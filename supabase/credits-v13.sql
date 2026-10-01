-- Credits V3 (catalog v13, docs/PLAN-UNIFIED-BG.md §9.2–§9.10, §11.9). Source for the generated V13 block in
-- schema.sql; run scripts/credits-sync.mjs after editing. Loaded AFTER credits-v12.sql: the lots, ledger, holds,
-- refunds and periods of V12 stay; this module replaces the functions whose rules changed.
--
--  * Included credits of a period are released linearly: R(t) = floor(B · min(1, max(0, (t − t₀) / 336 h))).
--    Spendable included = min(R − spent − held, unreserved left). B cannot be exhausted before 336 h.
--  * Guards on SETTLED included spend (rolling 24 h ≤ 25 % B, 7 days ≤ 50 % B) decide whether a NEW task may
--    start, never how large it may be. The 5 h / anchored-week windows and Boost are no longer enforced
--    (usage_windows stays for history and migration only).
--  * Spend order: starter bonus → carried (oldest expiry first) → included → packs. Packs are outside R(t) but
--    under a technical rate limit (credits per rolling hour).
--  * Active sites are a plan entitlement: site.day no longer charges AI credits.
--  * Free: 10 000 credits per month (released like any period), 1 active site. Starter bonus once per customer.
--  * Migration: lots that existed before V3 have no period (period_start is null) → fully released ("carried").

alter table public.credit_grants add column if not exists period_start timestamptz;
alter table public.credit_grants add column if not exists period_end timestamptz;
alter table public.credit_grants add column if not exists budget bigint check(budget is null or budget>=0);
create index if not exists credit_grants_period on public.credit_grants(user_id,period_start) where period_start is not null;
alter table public.sites add column if not exists last_entitled_day date;

-- Every settled credit, by lot and kind at the moment it was spent. The rolling guards read SETTLED included
-- spend from here (reservations never count against them); the pack rate limit reads pack spend.
create table if not exists public.credit_spends (
  id bigserial primary key, user_id uuid not null references public.profiles(user_id) on delete cascade,
  grant_id uuid, operation_id text not null, kind text not null check(kind in ('bonus','carried','included','pack')),
  credits bigint not null check(credits>0), at timestamptz not null
);
create index if not exists credit_spends_window on public.credit_spends(user_id,kind,at);
alter table public.credit_spends enable row level security;
drop policy if exists own_read on public.credit_spends;
create policy own_read on public.credit_spends for select to authenticated using(auth.uid()=user_id);

-- Starter bonus: once per customer — per account, per e-mail (hash) and per Paddle customer. Like trial_claims it
-- survives account deletion (the e-mail hash cannot claim again). Service role only.
create table if not exists public.bonus_claims (
  email_hash text primary key, user_id uuid unique references public.profiles(user_id) on delete set null,
  customer_ref text unique, claimed_at timestamptz not null default now()
);
alter table public.bonus_claims enable row level security;

-- site.day is an entitlement now; the action stays in the price table (0 credits) so old receipts still read.
do $$ begin
 if not exists(select 1 from public.settings where key='credits.v13') then
  update public.settings set value=jsonb_set(value,'{site.day}','{"credits":0,"window":false}'::jsonb) where key='pricing.actions';
  insert into public.settings(key,value) values('credits.v13',to_jsonb(now())) on conflict(key) do nothing;
 end if;
end $$;

