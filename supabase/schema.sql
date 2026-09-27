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

create or replace function public.profiles_protect_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service role (Edge Functions) may change anything; a user session may not touch these
  if coalesce(auth.role(), '') <> 'service_role' then
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

-- ---------------------------------------------------------------- AI credits (tokens)

create table if not exists public.credit_ledger (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  delta      bigint not null,                -- + grant, − usage
  bucket     text not null default 'plan',   -- 'plan' (monthly, expires) | 'topup' (packs, 12 months)
  reason     text not null,                  -- plan_grant | topup | ai_fix | admin_grant | refund | expiry
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

-- ---------------------------------------------------------------- owner
-- Make yourself admin once (replace the email):
--   update public.profiles set role = 'admin' where email = 'you@example.com';
