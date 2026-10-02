-- Credits V2. Source for the generated block in schema.sql; run scripts/credits-sync.mjs after editing.
-- V3 (catalog v13) lives in credits-v13.sql, generated right after this block; functions whose rules changed
-- (release curve, guards, spend order, site entitlements) are defined there only.
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
alter table public.credit_grants add column if not exists refund_base bigint check(refund_base>=credits);
-- Credits that left a lot without being spent (expiry, cap trim, refund) and the refund debt already
-- recorded against it. Spent = credits - left_credits - removed_credits; only spent credits become refund debt.
alter table public.credit_grants add column if not exists removed_credits bigint not null default 0 check(removed_credits>=0);
alter table public.credit_grants add column if not exists refund_debt bigint not null default 0 check(refund_debt>=0);
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
-- B5: Paddle chargebacks. An open chargeback suspends paid entitlements (no new holds, no active sites);
-- chargeback_reverse restores them. Warnings only notify the owner.
create table if not exists public.credit_disputes (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  adjustment_ref text not null, payment_ref text not null,
  kind text not null check(kind in ('warning','chargeback')),
  status text not null default 'open' check(status in ('open','closed','reversed')),
  taken bigint not null default 0, debt bigint not null default 0,
  created_at timestamptz not null default now(), resolved_at timestamptz,
  primary key(user_id,adjustment_ref)
);
-- Rows for the owner/admin to act on (chargebacks, reconciliation warnings). Service role only.
create table if not exists public.admin_notifications (
  id bigserial primary key, kind text not null, user_id uuid references public.profiles(user_id) on delete cascade,
  ref text not null, payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), resolved_at timestamptz, unique(kind,ref)
);
alter table public.admin_notifications enable row level security;
alter table public.subscriptions add column if not exists window_anchor timestamptz;
-- B6: time of the first failed renewal payment; past_due entitlements last 7 days from it.
alter table public.subscriptions add column if not exists past_due_since timestamptz;
update public.subscriptions set window_anchor=coalesce((raw->>'started_at')::timestamptz,period_start) where window_anchor is null;
alter table public.monitor_targets add column if not exists site_id uuid references public.sites(id) on delete set null;
alter table public.credit_ledger add column if not exists operation_id text;
alter table public.credit_ledger add column if not exists expires_at timestamptz;
create index if not exists credit_ledger_operation on public.credit_ledger(user_id,operation_id) where operation_id is not null;

do $$ declare t text; begin
  foreach t in array array['credit_accounts','credit_grants','credit_holds','credit_allocations','sites','usage_windows','usage_events','usage_daily','usage_nudges','domain_orders','netlify_allocations','credit_disputes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists own_read on public.%I',t);
    execute format('create policy own_read on public.%I for select to authenticated using(auth.uid()=user_id)',t);
  end loop;
end $$;

insert into public.settings(key,value) values
 ('pricing.actions','{"site.day":{"credits":0,"window":false},"monitor.fast":{"credits":500,"window":false},"monitor.path":{"credits":50,"window":false},"check.run":{"credits":50,"window":true},"audit.full":{"credits":400,"window":true},"deploy.preview":{"credits":150,"window":true},"deploy.production":{"credits":500,"window":true},"deploy.rollback":{"credits":0,"window":false},"backup.snapshot":{"credits":100,"window":true},"ai.fix":{"actual":true,"window":true},"ai.fix.deep":{"actual":true,"window":true},"ai.chat":{"actual":true,"window":true},"ai.site.create":{"actual":true,"window":true},"ai.site.edit":{"actual":true,"window":true}}'),
 ('credits.holdTtlMinutes','{"default":15,"deploy.preview":25,"deploy.production":25,"backup.snapshot":25,"audit.full":15,"check.run":15}'),
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
   update credit_grants set left_credits=left_credits-take,removed_credits=removed_credits+take where id=r.id;
   insert into credit_ledger(user_id,delta,bucket,reason,ref) values(p_user,-take,r.bucket,'grant_expiry',r.id::text);
  end if;
 end loop;
end $$;

-- bid_grant: replaced by the V3 rules in credits-v13.sql (loaded after this module).

-- Current tier drives window caps; cancelled users retain their last tier's limits while spending a
-- remaining grant. Free accounts with only packs use Flash windows; buying packs never raises them.
create or replace function public.bid_v12_suspended(p_user uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from credit_disputes where user_id=p_user and kind='chargeback' and status='open');
$$;

-- bid_v12_entitlement: replaced by the V3 rules in credits-v13.sql (loaded after this module).

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

