-- Матчи и рейтинг: без этого «цвета MMR», «титулы ТОП-10» и «100 матчей»
-- нечем считать — до сих пор pts у всех был 1000, а матчи нигде не сохранялись.
--
-- Правила честности:
--   1. Матч фиксирует один капитан, подтверждает капитан соперников (или админ).
--   2. Рейтинг меняет только функция в базе, клиент писать pts не может.
--   3. Пока матч не подтверждён — рейтинг не двигается вовсе.
--   4. MMR никогда не падает ниже 100: проигрыши не «обнуляют» новичка.
--
-- Формула — классический Elo. Для 5v5 сравниваются средние рейтинги составов,
-- поэтому один и тот же дельта применяется ко всей команде.

alter table public.player_profiles
  add column if not exists matches_played integer not null default 0;
alter table public.player_profiles
  add column if not exists wins integer not null default 0;

-- Счётчики матчей — тоже только серверные.
revoke update (matches_played, wins) on public.player_profiles from authenticated, anon;
revoke insert (matches_played, wins) on public.player_profiles from authenticated, anon;

comment on column public.player_profiles.matches_played is
  'Сколько подтверждённых матчей на платформе сыграно (пишет только confirm_match)';
comment on column public.player_profiles.wins is
  'Сколько из них выиграно';

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid references public.lobbies (id) on delete set null,
  mode text not null default '5v5' check (mode in ('1v1', '5v5')),
  region text not null default '',
  team_a uuid[] not null,
  team_b uuid[] not null,
  winner text not null check (winner in ('a', 'b')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'disputed', 'cancelled')),
  reported_by uuid not null references auth.users (id) on delete cascade,
  confirmed_by uuid references auth.users (id) on delete set null,
  dispute_reason text not null default '' check (char_length(dispute_reason) <= 300),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  -- Составы: 1..5 игроков в каждой команде, пересечений быть не может.
  check (cardinality(team_a) between 1 and 5),
  check (cardinality(team_b) between 1 and 5),
  check (not (team_a && team_b))
);

create index if not exists matches_created_idx on public.matches (created_at desc);
create index if not exists matches_status_idx on public.matches (status);

create table if not exists public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  team text not null check (team in ('a', 'b')),
  mmr_before integer,
  mmr_delta integer,
  mmr_after integer,
  primary key (match_id, user_id)
);

alter table public.matches enable row level security;
alter table public.match_players enable row level security;

-- Матчи читают все вошедшие: история результатов открыта, но менять её нельзя
-- напрямую — только функциями ниже.
drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches
  for select to authenticated using (true);

drop policy if exists match_players_read on public.match_players;
create policy match_players_read on public.match_players
  for select to authenticated using (true);

-- ------------------------------------------------------------------ формулы

-- Ожидаемый счёт по Elo (0..1). Используется и для 1v1, и для средних 5v5.
create or replace function public.mmr_expected(p_rating numeric, p_opponent numeric)
returns numeric
language sql
immutable
as $$
  select 1.0 / (1.0 + power(10, (p_opponent - p_rating) / 400.0))
$$;

-- Сколько очков получит игрок. K зависит от формата: одиночная игра — 32,
-- командная — 24 (делим влияние на пятерых).
create or replace function public.mmr_delta(p_rating numeric, p_opponent numeric, p_win boolean, p_k integer)
returns integer
language sql
immutable
as $$
  with calc as (
    select round(p_k * ((case when p_win then 1.0 else 0.0 end) - public.mmr_expected(p_rating, p_opponent)))::int as d
  )
  -- Нулевой дельта превращал бы победу в «ничего не произошло», поэтому
  -- минимальный шаг всегда ±1.
  select case when d = 0 then (case when p_win then 1 else -1 end) else d end from calc
$$;

-- -------------------------------------------------------------- фиксация матча

