-- Одноразовый вход через Telegram: секрет подтверждения в боте отдельно от
-- секрета браузера. Только для staging до защиты привязок и проверки гонок.
create table if not exists public.telegram_auth_requests (
  id uuid primary key,
  bot_token_hash text not null unique,
  browser_verifier_hash text not null,
  status text not null default 'pending' check (status in ('pending','approved','consumed')),
  user_id uuid references auth.users(id) on delete cascade,
  tg_chat_id bigint,
  link_instance_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_auth_requests enable row level security;
revoke all on public.telegram_auth_requests from public, anon, authenticated;

create or replace function public.begin_telegram_token_auth(p_id uuid,p_bot_hash text,p_verifier_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_id is null or p_bot_hash is null or p_verifier_hash is null or p_bot_hash !~ '^[0-9a-f]{64}$' or p_verifier_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error','bad_request'); end if;
  -- Ограничитель ресурсов, не замена сетевому rate limit.
  perform pg_advisory_xact_lock(872010442);
  delete from public.telegram_auth_requests where expires_at < clock_timestamp() - interval '1 hour';
  if (select count(*) from public.telegram_auth_requests where status='pending' and expires_at>clock_timestamp()) >= 1000 then return jsonb_build_object('error','busy'); end if;
  insert into public.telegram_auth_requests(id,bot_token_hash,browser_verifier_hash,expires_at)
    values(p_id,p_bot_hash,p_verifier_hash,clock_timestamp()+interval '5 minutes');
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.approve_telegram_token_auth(p_bot_hash text,p_chat_id bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.telegram_auth_requests; v_user uuid; v_link uuid;
begin
  if p_bot_hash is null or p_chat_id is null then return jsonb_build_object('error','invalid'); end if;
  select * into r from public.telegram_auth_requests where bot_token_hash=p_bot_hash for update;
  if not found or r.status<>'pending' or r.expires_at<=clock_timestamp() then return jsonb_build_object('error','invalid'); end if;
  select user_id,link_instance_id into v_user,v_link from public.telegram_links where tg_chat_id=p_chat_id and verified_at is not null and link_instance_id is not null for update;
  if v_user is null then return jsonb_build_object('error','not_linked'); end if;
  update public.telegram_auth_requests set status='approved', user_id=v_user, tg_chat_id=p_chat_id, link_instance_id=v_link where id=r.id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.consume_telegram_token_auth(p_id uuid,p_verifier_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.telegram_auth_requests;
begin
  if p_id is null or p_verifier_hash is null then return jsonb_build_object('error','invalid'); end if;
  select * into r from public.telegram_auth_requests where id=p_id for update;
  if not found or r.browser_verifier_hash<>p_verifier_hash or r.expires_at<=clock_timestamp() or r.status='consumed' then return jsonb_build_object('error','invalid'); end if;
  if r.status='pending' then return jsonb_build_object('status','pending'); end if;
  perform 1 from public.telegram_links where user_id=r.user_id and tg_chat_id=r.tg_chat_id and verified_at is not null and link_instance_id=r.link_instance_id for update;
  if not found then
    update public.telegram_auth_requests set status='consumed' where id=r.id;
    return jsonb_build_object('error','invalid');
  end if;
  update public.telegram_auth_requests set status='consumed' where id=r.id;
  return jsonb_build_object('ok',true,'user_id',r.user_id);
end $$;
revoke all on function public.begin_telegram_token_auth(uuid,text,text), public.approve_telegram_token_auth(text,bigint), public.consume_telegram_token_auth(uuid,text) from public, anon, authenticated;
grant execute on function public.begin_telegram_token_auth(uuid,text,text), public.approve_telegram_token_auth(text,bigint), public.consume_telegram_token_auth(uuid,text) to service_role;
notify pgrst, 'reload schema';
