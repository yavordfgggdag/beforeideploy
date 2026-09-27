-- Before I Deploy — Supabase schema (run once in Supabase → SQL Editor)
-- Only project METADATA is stored. Service tokens (Netlify, Vercel, GitHub…) never leave the user's Mac.

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

-- Every user sees and edits only their own rows.
drop policy if exists "own rows" on public.bid_projects;
create policy "own rows" on public.bid_projects
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