-- Капитан отправляет результат. Ничего не начисляется, пока соперник не
-- подтвердит: так нельзя «нарисовать» себе победу.
create or replace function public.report_match(
  p_team_a uuid[],
  p_team_b uuid[],
  p_winner text,
  p_lobby_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_a uuid[] := coalesce(p_team_a, '{}');
  v_b uuid[] := coalesce(p_team_b, '{}');
  v_match public.matches;
  v_mode text;
  v_region text := '';
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  if p_winner is null or p_winner not in ('a', 'b') then
    return jsonb_build_object('error', 'bad_winner');
  end if;
  if array_length(v_a, 1) is null or array_length(v_b, 1) is null then
    return jsonb_build_object('error', 'empty_team');
  end if;
  if array_length(v_a, 1) > 5 or array_length(v_b, 1) > 5 then
    return jsonb_build_object('error', 'too_many');
  end if;
  if v_a && v_b then
    return jsonb_build_object('error', 'same_players');
  end if;
  if not (v_uid = any(v_a) or v_uid = any(v_b)) then
    return jsonb_build_object('error', 'not_in_match');
  end if;

  v_mode := case when array_length(v_a, 1) = 1 and array_length(v_b, 1) = 1 then '1v1' else '5v5' end;

  if p_lobby_id is not null then
    select region into v_region from public.lobbies where id = p_lobby_id;
    v_region := coalesce(v_region, '');
  end if;

  insert into public.matches (lobby_id, mode, region, team_a, team_b, winner, reported_by)
  values (p_lobby_id, v_mode, v_region, v_a, v_b, p_winner, v_uid)
  returning * into v_match;

  return jsonb_build_object('match_id', v_match.id, 'mode', v_match.mode, 'status', v_match.status);
end;
$$;

-- Подтверждение соперником (или админом). Здесь и только здесь меняется MMR.
create or replace function public.confirm_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_opponent uuid[];
  v_avg_a numeric;
  v_avg_b numeric;
  v_k integer;
  v_a_wins boolean;
  v_delta_a integer;
  v_delta_b integer;
  v_row record;
  v_changes jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_match.status = 'confirmed' then
    return jsonb_build_object('error', 'already_confirmed');
  end if;
  if v_match.status <> 'pending' then
    return jsonb_build_object('error', 'closed');
  end if;

  -- Подтверждает сторона, которая результат не отправляла (или админ).
  v_opponent := case
    when v_match.reported_by = any(v_match.team_a) then v_match.team_b
    when v_match.reported_by = any(v_match.team_b) then v_match.team_a
    else v_match.team_a || v_match.team_b
  end;
  if not (v_uid = any(v_opponent) or public.is_admin()) then
    return jsonb_build_object('error', 'not_opponent');
  end if;

  select coalesce(avg(p.pts), 1000) into v_avg_a
    from public.player_profiles p where p.user_id = any(v_match.team_a);
  select coalesce(avg(p.pts), 1000) into v_avg_b
    from public.player_profiles p where p.user_id = any(v_match.team_b);

  v_k := case when v_match.mode = '1v1' then 32 else 24 end;
  v_a_wins := v_match.winner = 'a';

  v_delta_a := public.mmr_delta(v_avg_a, v_avg_b, v_a_wins, v_k);
  v_delta_b := public.mmr_delta(v_avg_b, v_avg_a, not v_a_wins, v_k);

  for v_row in
    select p.user_id, p.pts, (v_match.winner = m.team) as win, m.team
    from public.player_profiles p
    join (
      select unnest(v_match.team_a) as user_id, 'a' as team
      union all
      select unnest(v_match.team_b) as user_id, 'b' as team
    ) m on m.user_id = p.user_id
  loop
    declare
      v_before integer := coalesce(v_row.pts, 1000);
      v_step integer := case when v_row.team = 'a' then v_delta_a else v_delta_b end;
      v_after integer := greatest(100, v_before + v_step);
    begin
      -- MMR ограничен снизу, поэтому фактический шаг считаем после ограничения.
      v_step := v_after - v_before;

      update public.player_profiles
         set pts = v_after,
             matches_played = matches_played + 1,
             wins = wins + (case when v_row.win then 1 else 0 end),
             updated_at = now()
       where user_id = v_row.user_id;

      insert into public.match_players (match_id, user_id, team, mmr_before, mmr_delta, mmr_after)
      values (p_match_id, v_row.user_id, v_row.team, v_before, v_step, v_after)
      on conflict (match_id, user_id) do update
        set mmr_before = excluded.mmr_before,
            mmr_delta = excluded.mmr_delta,
            mmr_after = excluded.mmr_after;

      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'user_id', v_row.user_id,
        'before', v_before,
        'delta', v_step,
        'after', v_after,
        'win', v_row.win
      ));
    end;
  end loop;

  update public.matches
     set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now()
   where id = p_match_id;

  return jsonb_build_object('ok', true, 'changes', v_changes);
