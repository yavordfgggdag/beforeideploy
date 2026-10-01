-- Credits V2. Source for the generated block in schema.sql; run scripts/credits-sync.mjs after editing.
-- All mutations share one transaction-scoped user lock. The ledger remains the compatibility balance.
create table if not exists public.credit_accounts (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  debt bigint not null default 0 check (debt >= 0), debt_since timestamptz, legacy_ledger_id bigint not null default 0,
  migrated_at timestamptz not null default now(), migration_grace_until timestamptz
);
create table if not exists public.credit_grants (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(user_id) on delete cascade,
  source text not null, tier text, bucket text not null check (bucket in ('plan','topup')),
  credits bigint not null check (credits >= 0), left_credits bigint not null check (left_credits >= 0 and left_credits <= credits),
  granted_at timestamptz not null, expires_at timestamptz not null, ref text not null,
  unique(user_id,ref,source), unique(user_id,id)
);
create index if not exists credit_grants_fifo on public.credit_grants(user_id,expires_at,granted_at,id) where left_credits>0;
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(user_id) on delete cascade,
  project_key text not null, state text not null default 'paused' check(state in ('active','paused','archived')),
  hosting_owner text not null default 'user' check(hosting_owner in ('user','bid')), netlify_site_id text,
  activated_at timestamptz, paused_at timestamptz, paused_reason text,
  migration_grace_until timestamptz, last_burn_attempt_at timestamptz, created_at timestamptz not null default now(),
  unique(user_id,project_key), unique(user_id,id)
);
create table if not exists public.usage_windows (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null check(kind in ('5h','week')), opened_at timestamptz not null, resets_at timestamptz not null,
  cap bigint not null check(cap>=0), used bigint not null default 0 check(used>=0), week_anchor timestamptz,
  boost_until timestamptz, boost_used_at timestamptz, unique(user_id,kind,opened_at), unique(user_id,id)
);
create table if not exists public.credit_holds (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(user_id) on delete cascade,
  operation_id text not null, action text not null, credits bigint not null check(credits>=0),
  site_id uuid, counts_in_window boolean not null, pricing_version text not null,
  window_5h_id uuid, window_week_id uuid, ai_usage_id uuid references public.ai_usage(id) on delete set null,
  created_at timestamptz not null, expires_at timestamptz not null,
  status text not null default 'held' check(status in ('held','settled','released','orphaned')),
  foreign key(user_id,site_id) references public.sites(user_id,id),
  foreign key(user_id,window_5h_id) references public.usage_windows(user_id,id),
  foreign key(user_id,window_week_id) references public.usage_windows(user_id,id),
  unique(user_id,operation_id), unique(user_id,id)
);
create table if not exists public.credit_allocations (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  hold_id uuid not null, grant_id uuid not null, credits bigint not null check(credits>0),
  foreign key(user_id,hold_id) references public.credit_holds(user_id,id) on delete cascade,
  foreign key(user_id,grant_id) references public.credit_grants(user_id,id) on delete cascade,
  primary key(hold_id,grant_id)
);
create table if not exists public.usage_events (
  id bigserial primary key, user_id uuid not null references public.profiles(user_id) on delete cascade,
  site_id uuid, action text not null, units numeric not null default 1 check(units>=0), credits bigint not null check(credits>=0),
  counts_in_window boolean not null, operation_id text not null, ai_usage_id uuid references public.ai_usage(id) on delete set null,
  pricing_version text not null, window_5h_id uuid, window_week_id uuid, created_at timestamptz not null default now(),
  foreign key(user_id,site_id) references public.sites(user_id,id),
  foreign key(user_id,window_5h_id) references public.usage_windows(user_id,id),
  foreign key(user_id,window_week_id) references public.usage_windows(user_id,id), unique(user_id,operation_id)
);
create index if not exists usage_events_period on public.usage_events(user_id,created_at);
create table if not exists public.usage_daily (
  id bigserial primary key, user_id uuid not null references public.profiles(user_id) on delete cascade,
  day date not null, site_id uuid, action text not null, credits bigint not null default 0, count bigint not null default 0,
  foreign key(user_id,site_id) references public.sites(user_id,id)
);
create unique index if not exists usage_daily_key on public.usage_daily(user_id,day,coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid),action);
create table if not exists public.usage_nudges (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  period_ref text not null, threshold text not null, shown_at timestamptz not null default now(), channel text not null default 'app',
  primary key(user_id,period_ref,threshold)
);
create table if not exists public.domain_orders (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(user_id) on delete cascade,
  site_id uuid, domain text not null, registrar text not null default 'spaceship', cost_eur numeric(10,2) check(cost_eur>=0),
  status text not null default 'review', included boolean not null default true, year_ref text not null,
  registered_at timestamptz, expires_at timestamptz, created_at timestamptz not null default now(),
  foreign key(user_id,site_id) references public.sites(user_id,id),
  check(not included or cost_eur<=15)
);
create unique index if not exists domain_orders_included on public.domain_orders(user_id,year_ref) where included and status<>'rejected';
create table if not exists public.netlify_allocations (
  user_id uuid not null references public.profiles(user_id) on delete cascade, period_ref text not null,
  included bigint not null default 3000, used bigint not null default 0, overage_credits bigint not null default 0,
  primary key(user_id,period_ref)
);
alter table public.subscriptions add column if not exists window_anchor timestamptz;
update public.subscriptions set window_anchor=coalesce((raw->>'started_at')::timestamptz,period_start) where window_anchor is null;
alter table public.monitor_targets add column if not exists site_id uuid references public.sites(id) on delete set null;
alter table public.credit_ledger add column if not exists operation_id text;
alter table public.credit_ledger add column if not exists expires_at timestamptz;
create index if not exists credit_ledger_operation on public.credit_ledger(user_id,operation_id) where operation_id is not null;

do $$ declare t text; begin
  foreach t in array array['credit_accounts','credit_grants','credit_holds','credit_allocations','sites','usage_windows','usage_events','usage_daily','usage_nudges','domain_orders','netlify_allocations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists own_read on public.%I',t);
    execute format('create policy own_read on public.%I for select to authenticated using(auth.uid()=user_id)',t);
  end loop;
end $$;

insert into public.settings(key,value) values
 ('pricing.actions','{"site.day":{"credits":1000,"window":false},"monitor.fast":{"credits":500,"window":false},"monitor.path":{"credits":50,"window":false},"check.run":{"credits":50,"window":true},"audit.full":{"credits":400,"window":true},"deploy.preview":{"credits":150,"window":true},"deploy.production":{"credits":500,"window":true},"deploy.rollback":{"credits":0,"window":false},"backup.snapshot":{"credits":100,"window":true},"ai.fix":{"actual":true,"window":true},"ai.fix.deep":{"actual":true,"window":true},"ai.chat":{"actual":true,"window":true}}'),
 ('billing.graceDays','3'),('features.netlifyCredits','false'),('features.knightDomain','true') on conflict(key) do nothing;
do $$ begin
 if not exists(select 1 from public.settings where key='credits.migration' and value='2'::jsonb) then
  insert into public.settings(key,value) values('ai.creditEur','0.000025'),('pricing.version','"2026-10"'),('credits.migration','2') on conflict(key) do update set value=excluded.value;
 end if;
end $$;

-- Reads are also locked when they perform lazy expiry. p_now is supplied only by trusted server code/tests.
create or replace function public.bid_v12_lock(p_user uuid) returns void
language sql security definer set search_path=public,pg_temp as $$ select pg_advisory_xact_lock(hashtextextended(p_user::text,12)); $$;

