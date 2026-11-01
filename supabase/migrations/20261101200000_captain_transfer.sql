-- Передача капитанства.
--
-- Капитан лобби = хост: он собирал состав, он и ведёт драфт. Если он уходит
-- играть другим составом или просто хочет уступить место, капитанство должно
-- перейти к участнику его команды — но не к постороннему.
--
-- На уровне базы это меняет host_id лобби: только текущий хост и только на
-- реального участника этого же лобби. Дальше приложение подхватывает нового
-- хоста и делает его капитаном в драфте.

create or replace function public.transfer_lobby_host(p_lobby_id uuid, p_user_id uuid)
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

  select * into v_lobby from public.lobbies where id = p_lobby_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_lobby.host_id <> v_uid then
    return jsonb_build_object('error', 'not_host');
  end if;
  if p_user_id is null or p_user_id = v_uid then
    return jsonb_build_object('error', 'bad_target');
  end if;
  if not exists (
    select 1 from public.lobby_members m where m.lobby_id = p_lobby_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('error', 'not_member');
  end if;

  update public.lobbies
     set host_id = p_user_id, updated_at = now()
   where id = p_lobby_id;

  return jsonb_build_object('ok', true, 'host_id', p_user_id);
end;
$$;

revoke all on function public.transfer_lobby_host(uuid, uuid) from public;
grant execute on function public.transfer_lobby_host(uuid, uuid) to authenticated;

comment on function public.transfer_lobby_host(uuid, uuid) is
  'Передать лобби (и капитанство) участнику этого же лобби. Только текущий хост.';