-- B3: a reservation must outlive the work it pays for. Provider CLIs time out after 20 minutes
-- (engine hosting.mjs/netlify.mjs), so deploy holds live 25 minutes; AI calls keep 15 minutes.
create or replace function public.bid_v12_hold_ttl(p_action text) returns interval
language sql stable security definer set search_path=public,pg_temp as $$
 select make_interval(mins=>least(120,greatest(5,coalesce((value->>p_action)::integer,(value->>'default')::integer,15))))
 from (select coalesce((select value from settings where key='credits.holdTtlMinutes'),'{}'::jsonb) as value) s;
$$;

-- bid_hold: replaced by the V3 rules in credits-v13.sql (loaded after this module).

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

-- bid_settle: replaced by the V3 rules in credits-v13.sql (loaded after this module).

create or replace function public.bid_charge(p_user uuid,p_action text,p_credits bigint,p_operation_id text,p_site uuid default null,p_counts_window boolean default true,p_pricing_version text default '2026-10',p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare held jsonb;
begin
 held:=bid_hold(p_user,p_action,p_credits,p_operation_id,p_site,p_counts_window,p_pricing_version,null,p_now);
 if not (held->>'ok')::boolean or coalesce((held->>'settled')::boolean,false) then return held; end if;
 return bid_settle(p_user,p_operation_id,p_credits,null,p_now);
end $$;

-- bid_boost: replaced by the V3 rules in credits-v13.sql (loaded after this module).

-- Refund only the unspent, unreserved part of the ORIGINAL grant, never credits from a later purchase.
-- Persist approved adjustments even when their payment/upgrade grant arrives later.
create table if not exists public.credit_refunds (
 user_id uuid not null references public.profiles(user_id) on delete cascade,
 payment_ref text not null, adjustment_ref text not null, share numeric not null check(share>0 and share<=1),
 created_at timestamptz not null default now(), primary key(user_id,payment_ref,adjustment_ref)
);
alter table credit_refunds add column if not exists scope text not null default 'all';
alter table credit_refunds enable row level security;
drop policy if exists own_read on credit_refunds;
create policy own_read on credit_refunds for select to authenticated using(auth.uid()=user_id);

-- B7: zero-value refund markers are written once per (user, ref, reason); replays used to duplicate them.
delete from credit_ledger a using credit_ledger b where a.user_id=b.user_id and a.reason=b.reason and a.ref=b.ref
 and a.reason in ('payment_refund','grant_refund') and a.delta=0 and a.id>b.id;
create unique index if not exists credit_ledger_refund_markers_once on public.credit_ledger(user_id,ref,reason)
 where reason in ('payment_refund','grant_refund') and ref is not null;

-- p_scope (B2): 'all' (whole transaction, no line items known), 'plan' (the plan line: plan, annual slices,
-- upgrade lots) or 'price:<paddle price id>' (that pack line only). The refunded amount is taken from what
-- is left of each lot; credits already SPENT from it become debt (expired or trimmed credits do not).
drop function if exists public.bid_refund(uuid,text,text,numeric,timestamptz);
create or replace function public.bid_refund(p_user uuid,p_ref text,p_adjustment text,p_share numeric,p_now timestamptz default now(),p_scope text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; held bigint; take bigint; owed bigint; target bigint; taken bigint:=0; debt_added bigint:=0; prior numeric; v_scope text:=coalesce(p_scope,'all'); v_price text;
begin
 perform bid_v12_refresh(p_user,p_now);
 if p_share<=0 or p_share>1 then raise exception 'invalid refund share'; end if;
 if v_scope not in ('all','plan') and not starts_with(v_scope,'price:') then raise exception 'invalid refund scope'; end if;
 v_price:=case when starts_with(v_scope,'price:') then substr(v_scope,7) end;
 select share into prior from credit_refunds where user_id=p_user and payment_ref=p_ref and adjustment_ref=p_adjustment;
 if prior is not null and prior<>p_share then raise exception 'refund adjustment changed'; end if;
 insert into credit_refunds(user_id,payment_ref,adjustment_ref,share,created_at,scope) values(p_user,p_ref,p_adjustment,p_share,p_now,v_scope) on conflict do nothing;
 for r in select * from credit_grants where user_id=p_user and (ref=p_ref or payment_ref=p_ref or starts_with(ref,p_ref||':'))
  and (v_scope='all' or (v_scope='plan' and bucket='plan') or (v_price is not null and ref=p_ref||':'||v_price)) order by expires_at,granted_at,id loop
  if exists(select 1 from credit_ledger where user_id=p_user and reason='grant_refund' and ref=p_adjustment||':'||r.id) then continue; end if;
  select coalesce(sum(credits),0) into held from credit_allocations where grant_id=r.id;
  if held>0 then raise exception 'refund waits for reserved work' using errcode='55P03'; end if;
  target:=round(coalesce(r.refund_base,r.credits)*p_share)::bigint;
  take:=least(target,r.left_credits);
  owed:=least(target-take,greatest(0,r.credits-r.left_credits-r.removed_credits-r.refund_debt));
  update credit_grants set left_credits=left_credits-take,removed_credits=removed_credits+take,refund_debt=refund_debt+owed where id=r.id;
  if owed>0 then update credit_accounts set debt=debt+owed,debt_since=coalesce(debt_since,p_now) where user_id=p_user; end if;
  insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) values(p_user,-(take+owed),r.bucket,'grant_refund',p_adjustment||':'||r.id,p_now);
  taken:=taken+take; debt_added:=debt_added+owed;
 end loop;
 -- Refunded-but-spent credits are owed like an action charge: other available lots pay them first (FIFO),
 -- only a shortfall stays as debt (repaid by the next grant).
 if debt_added>0 then
  for r in select * from credit_grants where user_id=p_user and left_credits>0 and expires_at>p_now order by expires_at,granted_at,id loop
   select debt into owed from credit_accounts where user_id=p_user;
   exit when owed<=0;
   select coalesce(sum(credits),0) into held from credit_allocations where grant_id=r.id;
   take:=least(owed,greatest(0,r.left_credits-held));
   if take>0 then
    update credit_grants set left_credits=left_credits-take where id=r.id;
    update credit_accounts set debt=debt-take,debt_since=case when debt=take then null else debt_since end where user_id=p_user;
   end if;
  end loop;
 end if;
 if v_scope in ('all','plan') then
  update credit_periods set refund_share=greatest(refund_share,least(1,(select sum(share) from credit_refunds where user_id=p_user and payment_ref=p_ref and scope in ('all','plan')))) where transaction_ref=p_ref and user_id=p_user;
 end if;
 insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) values(p_user,0,'plan','payment_refund',p_adjustment||':'||p_ref,p_now) on conflict do nothing;
 return jsonb_build_object('ok',true,'taken',taken,'debt',debt_added);
