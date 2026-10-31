-- Статистика игрока из самой игры: КДА и винрейт.
--
-- Появляется только после подтверждения владения аккаунтом кодом из
-- внутриигровой почты: тогда edge-функция `game-login` получает игровой JWT
-- (наружу он не отдаётся) и забирает общие цифры игрока:
--   game_winrate — процент побед (wc / tc из /api/user/stats);
--   game_kda     — среднее (убийства + помощь) / смерть по последним матчам;
--   game_matches — сколько всего матчей сыграно;
--   game_stats_at — когда цифры обновлялись.
--
-- Без подтверждения колонки остаются пустыми, и карточка честно показывает «—»,
-- а не придуманные числа.
alter table public.player_profiles
  add column if not exists game_kda numeric(6, 2);

alter table public.player_profiles
  add column if not exists game_winrate integer;

alter table public.player_profiles
  add column if not exists game_matches integer;

alter table public.player_profiles
  add column if not exists game_stats_at timestamptz;

comment on column public.player_profiles.game_kda is
  'Средний KDA по последним матчам; пишет только edge-функция game-login после кода из игры';
comment on column public.player_profiles.game_winrate is
  'Общий процент побед из /api/user/stats (0–100)';
comment on column public.player_profiles.game_matches is
  'Сколько матчей сыграно по данным игры';
comment on column public.player_profiles.game_stats_at is
  'Когда статистику забирали из игры';

-- Статистика — публичная (это витрина игрока), но номер аккаунта остаётся скрыт.
-- Новые колонки добавляем в конец: CREATE OR REPLACE VIEW так разрешает.
create or replace view public.player_profiles_public as
 SELECT user_id,
    nick,
    COALESCE(pts, 0) AS pts,
    rank,
    COALESCE(roles, '{}'::text[]) AS roles,
    COALESCE(regions, '{}'::text[]) AS regions,
    COALESCE(heroes, '{}'::text[]) AS heroes,
    COALESCE(hero_classes, '{}'::text[]) AS hero_classes,
    bio,
    avatar_url,
    updated_at,
    COALESCE(( SELECT jsonb_agg(
                CASE
                    WHEN split_part(s.s, ':'::text, 1) = 'google'::text THEN 'google'::text
                    ELSE s.s
                END ORDER BY s.s) AS jsonb_agg
           FROM unnest(COALESCE(p.socials, '{}'::text[])) s(s)
          WHERE btrim(s.s) <> ''::text), '[]'::jsonb) AS socials,
    p.game_kda,
    p.game_winrate,
    p.game_matches,
    p.game_stats_at,
    (p.game_verified_at IS NOT NULL) AS game_verified
   FROM player_profiles p
  WHERE COALESCE(nick, ''::text) <> ''::text AND COALESCE(is_banned, false) = false;

grant select on public.player_profiles_public to authenticated;
revoke all on public.player_profiles_public from anon;