-- Release, guard and bonus parameters: the reviewed catalog (settings billing.catalog), with V3 defaults.
create or replace function public.bid_v13_conf() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'hours',coalesce((c#>>'{release,hours}')::numeric,336),
  'guard24h',coalesce((c#>>'{release,guard24hShare}')::numeric,0.25),
  'guard7d',coalesce((c#>>'{release,guard7dShare}')::numeric,0.5),
  'packPerHour',coalesce((c#>>'{release,packCreditsPerHour}')::bigint,200000),
  'bonusCredits',coalesce((c#>>'{starterBonus,credits}')::bigint,60000),
  'bonusDays',coalesce((c#>>'{starterBonus,validityDays}')::integer,30),
  'bonusActions',coalesce(c#>'{starterBonus,actions}','["ai.fix","ai.fix.deep"]'::jsonb))
 from (select coalesce((select value from settings where key='billing.catalog'),'{}'::jsonb) as c) s;
$$;

-- Every unexpired lot with its kind at p_now. The current period is the latest plan period that contains p_now;
-- an older period that still overlaps it (late renewal) is already "carried".
create or replace function public.bid_v13_lots(p_user uuid,p_now timestamptz default now())
returns table(id uuid,kind text,rank integer,credits bigint,left_credits bigint,removed_credits bigint,allocated bigint,free bigint,
 budget bigint,period_start timestamptz,period_end timestamptz,granted_at timestamptz,expires_at timestamptz,source text,tier text)
language sql stable security definer set search_path=public,pg_temp as $$
 with cur as (
  select max(g.period_start) as start from credit_grants g
  where g.user_id=p_user and g.bucket='plan' and g.period_start is not null and g.period_start<=p_now and p_now<g.period_end
 ), lots as (
  select g.*,coalesce((select sum(a.credits) from credit_allocations a where a.grant_id=g.id),0)::bigint as alloc,
   case when g.source='bonus_grant' then 'bonus' when g.bucket='topup' then 'pack'
        when g.period_start is not null and g.period_start=(select start from cur) then 'included' else 'carried' end as k
  from credit_grants g where g.user_id=p_user and g.expires_at>p_now
 )
 select l.id,l.k,case l.k when 'bonus' then 1 when 'carried' then 2 when 'included' then 3 else 4 end,
  l.credits,l.left_credits,l.removed_credits,l.alloc,greatest(0,l.left_credits-l.alloc),
  coalesce(l.budget,l.credits),l.period_start,l.period_end,l.granted_at,l.expires_at,l.source,l.tier
 from lots l;
$$;

-- When the rolling window's settled included spend falls below p_cap again (null when it is below now).
create or replace function public.bid_v13_guard_clear(p_user uuid,p_now timestamptz,p_hours integer,p_cap bigint) returns timestamptz
language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_cap is null or (select coalesce(sum(credits),0) from credit_spends where user_id=p_user and kind='included'
   and at>p_now-make_interval(hours=>p_hours) and at<=p_now)<p_cap then null else
  (select min(s.at+make_interval(hours=>p_hours)) from credit_spends s where s.user_id=p_user and s.kind='included'
    and s.at>p_now-make_interval(hours=>p_hours) and s.at<=p_now
    and (select coalesce(sum(x.credits),0) from credit_spends x where x.user_id=p_user and x.kind='included' and x.at>s.at and x.at<=p_now)<p_cap) end;
$$;

-- The whole V3 availability picture at p_now (pure read). p_action decides whether the starter bonus applies.
create or replace function public.bid_v13_state(p_user uuid,p_now timestamptz default now(),p_action text default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb:=bid_v13_conf(); hours numeric; b bigint; t0 timestamptz; t1 timestamptz; spent bigint; held bigint; inc_free bigint; inc_left bigint;
 frac numeric; r bigint; by_release bigint; last24 bigint; last7 bigint; cap24 bigint; cap7 bigint; over24 boolean; over7 boolean; why text; avail_inc bigint;
 bonus_free bigint; bonus_ok boolean; bonus_exp timestamptz; carried_free bigint; pack_free bigint; pack_held bigint; pack_hour bigint; pack_cap bigint; pack_avail bigint;
begin
 hours:=(c->>'hours')::numeric;
 select coalesce(max(l.budget),0),min(l.period_start),max(l.period_end),coalesce(sum(l.credits-l.left_credits-l.removed_credits),0),coalesce(sum(l.allocated),0),coalesce(sum(l.free),0),coalesce(sum(l.left_credits),0)
  into b,t0,t1,spent,held,inc_free,inc_left from bid_v13_lots(p_user,p_now) l where l.kind='included';
 frac:=case when t0 is null then 0 when hours<=0 then 1 else least(1,greatest(0,extract(epoch from(p_now-t0))/(hours*3600))) end;
 r:=floor(b*frac);
 by_release:=greatest(0,r-spent-held);
 select coalesce(sum(credits) filter(where at>p_now-interval '24 hours'),0),coalesce(sum(credits),0) into last24,last7
  from credit_spends where user_id=p_user and kind='included' and at>p_now-interval '7 days' and at<=p_now;
 cap24:=case when (c->>'guard24h')::numeric>0 then floor(b*(c->>'guard24h')::numeric) end;
 cap7:=case when (c->>'guard7d')::numeric>0 then floor(b*(c->>'guard7d')::numeric) end;
 over24:=b>0 and cap24 is not null and last24>=cap24;
 over7:=b>0 and cap7 is not null and last7>=cap7;
 why:=case when b=0 or spent+held>=b or inc_free<=0 then 'exhausted' when over24 then 'guard24h' when over7 then 'guard7d'
  when least(by_release,inc_free)<inc_free then 'release' else 'ok' end;
 avail_inc:=case when over24 or over7 then 0 else least(by_release,inc_free) end;
 bonus_ok:=p_action is null or (c->'bonusActions') ? p_action;
 select coalesce(sum(l.free),0),min(l.expires_at) filter(where l.free>0) into bonus_free,bonus_exp from bid_v13_lots(p_user,p_now) l where l.kind='bonus';
 select coalesce(sum(l.free),0) into carried_free from bid_v13_lots(p_user,p_now) l where l.kind='carried';
 select coalesce(sum(l.free),0),coalesce(sum(l.allocated),0) into pack_free,pack_held from bid_v13_lots(p_user,p_now) l where l.kind='pack';
 select coalesce(sum(credits),0)+pack_held into pack_hour from credit_spends where user_id=p_user and kind='pack' and at>p_now-interval '1 hour' and at<=p_now;
 pack_cap:=case when (c->>'packPerHour')::bigint>0 then (c->>'packPerHour')::bigint end;
 pack_avail:=case when pack_cap is null then pack_free else least(pack_free,greatest(0,pack_cap-pack_hour)) end;
 return jsonb_build_object(
  'included',jsonb_build_object('budget',b,'released',r,'spent',spent,'held',held,'left',inc_left,'free',inc_free,'availableNow',avail_inc,
    'periodStart',t0,'periodEnd',t1,'releaseEndsAt',case when t0 is not null then t0+make_interval(secs=>hours*3600) end),
  'guards',jsonb_build_object('last24h',last24,'cap24h',cap24,'last7d',last7,'cap7d',cap7,
    'clears24hAt',case when over24 then bid_v13_guard_clear(p_user,p_now,24,cap24) end,'clears7dAt',case when over7 then bid_v13_guard_clear(p_user,p_now,168,cap7) end),
  'reason',why,
  'bonus',jsonb_build_object('free',bonus_free,'available',case when bonus_ok then bonus_free else 0 end,'expiresAt',bonus_exp,'appliesTo',c->'bonusActions'),
  'carried',carried_free,
  'packs',jsonb_build_object('free',pack_free,'available',pack_avail,'lastHour',pack_hour,'capPerHour',pack_cap),
  'availableNow',(case when bonus_ok then bonus_free else 0 end)+carried_free+avail_inc+pack_avail,
  'total',(case when bonus_ok then bonus_free else 0 end)+carried_free+inc_free+pack_free);
end $$;

-- Earliest moment at which p_need credits can start (assuming no further spending), with the binding rule.
-- readyAt is null when the current period cannot cover it at all (reason 'exhausted'; next period → periodEnd).
create or replace function public.bid_v13_ready_at(p_user uuid,p_need bigint,p_action text default null,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare st jsonb; c jsonb:=bid_v13_conf(); hours numeric; others bigint; need_inc bigint; b bigint; used bigint; t_rel timestamptz; t24 timestamptz; t7 timestamptz; ready timestamptz; why text;
begin
 perform bid_v13_accrue_free(p_user,p_now);
 if p_need is null or p_need<0 or p_need>1000000000 then raise exception 'invalid estimate'; end if;
 st:=bid_v13_state(p_user,p_now,p_action); hours:=(c->>'hours')::numeric;
 others:=(st#>>'{bonus,available}')::bigint+(st->>'carried')::bigint+(st#>>'{packs,available}')::bigint;
 if p_need<=others+(st#>>'{included,availableNow}')::bigint then
  return jsonb_build_object('need',p_need,'availableNow',(st->>'availableNow')::bigint,'readyAt',p_now,'reason','ok','state',st);
 end if;
 need_inc:=p_need-others; b:=(st#>>'{included,budget}')::bigint;
 used:=(st#>>'{included,spent}')::bigint+(st#>>'{included,held}')::bigint;
 if b=0 or used+need_inc>b or need_inc>(st#>>'{included,free}')::bigint then
  return jsonb_build_object('need',p_need,'availableNow',(st->>'availableNow')::bigint,'readyAt',null,'reason','exhausted','nextPeriodAt',st#>'{included,periodEnd}','state',st);
 end if;
 t_rel:=case when hours<=0 then p_now else (st#>>'{included,periodStart}')::timestamptz+make_interval(secs=>ceil((used+need_inc)::numeric/b*hours*3600)) end;
 t24:=(st#>>'{guards,clears24hAt}')::timestamptz; t7:=(st#>>'{guards,clears7dAt}')::timestamptz;
 ready:=greatest(p_now,t_rel,t24,t7);
 why:=case when ready=t7 then 'guard7d' when ready=t24 then 'guard24h' when ready=t_rel then 'release' else 'ok' end;
 return jsonb_build_object('need',p_need,'availableNow',(st->>'availableNow')::bigint,'readyAt',ready,'reason',why,'state',st);
end $$;

-- Free plan: one monthly period anchored at sign-up, granted lazily while no paid/trial entitlement exists.
create or replace function public.bid_v13_accrue_free(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare tokens bigint; anchor timestamptz; k integer; start_at timestamptz;
begin
 select (value#>>'{free,tokens}')::bigint into tokens from settings where key='plans';
 if coalesce(tokens,0)<=0 then return jsonb_build_object('ok',true,'granted',0); end if;
 select created_at into anchor from profiles where user_id=p_user and plan='free' and role='normal';
 if anchor is null or anchor>p_now or bid_v12_suspended(p_user)
  or exists(select 1 from subscriptions where user_id=p_user and status in ('active','trial','past_due') and (period_end is null or period_end>p_now)) then
  return jsonb_build_object('ok',true,'granted',0);
 end if;
 k:=greatest(0,(extract(year from p_now at time zone 'UTC')::int-extract(year from anchor at time zone 'UTC')::int)*12+extract(month from p_now at time zone 'UTC')::int-extract(month from anchor at time zone 'UTC')::int);
 if anchor+make_interval(months=>k)>p_now then k:=greatest(0,k-1); end if;
 start_at:=anchor+make_interval(months=>k);
 if exists(select 1 from credit_grants where user_id=p_user and source='free_grant' and granted_at=start_at) then return jsonb_build_object('ok',true,'granted',0); end if;
 return bid_grant(p_user,tokens,'free_grant','free:'||to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'free',start_at,start_at+interval '1 month',p_now);
end $$;

-- Starter bonus (§9.5.3): 60 000 credits once per customer, valid 30 days, spent first but only by the actions in
-- catalog.starterBonus.actions (creating a site / large fixes).
create or replace function public.bid_v13_claim_bonus(p_user uuid,p_email_hash text,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb:=bid_v13_conf(); customer text; r jsonb;
begin
 perform bid_v12_lock(p_user);
 if p_email_hash is null or p_email_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid bonus claim'; end if;
 if (c->>'bonusCredits')::bigint<=0 then return jsonb_build_object('ok',false,'code','not_available'); end if;
 if bid_v12_suspended(p_user) then return jsonb_build_object('ok',false,'code','account_suspended'); end if;
 select customer_ref into customer from subscriptions where user_id=p_user and customer_ref is not null order by updated_at desc limit 1;
 if exists(select 1 from bonus_claims where user_id=p_user or email_hash=p_email_hash
   or customer_ref in (select customer_ref from subscriptions where user_id=p_user and customer_ref is not null)) then
  return jsonb_build_object('ok',false,'code','bonus_used');
 end if;
 insert into bonus_claims(email_hash,user_id,customer_ref,claimed_at) values(p_email_hash,p_user,customer,p_now);
 r:=bid_grant(p_user,(c->>'bonusCredits')::bigint,'bonus_grant','bonus:'||p_user::text,null,p_now,p_now+make_interval(days=>(c->>'bonusDays')::integer),p_now);
 return r||jsonb_build_object('code','bonus_granted','appliesTo',c->'bonusActions');
end $$;

create or replace function public.bid_grant(p_user uuid,p_credits bigint,p_source text,p_ref text,p_tier text default null,p_granted_at timestamptz default now(),p_expires_at timestamptz default null,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare g credit_grants; conf jsonb; months integer; cap bigint; excess bigint; take bigint; debt_paid bigint; bucket_name text; cur credit_grants; b bigint;
begin
 perform bid_v12_refresh(p_user,p_now);
 if p_credits<0 or p_ref is null or length(p_ref)>300 or p_source not in ('plan_grant','trial_grant','upgrade_grant','topup','admin_grant','free_grant','bonus_grant') then raise exception 'invalid grant'; end if;
 select * into g from credit_grants where user_id=p_user and ref=p_ref and source=p_source;
 if found then return jsonb_build_object('ok',true,'duplicate',true,'id',g.id,'granted',g.credits); end if;
 select value->p_tier into conf from settings where key='plans';
 months:=case when p_source in ('topup','admin_grant') then 12 when p_source in ('free_grant','bonus_grant') then 1 else coalesce((conf->>'validity_months')::integer,1) end;
 bucket_name:=case when p_source in ('topup','admin_grant') then 'topup' else 'plan' end;
 insert into credit_grants(user_id,source,tier,bucket,credits,left_credits,granted_at,expires_at,ref)
 values(p_user,p_source,p_tier,bucket_name,p_credits,p_credits,p_granted_at,coalesce(p_expires_at,p_granted_at+make_interval(months=>months)),p_ref) returning * into g;
 -- V3 release: a plan/free payment opens a monthly period at its grant time (annual plans: one per monthly slice).
 -- An upgrade joins the running period (t₀ unchanged) and raises its budget B to the new tier's.
 if p_source in ('plan_grant','free_grant') then
  b:=case when p_source='free_grant' then p_credits else greatest(coalesce((conf->>'tokens')::bigint,p_credits),p_credits) end;
  update credit_grants set period_start=p_granted_at,period_end=p_granted_at+interval '1 month',budget=b where id=g.id;
  update credit_grants set budget=greatest(budget,b) where user_id=p_user and period_start=p_granted_at and id<>g.id;
 elsif p_source='upgrade_grant' then
  select * into cur from credit_grants where user_id=p_user and bucket='plan' and source in ('plan_grant','upgrade_grant') and id<>g.id
   and period_start is not null and period_start<=p_granted_at and p_granted_at<period_end order by period_start desc limit 1;
  if found then
   b:=greatest(coalesce((conf->>'tokens')::bigint,0),coalesce(cur.budget,0));
   update credit_grants set period_start=cur.period_start,period_end=cur.period_end,budget=b where id=g.id;
   update credit_grants set budget=greatest(budget,b) where user_id=p_user and period_start=cur.period_start;
  end if;
 end if;
 insert into credit_ledger(user_id,delta,bucket,reason,ref,expires_at) values(p_user,p_credits,bucket_name,p_source,p_ref,g.expires_at);
 select least(debt,p_credits) into debt_paid from credit_accounts where user_id=p_user;
 if debt_paid>0 then
  update credit_grants set left_credits=left_credits-debt_paid where id=g.id;
  -- Debt was already charged to the compatibility ledger. Grant pays it without charging twice.
  update credit_accounts set debt=debt-debt_paid,debt_since=case when debt=debt_paid then null else debt_since end where user_id=p_user;
 end if;
 -- D2 accumulation cap (B1): it limits only the NEW grant. Lots already paid stay until their own expiry,
 -- and lots bought under another tier (e.g. Knight before a downgrade) never count against the new tier's cap.
 if bucket_name='plan' and p_source not in ('trial_grant','free_grant','bonus_grant') then
  cap:=coalesce((conf->>'tokens')::bigint,p_credits)*months;
  select greatest(0,coalesce(sum(left_credits),0)-cap) into excess from credit_grants
   where user_id=p_user and bucket='plan' and source not in ('trial_grant','free_grant','bonus_grant') and tier is not distinct from p_tier;
  take:=least(excess,(select left_credits from credit_grants where id=g.id));
  if take>0 then
   update credit_grants set left_credits=left_credits-take,removed_credits=removed_credits+take where id=g.id;
   insert into credit_ledger(user_id,delta,bucket,reason,ref) values(p_user,-take,'plan','grant_cap',g.id::text||':'||g.id::text);
  end if;
 end if;
 perform bid_v12_refresh(p_user,p_now);
 return jsonb_build_object('ok',true,'granted',p_credits,'id',g.id,'expiresAt',g.expires_at,'debtPaid',debt_paid);
end $$;

-- Entitlements: Free now has its own row in settings.plans (10 000 credits, 1 active site).
create or replace function public.bid_v12_entitlement(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare tier text; conf jsonb; monthly bigint; site_limit integer; anchor timestamptz; trial_end timestamptz; minutes integer;
begin
 select plan::text,created_at into tier,anchor from profiles where user_id=p_user;
 select period_start,period_end into anchor,trial_end from subscriptions where user_id=p_user and provider='trial' and status='trial' and period_end>p_now limit 1;
 if found then
  select coalesce((value#>>'{trial,tokens}')::bigint,50000) into monthly from settings where key='billing.catalog';
  return jsonb_build_object('plan',tier,'monthly',monthly,'siteLimit',case when bid_v12_suspended(p_user) then 0 else 1 end,'anchor',anchor,'trial',true,'suspended',bid_v12_suspended(p_user),'cloudMinutes',0);
 end if;
 select coalesce(window_anchor,(raw->>'started_at')::timestamptz,period_start) into anchor from subscriptions where user_id=p_user and provider='paddle'
 order by (status in ('active','past_due')) desc,updated_at desc limit 1;
 anchor:=coalesce(anchor,(select created_at from profiles where user_id=p_user));
 select value->tier into conf from settings where key='plans';
 if tier='free' and conf is null then
  -- Pre-V13 policy (no Free row): a lapsed payer keeps one site while paid credits last.
  select cg.tier into tier from credit_grants cg where user_id=p_user and source in ('plan_grant','upgrade_grant') order by granted_at desc,id desc limit 1;
  site_limit:=case when tier is not null and exists(select 1 from credit_grants where user_id=p_user and left_credits>0 and expires_at>p_now) then 1 else 0 end;
  tier:=coalesce(tier,'flash');
  select value->tier into conf from settings where key='plans';
 end if;
 monthly:=coalesce((conf->>'tokens')::bigint,0);
 site_limit:=coalesce(site_limit,(conf->>'max_active_sites')::integer,0);
 minutes:=coalesce((conf->>'cloud_minutes')::integer,0);
 if bid_v12_suspended(p_user) then site_limit:=0; end if;
 return jsonb_build_object('plan',tier,'monthly',monthly,'siteLimit',site_limit,'fairUseSites',coalesce((conf->>'fair_use_sites')::integer,site_limit),'anchor',anchor,'trial',false,'suspended',bid_v12_suspended(p_user),'cloudMinutes',minutes);
end $$;

-- Reservation under the V3 rules. p_counts_window=false marks small technical actions (rollback, monitor extras):
-- they follow the spend order but not the release curve, guards or pack rate.
create or replace function public.bid_hold(p_user uuid,p_action text,p_credits bigint,p_operation_id text,p_site uuid default null,p_counts_window boolean default true,p_pricing_version text default '2026-10',p_ai_usage uuid default null,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h credit_holds; e usage_events; st jsonb; remaining bigint; available bigint; take bigint; r record; drift bigint; usable bigint; need_lots bigint;
 room_bonus bigint; room_inc bigint; room_pack bigint; limited bigint; code text; ready jsonb;
begin
 perform bid_v12_refresh(p_user,p_now);
 if p_credits<0 or p_credits>1000000000 or p_operation_id is null or length(p_operation_id) not between 8 and 200 then raise exception 'invalid charge'; end if;
 select * into e from usage_events where user_id=p_user and operation_id=p_operation_id;
 if found then
  if e.action<>p_action or e.site_id is distinct from p_site then return jsonb_build_object('ok',false,'code','operation_conflict'); end if;
  return jsonb_build_object('ok',true,'duplicate',true,'settled',true,'charged',e.credits);
 end if;
 select * into h from credit_holds where user_id=p_user and operation_id=p_operation_id;
 if found then
  if h.action<>p_action or h.credits<>p_credits or h.site_id is distinct from p_site then return jsonb_build_object('ok',false,'code','operation_conflict'); end if;
  return jsonb_build_object('ok',h.status='held','duplicate',true,'holdId',h.id,'code',case when h.status in ('released','orphaned') then 'operation_released' end);
 end if;
 if p_credits>0 and bid_v12_suspended(p_user) then return jsonb_build_object('ok',false,'code','account_suspended'); end if;
 if p_site is not null and not exists(select 1 from sites where id=p_site and user_id=p_user and (state='active' or p_action='deploy.rollback')) then return jsonb_build_object('ok',false,'code','site_paused'); end if;
 if p_ai_usage is not null and not exists(select 1 from ai_usage where id=p_ai_usage and user_id=p_user) then raise exception 'invalid AI operation'; end if;
 if p_credits>0 then perform bid_v13_accrue_free(p_user,p_now); end if;
 select coalesce(sum(delta),0) into available from credit_ledger where user_id=p_user;
 st:=bid_v13_state(p_user,p_now,p_action);
 -- Ledger credits without a lot (V1 writes, manual SQL) stay usable as before (B8); everything else must come
 -- from lots this action may use.
 drift:=greatest(0,available-((st#>>'{bonus,free}')::bigint+(st->>'carried')::bigint+(st#>>'{included,free}')::bigint+(st#>>'{packs,free}')::bigint));
 usable:=(st->>'total')::bigint;
 if p_credits>0 and (available<p_credits or usable+drift<p_credits) then
  return jsonb_build_object('ok',false,'code','quota_exhausted','reason','exhausted','balance',available,'credits',st);
 end if;
 room_bonus:=(st#>>'{bonus,available}')::bigint;
 room_inc:=case when p_counts_window then (st#>>'{included,availableNow}')::bigint else (st#>>'{included,free}')::bigint end;
 room_pack:=case when p_counts_window then (st#>>'{packs,available}')::bigint else (st#>>'{packs,free}')::bigint end;
 limited:=room_bonus+(st->>'carried')::bigint+room_inc+room_pack;
 need_lots:=least(p_credits,usable);
 if p_credits>0 and limited<need_lots then
  -- The rule whose lifting alone would let the task start is the one reported (the pack rate before the release).
  code:=case when room_pack<(st#>>'{packs,free}')::bigint and limited+(st#>>'{packs,free}')::bigint-room_pack>=need_lots then 'pack_rate'
   when room_inc<(st#>>'{included,free}')::bigint then
    case st->>'reason' when 'guard24h' then 'guard_24h' when 'guard7d' then 'guard_7d' else 'credits_release' end
   else 'pack_rate' end;
  ready:=bid_v13_ready_at(p_user,p_credits,p_action,p_now);
  return jsonb_build_object('ok',false,'code',code,'reason',case code when 'guard_24h' then 'guard24h' when 'guard_7d' then 'guard7d' when 'pack_rate' then 'packRate' else 'release' end,
   'availableNow',limited,'readyAt',ready->'readyAt','resetsAt',ready->'readyAt','credits',st);
 end if;
 insert into credit_holds(user_id,operation_id,action,credits,site_id,counts_in_window,pricing_version,ai_usage_id,created_at,expires_at)
 values(p_user,p_operation_id,p_action,p_credits,p_site,p_counts_window,p_pricing_version,p_ai_usage,p_now,p_now+bid_v12_hold_ttl(p_action)) returning * into h;
 remaining:=least(p_credits,limited);
 for r in select * from bid_v13_lots(p_user,p_now) l where l.free>0 and l.kind<>'bonus' or (l.kind='bonus' and room_bonus>0 and l.free>0) order by l.rank,l.expires_at,l.granted_at,l.id loop
  exit when remaining<=0;
  take:=least(remaining,r.free,case r.kind when 'bonus' then room_bonus when 'included' then room_inc when 'pack' then room_pack else r.free end);
  if take>0 then
   insert into credit_allocations(user_id,hold_id,grant_id,credits) values(p_user,h.id,r.id,take); remaining:=remaining-take;
   if r.kind='bonus' then room_bonus:=room_bonus-take; elsif r.kind='included' then room_inc:=room_inc-take; elsif r.kind='pack' then room_pack:=room_pack-take; end if;
  end if;
 end loop;
 remaining:=remaining+p_credits-least(p_credits,limited);
 -- B8: the ledger allowed the hold but the lots cannot pin all of it (a ledger write without a lot: V1 code,
 -- manual SQL). The request proceeds (settlement draws in spend order, any shortfall becomes debt); the drift is
 -- logged and left for the owner to reconcile instead of failing the user's request with a 503.
 if remaining>0 then
  raise warning 'credit grants and ledger need reconciliation for % (% credits unpinned)',p_user,remaining;
  insert into admin_notifications(kind,user_id,ref,payload,created_at)
  values('ledger_drift',p_user,p_user::text||':'||(p_now at time zone 'UTC')::date,jsonb_build_object('operation',p_operation_id,'unpinned',remaining,'ledgerAvailable',available),p_now)
  on conflict(kind,ref) do update set payload=excluded.payload;
 end if;
 insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id,created_at) values(p_user,-p_credits,'hold','hold',h.id::text,p_operation_id,p_now);
 return jsonb_build_object('ok',true,'holdId',h.id,'reserved',p_credits,'balance',available-p_credits,'credits',bid_v13_state(p_user,p_now,p_action));
end $$;

-- Settlement consumes pinned reservations first (in spend order). A started operation is always recorded,
-- including interrupted output or a provider count above the estimate: the overflow draws bonus → carried →
-- included → packs without the release limits, any shortfall becomes explicit debt. Every take is a credit_spends row.
create or replace function public.bid_settle(p_user uuid,p_operation_id text,p_credits bigint,p_ai jsonb default null,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h credit_holds; e usage_events; remaining bigint; take bigint; r record; balance bigint; bonus_ok boolean;
begin
 perform bid_v12_lock(p_user);
 select * into e from usage_events where user_id=p_user and operation_id=p_operation_id;
 if found then return jsonb_build_object('ok',true,'duplicate',true,'charged',e.credits); end if;
 select * into h from credit_holds where user_id=p_user and operation_id=p_operation_id;
 if not found or h.status not in ('held','orphaned') then return jsonb_build_object('ok',false,'code','operation_released'); end if;
 if p_credits<0 or p_credits>1000000000 then raise exception 'invalid settlement'; end if;
 remaining:=p_credits;
 -- A pinned lot may have expired or changed kind meanwhile (the hold keeps it); its kind is read as of now.
 for r in select g.id,g.bucket,a.credits as allocation,coalesce(l.kind,case when g.source='bonus_grant' then 'bonus' when g.bucket='topup' then 'pack' else 'carried' end) as kind
   from credit_allocations a join credit_grants g on g.id=a.grant_id left join bid_v13_lots(p_user,p_now) l on l.id=a.grant_id
   where a.hold_id=h.id order by coalesce(l.rank,2),g.expires_at,g.granted_at,g.id loop
  take:=least(remaining,r.allocation);
  if take>0 then
   update credit_grants set left_credits=left_credits-take where id=r.id;
   insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id,pricing_version,created_at) values(p_user,-take,r.bucket,'action',p_operation_id,p_operation_id,h.pricing_version,p_now);
   insert into credit_spends(user_id,grant_id,operation_id,kind,credits,at) values(p_user,r.id,p_operation_id,r.kind,take,p_now);
   remaining:=remaining-take;
  end if;
 end loop;
 delete from credit_allocations where hold_id=h.id;
 bonus_ok:=(bid_v13_conf()->'bonusActions') ? h.action;
 for r in select l.*,g.bucket from bid_v13_lots(p_user,p_now) l join credit_grants g on g.id=l.id where l.free>0 and (l.kind<>'bonus' or bonus_ok) order by l.rank,l.expires_at,l.granted_at,l.id loop
  exit when remaining<=0;
  take:=least(remaining,r.free);
  if take>0 then
   update credit_grants set left_credits=left_credits-take where id=r.id;
   insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id,pricing_version,created_at) values(p_user,-take,r.bucket,'action',p_operation_id,p_operation_id,h.pricing_version,p_now);
   insert into credit_spends(user_id,grant_id,operation_id,kind,credits,at) values(p_user,r.id,p_operation_id,r.kind,take,p_now);
   remaining:=remaining-take;
  end if;
 end loop;
 if remaining>0 then
  update credit_accounts set debt=debt+remaining,debt_since=coalesce(debt_since,p_now) where user_id=p_user;
  insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id,pricing_version,created_at) values(p_user,-remaining,'topup','action',p_operation_id,p_operation_id,h.pricing_version,p_now);
 end if;
 if h.status='held' then
  insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id,created_at) values(p_user,h.credits,'hold','hold_release',h.id::text,p_operation_id,p_now);
 end if;
 update credit_holds set status='settled' where id=h.id;
 insert into usage_events(user_id,site_id,action,credits,counts_in_window,operation_id,ai_usage_id,pricing_version,created_at)
 values(p_user,h.site_id,h.action,p_credits,h.counts_in_window,p_operation_id,h.ai_usage_id,h.pricing_version,p_now);
 insert into usage_daily(user_id,day,site_id,action,credits,count) values(p_user,(p_now at time zone 'UTC')::date,h.site_id,h.action,p_credits,1)
 on conflict(user_id,day,(coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid)),action) do update set credits=usage_daily.credits+excluded.credits,count=usage_daily.count+1;
 if h.ai_usage_id is not null and p_ai is not null then
  update ai_usage set charged_tokens=p_credits,status=coalesce(p_ai->>'status','ok'),model=coalesce(p_ai->>'model',model),input_tokens=(p_ai->>'input')::integer,output_tokens=(p_ai->>'output')::integer,cost_usd=(p_ai->>'costUsd')::numeric where id=h.ai_usage_id and user_id=p_user;
 end if;
 perform bid_v12_refresh(p_user,p_now);
 select coalesce(sum(delta),0) into balance from credit_ledger where user_id=p_user;
 return jsonb_build_object('ok',true,'charged',p_credits,'balance',balance,'credits',bid_v13_state(p_user,p_now,h.action));
end $$;

-- Boost raised the old 5 h / weekly windows; with the release curve it has nothing to raise (Р-4).
create or replace function public.bid_boost(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform bid_v12_lock(p_user);
 return jsonb_build_object('ok',false,'code','boost_unavailable');
end $$;

-- Daily site pass: an active site costs no AI credits (plan entitlement). Only paid monitoring extras recur.
create or replace function public.bid_v12_burn_one(p_user uuid,p_site uuid,p_day date,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s sites; r jsonb; cnt integer; extra bigint;
begin
 perform bid_v12_refresh(p_user,p_now);
 select * into s from sites where user_id=p_user and id=p_site;
 if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
 update sites set last_burn_attempt_at=p_now where id=p_site;
 if s.last_entitled_day>=p_day then return jsonb_build_object('ok',true,'duplicate',true,'charged',0); end if;
 -- B4: the 14-day migration grace is free (also for monitoring extras).
 if s.migration_grace_until>p_now then return jsonb_build_object('ok',true,'grace',true,'charged',0); end if;
 select coalesce(min(interval_min),10),coalesce(max(jsonb_array_length(coalesce(checks->'paths','[]'::jsonb))),0) into cnt,extra from monitor_targets where site_id=p_site and enabled;
 r:=bid_v12_monitor_extras(p_user,p_site,cnt,extra::integer,p_day,p_now);
 if not (r->>'ok')::boolean then
  update monitor_targets set interval_min=greatest(interval_min,10),checks=jsonb_set(checks,'{paths}',coalesce((select jsonb_agg(value) from jsonb_array_elements(checks->'paths') with ordinality as p(value,n) where n<=3),'[]'::jsonb)) where site_id=p_site;
 end if;
 update sites set last_entitled_day=greatest(coalesce(last_entitled_day,p_day),p_day) where id=p_site;
 return jsonb_build_object('ok',true,'charged',coalesce((r->>'charged')::bigint,0));
end $$;

create or replace function public.bid_site_burn(p_day date default (now() at time zone 'UTC')::date,p_batch integer default 100,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s record; n integer:=0; r jsonb;
begin
 if p_day>(p_now at time zone 'UTC')::date or p_day<(p_now at time zone 'UTC')::date-1 then raise exception 'invalid burn day'; end if;
 for s in select * from sites where state='active' and activated_at<(p_day+1)::timestamp at time zone 'UTC'
  and (migration_grace_until is null or migration_grace_until<=p_now)
  and (last_entitled_day is null or last_entitled_day<p_day)
  order by last_burn_attempt_at nulls first,user_id,id limit greatest(1,least(p_batch,1000)) loop
  perform bid_enforce_sites(s.user_id,p_now);
  if exists(select 1 from sites where id=s.id and state='active') then
   r:=bid_v12_burn_one(s.user_id,s.id,p_day,p_now);
   n:=n+1;
  end if;
 end loop;
 return jsonb_build_object('ok',true,'processed',n);
end $$;

-- Activating a site needs a free slot of the plan's site entitlement, not AI credits.
create or replace function public.bid_site_change(p_user uuid,p_project text,p_active boolean,p_hosting text default 'user',p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s sites; ent jsonb; lim integer; n integer; tier text; r jsonb;
begin
 perform bid_v12_refresh(p_user,p_now);
 if p_project is null or length(p_project) not between 1 and 200 or p_hosting not in ('user','bid') then raise exception 'invalid site'; end if;
 select * into s from sites where user_id=p_user and project_key=p_project;
 if not p_active then
  if s.id is not null then update sites set state='paused',paused_at=p_now,paused_reason='user' where id=s.id; end if;
  return jsonb_build_object('ok',true,'siteId',s.id,'state','paused');
 end if;
 if s.state='active' then return jsonb_build_object('ok',true,'siteId',s.id,'state','active','duplicate',true); end if;
 if not exists(select 1 from bid_projects where user_id=p_user and key=p_project) then return jsonb_build_object('ok',false,'code','not_found'); end if;
 select plan::text into tier from profiles where user_id=p_user;
 if p_hosting='bid' and tier<>'knight' then return jsonb_build_object('ok',false,'code','hosting_plan'); end if;
 -- Owner-hosted provisioning requires a separate provider setup; this endpoint cannot imply it exists.
 if p_hosting='bid' and (s.netlify_site_id is null or s.hosting_owner<>'bid') then return jsonb_build_object('ok',false,'code','hosting_not_ready'); end if;
 ent:=bid_v12_entitlement(p_user,p_now); lim:=(ent->>'siteLimit')::integer;
 select count(*) into n from sites where user_id=p_user and state='active';
 if n>=lim then return jsonb_build_object('ok',false,'code','site_limit','active',n,'limit',lim); end if;
 insert into sites(user_id,project_key,state,hosting_owner,activated_at) values(p_user,p_project,'active',p_hosting,p_now)
 on conflict(user_id,project_key) do update set state='active',hosting_owner=excluded.hosting_owner,activated_at=p_now,paused_at=null,paused_reason=null,migration_grace_until=null returning * into s;
 r:=bid_v12_burn_one(p_user,s.id,(p_now at time zone 'UTC')::date,p_now);
 return r||jsonb_build_object('siteId',s.id,'state','active');
end $$;

create or replace function public.bid_credit_status(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare before_n bigint; after_n bigint; reserved bigint; available bigint; plan_left bigint; packs_left bigint; debt_now bigint; st jsonb;
begin
 select count(*) into before_n from credit_holds where user_id=p_user and status='held';
 before_n:=before_n+(select count(*) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 perform bid_v12_refresh(p_user,p_now);
 perform bid_v13_accrue_free(p_user,p_now);
 select count(*),coalesce(sum(credits),0) into after_n,reserved from credit_holds where user_id=p_user and status='held';
 after_n:=after_n+(select count(*) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 reserved:=reserved-(select coalesce(sum(delta),0) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 select coalesce(sum(delta),0) into available from credit_ledger where user_id=p_user;
 select coalesce(sum(left_credits) filter(where bucket='plan'),0),coalesce(sum(left_credits) filter(where bucket='topup'),0) into plan_left,packs_left from credit_grants where user_id=p_user;
 select debt into debt_now from credit_accounts where user_id=p_user;
 st:=bid_v13_state(p_user,p_now,null);
 return jsonb_build_object('ok',true,'released',before_n-after_n,'reservedTokens',reserved,'open',after_n,'available',greatest(0,available),'balance',available,'plan',plan_left,'topup',packs_left,'total',greatest(0,plan_left+packs_left-debt_now),'debt',debt_now,
  'availableNow',(st->>'availableNow')::bigint,'reason',st->>'reason','entitlements',bid_v12_entitlement(p_user,p_now));
end $$;

-- Usage contract v3 (superset of v2 so older decoders keep working). `session`/`weekly` now describe the 24 h and
-- 7-day guards; the Edge function labels the version the caller asked for.
create or replace function public.bid_usage_summary(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ent jsonb; st jsonb; tier text; s subscriptions; start_at timestamptz; end_at timestamptz; k integer;
 included bigint; used bigint; operations bigint; reserved bigint; open_holds bigint; available bigint; plan_left bigint; packs_left bigint; debt_now bigint;
 actions jsonb; daily jsonb; models jsonb; lots jsonb; carried jsonb; bonus jsonb; site_items jsonb; hist jsonb; ledger jsonb; v_period_ref text; v_threshold integer; nudge jsonb;
 active_count integer; paused_count integer; lim integer; forecast numeric; cap24 bigint; cap7 bigint; inc_held bigint;
begin
 perform bid_v12_refresh(p_user,p_now);
 perform bid_v13_accrue_free(p_user,p_now);
 perform bid_enforce_sites(p_user,p_now);
 ent:=bid_v12_entitlement(p_user,p_now); st:=bid_v13_state(p_user,p_now,null);
 select plan::text into tier from profiles where user_id=p_user;
 select * into s from subscriptions where user_id=p_user and status in ('active','trial','past_due') and period_end>p_now order by tier desc,updated_at desc limit 1;
 start_at:=coalesce((st#>>'{included,periodStart}')::timestamptz,s.period_start,date_trunc('month',p_now at time zone 'UTC') at time zone 'UTC');
 end_at:=coalesce((st#>>'{included,periodEnd}')::timestamptz,s.period_end,start_at+interval '1 month');
 if (st#>>'{included,periodStart}') is null and s.raw#>>'{billing_cycle,interval}'='year' then
  k:=greatest(0,(extract(year from p_now at time zone 'UTC')::int-extract(year from start_at at time zone 'UTC')::int)*12+extract(month from p_now at time zone 'UTC')::int-extract(month from start_at at time zone 'UTC')::int);
  if start_at+make_interval(months=>k)>p_now then k:=greatest(0,k-1); end if;
  end_at:=least(end_at,start_at+make_interval(months=>k+1)); start_at:=start_at+make_interval(months=>k);
 end if;
 included:=(st#>>'{included,budget}')::bigint;
 if included=0 then
  select coalesce(sum(credits),0) into included from credit_grants where user_id=p_user and source in ('plan_grant','trial_grant','upgrade_grant','free_grant') and granted_at>=start_at and granted_at<end_at;
 end if;
 select coalesce(sum(credits),0),count(*) into used,operations from usage_events where user_id=p_user and created_at>=start_at and created_at<end_at;
 select coalesce(sum(credits),0),count(*) into reserved,open_holds from credit_holds where user_id=p_user and status='held';
 reserved:=reserved-(select coalesce(sum(delta),0) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 open_holds:=open_holds+(select count(*) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 select coalesce(sum(delta),0) into available from credit_ledger where user_id=p_user;
 select coalesce(sum(left_credits) filter(where bucket='plan'),0),coalesce(sum(left_credits) filter(where bucket='topup'),0) into plan_left,packs_left from credit_grants where user_id=p_user;
 select debt into debt_now from credit_accounts where user_id=p_user;
 select coalesce(jsonb_agg(x),'[]') into actions from(select action,sum(credits) as credits,count(*) as count,count(*) as operations from usage_events where user_id=p_user and created_at>=start_at and created_at<end_at group by action order by sum(credits) desc) x;
 select coalesce(jsonb_agg(x order by x.day),'[]') into daily from(select d.day::date as day,d.day::date as date,coalesce(sum(u.credits),0) as credits from generate_series((p_now at time zone 'UTC')::date-29,(p_now at time zone 'UTC')::date,interval '1 day') d(day) left join usage_daily u on u.day=d.day::date and u.user_id=p_user group by d.day) x;
 select coalesce(jsonb_agg(x),'[]') into models from(select coalesce(a.model,'unknown') as model,sum(e.credits) as tokens,count(*) as operations from usage_events e join ai_usage a on a.id=e.ai_usage_id where e.user_id=p_user and e.created_at>=start_at and e.created_at<end_at group by a.model) x;
 select coalesce(jsonb_agg(x order by x."expiresAt"),'[]') into lots from(select l.id,l.source,l.kind,l.credits,l.left_credits as remaining,l.granted_at as "grantedAt",l.expires_at as "expiresAt" from bid_v13_lots(p_user,p_now) l where l.left_credits>0) x;
 select coalesce(jsonb_agg(x order by x."expiresAt"),'[]') into carried from(select l.id,l.source,l.left_credits as remaining,l.free as available,l.granted_at as "grantedAt",l.expires_at as "expiresAt" from bid_v13_lots(p_user,p_now) l where l.kind='carried' and l.left_credits>0) x;
 select jsonb_build_object('credits',coalesce(sum(l.credits),0),'remaining',coalesce(sum(l.left_credits),0),'expiresAt',min(l.expires_at),'claimed',exists(select 1 from bonus_claims where user_id=p_user),'appliesTo',st#>'{bonus,appliesTo}')
  into bonus from bid_v13_lots(p_user,p_now) l where l.kind='bonus';
 select count(*) filter(where state='active'),count(*) filter(where state='paused') into active_count,paused_count from sites where user_id=p_user;
 lim:=(ent->>'siteLimit')::integer;
 select coalesce(jsonb_agg(x),'[]') into site_items from(select t.id,t.project_key as "projectKey",coalesce(p.name,t.project_key) as name,t.state,t.hosting_owner as "hostingOwner",t.paused_reason as "pausedReason",t.migration_grace_until as "graceUntil",coalesce((select sum(credits) from usage_events where site_id=t.id and created_at>=start_at and created_at<end_at),0) as credits from sites t left join bid_projects p on p.user_id=t.user_id and p.key=t.project_key where t.user_id=p_user order by t.state,t.activated_at,t.id) x;
 select coalesce(jsonb_agg(x),'[]') into hist from(select e.id::text as id,e.created_at as at,e.action as step,coalesce(a.project_key,cr.project_key) as project,a.model,coalesce(a.status,case when cr.report->>'status' in ('ready','warnings','complete') then 'ok' else cr.report->>'status' end,'ok') as status,e.credits as tokens,a.input_tokens as input,a.output_tokens as output,e.pricing_version as "pricingVersion",e.operation_id as "operationId" from usage_events e left join ai_usage a on a.id=e.ai_usage_id left join cloud_reports cr on cr.user_id=e.user_id and cr.operation_id=e.operation_id where e.user_id=p_user order by e.created_at desc,e.id desc limit 50) x;
 select coalesce(jsonb_agg(x),'[]') into ledger from(select id,created_at as at,delta,bucket,reason,ref,pricing_version as "pricingVersion" from credit_ledger where user_id=p_user order by created_at desc,id desc limit 50) x;
 v_threshold:=case when included<=0 then 0 when used>=included then 100 when used>=included*0.9 then 90 when used>=included*0.75 then 75 else 0 end;
 v_period_ref:=start_at::text;
 if v_threshold>0 and not exists(select 1 from usage_nudges where user_id=p_user and usage_nudges.period_ref=v_period_ref and usage_nudges.threshold=v_threshold::text) then
  nudge:=jsonb_build_object('threshold',v_threshold,'periodRef',v_period_ref,'kind',case when tier='knight' then 'buy' else 'upgrade' end,'target',case when tier in ('free','flash') then 'high' when tier='high' then 'knight' end);
 end if;
 forecast:=case when used>0 then floor(greatest(available,0)/(used/greatest(1,extract(epoch from(p_now-start_at))/86400))) else null end;
 cap24:=coalesce((st#>>'{guards,cap24h}')::bigint,0); cap7:=coalesce((st#>>'{guards,cap7d}')::bigint,0); inc_held:=(st#>>'{included,held}')::bigint;
 return jsonb_build_object('v',3,'serverTime',p_now,'unit','credits','plan',tier,'source','cloud',
  'included',jsonb_build_object('tokens',included)||(st->'included'),
  'guards',st->'guards','reason',st->>'reason',
  'available',jsonb_build_object('now',(st->>'availableNow')::bigint,'total',(st->>'total')::bigint),
  'carried',carried,'bonus',bonus,
  'packRate',jsonb_build_object('lastHour',st#>'{packs,lastHour}','capPerHour',st#>'{packs,capPerHour}'),
  'cloudMinutes',jsonb_build_object('included',coalesce((ent->>'cloudMinutes')::integer,0),'used',null,'tracked',false),
  -- v2 compatibility: the two rolling meters are now the 24 h and 7-day guards on settled included spend.
  'session',jsonb_build_object('windowHours',24,'capPercent',25,'cap',cap24,'used',(st#>>'{guards,last24h}')::bigint,'reserved',inc_held,'remaining',greatest(0,cap24-(st#>>'{guards,last24h}')::bigint),'resetsAt',st#>'{guards,clears24hAt}'),
  'weekly',jsonb_build_object('windowHours',168,'capPercent',50,'cap',cap7,'used',(st#>>'{guards,last7d}')::bigint,'reserved',inc_held,'remaining',greatest(0,cap7-(st#>>'{guards,last7d}')::bigint),'resetsAt',st#>'{guards,clears7dAt}'),
  'period',jsonb_build_object('start',start_at,'end',end_at,'renewsAt',case when s.cancel_at is null then s.period_end end,'source',case when s.id is null then 'calendar' else 'subscription' end,'included',included,'used',used,'reserved',reserved,'packs',packs_left,'available',greatest(available,0),'debt',debt_now,'forecastDaysLeft',forecast),
  'used',jsonb_build_object('tokens',used,'operations',operations),'reserved',jsonb_build_object('tokens',reserved,'operations',open_holds),
  'remaining',jsonb_build_object('plan',plan_left,'purchased',packs_left,'total',greatest(plan_left+packs_left-debt_now,0),'available',greatest(available,0)),
  'purchased',jsonb_build_object('tokens',packs_left,'expires','12 months after purchase'),'grants',lots,'packs',(select coalesce(jsonb_agg(x),'[]') from(select id,left_credits as remaining,expires_at as "expiresAt" from credit_grants where user_id=p_user and bucket='topup' and left_credits>0 and expires_at>p_now order by expires_at) x),
  'sites',jsonb_build_object('active',active_count,'paused',paused_count,'limit',lim,'max',lim,'fairUse',coalesce((ent->>'fairUseSites')::integer,lim),'items',site_items),'byAction',actions,'daily',daily,'byModel',models,'nudge',nudge,
  'limits',jsonb_build_object('perMinute',6,'perHour',60,'releaseHours',(bid_v13_conf()->>'hours')::numeric,'guard24hPercent',25,'guard7dPercent',50),
  'pricing',jsonb_build_object('version',coalesce((select value#>>'{}' from settings where key='pricing.version'),'2026-10'),'spendOrder',jsonb_build_array('bonus','carried','included','packs')),'history',jsonb_build_object('operations',hist,'ledger',ledger));
end $$;

-- V12 site migration (moved here: it needs the entitlement function above). Runs once.
do $$ begin
 if not exists(select 1 from settings where key='credits.sitesMigrated') then
  perform bid_v12_migrate_sites(now());
  insert into settings(key,value) values('credits.sitesMigrated',to_jsonb(now()));
 end if;
end $$;

-- No client can invoke a monetary mutation or a SECURITY DEFINER helper, including via PostgREST.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'bid_v12_%' or p.proname like 'bid_v13_%' or p.proname in ('bid_accrue_periods','bid_record_payment','bid_scheduler_credits','bid_monitor_register','bid_start_trial','bid_upgrade_grant','bid_domain_request','bid_credit_status','bid_grant','bid_hold','bid_settle','bid_release','bid_charge','bid_boost','bid_refund','bid_enforce_sites','bid_site_burn','bid_site_change','bid_nudge_ack','bid_usage_summary','bid_reconcile_usage')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
