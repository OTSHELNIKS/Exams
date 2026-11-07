-- Серверный лимит для ненавязчивых реакций, без клиентского доступа.
create table if not exists public.telegram_reaction_throttle (
  tg_chat_id bigint primary key,
  last_reaction_at timestamptz not null
);
alter table public.telegram_reaction_throttle enable row level security;
revoke all on public.telegram_reaction_throttle from public, anon, authenticated;
create or replace function public.claim_telegram_reaction(p_chat_id bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_claim bigint;
begin
  if p_chat_id is null or p_chat_id <= 0 then return jsonb_build_object('ok',false); end if;
  -- В течение одного запроса чистим только небольшую порцию старых записей.
  delete from public.telegram_reaction_throttle where tg_chat_id in
    (select tg_chat_id from public.telegram_reaction_throttle where last_reaction_at < clock_timestamp()-interval '1 day' limit 100);
  insert into public.telegram_reaction_throttle(tg_chat_id,last_reaction_at) values(p_chat_id,clock_timestamp())
    on conflict (tg_chat_id) do update set last_reaction_at=excluded.last_reaction_at
    where public.telegram_reaction_throttle.last_reaction_at <= clock_timestamp()-interval '1 minute'
    returning tg_chat_id into v_claim;
  return jsonb_build_object('ok',v_claim is not null);
end $$;
revoke all on function public.claim_telegram_reaction(bigint) from public, anon, authenticated;
grant execute on function public.claim_telegram_reaction(bigint) to service_role;
notify pgrst, 'reload schema';