end;
$$;

-- Спорный результат: рейтинг не двигается, разбирает админ.
create or replace function public.dispute_match(p_match_id uuid, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_match.status <> 'pending' then
    return jsonb_build_object('error', 'closed');
  end if;
  if not (v_uid = any(v_match.team_a) or v_uid = any(v_match.team_b)) then
    return jsonb_build_object('error', 'not_in_match');
  end if;

  update public.matches
     set status = 'disputed', dispute_reason = left(coalesce(p_reason, ''), 300)
   where id = p_match_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Админский разбор: переписать победителя и подтвердить.
create or replace function public.resolve_match(p_match_id uuid, p_winner text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if p_winner not in ('a', 'b') then
    return jsonb_build_object('error', 'bad_winner');
  end if;

  update public.matches
     set status = 'pending', winner = p_winner
   where id = p_match_id and status in ('disputed', 'pending');
  if not found then
    return jsonb_build_object('error', 'closed');
  end if;

  return public.confirm_match(p_match_id);
end;
$$;

revoke all on function public.report_match(uuid[], uuid[], text, uuid) from public;
revoke all on function public.confirm_match(uuid) from public;
revoke all on function public.dispute_match(uuid, text) from public;
revoke all on function public.resolve_match(uuid, text) from public;
grant execute on function public.report_match(uuid[], uuid[], text, uuid) to authenticated;
grant execute on function public.confirm_match(uuid) to authenticated;
grant execute on function public.dispute_match(uuid, text) to authenticated;
grant execute on function public.resolve_match(uuid, text) to authenticated;

-- ------------------------------------------------------------------- вьюхи

-- Титул и место в рейтинге: считаются из pts, а не выдаются вручную, поэтому
-- «ТОП-3» физически не может быть у кого-то ещё.
create or replace view public.leaderboard_ranks as
select
  l.user_id,
  l.nick,
  l.pts,
  l.rank,
  l.roles,
  l.avatar_url,
  l.updated_at,
  row_number() over (order by l.pts desc, l.updated_at asc)::int as position,
  count(*) over ()::int as total,
  case
    when row_number() over (order by l.pts desc, l.updated_at asc) = 1 then 'ТОП-1'
    when row_number() over (order by l.pts desc, l.updated_at asc) <= 3 then 'ТОП-3'
    when row_number() over (order by l.pts desc, l.updated_at asc) <= 10 then 'ТОП-10'
    else ''
  end as title
from public.leaderboard l;

revoke all on public.leaderboard_ranks from anon, authenticated;
grant select on public.leaderboard_ranks to authenticated;

-- История матчей с никами и изменением рейтинга — без приватных данных.
create or replace view public.match_history as
select
  m.id,
  m.mode,
  m.region,
  m.winner,
  m.status,
  m.created_at,
  m.confirmed_at,
  m.reported_by,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', p.user_id,
      'nick', coalesce(nullif(p.nick, ''), 'Игрок'),
      'delta', mp.mmr_delta,
      'after', mp.mmr_after
    ) order by p.nick)
    from public.match_players mp
    join public.player_profiles p on p.user_id = mp.user_id
    where mp.match_id = m.id and mp.team = 'a'
  ), '[]'::jsonb) as team_a,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', p.user_id,
      'nick', coalesce(nullif(p.nick, ''), 'Игрок'),
      'delta', mp.mmr_delta,
      'after', mp.mmr_after
    ) order by p.nick)
    from public.match_players mp
    join public.player_profiles p on p.user_id = mp.user_id
    where mp.match_id = m.id and mp.team = 'b'
  ), '[]'::jsonb) as team_b
from public.matches m;

revoke all on public.match_history from anon, authenticated;
grant select on public.match_history to authenticated;

comment on table public.matches is
  'Матчи платформы: результат фиксирует капитан, подтверждает соперник, MMR меняет только confirm_match.';
comment on view public.leaderboard_ranks is
  'Место и титул (ТОП-1/ТОП-3/ТОП-10) считаются из pts, вручную не выдаются.';
