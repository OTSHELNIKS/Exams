-- Telegram account linking for the NAME MLBB bot.
create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tg_chat_id bigint not null unique,
  tg_username text not null default '' check (char_length(tg_username) <= 100),
  created_at timestamptz not null default now()
);
alter table public.telegram_links enable row level security;
drop policy if exists "Users can read their own telegram link" on public.telegram_links;
create policy "Users can read their own telegram link" on public.telegram_links
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own telegram link" on public.telegram_links;
create policy "Users can delete their own telegram link" on public.telegram_links
  for delete to authenticated using ((select auth.uid()) = user_id);
-- No insert/update policies: only service_role (the bot) creates links.

-- One-time 6-digit codes shown in the app and sent to the bot.
create table if not exists public.telegram_link_codes (
  code text primary key check (code ~ '^[0-9]{6}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_link_codes enable row level security;
drop policy if exists "Users can manage their own link codes" on public.telegram_link_codes;
create policy "Users can manage their own link codes" on public.telegram_link_codes
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Server-owned rating points. Clients must never write this column:
-- revoke it from anon/authenticated (Postgres + PostgREST enforce it).
-- Our app upserts never include pts, so legitimate saves keep working.
alter table public.player_profiles
  add column if not exists pts integer not null default 1000 check (pts >= 0);
revoke update (pts) on public.player_profiles from authenticated, anon;
revoke insert (pts) on public.player_profiles from authenticated, anon;

notify pgrst, 'reload schema';
