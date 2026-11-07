-- Staging only: legacy links are not trusted for login until re-confirmed.
-- One high-entropy, server-generated challenge replaces client six-digit codes.
alter table public.telegram_links add column if not exists verified_at timestamptz;
alter table public.telegram_links add column if not exists link_instance_id uuid;

-- An old bot could otherwise update a previously verified row to a new chat
-- while leaving verified_at intact. A changed chat always loses verification.
create or replace function public.clear_telegram_verification_on_chat_change()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.tg_chat_id is distinct from old.tg_chat_id then
    new.verified_at := null;
    new.link_instance_id := null;
  end if;
  return new;
end $$;
drop trigger if exists telegram_link_chat_changed on public.telegram_links;
create trigger telegram_link_chat_changed before update of tg_chat_id on public.telegram_links
  for each row execute function public.clear_telegram_verification_on_chat_change();

-- Retire every outstanding low-entropy code and prohibit old clients from
-- issuing more. Applying this changes compatibility; deploy only as a unit.
delete from public.telegram_link_codes;
drop policy if exists "Users can manage their own link codes" on public.telegram_link_codes;
revoke all on public.telegram_link_codes from public, anon, authenticated;

create table if not exists public.telegram_link_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null
);
create table if not exists public.telegram_link_issue_throttle (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_issued_at timestamptz not null
);
create table if not exists public.telegram_link_confirm_throttle (
  tg_chat_id bigint primary key,
  window_started_at timestamptz not null,
  attempts integer not null
);
alter table public.telegram_link_challenges enable row level security;
alter table public.telegram_link_issue_throttle enable row level security;
alter table public.telegram_link_confirm_throttle enable row level security;
revoke all on public.telegram_link_challenges, public.telegram_link_issue_throttle, public.telegram_link_confirm_throttle from public, anon, authenticated;

-- auth.uid(), never a caller-provided user id. gen_random_uuid is backed by
-- PostgreSQL's cryptographic RNG; 48 hex chars have ~188 random bits.
create or replace function public.issue_telegram_link()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid := auth.uid(); v_last timestamptz; v_token text;
begin
  if v_user is null or not exists(select 1 from auth.users where id=v_user and not coalesce(is_anonymous,false)) then return jsonb_build_object('error','auth_required'); end if;
  insert into public.telegram_link_issue_throttle(user_id,last_issued_at) values(v_user, '-infinity') on conflict do nothing;
  select last_issued_at into v_last from public.telegram_link_issue_throttle where user_id=v_user for update;
  if v_last > clock_timestamp()-interval '20 seconds' then return jsonb_build_object('error','too_often'); end if;
  v_token := replace(gen_random_uuid()::text,'-','') || left(replace(gen_random_uuid()::text,'-',''),16);
  delete from public.telegram_link_challenges where expires_at < clock_timestamp()-interval '1 hour';
  insert into public.telegram_link_challenges(user_id,token_hash,expires_at)
    values(v_user,encode(sha256(convert_to(v_token,'UTF8')),'hex'),clock_timestamp()+interval '10 minutes')
    on conflict(user_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at;
  update public.telegram_link_issue_throttle set last_issued_at=clock_timestamp() where user_id=v_user;
  return jsonb_build_object('token',v_token,'expiresIn',600);
end $$;

-- Отмена действует только на конкретную ссылку владельца, чтобы запоздавший
-- ответ отмены не удалил новую попытку.
create or replace function public.cancel_telegram_link(p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or p_token is null or p_token !~ '^[0-9a-f]{48}$' then return jsonb_build_object('error','invalid'); end if;
  delete from public.telegram_link_challenges where user_id=v_user and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  return jsonb_build_object('ok',true);
end $$;

-- Only the trusted bot invokes this, after an inline confirmation in the
-- matching private Telegram chat. The row locks serialize retries/rebinding.
create or replace function public.confirm_telegram_link(p_token text,p_chat_id bigint,p_username text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.telegram_link_challenges; t public.telegram_link_confirm_throttle;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' or p_chat_id is null or p_chat_id<=0 then return jsonb_build_object('error','invalid'); end if;
  insert into public.telegram_link_confirm_throttle(tg_chat_id,window_started_at,attempts) values(p_chat_id,clock_timestamp(),0) on conflict do nothing;
  select * into t from public.telegram_link_confirm_throttle where tg_chat_id=p_chat_id for update;
  if t.window_started_at <= clock_timestamp()-interval '1 minute' then
    update public.telegram_link_confirm_throttle set window_started_at=clock_timestamp(),attempts=0 where tg_chat_id=p_chat_id;
    t.attempts := 0;
  end if;
  if t.attempts >= 10 then return jsonb_build_object('error','too_often'); end if;
  update public.telegram_link_confirm_throttle set attempts=attempts+1 where tg_chat_id=p_chat_id;
  select * into c from public.telegram_link_challenges where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found or c.expires_at<=clock_timestamp() then return jsonb_build_object('error','invalid'); end if;
  -- Delete+insert resets old verification and allows unique chat transfer only
  -- after this chat explicitly confirms. All changes roll back on error.
  delete from public.telegram_links where user_id=c.user_id or tg_chat_id=p_chat_id;
  insert into public.telegram_links(user_id,tg_chat_id,tg_username,verified_at,link_instance_id)
    values(c.user_id,p_chat_id,left(coalesce(p_username,''),100),clock_timestamp(),gen_random_uuid());
  delete from public.telegram_link_challenges where user_id=c.user_id;
  delete from public.telegram_link_confirm_throttle where tg_chat_id in
    (select tg_chat_id from public.telegram_link_confirm_throttle where window_started_at < clock_timestamp()-interval '1 day' limit 100);
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.issue_telegram_link(), public.cancel_telegram_link(text) from public, anon;
grant execute on function public.issue_telegram_link(), public.cancel_telegram_link(text) to authenticated;
revoke all on function public.confirm_telegram_link(text,bigint,text) from public, anon, authenticated;
grant execute on function public.confirm_telegram_link(text,bigint,text) to service_role;
notify pgrst, 'reload schema';