-- Import V1 balances without minting credits or changing old ledger/pricing records. Reconstruct the
-- unspent tail of positive grants in each bucket; unknown manual balances receive a 12-month expiry.
create or replace function public.bid_v12_refresh(p_user uuid,p_now timestamptz default now()) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; keep bigint; held bigint; take bigint; total bigint; months integer; tier text; cursor_id bigint; legacy record;
begin
 perform bid_v12_lock(p_user);
 if not exists(select 1 from credit_accounts where user_id=p_user) then
  insert into credit_accounts(user_id,migrated_at) values(p_user,p_now);
  select plan::text into tier from profiles where user_id=p_user;
  months:=case tier when 'flash' then 1 when 'high' then 3 when 'knight' then 10 else 12 end;
  for r in select * from credit_ledger where user_id=p_user and bucket in ('plan','topup') and delta>0 order by bucket,created_at desc,id desc loop
   select greatest(0,coalesce(sum(delta),0)) into total from credit_ledger where user_id=p_user and bucket=r.bucket;
   select coalesce(sum(left_credits),0) into held from credit_grants where user_id=p_user and bucket=r.bucket;
   keep:=least(r.delta,greatest(0,total-held));
   insert into credit_grants(user_id,source,tier,bucket,credits,left_credits,granted_at,expires_at,ref)
   values(p_user,r.reason,tier,r.bucket,r.delta,keep,r.created_at,
     coalesce(r.expires_at,case when r.reason='trial_grant' then (select period_end from subscriptions where user_id=p_user and provider='trial' order by updated_at desc limit 1) end,r.created_at+make_interval(months=>case when r.bucket='topup' then 12 else months end)),case when r.reason='admin_grant' then 'legacy:'||r.id else coalesce(r.ref,'legacy:'||r.id) end);
  end loop;
  select coalesce(-sum(n),0) into total from(select sum(delta) as n from credit_ledger where user_id=p_user and bucket<>'hold' group by bucket having sum(delta)<0) b;
  update credit_accounts set debt=total,debt_since=case when total>0 then p_now end,legacy_ledger_id=(select coalesce(max(id),0) from credit_ledger where user_id=p_user) where user_id=p_user;
  -- Backfill V1 settled AI usage once, preserving every amount, timestamp and historical price version.
  insert into usage_events(user_id,action,credits,counts_in_window,operation_id,ai_usage_id,pricing_version,created_at)
   select p_user,'ai.fix',greatest(0,coalesce(charged_tokens,0)),true,'legacy-ai:'||id,id,coalesce(pricing_version,'legacy'),created_at
   from ai_usage where user_id=p_user and status not in ('pending','orphaned') on conflict(user_id,operation_id) do nothing;
  update credit_ledger l set operation_id='legacy-ai:'||a.id from ai_usage a where a.user_id=p_user and l.user_id=p_user and l.ref=a.id::text and l.reason='ai_fix' and l.operation_id is null;
  insert into usage_daily(user_id,day,action,credits,count)
   select p_user,(created_at at time zone 'UTC')::date,action,sum(credits),count(*) from usage_events
   where user_id=p_user and operation_id like 'legacy-ai:%' group by (created_at at time zone 'UTC')::date,action
   on conflict(user_id,day,(coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid)),action) do nothing;
 end if;
 -- A V1 request already streaming during a rolling function deploy may settle AFTER import.
 -- Apply its late debit to lots once without duplicating its existing ledger charge.
 select coalesce(max(id),0) into cursor_id from credit_ledger where user_id=p_user;
 for legacy in select * from credit_ledger where user_id=p_user and id>(select legacy_ledger_id from credit_accounts where user_id=p_user) and id<=cursor_id and reason='ai_fix' and delta<0 and operation_id is null order by id loop
  keep:=-legacy.delta;
  for r in select * from credit_grants where user_id=p_user and bucket=legacy.bucket and left_credits>0 order by expires_at,granted_at,id loop
   exit when keep<=0;
   select coalesce(sum(credits),0) into held from credit_allocations where grant_id=r.id;
   take:=least(keep,greatest(0,r.left_credits-held));
   update credit_grants set left_credits=left_credits-take where id=r.id; keep:=keep-take;
  end loop;
  if keep>0 then update credit_accounts set debt=debt+keep,debt_since=coalesce(debt_since,p_now) where user_id=p_user; end if;
  update credit_ledger set operation_id='legacy-ai:'||legacy.ref where id=legacy.id;
 end loop;
 update credit_accounts set legacy_ledger_id=cursor_id where user_id=p_user;
 with added as (
  insert into usage_events(user_id,action,credits,counts_in_window,operation_id,ai_usage_id,pricing_version,created_at)
   select p_user,'ai.fix',greatest(0,coalesce(charged_tokens,0)),true,'legacy-ai:'||a.id,a.id,coalesce(a.pricing_version,'legacy'),a.created_at
   from ai_usage a where a.user_id=p_user and a.status not in ('pending','orphaned')
    and exists(select 1 from credit_ledger l where l.user_id=p_user and l.operation_id='legacy-ai:'||a.id)
   on conflict(user_id,operation_id) do nothing returning created_at,action,credits
 ) insert into usage_daily(user_id,day,action,credits,count)
  select p_user,(created_at at time zone 'UTC')::date,action,sum(credits),count(*) from added group by (created_at at time zone 'UTC')::date,action
  on conflict(user_id,day,(coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid)),action) do update set credits=usage_daily.credits+excluded.credits,count=usage_daily.count+excluded.count;
 -- Persisted hold state, not a paginated list of ledger rows. Releasing returns the full reservation.
 for r in select * from credit_holds where user_id=p_user and status='held' and expires_at<=p_now loop
  insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id) values(p_user,r.credits,'hold','hold_release',r.id::text,r.operation_id);
  delete from credit_allocations where hold_id=r.id;
  update credit_holds set status='orphaned' where id=r.id;
  update ai_usage set status='orphaned' where id=r.ai_usage_id and status='pending';
 end loop;
 update ai_usage a set status='orphaned' where a.user_id=p_user and a.status='pending'
   and exists(select 1 from credit_ledger l where l.user_id=p_user and l.ref=a.id::text and l.reason='hold' and l.operation_id is null and l.created_at<=p_now-interval '15 minutes');
 -- Old in-flight V1 requests retain their reservation for 15 minutes across an upgrade.
 delete from credit_ledger l where l.user_id=p_user and l.reason='hold' and l.operation_id is null
   and l.created_at<=p_now-interval '15 minutes';
 for r in select * from credit_grants where user_id=p_user and expires_at<=p_now and left_credits>0 order by expires_at,id loop
  select coalesce(sum(credits),0) into held from credit_allocations where grant_id=r.id;
  take:=greatest(0,r.left_credits-held);
  if take>0 then
   update credit_grants set left_credits=left_credits-take where id=r.id;
   insert into credit_ledger(user_id,delta,bucket,reason,ref) values(p_user,-take,r.bucket,'grant_expiry',r.id::text);
  end if;
 end loop;
end $$;

