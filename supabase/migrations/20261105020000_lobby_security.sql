-- Доступ к игровым реквизитам и составу только после входа по коду.
-- Тестировать на staging, в том числе обновления Realtime и выход/возврат.

-- SECURITY DEFINER нужен, чтобы политика на lobby_members не обращалась к
-- самой себе через RLS. Функция проверяет только текущего пользователя.
create or replace function public.is_lobby_member(p_lobby_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.lobby_members m
    where m.lobby_id = p_lobby_id and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_lobby_member(uuid) from public, anon;
grant execute on function public.is_lobby_member(uuid) to authenticated;

-- Удаляем обходные прямые записи и ограничиваем доступные клиенту поля.
revoke all privileges on public.lobbies, public.lobby_members from public, anon, authenticated;
grant select on public.lobbies, public.lobby_members to authenticated;
grant update (room_id, room_password, updated_at) on public.lobbies to authenticated;
grant update (checked_in) on public.lobby_members to authenticated;

drop policy if exists lobbies_read on public.lobbies;
create policy lobbies_read on public.lobbies
  for select to authenticated using (public.is_lobby_member(id));

drop policy if exists lobbies_host_update on public.lobbies;
create policy lobbies_host_update on public.lobbies
  for update to authenticated
  using (host_id = auth.uid() and public.is_lobby_member(id) and status <> 'closed')
  with check (host_id = auth.uid() and public.is_lobby_member(id) and status <> 'closed');

drop policy if exists lobbies_host_delete on public.lobbies;
drop policy if exists lobby_members_join on public.lobby_members;
drop policy if exists lobby_members_self_leave on public.lobby_members;
drop policy if exists lobby_members_read on public.lobby_members;
create policy lobby_members_read on public.lobby_members
  for select to authenticated using (public.is_lobby_member(lobby_id));

drop policy if exists lobby_members_self_update on public.lobby_members;
create policy lobby_members_self_update on public.lobby_members
  for update to authenticated
  using (user_id = auth.uid() and public.is_lobby_member(lobby_id))
  with check (user_id = auth.uid() and public.is_lobby_member(lobby_id));

-- Обычные view работают с привилегиями владельца. Поэтому явное условие
-- обязательно, даже при наличии RLS на таблицах под представлением.
create or replace view public.lobby_members_public as
select
  m.lobby_id, m.user_id, m.checked_in, m.joined_at,
  p.nick, p.avatar_url, p.rank, coalesce(p.roles, '{}'::text[]) as roles,
  case
    when coalesce(hp.game_server, '') = '' or coalesce(p.game_server, '') = '' then null
    else hp.game_server = p.game_server
  end as same_server,
  (l.host_id = m.user_id) as is_host
from public.lobby_members m
join public.lobbies l on l.id = m.lobby_id
left join public.player_profiles p on p.user_id = m.user_id
left join public.player_profiles hp on hp.user_id = l.host_id
where public.is_lobby_member(m.lobby_id);
revoke all on public.lobby_members_public from public, anon, authenticated;
grant select on public.lobby_members_public to authenticated;

-- Шесть цифр — короткий код. Ограничение по аккаунту уменьшает риск перебора,
-- но не заменяет защиту от массовых аккаунтов и сетевой rate limit.
create table if not exists public.lobby_join_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);
alter table public.lobby_join_attempts enable row level security;
revoke all on public.lobby_join_attempts from public, anon, authenticated;

create or replace function public.join_lobby(p_code text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_lobby public.lobbies;
  v_attempts integer;
  v_count integer;
begin
  if v_uid is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then return jsonb_build_object('error', 'bad_code'); end if;

  -- Повторный вход участника не расходует квоту и не удаляет существующую запись.
  select l.* into v_lobby from public.lobbies l
    where l.code = p_code and exists (
      select 1 from public.lobby_members m where m.lobby_id = l.id and m.user_id = v_uid
    );
  if found then
    if v_lobby.status = 'closed' then return jsonb_build_object('error', 'closed'); end if;
    return jsonb_build_object('lobby_id', v_lobby.id, 'code', v_lobby.code,
      'region', v_lobby.region, 'status', v_lobby.status);
  end if;

  insert into public.lobby_join_attempts as a (user_id, window_started_at, attempts)
    values (v_uid, now(), 1)
  on conflict (user_id) do update set
    window_started_at = case when a.window_started_at <= now() - interval '15 minutes' then now() else a.window_started_at end,
    attempts = case when a.window_started_at <= now() - interval '15 minutes' then 1 else a.attempts + 1 end
  returning attempts into v_attempts;
  if v_attempts > 12 then return jsonb_build_object('error', 'rate_limited'); end if;

  -- Блокировка строки сериализует проверки размера при одновременном входе.
  select * into v_lobby from public.lobbies where code = p_code for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if exists (select 1 from public.lobby_members where lobby_id = v_lobby.id and user_id = v_uid) then
    if v_lobby.status = 'closed' then return jsonb_build_object('error', 'closed'); end if;
    delete from public.lobby_join_attempts where user_id = v_uid;
    return jsonb_build_object('lobby_id', v_lobby.id, 'code', v_lobby.code,
      'region', v_lobby.region, 'status', v_lobby.status);
  end if;
  if v_lobby.status <> 'open' then return jsonb_build_object('error', 'closed'); end if;
  select count(*) into v_count from public.lobby_members where lobby_id = v_lobby.id;
  if v_count >= 10 then return jsonb_build_object('error', 'full'); end if;

  insert into public.lobby_members (lobby_id, user_id)
  values (v_lobby.id, v_uid) on conflict (lobby_id, user_id) do nothing;
  delete from public.lobby_join_attempts where user_id = v_uid;
  return jsonb_build_object('lobby_id', v_lobby.id, 'code', v_lobby.code,
    'region', v_lobby.region, 'status', v_lobby.status);
end;
$$;

revoke all on function public.create_lobby(text), public.join_lobby(text), public.leave_lobby(uuid) from public, anon;
grant execute on function public.create_lobby(text), public.join_lobby(text), public.leave_lobby(uuid) to authenticated;
notify pgrst, 'reload schema';
