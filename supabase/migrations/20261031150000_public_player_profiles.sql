-- Публичная карточка игрока: чужие профили можно смотреть, не открывая
-- приватные данные. Вьюха выполняется правами владельца (как public.leaderboard),
-- поэтому RLS на player_profiles остаётся «только владелец», а наружу уходят
-- исключительно безопасные колонки:
--   • нет game_id / game_server — по ним можно добавить в друзья и угнать вход;
--   • нет скриншотов, возраста, пола и причины бана;
--   • из соцсетей уходит только факт привязки Google, без адреса почты.
create or replace view public.player_profiles_public as
select
  p.user_id,
  p.nick,
  coalesce(p.pts, 0) as pts,
  p.rank,
  coalesce(p.roles, '{}'::text[]) as roles,
  coalesce(p.regions, '{}'::text[]) as regions,
  coalesce(p.heroes, '{}'::text[]) as heroes,
  coalesce(p.hero_classes, '{}'::text[]) as hero_classes,
  p.bio,
  p.avatar_url,
  p.updated_at,
  coalesce((
    select jsonb_agg(
      case when split_part(s, ':', 1) = 'google' then 'google' else s end
      order by s
    )
    from unnest(coalesce(p.socials, '{}'::text[])) as s
    where btrim(s) <> ''
  ), '[]'::jsonb) as socials
from public.player_profiles p
where coalesce(p.nick, '') <> ''
  and coalesce(p.is_banned, false) = false;

revoke all on public.player_profiles_public from anon, authenticated;
grant select on public.player_profiles_public to authenticated;

comment on view public.player_profiles_public is
  'Public player card for viewing other players: no game_id, screenshots, email, age or ban data.';
