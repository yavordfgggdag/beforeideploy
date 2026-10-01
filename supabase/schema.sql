-- Before I Deploy — Supabase schema v10 (run once in Supabase → SQL Editor; safe to re-run)
-- Only project METADATA and account data are stored. Service tokens (Netlify, Vercel, GitHub, AI keys…)
-- never leave the user's Mac.
--
-- Invariants (V10-PLAN §4): role, plan and credit_ledger change only through Edge Functions running
-- with the service role; the client can read its own rows and write only profiles.locale / display_name.

-- ---------------------------------------------------------------- projects (V9)

create table if not exists public.bid_projects (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  key         text        not null,
  name        text        not null,
  framework   text,
  hosting     text,
  live_url    text,
  domain      text,
  last_status text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.bid_projects enable row level security;

drop policy if exists "own rows" on public.bid_projects;
create policy "own rows" on public.bid_projects
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- roles, plans, profiles (V10)

do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('normal', 'vip', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'plan_tier') then
    create type public.plan_tier as enum ('free', 'flash', 'high', 'knight');
  end if;
end $$;

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  locale       text not null default 'en',
  role         public.user_role not null default 'normal',
  plan         public.plan_tier not null default 'free',
  ai_disabled  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = user_id);

-- The client may update its own row, but the trigger below keeps role/plan/ai_disabled as they were.
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Not security definer: current_user must be the caller's role. A client session (anon/authenticated) may not
-- touch these columns; the service role (Edge Functions) and the owner in the SQL editor may (audit C7 — the
-- earlier auth.role() check also blocked the owner's "make yourself admin" update below).
create or replace function public.profiles_protect_columns()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.role := old.role;
    new.plan := old.plan;
    new.ai_disabled := old.ai_disabled;
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.profiles_protect_columns();

-- New auth user → profile (email, display name and locale from the signup metadata).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, display_name, locale)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en')
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- A changed sign-in address reaches the profile too (Admin search, invitations; audit C15).
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = coalesce(new.email, '') where user_id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Profiles for users who signed up before v10.
insert into public.profiles (user_id, email, display_name)
select u.id, coalesce(u.email, ''), coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------- subscriptions (filled by billing-webhook, WP4)

create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(user_id) on delete cascade,
  provider      text not null,               -- 'paddle' | 'apple' | 'manual'
  provider_ref  text,                        -- subscription id at the provider
  tier          public.plan_tier not null,
  status        text not null,               -- active | trial | past_due | canceled | expired
  period_start  timestamptz,
  period_end    timestamptz,
  cancel_at     timestamptz,
  raw           jsonb,
  updated_at    timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;
