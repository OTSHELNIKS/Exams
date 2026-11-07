-- Серверный драфт 5v5. Начисление рейтинга этой миграцией не включается.
-- Применять только после тестов на отдельном Supabase-стенде и обновления клиента.
-- Порядок блокировок во всех операциях: lobbies, затем lobby_drafts.

create table if not exists public.lobby_drafts (
  lobby_id uuid primary key references public.lobbies(id) on delete cascade,
  status text not null check (status in ('active', 'complete', 'cancelled')),
  team_a uuid[] not null,
  team_b uuid[] not null,
  pool uuid[] not null,
  captain_a uuid not null references auth.users(id),
  captain_b uuid not null references auth.users(id),
  turn text not null check (turn in ('a','b')),
  deadline timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.lobby_drafts enable row level security;
revoke all on public.lobby_drafts from public, anon, authenticated;

-- Возвращаем только данные участников, уже допущенных в это лобби.
-- Не полагаемся на RLS view: функция работает правами владельца.
create or replace function public.get_lobby_draft(p_lobby_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_lobby public.lobbies;
  v_draft public.lobby_drafts;
  v_team_a jsonb; v_team_b jsonb; v_pool jsonb;
begin
  if v_uid is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if not exists (select 1 from public.lobby_members m where m.lobby_id=p_lobby_id and m.user_id=v_uid) then
    return jsonb_build_object('error', 'not_member');
  end if;
  select * into v_lobby from public.lobbies where id=p_lobby_id;
  if not found or v_lobby.status='closed' then return jsonb_build_object('error', 'closed'); end if;
  select * into v_draft from public.lobby_drafts where lobby_id=p_lobby_id;
  if not found then return jsonb_build_object('error', 'not_started'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'nick', coalesce(nullif(p.nick,''),'Игрок'),
    'pts', p.pts, 'rank', p.rank, 'roles', coalesce(p.roles,'{}'::text[]), 'avatar_url', p.avatar_url,
    'isCaptain', x.user_id=v_draft.captain_a) order by x.ord), '[]'::jsonb)
  into v_team_a from unnest(v_draft.team_a) with ordinality x(user_id,ord)
  join public.lobby_members m on m.lobby_id=p_lobby_id and m.user_id=x.user_id
  left join public.player_profiles p on p.user_id=x.user_id;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'nick', coalesce(nullif(p.nick,''),'Игрок'),
    'pts', p.pts, 'rank', p.rank, 'roles', coalesce(p.roles,'{}'::text[]), 'avatar_url', p.avatar_url,
    'isCaptain', x.user_id=v_draft.captain_b) order by x.ord), '[]'::jsonb)
  into v_team_b from unnest(v_draft.team_b) with ordinality x(user_id,ord)
  join public.lobby_members m on m.lobby_id=p_lobby_id and m.user_id=x.user_id
  left join public.player_profiles p on p.user_id=x.user_id;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'nick', coalesce(nullif(p.nick,''),'Игрок'),
    'pts', p.pts, 'rank', p.rank, 'roles', coalesce(p.roles,'{}'::text[]), 'avatar_url', p.avatar_url) order by x.ord), '[]'::jsonb)
  into v_pool from unnest(v_draft.pool) with ordinality x(user_id,ord)
  join public.lobby_members m on m.lobby_id=p_lobby_id and m.user_id=x.user_id
  left join public.player_profiles p on p.user_id=x.user_id;

  return jsonb_build_object('lobby_id', p_lobby_id, 'status', v_draft.status,
    'turn', v_draft.turn, 'deadline', v_draft.deadline, 'server_time', clock_timestamp(), 'captain_a', v_draft.captain_a,
    'captain_b', v_draft.captain_b, 'team_a', v_team_a, 'team_b', v_team_b, 'pool', v_pool);
end;
$$;

