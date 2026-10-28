-- Moderation v1: profile bans + screenshot review queue.
-- Bot (service_role) reads/writes everything; clients get narrow rights.

-- 1) Ban fields on player_profiles (server-side only, like pts).
alter table public.player_profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists banned_at timestamptz;
revoke insert (is_banned, ban_reason, banned_at) on public.player_profiles from anon, authenticated;
revoke update (is_banned, ban_reason, banned_at) on public.player_profiles from anon, authenticated;

-- 2) Screenshot review queue.
create table if not exists public.screenshot_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);
create index if not exists screenshot_reviews_pending_idx
  on public.screenshot_reviews (status, created_at);
alter table public.screenshot_reviews enable row level security;
drop policy if exists "Users can read own reviews" on public.screenshot_reviews;
create policy "Users can read own reviews"
  on public.screenshot_reviews for select
  using (auth.uid() = user_id);
drop policy if exists "Users can submit own screenshots" on public.screenshot_reviews;
create policy "Users can submit own screenshots"
  on public.screenshot_reviews for insert
  with check (auth.uid() = user_id and status = 'pending');
drop policy if exists "Users can withdraw own pending reviews" on public.screenshot_reviews;
create policy "Users can withdraw own pending reviews"
  on public.screenshot_reviews for delete
  using (auth.uid() = user_id and status = 'pending');

notify pgrst, 'reload schema';