drop policy if exists "read own subscriptions" on public.subscriptions;
create policy "read own subscriptions" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Paddle webhook deliveries already processed (idempotency: Paddle retries until it gets a 2xx).
create table if not exists public.billing_events (
  id           text primary key,             -- Paddle event_id
  provider     text not null default 'paddle',
  type         text not null,
  payload      jsonb,
  processed_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;   -- no policies: service role only

alter table public.subscriptions add column if not exists customer_ref text;   -- Paddle customer id (portal)
create unique index if not exists subscriptions_provider_ref_idx on public.subscriptions (provider, provider_ref) where provider_ref is not null;

-- ---------------------------------------------------------------- AI credits (tokens)

create table if not exists public.credit_ledger (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  delta      bigint not null,                -- + grant, − usage
  bucket     text not null default 'plan',   -- 'plan' (monthly, expires) | 'topup' (packs, 12 months)
                                             -- | 'hold' (an AI request in flight; replaced by the real charge)
  reason     text not null,                  -- plan_grant | trial_grant | topup | ai_fix | hold | admin_grant | refund | expiry
  ref        text,                           -- ai_usage.id / order id
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;
drop policy if exists "read own ledger" on public.credit_ledger;
create policy "read own ledger" on public.credit_ledger
  for select using (auth.uid() = user_id);

-- security_invoker: the view is filtered by the ledger's RLS, so a user sees only their own balance.
create or replace view public.credit_balance
  with (security_invoker = true) as
  select user_id, sum(delta)::bigint as balance
  from public.credit_ledger
  group by user_id;

-- per bucket, summed in Postgres: the Edge Functions never page through ledger rows (audit C8)
create or replace view public.credit_bucket_balance
  with (security_invoker = true) as
  select user_id, bucket, sum(delta)::bigint as balance
  from public.credit_ledger
  group by user_id, bucket;

create table if not exists public.ai_usage (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(user_id) on delete cascade,
  project_key    text,
  step           text,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(10, 6),
  charged_tokens bigint,                     -- (input + output) × model multiplier
  status         text,
  created_at     timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------- admin

create table if not exists public.admin_audit (
  id         bigserial primary key,
  admin_id   uuid,
  action     text not null,
  target     uuid,
  payload    jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;   -- no policies: service role only

-- Global settings (plan prices, models per plan, daily limit…) edited from the Admin panel.
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings
  for select to authenticated using (true);

-- BEGIN GENERATED V12 CATALOG (scripts/catalog-sync.mjs)
insert into public.settings (key, value) values
  ('plans', '{"flash":{"tokens":100000,"max_active_sites":1,"fair_use_sites":1,"validity_months":1},"high":{"tokens":300000,"max_active_sites":3,"fair_use_sites":3,"validity_months":3},"knight":{"tokens":1000000,"max_active_sites":10,"fair_use_sites":25,"validity_months":10}}'),
  ('billing.catalog', '{"version":"v12.2","currency":"EUR","taxInclusive":true,"mode":"sandbox","trial":{"days":7,"plan":"high","tokens":50000,"activeSites":1},"plans":{"flash":{"price":9.99,"paddlePriceId":null,"yearly":{"price":99.9,"paddlePriceId":null},"credits":100000,"activeSites":1,"activeSitesMax":1,"validityMonths":1,"window5h":20000,"weekly":40000,"extras":{"domain":false,"netlifyCredits":false,"boost":false}},"high":{"price":29.99,"paddlePriceId":null,"yearly":{"price":299.9,"paddlePriceId":null},"credits":300000,"activeSites":3,"activeSitesMax":3,"validityMonths":3,"window5h":60000,"weekly":120000,"extras":{"domain":false,"netlifyCredits":false,"boost":false}},"knight":{"price":99.99,"paddlePriceId":null,"yearly":{"price":999.9,"paddlePriceId":null},"credits":1000000,"activeSites":10,"activeSitesMax":25,"validityMonths":10,"window5h":200000,"weekly":400000,"extras":{"domain":true,"netlifyCredits":false,"boost":true}}},"packs":[{"id":"pack-100k","tokens":100000,"price":4.99,"validityMonths":12,"paddlePriceId":null},{"id":"pack-500k","tokens":500000,"price":19.99,"validityMonths":12,"paddlePriceId":null},{"id":"pack-1m","tokens":1000000,"price":39.99,"validityMonths":12,"paddlePriceId":null}]}')
on conflict (key) do nothing;
-- END GENERATED V12 CATALOG

-- ---------------------------------------------------------------- V10 audit migration (batch 2)
-- Safe to run again. On an existing database, first check for duplicates the unique indexes would reject:
--   select user_id, ref, reason, count(*) from public.credit_ledger group by 1,2,3 having count(*) > 1;

-- one trial per e-mail address, surviving account deletion (only a SHA-256 of the lower-cased address)
create table if not exists public.trial_claims (
  email_hash text primary key,
  claimed_at timestamptz not null default now()
);
alter table public.trial_claims enable row level security;   -- no policies: service role only
create unique index if not exists subscriptions_one_trial on public.subscriptions (user_id) where provider = 'trial';

-- webhook idempotency and ordering (C4/C5); user_id lets account deletion remove the payment payloads
alter table public.billing_events add column if not exists user_id uuid;
alter table public.billing_events add column if not exists ref text;   -- the transaction id (refund lookup)
create index if not exists billing_events_ref_idx on public.billing_events (type, ref);
create index if not exists billing_events_user_idx on public.billing_events (user_id);
alter table public.subscriptions add column if not exists event_at timestamptz;

-- every grant, refund and expiry happens once per reference, even with concurrent deliveries (C3)
create unique index if not exists credit_ledger_once on public.credit_ledger (user_id, ref, reason)
  where reason in ('plan_grant', 'trial_grant', 'topup', 'refund', 'expiry') and ref is not null;
create index if not exists credit_ledger_ref_idx on public.credit_ledger (ref);
create index if not exists credit_ledger_bucket_idx on public.credit_ledger (user_id, bucket);
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);

-- ---------------------------------------------------------------- owner
-- Make yourself admin once (replace the email):
--   update public.profiles set role = 'admin' where email = 'you@example.com';

-- ---------------------------------------------------------------- server-side monitoring (V11 RC)
-- Targets are registered by the app (JWT, own rows); probes, incidents and the heartbeat are written only
-- by the `monitor` Edge Function (service role, scheduled by pg_cron — see monitor-cron.sql).

create table if not exists public.monitor_targets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(user_id) on delete cascade,
  project_key   text not null,
  url           text not null,
  enabled       boolean not null default true,
  interval_min  integer not null default 10 check (interval_min between 5 and 1440),
  checks        jsonb not null default '{"kinds":["down","ssl"],"paths":[]}',
  last_run_at   timestamptz,
  next_run_at   timestamptz,
  last_ok       boolean,
  last_status   integer,
  last_ms       integer,
  last_reason   text,
  failures      integer not null default 0,
  updated_at    timestamptz not null default now(),
  unique (user_id, project_key)
);
create index if not exists monitor_targets_due_idx on public.monitor_targets (enabled, next_run_at);
alter table public.monitor_targets enable row level security;
drop policy if exists "read own targets" on public.monitor_targets;
create policy "read own targets" on public.monitor_targets for select using (auth.uid() = user_id);
-- writes go through the Edge Function (service role): the URL policy and ownership check live there

create table if not exists public.monitor_probes (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(user_id) on delete cascade,
  project_key  text not null,
  at           timestamptz not null default now(),
  kind         text not null,               -- down | page
  ok           boolean not null,
  status       integer,
  ms           integer,
  detail       text,
  ip           text
);
create index if not exists monitor_probes_user_idx on public.monitor_probes (user_id, project_key, at desc);
alter table public.monitor_probes enable row level security;
drop policy if exists "read own probes" on public.monitor_probes;
create policy "read own probes" on public.monitor_probes for select using (auth.uid() = user_id);

create table if not exists public.monitor_incidents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(user_id) on delete cascade,
  project_key   text not null,
  kind          text not null,              -- down | ssl | page
  status        text not null,              -- open | resolved
  severity      text not null default 'critical',
  opened_at     timestamptz not null default now(),
  last_seen_at  timestamptz,
  resolved_at   timestamptz,
  count         integer not null default 1,
  detail        text,
  url           text,
  source        text not null default 'cloud'
);
create index if not exists monitor_incidents_user_idx on public.monitor_incidents (user_id, opened_at desc);
create unique index if not exists monitor_incidents_one_open on public.monitor_incidents (user_id, project_key, kind) where status = 'open';
alter table public.monitor_incidents enable row level security;
drop policy if exists "read own incidents" on public.monitor_incidents;
create policy "read own incidents" on public.monitor_incidents for select using (auth.uid() = user_id);

-- one row per scheduler pass; readable by every signed-in user (it carries no tenant data)
create table if not exists public.monitor_heartbeat (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  checked  integer not null default 0,
  due      integer not null default 0,
  targets  integer not null default 0
);
create index if not exists monitor_heartbeat_at_idx on public.monitor_heartbeat (at desc);
alter table public.monitor_heartbeat enable row level security;
drop policy if exists "read heartbeat" on public.monitor_heartbeat;
create policy "read heartbeat" on public.monitor_heartbeat for select to authenticated using (true);

-- ---------------------------------------------------------------- usage ledger hardening (V11 RC)
-- One logical AI operation bills once (the client sends an operation id; a retry gets the recorded outcome),
-- every charge records the price table it was computed with, and abandoned holds are released.
alter table public.ai_usage add column if not exists operation_id text;
alter table public.ai_usage add column if not exists pricing_version text;
create unique index if not exists ai_usage_operation_once on public.ai_usage (user_id, operation_id) where operation_id is not null;
alter table public.credit_ledger add column if not exists pricing_version text;

-- ---------------------------------------------------------------- retention and rate limits (WP03)
-- Retention runs inside the database in bounded batches (never "select everything, delete one by one"
-- from a worker, which PostgREST caps at 1000 rows). Periods by category and purpose:
--   monitor_probes          90 days   (evidence behind incidents; shown in the app for the last weeks)
--   monitor_incidents       90 days after resolution; open incidents are never removed
--   monitor_heartbeat       7 days    (only "is the scheduler alive" is read from it)
--   rate_events             2 days    (rate limits look back at most one hour)
--   ai_usage                13 months (the usage page shows the current period; a year back for disputes)
--   admin_audit             24 months
--   credit_ledger, subscriptions, billing_events, trial_claims: not pruned here — money and one-trial-per-
--   address records follow the owner's accounting and legal retention (docs/BILLING-AND-USAGE.md §retention).
create index if not exists monitor_probes_at_idx on public.monitor_probes (at);
create index if not exists monitor_incidents_resolved_idx on public.monitor_incidents (resolved_at) where status = 'resolved';
create index if not exists ai_usage_created_idx on public.ai_usage (created_at);
create index if not exists admin_audit_created_idx on public.admin_audit (created_at);

create table if not exists public.rate_events (
  user_id  uuid not null references auth.users(id) on delete cascade,
  action   text not null,
  at       timestamptz not null default now()
);
create index if not exists rate_events_lookup on public.rate_events (user_id, action, at);
create index if not exists rate_events_at_idx on public.rate_events (at);
alter table public.rate_events enable row level security; -- no policies: service role only

-- One atomic check-and-record per (user, action) across every Edge Function instance: the advisory lock
-- serialises concurrent calls for the same key inside one transaction, so N parallel requests cannot all
-- see "under the limit".
create or replace function public.bid_rate_hit(p_user uuid, p_action text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_action, 0));
  select count(*) into n from public.rate_events
    where user_id = p_user and action = p_action and at > now() - make_interval(secs => p_window_seconds);
  if n >= p_limit then return false; end if;
  insert into public.rate_events (user_id, action) values (p_user, p_action);
  return true;
