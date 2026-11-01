-- Лобби по региону: игроки собираются в одно лобби, видят код приглашения,
-- проверяют, что все в одном сервере MLBB, и хост переносит Room ID из игры.
--
-- Почему так, а не «кинуть на выбранный сервер»: MLBB не даёт снаружи управлять
-- матчмейкингом — регион привязан к аккаунту, а поиск игры нельзя запрограммировать.
-- Зато Custom Room в игре создаёт сам игрок (Create Room → Room ID + пароль), и
-- туда попадают только те, кому он этот ID передал. Поэтому приложение собирает
-- состав, следит за серверами и раздаёт Room ID — а не подменяет матчмейкинг.

create table if not exists public.lobbies (
  id uuid primary key default gen_random_uuid(),
  -- Код приглашения: 6 цифр, который игроки диктуют друг другу голосом.
  code text not null unique check (code ~ '^[0-9]{6}$'),
  -- Регион, в котором собираемся играть (ключи совпадают с REGIONS в lobby.js).
  region text not null check (region in ('ru', 'eu', 'sea', 'na', 'sa', 'me', 'jp')),
  host_id uuid not null references auth.users (id) on delete cascade,
  -- Room ID и пароль из MLBB: Create Room → номер комнаты и пароль.
  room_id text not null default '' check (char_length(room_id) <= 12),
  room_password text not null default '' check (char_length(room_password) <= 12),
  status text not null default 'open' check (status in ('open', 'started', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lobbies_host_idx on public.lobbies (host_id);
create index if not exists lobbies_created_idx on public.lobbies (created_at desc);

create table if not exists public.lobby_members (
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- «Я в игре»: игрок сам отмечает, что уже внутри комнаты MLBB.
  checked_in boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (lobby_id, user_id)
);

create index if not exists lobby_members_user_idx on public.lobby_members (user_id);

alter table public.lobbies enable row level security;
alter table public.lobby_members enable row level security;

-- Читать лобби может любой вошедший игрок: по коду приглашения он находит
-- комнату и Room ID. Создание идёт только через функцию create_lobby().
drop policy if exists lobbies_read on public.lobbies;
create policy lobbies_read on public.lobbies
  for select to authenticated using (true);

drop policy if exists lobbies_host_update on public.lobbies;
create policy lobbies_host_update on public.lobbies
  for update to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

drop policy if exists lobbies_host_delete on public.lobbies;
create policy lobbies_host_delete on public.lobbies
  for delete to authenticated using (host_id = auth.uid());

drop policy if exists lobby_members_read on public.lobby_members;
create policy lobby_members_read on public.lobby_members
  for select to authenticated using (true);

drop policy if exists lobby_members_join on public.lobby_members;
create policy lobby_members_join on public.lobby_members
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists lobby_members_self_update on public.lobby_members;
create policy lobby_members_self_update on public.lobby_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists lobby_members_self_leave on public.lobby_members;
create policy lobby_members_self_leave on public.lobby_members
  for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------------ функции

-- Создать лобби: код выдаём здесь, чтобы он был уникальным и его нельзя было
-- «забронировать» вручную. Один хост — одна открытая комната: старые закрываем.
create or replace function public.create_lobby(p_region text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_id uuid;
  v_try int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  if p_region is null or p_region not in ('ru', 'eu', 'sea', 'na', 'sa', 'me', 'jp') then
    return jsonb_build_object('error', 'bad_region');
  end if;

  update public.lobbies
     set status = 'closed', updated_at = now()
   where host_id = v_uid and status <> 'closed';

  loop
    v_try := v_try + 1;
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.lobbies (code, region, host_id)
      values (v_code, p_region, v_uid)
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_try >= 25 then
        return jsonb_build_object('error', 'code_busy');
      end if;
    end;
  end loop;

  insert into public.lobby_members (lobby_id, user_id, checked_in)
  values (v_id, v_uid, false)
  on conflict do nothing;

  return jsonb_build_object('lobby_id', v_id, 'code', v_code, 'region', p_region);
end;
$$;

-- Войти по коду приглашения. Если игрок уже в этом лобби — просто возвращаем его.
create or replace function public.join_lobby(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lobby public.lobbies;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('error', 'bad_code');
  end if;

  select * into v_lobby from public.lobbies where code = p_code;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_lobby.status = 'closed' then
    return jsonb_build_object('error', 'closed');
  end if;

  insert into public.lobby_members (lobby_id, user_id)
  values (v_lobby.id, v_uid)
  on conflict (lobby_id, user_id) do nothing;

  return jsonb_build_object(
    'lobby_id', v_lobby.id,
    'code', v_lobby.code,
    'region', v_lobby.region,
    'status', v_lobby.status
  );
end;
$$;

-- Выйти из лобби. Хост, уходя, закрывает комнату: без него она бессмысленна.
create or replace function public.leave_lobby(p_lobby_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_host uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  select host_id into v_host from public.lobbies where id = p_lobby_id;
  delete from public.lobby_members where lobby_id = p_lobby_id and user_id = v_uid;

  if v_host = v_uid then
    update public.lobbies set status = 'closed', updated_at = now() where id = p_lobby_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.create_lobby(text) from public;
revoke all on function public.join_lobby(text) from public;
revoke all on function public.leave_lobby(uuid) from public;
grant execute on function public.create_lobby(text) to authenticated;
grant execute on function public.join_lobby(text) to authenticated;
grant execute on function public.leave_lobby(uuid) to authenticated;

-- --------------------------------------------------------------- публичная вьюха

-- Состав лобби: ник и аватар видны всем участникам, а вот номера серверов —
-- нет. Вместо них отдаём один флаг same_server: сравниваем сервер игрока с
-- сервером хоста. Точные значения game_server по-прежнему не уходят наружу
-- (по ним добавляют в друзья и уводят аккаунт) — см. player_profiles_public.
create or replace view public.lobby_members_public as
select
  m.lobby_id,
  m.user_id,
  m.checked_in,
  m.joined_at,
  p.nick,
  p.avatar_url,
  p.rank,
  coalesce(p.roles, '{}'::text[]) as roles,
  case
    when coalesce(hp.game_server, '') = '' or coalesce(p.game_server, '') = '' then null
    else hp.game_server = p.game_server
  end as same_server,
  (l.host_id = m.user_id) as is_host
from public.lobby_members m
join public.lobbies l on l.id = m.lobby_id
left join public.player_profiles p on p.user_id = m.user_id
left join public.player_profiles hp on hp.user_id = l.host_id;

revoke all on public.lobby_members_public from anon, authenticated;
grant select on public.lobby_members_public to authenticated;

comment on table public.lobbies is
  'Лобби по региону: код приглашения, Room ID из MLBB. Матчмейкинг игры не подменяем — собираем состав и раздаём комнату.';
comment on view public.lobby_members_public is
  'Состав лобби без номеров серверов: только флаг same_server относительно хоста.';