end $$;

create or replace function public.bid_v12_replay_refunds(p_user uuid,p_ref text,p_now timestamptz default now()) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;
begin
 perform bid_v12_lock(p_user);
 for r in select * from credit_refunds where user_id=p_user and payment_ref=p_ref order by created_at,adjustment_ref loop
  perform bid_refund(p_user,p_ref,r.adjustment_ref,r.share,p_now,r.scope);
 end loop;
end $$;

-- B2: one Paddle adjustment → one bid_refund per line item (adjustment.items[].item_id → the transaction's
-- details.line_items[].price_id → plan or pack lot). Without line items the whole-transaction share applies.
-- Once applied, an adjustment always replays with its recorded lines, so retries are deterministic.
create or replace function public.bid_v12_apply_adjustment(p_user uuid,p_adjustment jsonb,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare txn text:=p_adjustment->>'transaction_id'; adj text:=p_adjustment->>'id'; paid jsonb; item jsonb; line jsonb; v_price text; v_scope text;
 line_total numeric; amount numeric; total numeric; v_share numeric; r jsonb; stored record; taken bigint:=0; owed bigint:=0; lines jsonb:='[]'::jsonb;
begin
 perform bid_v12_lock(p_user);
 if txn is null or adj is null then raise exception 'invalid adjustment'; end if;
 if p_adjustment->>'action' in ('chargeback','chargeback_warning','chargeback_reverse') then return bid_v12_chargeback(p_user,p_adjustment,p_now); end if;
 if p_adjustment->>'action' is distinct from 'refund' or p_adjustment->>'status' is distinct from 'approved' then return jsonb_build_object('ok',true,'ignored',true); end if;
 if exists(select 1 from credit_refunds where user_id=p_user and payment_ref=txn and (adjustment_ref=adj or starts_with(adjustment_ref,adj||'#'))) then
  for stored in select * from credit_refunds where user_id=p_user and payment_ref=txn and (adjustment_ref=adj or starts_with(adjustment_ref,adj||'#')) order by adjustment_ref loop
   r:=bid_refund(p_user,txn,stored.adjustment_ref,stored.share,p_now,stored.scope);
   taken:=taken+(r->>'taken')::bigint; owed:=owed+(r->>'debt')::bigint;
   lines:=lines||jsonb_build_object('scope',stored.scope,'share',stored.share,'taken',r->'taken','debt',r->'debt');
  end loop;
  return jsonb_build_object('ok',true,'taken',taken,'debt',owed,'lines',lines,'share',case when jsonb_array_length(lines)=1 then lines#>'{0,share}' end);
 end if;
 select payload->'data' into paid from billing_events where user_id=p_user and type='transaction.completed' and ref=txn order by processed_at desc limit 1;
 total:=coalesce((paid#>>'{details,totals,total}')::numeric,(paid#>>'{totals,total}')::numeric,0);
 if jsonb_typeof(p_adjustment->'items')='array' and jsonb_array_length(p_adjustment->'items')>0 and jsonb_typeof(paid#>'{details,line_items}')='array' then
  for item in select value from jsonb_array_elements(p_adjustment->'items') loop
   continue when item->>'type'='tax'; -- a tax-only correction does not change what was bought
   line:=null;
   select value into line from jsonb_array_elements(paid#>'{details,line_items}') where value->>'id'=item->>'item_id' limit 1;
   amount:=coalesce((item->>'amount')::numeric,(item#>>'{totals,total}')::numeric);
   if line is null then
    v_scope:='all'; line_total:=nullif(total,0);
   else
    v_price:=line->>'price_id'; line_total:=nullif((line#>>'{totals,total}')::numeric,0);
    v_scope:=case when exists(select 1 from settings st,jsonb_array_elements(case when jsonb_typeof(st.value->'packs')='array' then st.value->'packs' else '[]'::jsonb end) pk where st.key='billing.catalog' and pk->>'paddlePriceId'=v_price)
      or exists(select 1 from credit_grants where user_id=p_user and ref=txn||':'||v_price and bucket='topup') then 'price:'||v_price else 'plan' end;
   end if;
   v_share:=case when item->>'type'='full' or line_total is null or amount is null then 1 else least(1,amount/line_total) end;
   continue when v_share<=0;
   r:=bid_refund(p_user,txn,adj||'#'||coalesce(item->>'item_id','item'),v_share,p_now,v_scope);
   taken:=taken+(r->>'taken')::bigint; owed:=owed+(r->>'debt')::bigint;
   lines:=lines||jsonb_build_object('scope',v_scope,'share',v_share,'taken',r->'taken','debt',r->'debt');
  end loop;
  return jsonb_build_object('ok',true,'taken',taken,'debt',owed,'lines',lines,'share',case when jsonb_array_length(lines)=1 then lines#>'{0,share}' end);
 end if;
 amount:=coalesce((p_adjustment#>>'{totals,total}')::numeric,0);
 v_share:=case when total>0 and amount>0 then least(1,amount/total) else 1 end;
 r:=bid_refund(p_user,txn,adj,v_share,p_now,null);
 return jsonb_build_object('ok',true,'taken',r->'taken','debt',r->'debt','share',v_share,'lines',jsonb_build_array(jsonb_build_object('scope','all','share',v_share,'taken',r->'taken','debt',r->'debt')));
end $$;

-- B5: chargeback → the transaction's credits are taken back like a full/partial refund (spent → owed),
-- paid entitlements are suspended and the owner is notified. chargeback_reverse restores the removed credits
-- (a 12-month lot that first repays the debt the chargeback created) and lifts the suspension.
create or replace function public.bid_v12_chargeback(p_user uuid,p_adjustment jsonb,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare txn text:=p_adjustment->>'transaction_id'; adj text:=p_adjustment->>'id'; act text:=p_adjustment->>'action'; d credit_disputes; r jsonb; restored bigint:=0; n integer:=0;
begin
 perform bid_v12_refresh(p_user,p_now);
 if txn is null or adj is null then raise exception 'invalid adjustment'; end if;
 if coalesce(p_adjustment->>'status','approved') in ('rejected','pending_approval') then return jsonb_build_object('ok',true,'ignored',true); end if;
 if act='chargeback_warning' then
  insert into credit_disputes(user_id,adjustment_ref,payment_ref,kind,created_at) values(p_user,adj,txn,'warning',p_now) on conflict do nothing;
  insert into admin_notifications(kind,user_id,ref,payload,created_at) values('chargeback_warning',p_user,adj,jsonb_build_object('transaction',txn,'amount',p_adjustment#>'{totals,total}','currency',p_adjustment->>'currency_code'),p_now) on conflict do nothing;
  return jsonb_build_object('ok',true,'dispute','warning');
 end if;
 if act='chargeback' then
  if exists(select 1 from credit_disputes where user_id=p_user and adjustment_ref=adj) then return jsonb_build_object('ok',true,'duplicate',true); end if;
  insert into credit_disputes(user_id,adjustment_ref,payment_ref,kind,created_at) values(p_user,adj,txn,'chargeback',p_now) returning * into d;
  update credit_disputes set status='closed',resolved_at=p_now where user_id=p_user and payment_ref=txn and kind='warning' and status='open';
  r:=bid_v12_apply_adjustment(p_user,p_adjustment||jsonb_build_object('action','refund','status','approved'),p_now);
  update credit_disputes set taken=(r->>'taken')::bigint,debt=coalesce((r->>'debt')::bigint,0) where user_id=p_user and adjustment_ref=adj;
  insert into admin_notifications(kind,user_id,ref,payload,created_at) values('chargeback',p_user,adj,jsonb_build_object('transaction',txn,'amount',p_adjustment#>'{totals,total}','currency',p_adjustment->>'currency_code','taken',r->'taken','debt',r->'debt'),p_now) on conflict do nothing;
  perform bid_enforce_sites(p_user,p_now);
  return jsonb_build_object('ok',true,'dispute','chargeback','taken',r->'taken','debt',r->'debt','suspended',true);
 end if;
 -- chargeback_reverse: the bank decided for the merchant; every open chargeback of this payment is undone
 if exists(select 1 from admin_notifications where kind='chargeback_reverse' and ref=adj) then return jsonb_build_object('ok',true,'duplicate',true); end if;
 for d in select * from credit_disputes where user_id=p_user and payment_ref=txn and kind='chargeback' and status='open' loop
  if d.taken+d.debt>0 then
   perform bid_grant(p_user,d.taken+d.debt,'admin_grant','chargeback_reverse:'||d.adjustment_ref,null,p_now,null,p_now);
  end if;
  delete from credit_refunds where user_id=p_user and payment_ref=txn and (adjustment_ref=d.adjustment_ref or starts_with(adjustment_ref,d.adjustment_ref||'#'));
  update credit_disputes set status='reversed',resolved_at=p_now where user_id=p_user and adjustment_ref=d.adjustment_ref;
  restored:=restored+d.taken+d.debt; n:=n+1;
 end loop;
 update credit_periods set refund_share=least(1,coalesce((select sum(share) from credit_refunds where user_id=p_user and payment_ref=txn and scope in ('all','plan')),0)) where user_id=p_user and transaction_ref=txn;
 insert into admin_notifications(kind,user_id,ref,payload,created_at) values('chargeback_reverse',p_user,adj,jsonb_build_object('transaction',txn,'restored',restored,'disputes',n),p_now) on conflict do nothing;
 return jsonb_build_object('ok',true,'dispute','reversed','restored',restored,'suspended',bid_v12_suspended(p_user));
end $$;

-- Verified webhook payloads may arrive out of order; recover adjustments once the owner is known.
create or replace function public.bid_v12_payment_refunds(p_user uuid,p_ref text,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;
begin
 perform bid_v12_lock(p_user);
 if exists(select 1 from billing_events where user_id=p_user and type='transaction.completed' and ref=p_ref) then
  for r in select x.payload from (select distinct on (payload#>>'{data,id}') payload,processed_at from billing_events where type in ('adjustment.created','adjustment.updated')
   and payload#>>'{data,transaction_id}'=p_ref and payload#>>'{data,action}' in ('refund','chargeback','chargeback_warning','chargeback_reverse')
   order by payload#>>'{data,id}',processed_at desc) x order by coalesce(x.payload->>'occurred_at',x.payload#>>'{data,created_at}'),x.processed_at loop
   perform bid_v12_apply_adjustment(p_user,r.payload->'data',p_now);
  end loop;
 end if;
 perform bid_v12_replay_refunds(p_user,p_ref,p_now);
 return jsonb_build_object('ok',true);
end $$;

-- Function ACLs are assigned explicitly at the end of this module, including internal helpers.

create or replace function public.bid_enforce_sites(p_user uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ent jsonb; lim integer; n integer:=0; r record; rank integer:=0; debt_at timestamptz; best_tier text;
begin
 perform bid_v12_refresh(p_user,p_now);
 -- The scheduler must expire entitlements even when the owner's Mac never opens the app.
 -- An active Paddle subscription keeps 3 days after period_end for a late renewal webhook. past_due counts
 -- 7 days from the first failed payment (B6): Paddle moves period_end forward when it creates the renewal.
 update subscriptions set status='expired',updated_at=p_now where user_id=p_user and (
  (status in ('active','trial') and period_end is not null
   and period_end+case when provider='paddle' and status='active' then interval '3 days' else interval '0 days' end<=p_now)
  or (status='past_due' and coalesce(past_due_since,event_at,period_end) is not null and coalesce(past_due_since,event_at,period_end)+interval '7 days'<=p_now));
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
   update sites set state='paused',paused_at=p_now,paused_reason=case when coalesce((ent->>'suspended')::boolean,false) then 'suspended' when debt_at+interval '3 days'<=p_now then 'no_credits' else 'plan_limit' end where id=r.id;
   n:=n+1;
  end if;
 end loop;
 return jsonb_build_object('ok',true,'paused',n,'limit',lim);
end $$;

-- bid_v12_burn_one: replaced by the V3 rules in credits-v13.sql (loaded after this module).

-- bid_site_burn: replaced by the V3 rules in credits-v13.sql (loaded after this module).

-- bid_site_change: replaced by the V3 rules in credits-v13.sql (loaded after this module).

create or replace function public.bid_nudge_ack(p_user uuid,p_period text,p_threshold text,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if length(p_period)>200 or p_threshold not in ('75','90','100','w5h80','w5h100','week80','week100','site_limit') then raise exception 'invalid nudge'; end if;
 insert into usage_nudges(user_id,period_ref,threshold,shown_at) values(p_user,p_period,p_threshold,p_now) on conflict do nothing;
 return jsonb_build_object('ok',true);
end $$;

-- bid_usage_summary: replaced by the V3 rules in credits-v13.sql (loaded after this module).

create or replace view public.usage_drift with(security_invoker=true) as
select e.user_id,e.operation_id,e.credits as recorded,coalesce(-sum(l.delta),0)::bigint as ledger_charged
from public.usage_events e left join public.credit_ledger l on l.user_id=e.user_id and l.operation_id=e.operation_id and l.reason in ('action','ai_fix')
group by e.user_id,e.operation_id,e.credits having e.credits<>coalesce(-sum(l.delta),0);
create or replace function public.bid_reconcile_usage(p_since timestamptz default now()-interval '1 day') returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('checkedSince',p_since,'drift',coalesce(jsonb_agg(d),'[]'::jsonb)) from usage_drift d
 where exists(select 1 from usage_events e where e.user_id=d.user_id and e.operation_id=d.operation_id and e.created_at>=p_since);
$$;

-- Existing projects enter a 14-day, visible migration grace. No sites are deleted by migration.
-- B4: at most the plan's site limit is activated (most recently monitored first); the rest start paused
-- with reason plan_limit, and nothing is billed while the grace lasts (bid_v12_burn_one).
create or replace function public.bid_v12_migrate_sites(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; cur uuid; lim integer; active_n integer; n integer:=0;
begin
 for r in select c.user_id,c.project_key,c.enabled from (
   select p.user_id,p.key as project_key,coalesce(m.enabled,false) as enabled,coalesce(m.updated_at,p.updated_at) as at
    from bid_projects p join profiles pr on pr.user_id=p.user_id left join monitor_targets m on m.user_id=p.user_id and m.project_key=p.key
   union all
   select m.user_id,m.project_key,m.enabled,m.updated_at from monitor_targets m
    where not exists(select 1 from bid_projects p where p.user_id=m.user_id and p.key=m.project_key)
  ) c where not exists(select 1 from sites s where s.user_id=c.user_id and s.project_key=c.project_key)
  order by c.user_id,c.enabled desc,c.at desc,c.project_key loop
  if cur is distinct from r.user_id then
   cur:=r.user_id;
   lim:=coalesce((bid_v12_entitlement(cur,p_now)->>'siteLimit')::integer,0);
   select count(*) into active_n from sites where user_id=cur and state='active';
  end if;
  if r.enabled and active_n<lim then
   insert into sites(user_id,project_key,state,activated_at,migration_grace_until) values(r.user_id,r.project_key,'active',p_now,p_now+interval '14 days');
   active_n:=active_n+1;
  else
   insert into sites(user_id,project_key,state,paused_at,paused_reason,migration_grace_until)
   values(r.user_id,r.project_key,'paused',case when r.enabled then p_now end,case when r.enabled then 'plan_limit' end,p_now+interval '14 days');
  end if;
  n:=n+1;
 end loop;
 update monitor_targets m set site_id=s.id from sites s where s.user_id=m.user_id and s.project_key=m.project_key and m.site_id is null;
 return jsonb_build_object('ok',true,'sites',n);
end $$;
-- The one-time site migration runs at the end of credits-v13.sql, once bid_v12_entitlement exists.

-- bid_credit_status: replaced by the V3 rules in credits-v13.sql (loaded after this module).

-- Preserve the subscription-start anchor when Paddle advances current_billing_period each month.
create or replace function public.bid_v12_subscription_anchor() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if TG_OP='UPDATE' then new.window_anchor:=coalesce(old.window_anchor,old.period_start,new.window_anchor); end if;
 new.window_anchor:=coalesce(new.window_anchor,(new.raw->>'started_at')::timestamptz,new.period_start);
 if new.status='past_due' then
  new.past_due_since:=coalesce(case when TG_OP='UPDATE' and old.status='past_due' then old.past_due_since end,new.past_due_since,new.event_at,now());
 else
  new.past_due_since:=null;
 end if;
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
declare c billing_changes; plans jsonb; from_credits bigint; to_credits bigint; grant_credits bigint; start_at timestamptz; end_at timestamptz; k integer; annual_start timestamptz; annual_end timestamptz; receipt jsonb; payment text; payment_count integer;
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
  annual_start:=start_at; annual_end:=end_at;
  k:=greatest(0,(extract(year from c.effective_at)::int-extract(year from start_at)::int)*12+extract(month from c.effective_at)::int-extract(month from start_at)::int);
  if start_at+make_interval(months=>k)>c.effective_at then k:=greatest(0,k-1); end if;
  end_at:=least(end_at,start_at+make_interval(months=>k+1)); start_at:=start_at+make_interval(months=>k);
 end if;
 grant_credits:=greatest(0,round((to_credits-from_credits)*least(1,greatest(0,extract(epoch from(end_at-c.effective_at))/extract(epoch from(end_at-start_at))))))::bigint;
 receipt:=bid_grant(p_user,grant_credits,'upgrade_grant',c.provider_ref||':upg:'||c.id,c.to_tier,c.effective_at,null,p_now);
 payment:=c.quote->>'paymentRef';
 if payment is null then
  select min(ref),count(distinct ref) into payment,payment_count from billing_events e where e.user_id=p_user and e.type='transaction.completed' and e.payload#>>'{data,origin}'='subscription_update' and e.payload#>>'{data,subscription_id}'=c.provider_ref
   and (e.payload->>'occurred_at')::timestamptz between c.effective_at-interval '2 seconds' and c.effective_at+interval '10 minutes'
   and exists(select 1 from jsonb_array_elements(e.payload#>'{data,items}') item where coalesce(item#>>'{price,id}',item->>'price_id') in ((select value#>>array['plans',c.to_tier,'paddlePriceId'] from settings where key='billing.catalog'),(select value#>>array['plans',c.to_tier,'yearly','paddlePriceId'] from settings where key='billing.catalog'),
     (select value#>>array['plans',c.to_tier,'hostingIncluded','paddlePriceId'] from settings where key='billing.catalog'),(select value#>>array['plans',c.to_tier,'hostingIncluded','yearly','paddlePriceId'] from settings where key='billing.catalog')));
  if payment_count<>1 then payment:=null; end if;
  if payment is not null then update billing_changes set quote=quote||jsonb_build_object('paymentRef',payment) where id=c.id; end if;
 end if;
 payment:=coalesce(payment,'upgrade:'||c.id);
 update credit_grants set payment_ref=payment where user_id=p_user and ref=c.provider_ref||':upg:'||c.id and source='upgrade_grant';
 if annual_start is not null then
  -- Keep each paid component separately refundable. Existing slices keep their original expiry;
  -- following slices use the upgraded validity and add only the newly paid monthly difference.
  perform bid_accrue_periods(p_user,c.effective_at);
  update credit_periods set tier=c.to_tier,validity_months=(plans#>>array[c.to_tier,'validity_months'])::int
   where user_id=p_user and subscription_ref=c.provider_ref and starts_at=annual_start and array_position(array['free','flash','high','knight'],tier)<array_position(array['free','flash','high','knight'],c.to_tier);
  insert into credit_periods(transaction_ref,user_id,subscription_ref,tier,interval,monthly_credits,validity_months,starts_at,ends_at,granted_through,billing_change_id)
  values(payment,p_user,c.provider_ref,c.to_tier,'year',to_credits-from_credits,(plans#>>array[c.to_tier,'validity_months'])::int,annual_start,annual_end,k,c.id)
  on conflict(billing_change_id) do nothing;
  update credit_grants set payment_ref=payment where user_id=p_user and (ref='upgrade:'||c.id or starts_with(ref,'upgrade:'||c.id||':'));
  update credit_periods set transaction_ref=payment where user_id=p_user and billing_change_id=c.id and transaction_ref<>payment;
 end if;
 perform bid_v12_payment_refunds(p_user,payment,p_now);
 return receipt;
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
alter table credit_periods add column if not exists billing_change_id uuid references public.billing_changes(id) on delete set null;
create unique index if not exists credit_periods_change_once on credit_periods(billing_change_id);
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
declare period credit_periods; until_at timestamptz; k integer; m integer; at timestamptz; amount bigint; ref text; given bigint:=0; receipt jsonb;
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
   receipt:=bid_grant(p_user,amount,'plan_grant',ref,period.tier,at,at+make_interval(months=>period.validity_months),p_now);
   update credit_grants set refund_base=period.monthly_credits,payment_ref=period.transaction_ref where id=(receipt->>'id')::uuid;
   -- This slice was already reduced by these adjustments; retries must not refund it again.
   insert into credit_ledger(user_id,delta,bucket,reason,ref,created_at) select p_user,0,'plan','grant_refund',adjustment_ref||':'||(receipt->>'id'),p_now from credit_refunds where user_id=p_user and payment_ref=period.transaction_ref and scope in ('all','plan') on conflict do nothing;
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
 perform bid_v12_payment_refunds(p_user,p_transaction,p_now);
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

-- Cloud artifacts are private and require the corresponding settled operation receipt.
create table if not exists public.cloud_reports (
 user_id uuid not null references public.profiles(user_id) on delete cascade,
 operation_id text not null, project_key text not null, action text not null,
 report jsonb not null, created_at timestamptz not null default now(),
 primary key(user_id,operation_id), foreign key(user_id,operation_id) references public.usage_events(user_id,operation_id) on delete cascade,
 check(octet_length(report::text)<=65536)
);
alter table cloud_reports enable row level security;
drop policy if exists own_read on cloud_reports;
create policy own_read on cloud_reports for select to authenticated using(auth.uid()=user_id);

create or replace function public.bid_v12_report(p_user uuid,p_operation_id text,p_project text,p_report jsonb,p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare h credit_holds; e usage_events; saved cloud_reports; r jsonb;
begin
 perform bid_v12_lock(p_user);
 select * into saved from cloud_reports where user_id=p_user and operation_id=p_operation_id;
 if found then return jsonb_build_object('ok',true,'duplicate',true,'report',saved.report,'operationId',p_operation_id); end if;
 if not exists(select 1 from bid_projects where user_id=p_user and key=p_project) then return jsonb_build_object('ok',false,'code','not_found'); end if;
 select * into h from credit_holds where user_id=p_user and operation_id=p_operation_id;
 if h.action not in ('check.run','audit.full','deploy.preview','deploy.production','deploy.rollback','backup.snapshot') or h.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
 if h.site_id is not null and not exists(select 1 from sites where id=h.site_id and user_id=p_user and project_key=p_project) then return jsonb_build_object('ok',false,'code','not_found'); end if;
 if h.status<>'settled' then
  r:=bid_settle(p_user,p_operation_id,h.credits,null,p_now);
  if not coalesce((r->>'ok')::boolean,false) then return r; end if;
 end if;
 select * into e from usage_events where user_id=p_user and operation_id=p_operation_id;
 if e.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
 insert into cloud_reports(user_id,operation_id,project_key,action,report,created_at) values(p_user,p_operation_id,p_project,e.action,p_report,p_now);
 return jsonb_build_object('ok',true,'operationId',p_operation_id,'charged',e.credits,'report',p_report);
end $$;

-- No client can invoke a monetary mutation or a SECURITY DEFINER helper, including via PostgREST.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'bid_v12_%' or p.proname in ('bid_accrue_periods','bid_record_payment','bid_scheduler_credits','bid_monitor_register','bid_start_trial','bid_upgrade_grant','bid_domain_request','bid_credit_status','bid_grant','bid_hold','bid_settle','bid_release','bid_charge','bid_boost','bid_refund','bid_enforce_sites','bid_site_burn','bid_site_change','bid_nudge_ack','bid_usage_summary','bid_reconcile_usage')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
