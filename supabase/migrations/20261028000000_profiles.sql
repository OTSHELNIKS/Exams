-- Player-editable data only. Ratings, verification, purchases and match results
-- must be controlled by trusted server-side code, never by the client.
create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  game_id text not null default '' check (char_length(game_id) <= 100),
  nick text not null default '' check (char_length(nick) <= 50),
  age text not null default '' check (age = '' or (age ~ '^[0-9]{1,3}$' and age::integer between 1 and 120)),
  gender text not null default '' check (gender in ('', 'М', 'Ж')),
  rank text not null default '' check (char_length(rank) <= 50),
  roles text[] not null default '{}',
  regions text[] not null default '{}',
  bio text not null default '' check (char_length(bio) <= 1000),
  heroes text[] not null default '{}',
  hero_classes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (cardinality(roles) <= 10 and cardinality(regions) <= 20
    and cardinality(heroes) <= 6 and cardinality(hero_classes) <= 6)
);

alter table public.player_profiles enable row level security;
create policy "Users can read their own profile" on public.player_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own profile" on public.player_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own profile" on public.player_profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
