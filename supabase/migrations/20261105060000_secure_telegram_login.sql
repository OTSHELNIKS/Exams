-- Telegram OTP: сериализация запросов и одноразовое потребление кода.
-- Применять только после проверки в изолированном Supabase/PostgREST.
-- Эти RPC доступны только service_role, не браузерным пользователям.
alter table public.game_login_codes add column if not exists telegram_chat_id bigint;
alter table public.game_login_codes add column if not exists telegram_link_instance_id uuid;
create table if not exists public.telegram_login_throttle (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_requested_at timestamptz,
  failed_attempts integer not null default 0,
  locked_until timestamptz
);
alter table public.telegram_login_throttle enable row level security;
revoke all on public.telegram_login_throttle from public, anon, authenticated;

create or replace function public.start_telegram_login(
  p_user_id uuid, p_game_id text, p_game_server text, p_chat_id bigint, p_code text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare t public.telegram_login_throttle; v_link uuid;
begin
  if p_user_id is null or p_chat_id is null or p_game_id is null or p_code is null or p_game_id !~ '^[0-9]{6,12}$' or p_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('error','bad_request');
  end if;
  insert into public.telegram_login_throttle(user_id) values(p_user_id) on conflict do nothing;
  select * into t from public.telegram_login_throttle where user_id=p_user_id for update;
  if t.locked_until is not null and t.locked_until > clock_timestamp() then return jsonb_build_object('error','too_many_attempts'); end if;
  if t.last_requested_at is not null and t.last_requested_at > clock_timestamp()-interval '30 seconds' then return jsonb_build_object('error','too_often'); end if;
  select link_instance_id into v_link from public.telegram_links where user_id=p_user_id and tg_chat_id=p_chat_id and verified_at is not null and link_instance_id is not null for update;
  if not found then return jsonb_build_object('error','telegram_not_linked'); end if;
  begin
    delete from public.game_login_codes where user_id=p_user_id;
    insert into public.game_login_codes(code,user_id,game_id,game_server,channel,attempts,expires_at,telegram_chat_id,telegram_link_instance_id)
      values(p_code,p_user_id,p_game_id,coalesce(p_game_server,''),'telegram',0,clock_timestamp()+interval '5 minutes',p_chat_id,v_link);
  exception when unique_violation then return jsonb_build_object('error','collision'); end;
  update public.telegram_login_throttle set last_requested_at=clock_timestamp(),
    failed_attempts=case when locked_until is not null and locked_until<=clock_timestamp() then 0 else failed_attempts end,
    locked_until=case when locked_until<=clock_timestamp() then null else locked_until end where user_id=p_user_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.consume_telegram_login(
  p_user_id uuid, p_game_id text, p_game_server text, p_code text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare t public.telegram_login_throttle; a public.game_login_codes; n integer;
begin
  if p_user_id is null or p_game_id is null or p_code is null or p_game_id !~ '^[0-9]{6,12}$' or p_code !~ '^[0-9]{6}$' then return jsonb_build_object('error','bad_code'); end if;
  select * into t from public.telegram_login_throttle where user_id=p_user_id for update;
  if not found then return jsonb_build_object('error','bad_code'); end if;
  if t.locked_until is not null and t.locked_until > clock_timestamp() then return jsonb_build_object('error','too_many_attempts'); end if;
  if t.locked_until is not null and t.locked_until <= clock_timestamp() then
    update public.telegram_login_throttle set failed_attempts=0,locked_until=null where user_id=p_user_id;
    t.failed_attempts := 0;
  end if;
  select * into a from public.game_login_codes where user_id=p_user_id order by created_at desc limit 1 for update;
  if not found or a.channel <> 'telegram' then return jsonb_build_object('error','bad_code'); end if;
  if a.expires_at <= clock_timestamp() then
    delete from public.game_login_codes where code=a.code;
    return jsonb_build_object('error','code_expired');
  end if;
  perform 1 from public.telegram_links where user_id=p_user_id and tg_chat_id=a.telegram_chat_id and verified_at is not null and link_instance_id=a.telegram_link_instance_id for update;
  if not found then
    delete from public.game_login_codes where code=a.code;
    return jsonb_build_object('error','bad_code');
  end if;
  if a.game_id<>p_game_id or (coalesce(p_game_server,'')<>'' and a.game_server<>p_game_server) or a.code<>p_code then
    n := t.failed_attempts+1;
    update public.telegram_login_throttle set failed_attempts=n,
      locked_until=case when n>=5 then clock_timestamp()+interval '15 minutes' else null end where user_id=p_user_id;
    if n>=5 then
      delete from public.game_login_codes where code=a.code;
      return jsonb_build_object('error','too_many_attempts');
    end if;
    return jsonb_build_object('error','bad_code','attemptsLeft',5-n);
  end if;
  delete from public.game_login_codes where code=a.code;
  update public.telegram_login_throttle set failed_attempts=0,locked_until=null where user_id=p_user_id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.start_telegram_login(uuid,text,text,bigint,text), public.consume_telegram_login(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.start_telegram_login(uuid,text,text,bigint,text), public.consume_telegram_login(uuid,text,text,text) to service_role;
notify pgrst, 'reload schema';
