-- Public leaderboard: safe columns only (no game_id, contacts or ban data).
-- Backs the app leaderboard and the draft pool; banned and nick-less
-- profiles are excluded.

create or replace view public.leaderboard as
select user_id, nick, pts, rank, roles, avatar_url, updated_at
from public.player_profiles
where coalesce(nick, '') <> '' and coalesce(is_banned, false) = false;

grant select on public.leaderboard to authenticated;

comment on view public.leaderboard is
  'Public player rating for the app leaderboard and draft pool. Safe columns only.';
