-- Persistent social bindings + extra slots on the profile.
alter table public.player_profiles
  add column if not exists socials text[] not null default '{}'
  check (cardinality(socials) <= 3 and socials <@ array['telegram', 'vk', 'google']);
alter table public.player_profiles
  add column if not exists extra_slots integer not null default 0
  check (extra_slots between 0 and 3);

-- Admins registry: NO write policies for clients, so only service_role
-- (SQL editor / dashboard) can add or remove admins. Users can only
-- check their own admin status.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "Users can check their own admin status" on public.admins;
create policy "Users can check their own admin status" on public.admins
  for select to authenticated using ((select auth.uid()) = user_id);

-- Admins can read ALL player profiles (admin panel). Regular users
-- still see only their own row via the existing policy.
drop policy if exists "Admins can read all profiles" on public.player_profiles;
create policy "Admins can read all profiles" on public.player_profiles
  for select to authenticated
  using (exists (select 1 from public.admins a where a.user_id = (select auth.uid())));

notify pgrst, 'reload schema';

-- Make a user admin (run as service_role, e.g. in SQL Editor):
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'YOU@example.com'
--   on conflict do nothing;