-- Капитан А — хост; капитан B — участник с наибольшим MMR, при равенстве
-- раньше вошедший. В состав попадают только реальные участники данного лобби.
create or replace function public.start_lobby_draft(p_lobby_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid(); v_lobby public.lobbies; v_draft public.lobby_drafts;
  v_count integer; v_captain_b uuid; v_pool uuid[];
begin
  if v_uid is null then return jsonb_build_object('error','unauthorized'); end if;
  select * into v_lobby from public.lobbies where id=p_lobby_id for update;
  if not found or v_lobby.status='closed' then return jsonb_build_object('error','closed'); end if;
  if v_lobby.host_id <> v_uid then return jsonb_build_object('error','not_host'); end if;
  if not exists (select 1 from public.lobby_members where lobby_id=p_lobby_id and user_id=v_uid) then
    return jsonb_build_object('error','not_member');
  end if;
  select * into v_draft from public.lobby_drafts where lobby_id=p_lobby_id for update;
  if found and v_draft.status in ('active','complete') then return public.get_lobby_draft(p_lobby_id); end if;
  if v_lobby.status <> 'open' then return jsonb_build_object('error','closed'); end if;
  select count(*) into v_count from public.lobby_members where lobby_id=p_lobby_id;
  if v_count <> 10 then return jsonb_build_object('error','need_ten', 'count',v_count); end if;

  select m.user_id into v_captain_b from public.lobby_members m
    left join public.player_profiles p on p.user_id=m.user_id
    where m.lobby_id=p_lobby_id and m.user_id<>v_uid
    order by coalesce(p.pts,1000) desc, m.joined_at, m.user_id limit 1;
  select array_agg(m.user_id order by m.joined_at,m.user_id) into v_pool from public.lobby_members m
    where m.lobby_id=p_lobby_id and m.user_id not in (v_uid,v_captain_b);
  if v_captain_b is null or cardinality(v_pool)<>8 then return jsonb_build_object('error','bad_roster'); end if;

  insert into public.lobby_drafts (lobby_id,status,team_a,team_b,pool,captain_a,captain_b,turn,deadline,updated_at)
  values (p_lobby_id,'active',array[v_uid],array[v_captain_b],v_pool,v_uid,v_captain_b,'a',clock_timestamp()+interval '30 seconds',now())
  on conflict (lobby_id) do update set status=excluded.status,team_a=excluded.team_a,team_b=excluded.team_b,
    pool=excluded.pool,captain_a=excluded.captain_a,captain_b=excluded.captain_b,turn=excluded.turn,
    deadline=excluded.deadline,updated_at=excluded.updated_at;
  update public.lobbies set status='started',updated_at=now() where id=p_lobby_id;
  return public.get_lobby_draft(p_lobby_id);
end;
$$;

-- Одно общее правило для выбора и авто-выбора. Доступ к нему имеет только
-- владелец функций, не клиент. Все проверки повторяются на сервере под блокировкой.
create or replace function public._draft_pick(p_lobby_id uuid, p_target uuid, p_auto boolean)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid(); v_lobby public.lobbies; v_draft public.lobby_drafts;
  v_captain uuid; v_player uuid;
begin
  if v_uid is null then return jsonb_build_object('error','unauthorized'); end if;
  select * into v_lobby from public.lobbies where id=p_lobby_id for update;
  if not found or v_lobby.status <> 'started' then return jsonb_build_object('error','closed'); end if;
  if not exists (select 1 from public.lobby_members where lobby_id=p_lobby_id and user_id=v_uid) then
    return jsonb_build_object('error','not_member');
  end if;
  select * into v_draft from public.lobby_drafts where lobby_id=p_lobby_id for update;
  if not found or v_draft.status <> 'active' then return jsonb_build_object('error','not_active'); end if;
  v_captain := case when v_draft.turn='a' then v_draft.captain_a else v_draft.captain_b end;
  if p_auto then
    if clock_timestamp() < v_draft.deadline then return jsonb_build_object('error','too_early'); end if;
    v_player := v_draft.pool[1];
  else
    if v_uid <> v_captain then return jsonb_build_object('error','not_turn'); end if;
    if clock_timestamp() >= v_draft.deadline then return jsonb_build_object('error','turn_expired'); end if;
    v_player := p_target;
  end if;
  if v_player is null or not (v_player=any(v_draft.pool)) then return jsonb_build_object('error','not_in_pool'); end if;
  if not exists (select 1 from public.lobby_members where lobby_id=p_lobby_id and user_id=v_player) then
    return jsonb_build_object('error','not_member');
  end if;
  if v_draft.turn='a' then
    if cardinality(v_draft.team_a)>=5 then return jsonb_build_object('error','team_full'); end if;
    v_draft.team_a := array_append(v_draft.team_a,v_player); v_draft.turn := 'b';
  else
    if cardinality(v_draft.team_b)>=5 then return jsonb_build_object('error','team_full'); end if;
    v_draft.team_b := array_append(v_draft.team_b,v_player); v_draft.turn := 'a';
  end if;
  v_draft.pool := array_remove(v_draft.pool,v_player);
  if cardinality(v_draft.pool)=0 then
    if cardinality(v_draft.team_a)<>5 or cardinality(v_draft.team_b)<>5 then
      raise exception 'invalid draft state';
    end if;
    v_draft.status := 'complete';
  end if;
  update public.lobby_drafts set team_a=v_draft.team_a,team_b=v_draft.team_b,pool=v_draft.pool,
    turn=v_draft.turn,status=v_draft.status,deadline=clock_timestamp()+interval '30 seconds',updated_at=now()
    where lobby_id=p_lobby_id;
  return public.get_lobby_draft(p_lobby_id);
end;
$$;
revoke all on function public._draft_pick(uuid,uuid,boolean) from public, anon, authenticated;

create or replace function public.pick_lobby_draft_player(p_lobby_id uuid, p_user_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public._draft_pick(p_lobby_id,p_user_id,false) $$;
create or replace function public.auto_pick_lobby_draft_player(p_lobby_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$ select public._draft_pick(p_lobby_id,null,true) $$;

-- Передача капитанства возможна только действующим капитаном и внутри его
-- зафиксированной команды. Для B это не меняет организатора лобби.
create or replace function public.transfer_draft_captain(p_lobby_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_lobby public.lobbies; v_draft public.lobby_drafts;
begin
  if v_uid is null then return jsonb_build_object('error','unauthorized'); end if;
  select * into v_lobby from public.lobbies where id=p_lobby_id for update;
  if not found or v_lobby.status <> 'started' then return jsonb_build_object('error','closed'); end if;
  if not exists (select 1 from public.lobby_members where lobby_id=p_lobby_id and user_id=v_uid) then
    return jsonb_build_object('error','not_member');
  end if;
  select * into v_draft from public.lobby_drafts where lobby_id=p_lobby_id for update;
  if not found or v_draft.status not in ('active','complete') then return jsonb_build_object('error','not_active'); end if;
  if p_user_id is null or p_user_id=v_uid or not exists (
    select 1 from public.lobby_members where lobby_id=p_lobby_id and user_id=p_user_id
  ) then return jsonb_build_object('error','bad_target'); end if;
  if v_uid=v_draft.captain_a then
    if not (p_user_id=any(v_draft.team_a)) then return jsonb_build_object('error','not_teammate'); end if;
    update public.lobby_drafts set captain_a=p_user_id,updated_at=now() where lobby_id=p_lobby_id;
  elsif v_uid=v_draft.captain_b then
    if not (p_user_id=any(v_draft.team_b)) then return jsonb_build_object('error','not_teammate'); end if;
    update public.lobby_drafts set captain_b=p_user_id,updated_at=now() where lobby_id=p_lobby_id;
  else return jsonb_build_object('error','not_captain'); end if;
  return public.get_lobby_draft(p_lobby_id);
end;
$$;

-- Любой выход отменяет текущий драфт: продолжать с неполным/устаревшим
-- составом нельзя. Хост может собрать 10 участников и начать заново.
create or replace function public.leave_lobby(p_lobby_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_lobby public.lobbies; v_had_draft boolean;
begin
  if v_uid is null then return jsonb_build_object('error','unauthorized'); end if;
  select * into v_lobby from public.lobbies where id=p_lobby_id for update;
  if not found or not exists (select 1 from public.lobby_members where lobby_id=p_lobby_id and user_id=v_uid) then
    return jsonb_build_object('error','not_member');
  end if;
  update public.lobby_drafts set status='cancelled',updated_at=now()
    where lobby_id=p_lobby_id and status in ('active','complete');
  v_had_draft := found;
  delete from public.lobby_members where lobby_id=p_lobby_id and user_id=v_uid;
  if v_lobby.host_id=v_uid then
    update public.lobbies set status='closed',updated_at=now() where id=p_lobby_id;
  elsif v_had_draft then
    update public.lobbies set status='open',updated_at=now() where id=p_lobby_id;
  end if;
  return jsonb_build_object('ok',true);
end;
$$;

-- Старая функция передавала хосту любого участника, без проверки команды.
-- Пока нет серверных составов, такая передача недопустима; используем только
-- transfer_draft_captain после формирования команд.
create or replace function public.transfer_lobby_host(p_lobby_id uuid, p_user_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog, public
as $$ select case when auth.uid() is null then jsonb_build_object('error','unauthorized')
                  else jsonb_build_object('error','use_draft_transfer') end $$;

revoke all on function public.get_lobby_draft(uuid), public.start_lobby_draft(uuid),
  public.pick_lobby_draft_player(uuid,uuid), public.auto_pick_lobby_draft_player(uuid),
  public.transfer_draft_captain(uuid,uuid), public.leave_lobby(uuid), public.transfer_lobby_host(uuid,uuid)
  from public, anon;
grant execute on function public.get_lobby_draft(uuid), public.start_lobby_draft(uuid),
  public.pick_lobby_draft_player(uuid,uuid), public.auto_pick_lobby_draft_player(uuid),
  public.transfer_draft_captain(uuid,uuid), public.leave_lobby(uuid), public.transfer_lobby_host(uuid,uuid)
  to authenticated;
notify pgrst, 'reload schema';