end $$;
revoke all on function public.bid_rate_hit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.bid_rate_hit(uuid, text, integer, integer) to service_role;

-- Deletes at most p_batch rows per table per call; the scheduler calls it every run, so a backlog drains
-- over a few runs without a long lock. Returns what was removed.
create or replace function public.bid_prune(p_batch integer default 5000)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare probes integer; incidents integer; beats integer; rates integer; usage integer; audit integer;
begin
  delete from public.monitor_probes where ctid in (select ctid from public.monitor_probes where at < now() - interval '90 days' limit p_batch);
  get diagnostics probes = row_count;
  delete from public.monitor_incidents where ctid in (select ctid from public.monitor_incidents where status = 'resolved' and resolved_at < now() - interval '90 days' limit p_batch);
  get diagnostics incidents = row_count;
  delete from public.monitor_heartbeat where ctid in (select ctid from public.monitor_heartbeat where at < now() - interval '7 days' limit p_batch);
  get diagnostics beats = row_count;
  delete from public.rate_events where ctid in (select ctid from public.rate_events where at < now() - interval '2 days' limit p_batch);
  get diagnostics rates = row_count;
  delete from public.ai_usage where ctid in (select ctid from public.ai_usage where created_at < now() - interval '13 months' limit p_batch);
  get diagnostics usage = row_count;
  delete from public.admin_audit where ctid in (select ctid from public.admin_audit where created_at < now() - interval '24 months' limit p_batch);
  get diagnostics audit = row_count;
  return jsonb_build_object('monitor_probes', probes, 'monitor_incidents', incidents, 'monitor_heartbeat', beats, 'rate_events', rates, 'ai_usage', usage, 'admin_audit', audit);