create or replace function public.bid_grant(p_user uuid,p_credits bigint,p_source text,p_ref text,p_tier text default null,p_granted_at timestamptz default now(),p_expires_at timestamptz default null,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare g credit_grants; conf jsonb; months integer; cap bigint; excess bigint; held bigint; take bigint; debt_paid bigint; bucket_name text; r record;
begin
 perform bid_v12_refresh(p_user,p_now);
 if p_credits<0 or p_ref is null or length(p_ref)>300 or p_source not in ('plan_grant','trial_grant','upgrade_grant','topup','admin_grant') then raise exception 'invalid grant'; end if;
 select * into g from credit_grants where user_id=p_user and ref=p_ref and source=p_source;
 if found then return jsonb_build_object('ok',true,'duplicate',true,'id',g.id,'granted',g.credits); end if;
 select value->p_tier into conf from settings where key='plans';
 months:=case when p_source in ('topup','admin_grant') then 12 else coalesce((conf->>'validity_months')::integer,1) end;
 bucket_name:=case when p_source in ('topup','admin_grant') then 'topup' else 'plan' end;
 insert into credit_grants(user_id,source,tier,bucket,credits,left_credits,granted_at,expires_at,ref)
 values(p_user,p_source,p_tier,bucket_name,p_credits,p_credits,p_granted_at,coalesce(p_expires_at,p_granted_at+make_interval(months=>months)),p_ref) returning * into g;
 insert into credit_ledger(user_id,delta,bucket,reason,ref,expires_at) values(p_user,p_credits,bucket_name,p_source,p_ref,g.expires_at);
 select least(debt,p_credits) into debt_paid from credit_accounts where user_id=p_user;
 if debt_paid>0 then
  update credit_grants set left_credits=left_credits-debt_paid where id=g.id;
  -- Debt was already charged to the compatibility ledger. Grant pays it without charging twice.
  update credit_accounts set debt=debt-debt_paid,debt_since=case when debt=debt_paid then null else debt_since end where user_id=p_user;
 end if;
 if bucket_name='plan' and p_source<>'trial_grant' then
  cap:=coalesce((conf->>'tokens')::bigint,p_credits)*months;
  select greatest(0,coalesce(sum(left_credits),0)-cap) into excess from credit_grants where user_id=p_user and bucket='plan';
  for r in select * from credit_grants where user_id=p_user and bucket='plan' and left_credits>0 order by expires_at,granted_at,id loop
   exit when excess<=0;
   select coalesce(sum(credits),0) into held from credit_allocations where grant_id=r.id;
   take:=least(excess,greatest(0,r.left_credits-held));
   if take>0 then
    update credit_grants set left_credits=left_credits-take where id=r.id;
    insert into credit_ledger(user_id,delta,bucket,reason,ref) values(p_user,-take,'plan','grant_cap',g.id::text||':'||r.id::text);
    excess:=excess-take;
   end if;
  end loop;
 end if;
 perform bid_v12_refresh(p_user,p_now);
 return jsonb_build_object('ok',true,'granted',p_credits,'id',g.id,'expiresAt',g.expires_at,'debtPaid',debt_paid);
end $$;

-- Current tier drives window caps; cancelled users retain their last tier's limits while spending a
-- remaining grant. Free accounts with only packs use Flash windows; buying packs never raises them.
create or replace function public.bid_v12_entitlement(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare tier text; conf jsonb; monthly bigint; site_limit integer; anchor timestamptz; trial_end timestamptz;
begin
 select plan::text,created_at into tier,anchor from profiles where user_id=p_user;
 select period_start,period_end into anchor,trial_end from subscriptions where user_id=p_user and provider='trial' and status='trial' and period_end>p_now limit 1;
 if found then
  select coalesce((value#>>'{trial,tokens}')::bigint,50000) into monthly from settings where key='billing.catalog';
  return jsonb_build_object('plan',tier,'monthly',monthly,'siteLimit',1,'anchor',anchor,'trial',true);
 end if;
 select coalesce(window_anchor,(raw->>'started_at')::timestamptz,period_start) into anchor from subscriptions where user_id=p_user and provider='paddle'
 order by (status in ('active','past_due')) desc,updated_at desc limit 1;
 anchor:=coalesce(anchor,(select created_at from profiles where user_id=p_user));
 if tier='free' then
  select cg.tier into tier from credit_grants cg where user_id=p_user and source in ('plan_grant','upgrade_grant') order by granted_at desc,id desc limit 1;
  site_limit:=case when tier is not null and exists(select 1 from credit_grants where user_id=p_user and left_credits>0 and expires_at>p_now) then 1 else 0 end;
  tier:=coalesce(tier,'flash');
 end if;
 select value->tier into conf from settings where key='plans';
 monthly:=coalesce((conf->>'tokens')::bigint,100000);
 site_limit:=coalesce(site_limit,(conf->>'max_active_sites')::integer,0);
 return jsonb_build_object('plan',tier,'monthly',monthly,'siteLimit',site_limit,'anchor',anchor,'trial',false);
end $$;

create or replace function public.bid_v12_windows(p_user uuid,p_now timestamptz default now(),p_open boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ent jsonb; anchor timestamptz; start_at timestamptz; w usage_windows; h usage_windows; week_cap bigint; session_cap bigint; reserved bigint; week_json jsonb; session_json jsonb; boosted_until timestamptz; old_used bigint; legacy_start timestamptz;
begin
 perform bid_v12_lock(p_user);
 ent:=bid_v12_entitlement(p_user,p_now); anchor:=(ent->>'anchor')::timestamptz;
 start_at:=anchor+floor(extract(epoch from(p_now-anchor))/604800)*interval '7 days';
 week_cap:=floor((ent->>'monthly')::bigint*0.4); session_cap:=floor((ent->>'monthly')::bigint*0.2);
 select * into w from usage_windows where user_id=p_user and kind='week' and opened_at=start_at;
 if not found and p_open then
  insert into usage_windows(user_id,kind,opened_at,resets_at,cap,week_anchor) values(p_user,'week',start_at,start_at+interval '7 days',week_cap,anchor) returning * into w;
  select coalesce(sum(credits),0) into old_used from usage_events where user_id=p_user and counts_in_window and created_at>=start_at and created_at<start_at+interval '7 days' and window_week_id is null;
  update usage_windows set used=old_used where id=w.id; w.used:=old_used;
  update usage_events set window_week_id=w.id where user_id=p_user and counts_in_window and created_at>=start_at and created_at<start_at+interval '7 days' and window_week_id is null;
 end if;
 select max(boost_until) into boosted_until from usage_windows where user_id=p_user and kind='week';
 if boosted_until>p_now then week_cap:=floor(week_cap*1.5); session_cap:=floor(session_cap*1.5); end if;
 if w.id is not null then update usage_windows set cap=week_cap where id=w.id; end if;
 select * into h from usage_windows where user_id=p_user and kind='5h' and resets_at>p_now and opened_at<=p_now order by opened_at desc limit 1;
 if not found then
  select min(created_at) into legacy_start from(select created_at from usage_events where user_id=p_user and counts_in_window and window_5h_id is null union all select created_at from credit_ledger where user_id=p_user and reason='hold' and operation_id is null) old where created_at>p_now-interval '5 hours' and created_at<=p_now;
  if legacy_start is not null then
   select coalesce(sum(credits),0) into old_used from usage_events where user_id=p_user and counts_in_window and window_5h_id is null and created_at>=legacy_start and created_at<legacy_start+interval '5 hours';
   insert into usage_windows(user_id,kind,opened_at,resets_at,cap,used) values(p_user,'5h',legacy_start,legacy_start+interval '5 hours',session_cap,old_used) returning * into h;
   update usage_events set window_5h_id=h.id where user_id=p_user and counts_in_window and window_5h_id is null and created_at>=legacy_start and created_at<legacy_start+interval '5 hours';
  end if;
 end if;
 if h.id is null and p_open then
  insert into usage_windows(user_id,kind,opened_at,resets_at,cap) values(p_user,'5h',p_now,p_now+interval '5 hours',session_cap) returning * into h;
 end if;
 if h.id is not null then update usage_windows set cap=session_cap where id=h.id; end if;
 if w.id is not null then
  select coalesce(sum(credits),0) into old_used from usage_events where user_id=p_user and counts_in_window and window_week_id is null and created_at>=w.opened_at and created_at<w.resets_at;
  update usage_windows set used=used+old_used where id=w.id; w.used:=w.used+old_used;
  update usage_events set window_week_id=w.id where user_id=p_user and counts_in_window and window_week_id is null and created_at>=w.opened_at and created_at<w.resets_at;
 end if;
 if h.id is not null then
  select coalesce(sum(credits),0) into old_used from usage_events where user_id=p_user and counts_in_window and window_5h_id is null and created_at>=h.opened_at and created_at<h.resets_at;
  update usage_windows set used=used+old_used where id=h.id; h.used:=h.used+old_used;
  update usage_events set window_5h_id=h.id where user_id=p_user and counts_in_window and window_5h_id is null and created_at>=h.opened_at and created_at<h.resets_at;
 end if;
 select coalesce(sum(credits),0) into reserved from credit_holds where user_id=p_user and status='held' and window_week_id=w.id;
 reserved:=reserved-(select coalesce(sum(delta),0) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 week_json:=jsonb_build_object('id',w.id,'used',coalesce(w.used,(select coalesce(sum(credits),0) from usage_events where user_id=p_user and counts_in_window and created_at>=start_at and created_at<start_at+interval '7 days')),'reserved',reserved,'cap',week_cap,'openedAt',start_at,'resetsAt',start_at+interval '7 days','boostUntil',case when boosted_until>p_now then boosted_until end,'boostAvailable',(select plan='knight' from profiles where user_id=p_user) and w.boost_used_at is null);
 select coalesce(sum(credits),0) into reserved from credit_holds where user_id=p_user and status='held' and window_5h_id=h.id;
 reserved:=reserved-(select coalesce(sum(delta),0) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 session_json:=jsonb_build_object('id',h.id,'used',coalesce(h.used,0),'reserved',reserved,'cap',session_cap,'openedAt',h.opened_at,'resetsAt',h.resets_at);
 return jsonb_build_object('session',session_json,'week',week_json);
end $$;

create or replace function public.bid_hold(p_user uuid,p_action text,p_credits bigint,p_operation_id text,p_site uuid default null,p_counts_window boolean default true,p_pricing_version text default '2026-10',p_ai_usage uuid default null,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h credit_holds; e usage_events; win jsonb; remaining bigint; available bigint; held bigint; take bigint; r record; wh uuid; ww uuid;
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
 if p_site is not null and not exists(select 1 from sites where id=p_site and user_id=p_user and (state='active' or p_action='deploy.rollback')) then return jsonb_build_object('ok',false,'code','site_paused'); end if;
 if p_ai_usage is not null and not exists(select 1 from ai_usage where id=p_ai_usage and user_id=p_user) then raise exception 'invalid AI operation'; end if;
 select coalesce(sum(delta),0) into available from credit_ledger where user_id=p_user;
 if p_credits>0 and available<p_credits then return jsonb_build_object('ok',false,'code','quota_exhausted','balance',available); end if;
 if p_counts_window and p_credits>0 then
  win:=bid_v12_windows(p_user,p_now,false);
  if (win#>>'{session,used}')::bigint+(win#>>'{session,reserved}')::bigint+p_credits>(win#>>'{session,cap}')::bigint then
   return jsonb_build_object('ok',false,'code','window_5h','legacyCode','session_cap','windowHours',5,'resetsAt',win#>'{session,resetsAt}','windows',win);
  end if;
  if (win#>>'{week,used}')::bigint+(win#>>'{week,reserved}')::bigint+p_credits>(win#>>'{week,cap}')::bigint then
   return jsonb_build_object('ok',false,'code','window_week','resetsAt',win#>'{week,resetsAt}','windows',win);
  end if;
  win:=bid_v12_windows(p_user,p_now,true);
  wh:=(win#>>'{session,id}')::uuid; ww:=(win#>>'{week,id}')::uuid;
 end if;
 insert into credit_holds(user_id,operation_id,action,credits,site_id,counts_in_window,pricing_version,window_5h_id,window_week_id,ai_usage_id,created_at,expires_at)
 values(p_user,p_operation_id,p_action,p_credits,p_site,p_counts_window,p_pricing_version,wh,ww,p_ai_usage,p_now,p_now+interval '15 minutes') returning * into h;
 remaining:=p_credits;
 for r in select * from credit_grants where user_id=p_user and left_credits>0 and expires_at>p_now order by expires_at,granted_at,id loop
  exit when remaining<=0;
  select coalesce(sum(credits),0) into held from credit_allocations where grant_id=r.id;
  take:=least(remaining,greatest(0,r.left_credits-held));
  if take>0 then insert into credit_allocations(user_id,hold_id,grant_id,credits) values(p_user,h.id,r.id,take); remaining:=remaining-take; end if;
 end loop;
 if remaining>0 then raise exception 'credit grants and ledger need reconciliation'; end if;
 insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id,created_at) values(p_user,-p_credits,'hold','hold',h.id::text,p_operation_id,p_now);
 return jsonb_build_object('ok',true,'holdId',h.id,'reserved',p_credits,'balance',available-p_credits,'windows',win);
end $$;

create or replace function public.bid_release(p_user uuid,p_operation_id text,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h credit_holds;
begin
 perform bid_v12_lock(p_user);
 select * into h from credit_holds where user_id=p_user and operation_id=p_operation_id;
 if h.status='held' then
  insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id,created_at) values(p_user,h.credits,'hold','hold_release',h.id::text,p_operation_id,p_now);
  delete from credit_allocations where hold_id=h.id;
  update credit_holds set status='released' where id=h.id;
 end if;
 perform bid_v12_refresh(p_user,p_now);
 return jsonb_build_object('ok',true,'released',coalesce(h.status='held',false));
end $$;

-- Settlement consumes pinned reservations first. A started operation is always recorded, including
-- interrupted output or a provider count above the estimate; any shortfall becomes explicit debt.
create or replace function public.bid_settle(p_user uuid,p_operation_id text,p_credits bigint,p_ai jsonb default null,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h credit_holds; e usage_events; remaining bigint; take bigint; held bigint; r record; balance bigint;
begin
 perform bid_v12_lock(p_user);
 select * into e from usage_events where user_id=p_user and operation_id=p_operation_id;
 if found then return jsonb_build_object('ok',true,'duplicate',true,'charged',e.credits); end if;
 select * into h from credit_holds where user_id=p_user and operation_id=p_operation_id;
 if not found or h.status not in ('held','orphaned') then return jsonb_build_object('ok',false,'code','operation_released'); end if;
 if p_credits<0 or p_credits>1000000000 then raise exception 'invalid settlement'; end if;
 remaining:=p_credits;
 for r in select g.*,a.credits as allocation from credit_allocations a join credit_grants g on g.id=a.grant_id where a.hold_id=h.id order by g.expires_at,g.granted_at,g.id loop
  take:=least(remaining,r.allocation);
  if take>0 then
   update credit_grants set left_credits=left_credits-take where id=r.id;
   insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id,pricing_version,created_at) values(p_user,-take,r.bucket,'action',p_operation_id,p_operation_id,h.pricing_version,p_now);
   remaining:=remaining-take;
  end if;
 end loop;
 delete from credit_allocations where hold_id=h.id;
 for r in select * from credit_grants where user_id=p_user and left_credits>0 and expires_at>p_now order by expires_at,granted_at,id loop
  exit when remaining<=0;
  select coalesce(sum(credits),0) into held from credit_allocations where grant_id=r.id;
  take:=least(remaining,greatest(0,r.left_credits-held));
  if take>0 then
   update credit_grants set left_credits=left_credits-take where id=r.id;
   insert into credit_ledger(user_id,delta,bucket,reason,ref,operation_id,pricing_version,created_at) values(p_user,-take,r.bucket,'action',p_operation_id,p_operation_id,h.pricing_version,p_now);
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
 insert into usage_events(user_id,site_id,action,credits,counts_in_window,operation_id,ai_usage_id,pricing_version,window_5h_id,window_week_id,created_at)
 values(p_user,h.site_id,h.action,p_credits,h.counts_in_window,p_operation_id,h.ai_usage_id,h.pricing_version,h.window_5h_id,h.window_week_id,p_now);
 insert into usage_daily(user_id,day,site_id,action,credits,count) values(p_user,(p_now at time zone 'UTC')::date,h.site_id,h.action,p_credits,1)
 on conflict(user_id,day,(coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid)),action) do update set credits=usage_daily.credits+excluded.credits,count=usage_daily.count+1;
 update usage_windows set used=used+p_credits where id in (h.window_5h_id,h.window_week_id);
 if h.ai_usage_id is not null and p_ai is not null then
  update ai_usage set charged_tokens=p_credits,status=coalesce(p_ai->>'status','ok'),model=coalesce(p_ai->>'model',model),input_tokens=(p_ai->>'input')::integer,output_tokens=(p_ai->>'output')::integer,cost_usd=(p_ai->>'costUsd')::numeric where id=h.ai_usage_id and user_id=p_user;
 end if;
 perform bid_v12_refresh(p_user,p_now);
 select coalesce(sum(delta),0) into balance from credit_ledger where user_id=p_user;
 return jsonb_build_object('ok',true,'charged',p_credits,'balance',balance,'windows',bid_v12_windows(p_user,p_now,false));
end $$;

create or replace function public.bid_charge(p_user uuid,p_action text,p_credits bigint,p_operation_id text,p_site uuid default null,p_counts_window boolean default true,p_pricing_version text default '2026-10',p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare held jsonb;
begin
 held:=bid_hold(p_user,p_action,p_credits,p_operation_id,p_site,p_counts_window,p_pricing_version,null,p_now);
 if not (held->>'ok')::boolean or coalesce((held->>'settled')::boolean,false) then return held; end if;
 return bid_settle(p_user,p_operation_id,p_credits,null,p_now);
end $$;

create or replace function public.bid_boost(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare win jsonb; w uuid; tier text;
begin
 perform bid_v12_refresh(p_user,p_now);
 select plan::text into tier from profiles where user_id=p_user;
 if tier<>'knight' then return jsonb_build_object('ok',false,'code','boost_unavailable'); end if;
 win:=bid_v12_windows(p_user,p_now,false); w:=(win#>>'{week,id}')::uuid;
 if w is null then
  insert into usage_windows(user_id,kind,opened_at,resets_at,cap,week_anchor,used)
   values(p_user,'week',(win#>>'{week,openedAt}')::timestamptz,(win#>>'{week,resetsAt}')::timestamptz,(win#>>'{week,cap}')::bigint,(bid_v12_entitlement(p_user,p_now)->>'anchor')::timestamptz,(win#>>'{week,used}')::bigint) returning id into w;
  update usage_events set window_week_id=w where user_id=p_user and counts_in_window and created_at>=(win#>>'{week,openedAt}')::timestamptz and created_at<(win#>>'{week,resetsAt}')::timestamptz and window_week_id is null;
 end if;
 if exists(select 1 from usage_windows where id=w and boost_used_at is not null) then return jsonb_build_object('ok',false,'code','boost_used','resetsAt',win#>'{week,resetsAt}'); end if;
 update usage_windows set boost_used_at=p_now,boost_until=p_now+interval '24 hours' where id=w;
 return jsonb_build_object('ok',true,'windows',bid_v12_windows(p_user,p_now,false));
end $$;

-- Refund only the unspent, unreserved part of the ORIGINAL grant, never credits from a later purchase.
create or replace function public.bid_refund(p_user uuid,p_ref text,p_adjustment text,p_share numeric,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; held bigint; take bigint; taken bigint:=0;
begin
 perform bid_v12_refresh(p_user,p_now);
 if p_share<=0 or p_share>1 then raise exception 'invalid refund share'; end if;
 if exists(select 1 from credit_ledger where user_id=p_user and reason='payment_refund' and ref=p_adjustment||':'||p_ref) then return jsonb_build_object('ok',true,'taken',0,'duplicate',true); end if;
 for r in select * from credit_grants where user_id=p_user and (ref=p_ref or payment_ref=p_ref or starts_with(ref,p_ref||':')) loop
  if exists(select 1 from credit_ledger where user_id=p_user and reason='grant_refund' and ref=p_adjustment||':'||r.id) then continue; end if;
  select coalesce(sum(credits),0) into held from credit_allocations where grant_id=r.id;
  if held>0 then raise exception 'refund waits for reserved work' using errcode='55P03'; end if;
  take:=least(round(r.credits*p_share)::bigint,r.left_credits);
  update credit_grants set left_credits=left_credits-take where id=r.id;
  insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) values(p_user,-take,r.bucket,'grant_refund',p_adjustment||':'||r.id,p_now);
  taken:=taken+take;
 end loop;
 update credit_periods set refund_share=least(1,refund_share+p_share) where transaction_ref=p_ref and user_id=p_user;
 insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) values(p_user,0,'plan','payment_refund',p_adjustment||':'||p_ref,p_now);
 return jsonb_build_object('ok',true,'taken',taken);
end $$;

-- Function ACLs are assigned explicitly at the end of this module, including internal helpers.

create or replace function public.bid_enforce_sites(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ent jsonb; lim integer; n integer:=0; r record; rank integer:=0; debt_at timestamptz; best_tier text;
begin
 perform bid_v12_refresh(p_user,p_now);
 -- The scheduler must expire entitlements even when the owner's Mac never opens the app.
 update subscriptions set status='expired',updated_at=p_now where user_id=p_user and status in ('active','trial','past_due') and period_end is not null
  and period_end+case when provider='paddle' and status in ('active','past_due') then interval '3 days' else interval '0 days' end<=p_now;
 if exists(select 1 from subscriptions where user_id=p_user) and exists(select 1 from profiles where user_id=p_user and role='normal') then
  select effective into best_tier from (
   select coalesce((select c.from_tier from billing_changes c where c.user_id=p_user and c.provider_ref=sub.provider_ref and c.to_tier=sub.tier::text and c.status in ('applying','applied') and c.effective_at>p_now order by c.created_at desc limit 1),sub.tier::text) as effective
   from subscriptions sub where sub.user_id=p_user and sub.status in ('active','trial','past_due')
  ) entitled order by array_position(array['free','flash','high','knight'],effective) desc limit 1;
  update profiles set plan=coalesce(best_tier,'free')::plan_tier where user_id=p_user and plan::text is distinct from coalesce(best_tier,'free');
 end if;
 ent:=bid_v12_entitlement(p_user,p_now); lim:=(ent->>'siteLimit')::integer;
 select debt_since into debt_at from credit_accounts where user_id=p_user and debt>0;
 for r in select * from sites where user_id=p_user and state='active' order by activated_at,id loop
  rank:=rank+1;
  if r.migration_grace_until>p_now then continue; end if;
  if rank>lim or debt_at+interval '3 days'<=p_now then
   update sites set state='paused',paused_at=p_now,paused_reason=case when debt_at+interval '3 days'<=p_now then 'no_credits' else 'plan_limit' end where id=r.id;
   n:=n+1;
  end if;
 end loop;
 return jsonb_build_object('ok',true,'paused',n,'limit',lim);
end $$;

create or replace function public.bid_v12_burn_one(p_user uuid,p_site uuid,p_day date,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s sites; r jsonb; op text; price bigint; extra bigint; conf jsonb; tier text; cnt integer; debt_now bigint; debt_at timestamptz; h credit_holds; version text;
begin
 perform bid_v12_refresh(p_user,p_now);
 select * into s from sites where user_id=p_user and id=p_site;
 if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
 update sites set last_burn_attempt_at=p_now where id=p_site;
 op:='site:'||p_site::text||':'||p_day::text;
 if exists(select 1 from usage_events where user_id=p_user and operation_id=op) then return jsonb_build_object('ok',true,'duplicate',true); end if;
 select value into conf from settings where key='pricing.actions';
 price:=coalesce((conf#>>'{site.day,credits}')::bigint,1000);
 select coalesce(value#>>'{}','2026-10') into version from settings where key='pricing.version';
 r:=bid_charge(p_user,'site.day',price,op,p_site,false,version,p_now);
 if r->>'code'='quota_exhausted' then
  select count(*) into cnt from sites where user_id=p_user and state='active';
  select debt,debt_since into debt_now,debt_at from credit_accounts where user_id=p_user;
  if debt_at+interval '3 days'<=p_now or debt_now+price>3*price*greatest(cnt,1) then
   if s.migration_grace_until is null or s.migration_grace_until<=p_now then
    update sites set state='paused',paused_at=p_now,paused_reason='no_credits' where id=p_site;
   end if;
   return r;
  end if;
  -- Only the scheduler can authorize this bounded hosting overdraft. It still uses the common settle.
  insert into credit_holds(user_id,operation_id,action,credits,site_id,counts_in_window,pricing_version,created_at,expires_at)
  values(p_user,op,'site.day',0,p_site,false,version,p_now,p_now+interval '15 minutes') returning * into h;
  r:=bid_settle(p_user,op,price,null,p_now);
 end if;
 if not coalesce((r->>'ok')::boolean,false) then return r; end if;
 select coalesce(min(interval_min),10),coalesce(max(jsonb_array_length(coalesce(checks->'paths','[]'::jsonb))),0) into cnt,extra from monitor_targets where site_id=p_site and enabled;
 r:=bid_v12_monitor_extras(p_user,p_site,cnt,extra::integer,p_day,p_now);
 if not (r->>'ok')::boolean then
  update monitor_targets set interval_min=greatest(interval_min,10),checks=jsonb_set(checks,'{paths}',coalesce((select jsonb_agg(value) from jsonb_array_elements(checks->'paths') with ordinality as p(value,n) where n<=3),'[]'::jsonb)) where site_id=p_site;
 end if;
 if p_day<>(p_now at time zone 'UTC')::date then
  update usage_events set created_at=p_day::timestamp at time zone 'UTC' where user_id=p_user and operation_id=op;
  update usage_daily set credits=credits-price,count=count-1 where user_id=p_user and site_id=p_site and action='site.day' and day=(p_now at time zone 'UTC')::date;
  insert into usage_daily(user_id,day,site_id,action,credits,count) values(p_user,p_day,p_site,'site.day',price,1)
   on conflict(user_id,day,(coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid)),action) do update set credits=usage_daily.credits+excluded.credits,count=usage_daily.count+1;
 end if;
 return jsonb_build_object('ok',true,'charged',price);
end $$;

create or replace function public.bid_site_burn(p_day date default (now() at time zone 'UTC')::date,p_batch integer default 100,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s record; n integer:=0; r jsonb;
begin
 if p_day>(p_now at time zone 'UTC')::date or p_day<(p_now at time zone 'UTC')::date-1 then raise exception 'invalid burn day'; end if;
 for s in select * from sites where state='active' and activated_at<(p_day+1)::timestamp at time zone 'UTC'
  and not exists(select 1 from usage_events e where e.user_id=sites.user_id and e.operation_id='site:'||sites.id||':'||p_day)
  order by last_burn_attempt_at nulls first,user_id,id limit greatest(1,least(p_batch,1000)) loop
  perform bid_enforce_sites(s.user_id,p_now);
  if exists(select 1 from sites where id=s.id and state='active') then
   r:=bid_v12_burn_one(s.user_id,s.id,p_day,p_now);
   n:=n+1;
  end if;
 end loop;
 return jsonb_build_object('ok',true,'processed',n);
end $$;

create or replace function public.bid_site_change(p_user uuid,p_project text,p_active boolean,p_hosting text default 'user',p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s sites; ent jsonb; lim integer; n integer; tier text; r jsonb; available bigint; price bigint;
begin
 perform bid_v12_refresh(p_user,p_now);
 if p_project is null or length(p_project) not between 1 and 200 or p_hosting not in ('user','bid') then raise exception 'invalid site'; end if;
 select * into s from sites where user_id=p_user and project_key=p_project;
 if not p_active then
  if s.state='active' then perform bid_v12_burn_one(p_user,s.id,(p_now at time zone 'UTC')::date,p_now); end if;
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
 select coalesce(sum(delta),0) into available from credit_ledger where user_id=p_user;
 select coalesce((value#>>'{site.day,credits}')::bigint,1000) into price from settings where key='pricing.actions';
 if available<0 or (available<price and not exists(select 1 from usage_events where user_id=p_user and operation_id='site:'||s.id||':'||(p_now at time zone 'UTC')::date)) then return jsonb_build_object('ok',false,'code','quota_exhausted','required',price); end if;
 insert into sites(user_id,project_key,state,hosting_owner,activated_at) values(p_user,p_project,'active',p_hosting,p_now)
 on conflict(user_id,project_key) do update set state='active',hosting_owner=excluded.hosting_owner,activated_at=p_now,paused_at=null,paused_reason=null returning * into s;
 r:=bid_v12_burn_one(p_user,s.id,(p_now at time zone 'UTC')::date,p_now);
 return r||jsonb_build_object('siteId',s.id,'state','active');
end $$;

create or replace function public.bid_nudge_ack(p_user uuid,p_period text,p_threshold text,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if length(p_period)>200 or p_threshold not in ('75','90','100','w5h80','w5h100','week80','week100','site_limit') then raise exception 'invalid nudge'; end if;
 insert into usage_nudges(user_id,period_ref,threshold,shown_at) values(p_user,p_period,p_threshold,p_now) on conflict do nothing;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.bid_usage_summary(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ent jsonb; win jsonb; tier text; s subscriptions; start_at timestamptz; end_at timestamptz; k integer;
 included bigint; used bigint; operations bigint; reserved bigint; open_holds bigint; available bigint; plan_left bigint; packs_left bigint; debt_now bigint;
 actions jsonb; daily jsonb; models jsonb; lots jsonb; site_items jsonb; hist jsonb; ledger jsonb; v_period_ref text; v_threshold integer; nudge jsonb; active_count integer; paused_count integer; lim integer; forecast numeric;
begin
 perform bid_v12_refresh(p_user,p_now);
 perform bid_enforce_sites(p_user,p_now);
 ent:=bid_v12_entitlement(p_user,p_now); win:=bid_v12_windows(p_user,p_now,false);
 select plan::text into tier from profiles where user_id=p_user;
 select * into s from subscriptions where user_id=p_user and status in ('active','trial','past_due') and period_end>p_now order by tier desc,updated_at desc limit 1;
 start_at:=coalesce(s.period_start,date_trunc('month',p_now at time zone 'UTC') at time zone 'UTC');
 end_at:=coalesce(s.period_end,start_at+interval '1 month');
 if s.raw#>>'{billing_cycle,interval}'='year' then
  k:=greatest(0,(extract(year from p_now at time zone 'UTC')::int-extract(year from start_at at time zone 'UTC')::int)*12+extract(month from p_now at time zone 'UTC')::int-extract(month from start_at at time zone 'UTC')::int);
  if start_at+make_interval(months=>k)>p_now then k:=greatest(0,k-1); end if;
  end_at:=least(end_at,start_at+make_interval(months=>k+1)); start_at:=start_at+make_interval(months=>k);
 end if;
 included:=case when tier='free' then 0 else (ent->>'monthly')::bigint end;
 select coalesce(sum(credits),0) into used from credit_grants where user_id=p_user and source in ('plan_grant','trial_grant','upgrade_grant') and granted_at>=start_at and granted_at<end_at;
 if used>0 then included:=used; end if;
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
 select coalesce(jsonb_agg(x order by x."expiresAt"),'[]') into lots from(select id,source,credits,left_credits as remaining,granted_at as "grantedAt",expires_at as "expiresAt" from credit_grants where user_id=p_user and left_credits>0) x;
 select count(*) filter(where state='active'),count(*) filter(where state='paused') into active_count,paused_count from sites where user_id=p_user;
 lim:=(ent->>'siteLimit')::integer;
 select coalesce(jsonb_agg(x),'[]') into site_items from(select t.id,t.project_key as "projectKey",coalesce(p.name,t.project_key) as name,t.state,t.hosting_owner as "hostingOwner",t.paused_reason as "pausedReason",t.migration_grace_until as "graceUntil",coalesce((select sum(credits) from usage_events where site_id=t.id and created_at>=start_at and created_at<end_at),0) as credits from sites t left join bid_projects p on p.user_id=t.user_id and p.key=t.project_key where t.user_id=p_user order by t.state,t.activated_at,t.id) x;
 select coalesce(jsonb_agg(x),'[]') into hist from(select e.id::text as id,e.created_at as at,e.action as step,a.project_key as project,a.model,coalesce(a.status,'ok') as status,e.credits as tokens,a.input_tokens as input,a.output_tokens as output,e.pricing_version as "pricingVersion",e.operation_id as "operationId" from usage_events e left join ai_usage a on a.id=e.ai_usage_id where e.user_id=p_user order by e.created_at desc,e.id desc limit 50) x;
 select coalesce(jsonb_agg(x),'[]') into ledger from(select id,created_at as at,delta,bucket,reason,ref,pricing_version as "pricingVersion" from credit_ledger where user_id=p_user order by created_at desc,id desc limit 50) x;
 v_threshold:=case when included<=0 then 0 when used>=included then 100 when used>=included*0.9 then 90 when used>=included*0.75 then 75 else 0 end;
 v_period_ref:=start_at::text;
 if v_threshold>0 and not exists(select 1 from usage_nudges where user_id=p_user and usage_nudges.period_ref=v_period_ref and usage_nudges.threshold=v_threshold::text) then
  nudge:=jsonb_build_object('threshold',v_threshold,'periodRef',v_period_ref,'kind',case when tier='knight' then 'buy' else 'upgrade' end,'target',case when tier in ('free','flash') then 'high' when tier='high' then 'knight' end);
 end if;
 forecast:=case when used>0 then floor(greatest(available,0)/(used/greatest(1,extract(epoch from(p_now-start_at))/86400))) else null end;
 return jsonb_build_object('v',2,'serverTime',p_now,'unit','credits','plan',tier,'source','cloud',
  'windows',win,'session',(win->'session')||jsonb_build_object('windowHours',5,'capPercent',20,'remaining',greatest(0,(win#>>'{session,cap}')::bigint-(win#>>'{session,used}')::bigint-(win#>>'{session,reserved}')::bigint)),
  'weekly',(win->'week')||jsonb_build_object('windowHours',168,'capPercent',40,'remaining',greatest(0,(win#>>'{week,cap}')::bigint-(win#>>'{week,used}')::bigint-(win#>>'{week,reserved}')::bigint)),
  'period',jsonb_build_object('start',start_at,'end',end_at,'renewsAt',case when s.cancel_at is null then s.period_end end,'source',case when s.id is null then 'calendar' else 'subscription' end,'included',included,'used',used,'reserved',reserved,'packs',packs_left,'available',greatest(available,0),'debt',debt_now,'forecastDaysLeft',forecast),
  'included',jsonb_build_object('tokens',included),'used',jsonb_build_object('tokens',used,'operations',operations),'reserved',jsonb_build_object('tokens',reserved,'operations',open_holds),
  'remaining',jsonb_build_object('plan',plan_left,'purchased',packs_left,'total',greatest(plan_left+packs_left-debt_now,0),'available',greatest(available,0)),
  'purchased',jsonb_build_object('tokens',packs_left,'expires','12 months after purchase'),'grants',lots,'packs',(select coalesce(jsonb_agg(x),'[]') from(select id,left_credits as remaining,expires_at as "expiresAt" from credit_grants where user_id=p_user and bucket='topup' and left_credits>0 order by expires_at) x),
  'sites',jsonb_build_object('active',active_count,'paused',paused_count,'limit',lim,'items',site_items),'byAction',actions,'daily',daily,'byModel',models,'nudge',nudge,
  'limits',jsonb_build_object('perMinute',6,'perHour',60,'sessionHours',5,'sessionCapPercent',20,'sessionCap',(win#>>'{session,cap}')::bigint,'sessionUsed',(win#>>'{session,used}')::bigint),
  'pricing',jsonb_build_object('version',coalesce((select value#>>'{}' from settings where key='pricing.version'),'2026-10'),'spendOrder',jsonb_build_array('expires_at','granted_at')),'history',jsonb_build_object('operations',hist,'ledger',ledger));
end $$;

create or replace view public.usage_drift with(security_invoker=true) as
select e.user_id,e.operation_id,e.credits as recorded,coalesce(-sum(l.delta),0)::bigint as ledger_charged
from public.usage_events e left join public.credit_ledger l on l.user_id=e.user_id and l.operation_id=e.operation_id and l.reason in ('action','ai_fix')
group by e.user_id,e.operation_id,e.credits having e.credits<>coalesce(-sum(l.delta),0);
create or replace function public.bid_reconcile_usage(p_since timestamptz default now()-interval '1 day') returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('checkedSince',p_since,'drift',coalesce(jsonb_agg(d),'[]'::jsonb)) from usage_drift d
 where exists(select 1 from usage_events e where e.user_id=d.user_id and e.operation_id=d.operation_id and e.created_at>=p_since);
$$;

-- Existing projects enter a 14-day, visible migration grace. No sites are deleted or paused by migration.
do $$ begin
 if not exists(select 1 from settings where key='credits.sitesMigrated') then
  insert into sites(user_id,project_key,state,activated_at,migration_grace_until)
   select p.user_id,p.key,case when coalesce(m.enabled,false) then 'active' else 'paused' end,
    case when coalesce(m.enabled,false) then now() end,now()+interval '14 days'
   from bid_projects p left join monitor_targets m on m.user_id=p.user_id and m.project_key=p.key on conflict(user_id,project_key) do nothing;
  insert into sites(user_id,project_key,state,activated_at,migration_grace_until)
   select user_id,project_key,case when enabled then 'active' else 'paused' end,case when enabled then now() end,now()+interval '14 days' from monitor_targets on conflict(user_id,project_key) do nothing;
  update monitor_targets m set site_id=s.id from sites s where s.user_id=m.user_id and s.project_key=m.project_key;
  insert into settings(key,value) values('credits.sitesMigrated',to_jsonb(now()));
 end if;
end $$;

create or replace function public.bid_credit_status(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare before_n bigint; after_n bigint; reserved bigint; available bigint; plan_left bigint; packs_left bigint; debt_now bigint;
begin
 select count(*) into before_n from credit_holds where user_id=p_user and status='held';
 before_n:=before_n+(select count(*) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 perform bid_v12_refresh(p_user,p_now);
 select count(*),coalesce(sum(credits),0) into after_n,reserved from credit_holds where user_id=p_user and status='held';
 after_n:=after_n+(select count(*) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 reserved:=reserved-(select coalesce(sum(delta),0) from credit_ledger where user_id=p_user and reason='hold' and operation_id is null);
 select coalesce(sum(delta),0) into available from credit_ledger where user_id=p_user;
 select coalesce(sum(left_credits) filter(where bucket='plan'),0),coalesce(sum(left_credits) filter(where bucket='topup'),0) into plan_left,packs_left from credit_grants where user_id=p_user;
 select debt into debt_now from credit_accounts where user_id=p_user;
 return jsonb_build_object('ok',true,'released',before_n-after_n,'reservedTokens',reserved,'open',after_n,'available',greatest(0,available),'balance',available,'plan',plan_left,'topup',packs_left,'total',greatest(0,plan_left+packs_left-debt_now),'debt',debt_now,'entitlements',bid_v12_entitlement(p_user,p_now));
end $$;

-- Preserve the subscription-start anchor when Paddle advances current_billing_period each month.
create or replace function public.bid_v12_subscription_anchor() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if TG_OP='UPDATE' then new.window_anchor:=coalesce(old.window_anchor,old.period_start,new.window_anchor); end if;
 new.window_anchor:=coalesce(new.window_anchor,(new.raw->>'started_at')::timestamptz,new.period_start);
 return new;
end $$;
drop trigger if exists bid_v12_subscription_anchor on subscriptions;
create trigger bid_v12_subscription_anchor before insert or update on subscriptions for each row execute function bid_v12_subscription_anchor();

create or replace function public.bid_start_trial(p_user uuid,p_email_hash text,p_tier text,p_days integer,p_credits bigint,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare sub_id uuid;
begin
 perform bid_v12_lock(p_user);
 if p_tier not in ('flash','high','knight') or p_days not between 1 and 30 or p_credits<1 or p_email_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid trial'; end if;
 if exists(select 1 from subscriptions where user_id=p_user and provider in ('paddle','trial')) then return jsonb_build_object('ok',false,'code','trial_used'); end if;
 insert into trial_claims(email_hash,claimed_at) values(p_email_hash,p_now) on conflict do nothing;
 if not found then return jsonb_build_object('ok',false,'code','trial_used'); end if;
 insert into subscriptions(user_id,provider,tier,status,period_start,period_end,updated_at) values(p_user,'trial',p_tier::plan_tier,'trial',p_now,p_now+make_interval(days=>p_days),p_now) returning id into sub_id;
 update profiles set plan=p_tier::plan_tier where user_id=p_user;
 perform bid_grant(p_user,p_credits,'trial_grant',sub_id::text,p_tier,p_now,p_now+make_interval(days=>p_days),p_now);
 return jsonb_build_object('ok',true,'subscriptionId',sub_id);
end $$;

create or replace function public.bid_upgrade_grant(p_user uuid,p_change uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c billing_changes; plans jsonb; from_credits bigint; to_credits bigint; grant_credits bigint; start_at timestamptz; end_at timestamptz; k integer;
begin
 perform bid_v12_refresh(p_user,p_now);
 select * into c from billing_changes where id=p_change and user_id=p_user and status='applied';
 if not found or c.effective_at>p_now or not exists(select 1 from subscriptions where user_id=p_user and provider_ref=c.provider_ref and provider='paddle' and status='active') then return jsonb_build_object('ok',true,'granted',0); end if;
 if array_position(array['free','flash','high','knight'],c.to_tier)<=array_position(array['free','flash','high','knight'],c.from_tier) then return jsonb_build_object('ok',true,'granted',0); end if;
 select value into plans from settings where key='plans';
 from_credits:=coalesce((plans#>>array[c.from_tier,'tokens'])::bigint,0); to_credits:=coalesce((plans#>>array[c.to_tier,'tokens'])::bigint,0);
 start_at:=(c.quote->>'periodStart')::timestamptz; end_at:=(c.quote->>'periodEnd')::timestamptz;
 if start_at is null or end_at is null or end_at<=start_at then return jsonb_build_object('ok',false,'code','billing_conflict'); end if;
 if end_at-start_at>interval '40 days' then
  k:=greatest(0,(extract(year from c.effective_at)::int-extract(year from start_at)::int)*12+extract(month from c.effective_at)::int-extract(month from start_at)::int);
  if start_at+make_interval(months=>k)>c.effective_at then k:=greatest(0,k-1); end if;
  end_at:=least(end_at,start_at+make_interval(months=>k+1)); start_at:=start_at+make_interval(months=>k);
 end if;
 grant_credits:=greatest(0,round((to_credits-from_credits)*least(1,greatest(0,extract(epoch from(end_at-c.effective_at))/extract(epoch from(end_at-start_at))))))::bigint;
 return bid_grant(p_user,grant_credits,'upgrade_grant',c.provider_ref||':upg:'||c.id,c.to_tier,c.effective_at,null,p_now);
end $$;

-- Domain requests create a review record, never purchase/register a domain. Owner fulfillment must
-- verify availability and the <= EUR15 registrar cost. Additional domains are money products, not credits.
create or replace function public.bid_domain_request(p_user uuid,p_domain text,p_site uuid default null,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare sub subscriptions; first_paid timestamptz; v_year_ref text; n integer; existing domain_orders; order_id uuid;
begin
 perform bid_v12_refresh(p_user,p_now);
 if not coalesce((select value='true'::jsonb from settings where key='features.knightDomain'),false) then return jsonb_build_object('ok',false,'code','not_available'); end if;
 if p_domain is null or length(p_domain)>253 or exists(select 1 from unnest(string_to_array(p_domain,'.')) label where length(label)>63) or p_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then return jsonb_build_object('ok',false,'code','invalid_domain'); end if;
 if not exists(select 1 from profiles where user_id=p_user and plan='knight') then return jsonb_build_object('ok',false,'code','domain_unavailable'); end if;
 if p_site is not null and not exists(select 1 from sites where user_id=p_user and id=p_site and state='active') then return jsonb_build_object('ok',false,'code','site_paused'); end if;
 select * into sub from subscriptions where user_id=p_user and provider='paddle' and status='active' and period_end>p_now order by updated_at desc limit 1;
 select min(granted_at) into first_paid from credit_grants where user_id=p_user and source in ('plan_grant','upgrade_grant') and tier='knight' and credits>0;
 if sub.id is null or first_paid is null then return jsonb_build_object('ok',false,'code','domain_unavailable'); end if;
 if sub.raw#>>'{billing_cycle,interval}' is distinct from 'year' and first_paid+interval '7 days'>p_now then return jsonb_build_object('ok',false,'code','domain_wait','availableAt',first_paid+interval '7 days'); end if;
 n:=extract(year from age(p_now,first_paid))::integer;
 v_year_ref:=sub.provider_ref||':'||(first_paid+make_interval(years=>n))::date;
 select * into existing from domain_orders where user_id=p_user and domain_orders.year_ref=v_year_ref and included and status<>'rejected';
 if found then
  if existing.domain<>p_domain then return jsonb_build_object('ok',false,'code','domain_used'); end if;
  return jsonb_build_object('ok',true,'orderId',existing.id,'status',existing.status,'duplicate',true);
 end if;
 insert into domain_orders(user_id,site_id,domain,year_ref,status,included) values(p_user,p_site,p_domain,v_year_ref,'review',true) returning id into order_id;
 return jsonb_build_object('ok',true,'orderId',order_id,'status','review','costCapEur',15);
end $$;

-- Quote and charge only newly enabled daily extras, under the same user lock as the configuration.
create or replace function public.bid_v12_monitor_extras(p_user uuid,p_site uuid,p_interval integer,p_paths integer,p_day date,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prices jsonb; version text; tier text; fast bigint:=0; paths bigint:=0; prior integer:=0; wanted integer; available bigint; op text; r jsonb;
begin
 perform bid_v12_refresh(p_user,p_now);
 select value into prices from settings where key='pricing.actions';
 select value#>>'{}' into version from settings where key='pricing.version';
 select plan::text into tier from profiles where user_id=p_user;
 if p_interval<10 and tier<>'knight' and not exists(select 1 from usage_events where user_id=p_user and operation_id='fast:'||p_site||':'||p_day) then fast:=coalesce((prices#>>'{monitor.fast,credits}')::bigint,500); end if;
 wanted:=greatest(0,p_paths-3);
 select coalesce(max(split_part(operation_id,':',4)::integer),0) into prior from usage_events where user_id=p_user and action='monitor.path' and operation_id like 'paths:'||p_site||':'||p_day||':%';
 paths:=greatest(0,wanted-prior)*coalesce((prices#>>'{monitor.path,credits}')::bigint,50);
 select coalesce(sum(delta),0) into available from credit_ledger where user_id=p_user;
 if available<fast+paths and fast+paths>0 then return jsonb_build_object('ok',false,'code','quota_exhausted','required',fast+paths,'balance',available); end if;
 if fast>0 then
  r:=bid_charge(p_user,'monitor.fast',fast,'fast:'||p_site||':'||p_day,p_site,false,coalesce(version,'2026-10'),p_now);
  if not (r->>'ok')::boolean then raise exception 'monitor extras charge refused'; end if;
 end if;
 if paths>0 then
  op:='paths:'||p_site||':'||p_day||':'||wanted;
  r:=bid_charge(p_user,'monitor.path',paths,op,p_site,false,coalesce(version,'2026-10'),p_now);
  if not (r->>'ok')::boolean then raise exception 'monitor extras charge refused'; end if;
  update usage_events set units=wanted-prior where user_id=p_user and operation_id=op;
 end if;
 return jsonb_build_object('ok',true,'charged',fast+paths);
end $$;

create or replace function public.bid_monitor_register(p_user uuid,p_project text,p_url text,p_interval integer,p_checks jsonb,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s sites; r jsonb; target monitor_targets;
begin
 perform bid_enforce_sites(p_user,p_now);
 select * into s from sites where user_id=p_user and project_key=p_project and state='active';
 if not found then return jsonb_build_object('ok',false,'code','site_paused'); end if;
 if p_interval not between 5 and 1440 or jsonb_typeof(p_checks->'paths')<>'array' or jsonb_array_length(p_checks->'paths')>10 then raise exception 'invalid monitor configuration'; end if;
 r:=bid_v12_monitor_extras(p_user,s.id,p_interval,jsonb_array_length(p_checks->'paths'),(p_now at time zone 'UTC')::date,p_now);
 if not (r->>'ok')::boolean then return r; end if;
 insert into monitor_targets(user_id,project_key,site_id,url,enabled,interval_min,checks,next_run_at,updated_at)
 values(p_user,p_project,s.id,p_url,true,p_interval,p_checks,p_now,p_now)
 on conflict(user_id,project_key) do update set site_id=excluded.site_id,url=excluded.url,enabled=true,interval_min=excluded.interval_min,checks=excluded.checks,next_run_at=p_now,updated_at=p_now returning * into target;
 return jsonb_build_object('ok',true,'registered',true,'target',to_jsonb(target),'charged',r->'charged');
end $$;

-- Paid periods outlive the current Paddle subscription row. Annual grants must accrue while the Mac
-- is closed, and refunds must cover every monthly slice bought by that same payment.
create table if not exists public.credit_periods (
 transaction_ref text primary key, user_id uuid not null references profiles(user_id) on delete cascade,
 subscription_ref text, tier text not null check(tier in ('flash','high','knight')),
 interval text not null check(interval in ('month','year')), monthly_credits bigint not null check(monthly_credits>0),
 validity_months integer not null check(validity_months between 1 and 24),
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 granted_through integer not null default -1 check(granted_through between -1 and 11),
 refund_share numeric not null default 0 check(refund_share between 0 and 1), created_at timestamptz not null default now()
);
alter table credit_periods enable row level security;
drop policy if exists own_read on credit_periods;
create policy own_read on credit_periods for select to authenticated using(auth.uid()=user_id);
alter table credit_accounts add column if not exists last_entitlement_check timestamptz;

-- Recover verified V1 annual receipts without reissuing previously delivered monthly slices.
alter table credit_periods add column if not exists legacy boolean not null default false;
alter table credit_grants add column if not exists payment_ref text;
create or replace function public.bid_v12_import_periods(p_user uuid,p_now timestamptz default now()) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s subscriptions; e record; conf jsonb; refunded numeric; old_month integer; legacy_refs text[];
begin
 perform bid_v12_lock(p_user);
 for s in select * from subscriptions where user_id=p_user and provider='paddle' and raw#>>'{billing_cycle,interval}'='year' and period_start is not null and period_end>period_start loop
  for e in select distinct on (b.ref) b.ref,b.payload from billing_events b join credit_ledger l on l.user_id=p_user and l.reason='plan_grant' and l.ref=b.ref
   where b.user_id=p_user and b.type='transaction.completed' and b.ref is not null and not exists(select 1 from credit_periods p where p.transaction_ref=b.ref)
   and b.payload#>>'{data,subscription_id}'=s.provider_ref
   and (b.payload#>>'{data,billing_period,starts_at}')::timestamptz=s.period_start
   and (b.payload#>>'{data,billing_period,ends_at}')::timestamptz=s.period_end
   and coalesce(b.payload#>>'{data,origin}','web') in ('web','api','subscription_recurring','subscription_charge') order by b.ref,b.processed_at
  loop
   select value->s.tier::text into conf from settings where key='plans';
   -- Historic refunds with incomplete totals stop future accrual pending owner reconciliation.
   select least(1,coalesce(sum(case when coalesce((e.payload#>>'{data,details,totals,total}')::numeric,0)>0 and coalesce((a.payload#>>'{data,totals,total}')::numeric,0)>0
     then (a.payload#>>'{data,totals,total}')::numeric/(e.payload#>>'{data,details,totals,total}')::numeric else 1 end),0)) into refunded
   from (select distinct on (payload#>>'{data,id}') payload from billing_events where type in ('adjustment.created','adjustment.updated') and payload#>>'{data,transaction_id}'=e.ref and payload#>>'{data,action}'='refund' and payload#>>'{data,status}'='approved' order by payload#>>'{data,id}',processed_at desc) a;
   insert into credit_periods(transaction_ref,user_id,subscription_ref,tier,interval,monthly_credits,validity_months,starts_at,ends_at,granted_through,refund_share,legacy)
   values(e.ref,p_user,s.provider_ref,s.tier::text,'year',(conf->>'tokens')::bigint,(conf->>'validity_months')::int,s.period_start,s.period_end,0,refunded,true);
   update credit_grants set payment_ref=e.ref where user_id=p_user and ref=e.ref;
   for old_month in 1..11 loop
    legacy_refs:=array[s.provider_ref||':m'||old_month,s.provider_ref||':'||to_char(s.period_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||':m'||old_month,s.provider_ref||':'||to_char(s.period_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||':m'||old_month];
    update credit_grants set payment_ref=e.ref where user_id=p_user and ref=any(legacy_refs) and granted_at>=s.period_start and granted_at<s.period_end;
   end loop;
  end loop;
 end loop;
end $$;

create or replace function public.bid_accrue_periods(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare period credit_periods; until_at timestamptz; k integer; m integer; at timestamptz; amount bigint; ref text; given bigint:=0;
begin
 perform bid_v12_refresh(p_user,p_now);
 perform bid_v12_import_periods(p_user,p_now);
 for period in select * from credit_periods where user_id=p_user and starts_at<=p_now and refund_share<1 and granted_through<case when interval='year' then 11 else 0 end order by starts_at,transaction_ref loop
  until_at:=least(p_now,period.ends_at-interval '1 microsecond');
  k:=greatest(0,(extract(year from until_at)::int-extract(year from period.starts_at)::int)*12+extract(month from until_at)::int-extract(month from period.starts_at)::int);
  if period.starts_at+make_interval(months=>k)>until_at then k:=greatest(0,k-1); end if;
  k:=least(k,case when period.interval='year' then 11 else 0 end);
  for m in (period.granted_through+1)..k loop
   at:=period.starts_at+make_interval(months=>m);
   if period.legacy and exists(select 1 from credit_ledger old_grant where old_grant.user_id=p_user and old_grant.reason='plan_grant' and old_grant.created_at>=period.starts_at and old_grant.created_at<period.ends_at and
      old_grant.ref in (period.subscription_ref||':m'||m,period.subscription_ref||':'||to_char(period.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||':m'||m,period.subscription_ref||':'||to_char(period.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||':m'||m)) then continue; end if;
   amount:=round(period.monthly_credits*(1-period.refund_share))::bigint;
   ref:=case when m=0 then period.transaction_ref else period.transaction_ref||':m'||m end;
   perform bid_grant(p_user,amount,'plan_grant',ref,period.tier,at,at+make_interval(months=>period.validity_months),p_now);
   given:=given+amount;
  end loop;
  update credit_periods set granted_through=greatest(granted_through,k) where transaction_ref=period.transaction_ref;
 end loop;
 return jsonb_build_object('ok',true,'granted',given);
end $$;

create or replace function public.bid_record_payment(p_user uuid,p_transaction text,p_subscription text,p_tier text,p_interval text,p_credits bigint,p_start timestamptz,p_end timestamptz,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare period credit_periods; months integer; r jsonb;
begin
 perform bid_v12_lock(p_user);
 select * into period from credit_periods where transaction_ref=p_transaction;
 if found then
  if period.user_id<>p_user then raise exception 'payment identity mismatch'; end if;
  return jsonb_build_object('ok',true,'duplicate',true);
 end if;
 select coalesce((value#>>array[p_tier,'validity_months'])::integer,1) into months from settings where key='plans';
 insert into credit_periods(transaction_ref,user_id,subscription_ref,tier,interval,monthly_credits,validity_months,starts_at,ends_at)
 values(p_transaction,p_user,p_subscription,p_tier,p_interval,p_credits,months,p_start,p_end);
 r:=bid_accrue_periods(p_user,p_now);
 return r||jsonb_build_object('transaction',p_transaction);
end $$;

create or replace function public.bid_scheduler_credits(p_batch integer default 1000,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u record; n integer:=0;
begin
 for u in select candidate.user_id from (
  select user_id from sites where state='active'
  union select user_id from subscriptions where provider='paddle' and status='active' and raw#>>'{billing_cycle,interval}'='year'
  union select user_id from credit_periods where refund_share<1 and granted_through<case when interval='year' then 11 else 0 end and starts_at+make_interval(months=>granted_through+1)<=p_now
 ) candidate left join credit_accounts a on a.user_id=candidate.user_id order by a.last_entitlement_check nulls first,candidate.user_id limit greatest(1,least(p_batch,5000)) loop
  perform bid_accrue_periods(u.user_id,p_now);
  perform bid_enforce_sites(u.user_id,p_now);
  update credit_accounts set last_entitlement_check=p_now where user_id=u.user_id;
  n:=n+1;
 end loop;
 return jsonb_build_object('ok',true,'accounts',n);
end $$;

-- No client can invoke a monetary mutation or a SECURITY DEFINER helper, including via PostgREST.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'bid_v12_%' or p.proname in ('bid_accrue_periods','bid_record_payment','bid_scheduler_credits','bid_monitor_register','bid_start_trial','bid_upgrade_grant','bid_domain_request','bid_credit_status','bid_grant','bid_hold','bid_settle','bid_release','bid_charge','bid_boost','bid_refund','bid_enforce_sites','bid_site_burn','bid_site_change','bid_nudge_ack','bid_usage_summary','bid_reconcile_usage')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