end $$;
revoke all on function public.bid_prune(integer) from public, anon, authenticated;
grant execute on function public.bid_prune(integer) to service_role;

-- BEGIN GENERATED V12 CATALOG MIGRATION
-- Generated V12 catalog migration. Preserves existing Paddle IDs and unrelated settings.
-- Existing subscribers retain their provider prices. Reconcile sandbox IDs in Admin before enabling sales.
do $$
declare old_catalog jsonb; next_catalog jsonb := '{"version":"v12.2","currency":"EUR","taxInclusive":true,"mode":"sandbox","trial":{"days":7,"plan":"high","tokens":50000,"activeSites":1},"plans":{"flash":{"price":9.99,"paddlePriceId":null,"yearly":{"price":99.9,"paddlePriceId":null},"credits":100000,"activeSites":1,"activeSitesMax":1,"validityMonths":1,"window5h":20000,"weekly":40000,"extras":{"domain":false,"netlifyCredits":false,"boost":false}},"high":{"price":29.99,"paddlePriceId":null,"yearly":{"price":299.9,"paddlePriceId":null},"credits":300000,"activeSites":3,"activeSitesMax":3,"validityMonths":3,"window5h":60000,"weekly":120000,"extras":{"domain":false,"netlifyCredits":false,"boost":false}},"knight":{"price":99.99,"paddlePriceId":null,"yearly":{"price":999.9,"paddlePriceId":null},"credits":1000000,"activeSites":10,"activeSitesMax":25,"validityMonths":10,"window5h":200000,"weekly":400000,"extras":{"domain":true,"netlifyCredits":false,"boost":true}}},"packs":[{"id":"pack-100k","tokens":100000,"price":4.99,"validityMonths":12,"paddlePriceId":null},{"id":"pack-500k","tokens":500000,"price":19.99,"validityMonths":12,"paddlePriceId":null},{"id":"pack-1m","tokens":1000000,"price":39.99,"validityMonths":12,"paddlePriceId":null}]}'::jsonb; old_plans jsonb; tier text; pack jsonb; old_pack jsonb; packs jsonb := '[]'::jsonb;
begin
  select value into old_catalog from public.settings where key = 'billing.catalog';
  if old_catalog->>'version' = next_catalog->>'version' then return; end if;
  foreach tier in array array['flash','high','knight'] loop
    next_catalog := jsonb_set(next_catalog, array['plans',tier,'paddlePriceId'], coalesce(old_catalog #> array['plans',tier,'paddlePriceId'], 'null'::jsonb));
    next_catalog := jsonb_set(next_catalog, array['plans',tier,'yearly','paddlePriceId'], coalesce(old_catalog #> array['plans',tier,'yearly','paddlePriceId'], 'null'::jsonb));
    next_catalog := jsonb_set(next_catalog, array['plans',tier,'needsReconciliation'], to_jsonb(coalesce(old_catalog #>> array['plans',tier,'price'],'') <> next_catalog #>> array['plans',tier,'price']));
    next_catalog := jsonb_set(next_catalog, array['plans',tier,'yearly','needsReconciliation'], to_jsonb(coalesce(old_catalog #>> array['plans',tier,'yearly','price'],'') <> next_catalog #>> array['plans',tier,'yearly','price']));
  end loop;
  for pack in select * from jsonb_array_elements(next_catalog->'packs') loop
    select value into old_pack from jsonb_array_elements(coalesce(old_catalog->'packs','[]'::jsonb)) where value->>'id' = pack->>'id' limit 1;
    packs := packs || jsonb_build_array(pack || jsonb_build_object('paddlePriceId',coalesce(old_pack->'paddlePriceId','null'::jsonb),'needsReconciliation',coalesce(old_pack->>'price','') <> pack->>'price'));
  end loop;
  next_catalog := jsonb_set(next_catalog, '{packs}', packs);
  insert into public.settings(key,value) values ('billing.catalog',coalesce(old_catalog,'{}'::jsonb) || next_catalog) on conflict(key) do update set value=excluded.value;
  select value into old_plans from public.settings where key='plans';
  insert into public.settings(key,value) values ('plans',coalesce(old_plans,'{}'::jsonb) || '{"flash":{"tokens":100000,"max_active_sites":1,"fair_use_sites":1,"validity_months":1},"high":{"tokens":300000,"max_active_sites":3,"fair_use_sites":3,"validity_months":3},"knight":{"tokens":1000000,"max_active_sites":10,"fair_use_sites":25,"validity_months":10}}'::jsonb) on conflict(key) do update set value=excluded.value;
end $$;
-- END GENERATED V12 CATALOG MIGRATION

-- V12: reviewed subscription changes, server-only writes and serialized provider mutations.
create table if not exists public.billing_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_ref text not null,
  from_tier text not null check (from_tier in ('free','flash','high','knight')),
  to_tier text not null check (to_tier in ('flash','high','knight')),
  status text not null check (status in ('preview','applying','applied','failed','stale')),
  request jsonb not null, quote jsonb not null, fingerprint text not null,
  effective_at timestamptz not null, expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index if not exists billing_changes_applying on public.billing_changes(provider_ref) where status='applying';
alter table public.billing_changes enable row level security;
drop policy if exists billing_changes_own on public.billing_changes;
create policy billing_changes_own on public.billing_changes for select to authenticated using (auth.uid()=user_id);
