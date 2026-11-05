-- ВРЕМЕННАЯ ПАУЗА РЕЙТИНГА.
-- Существующий клиентский драфт не является проверенным сервером составом.
-- До внедрения серверного драфта ни клиенты, ни администратор через эти RPC
-- не могут начислить MMR по непроверенным результатам. История и очки не меняются.
-- Старые pending/disputed матчи необходимо проверить и отдельно решить их судьбу.
-- Восстановить операции можно только новой миграцией с серверными проверками;
-- простое возвращение старых функций вернёт известные риски.

create or replace function public.report_match(
  p_team_a uuid[], p_team_b uuid[], p_winner text, p_lobby_id uuid default null
)
returns jsonb language sql security invoker
set search_path = pg_catalog, public
as $$
  select case when auth.uid() is null then jsonb_build_object('error', 'unauthorized')
              else jsonb_build_object('error', 'rating_paused') end
$$;

create or replace function public.confirm_match(p_match_id uuid)
returns jsonb language sql security invoker
set search_path = pg_catalog, public
as $$
  select case when auth.uid() is null then jsonb_build_object('error', 'unauthorized')
              else jsonb_build_object('error', 'rating_paused') end
$$;

create or replace function public.resolve_match(p_match_id uuid, p_winner text)
returns jsonb language sql security invoker
set search_path = pg_catalog, public
as $$
  select case when auth.uid() is null then jsonb_build_object('error', 'unauthorized')
              else jsonb_build_object('error', 'rating_paused') end
$$;

revoke all privileges on public.matches, public.match_players from public, anon, authenticated;
grant select on public.matches, public.match_players to authenticated;
revoke all on function public.report_match(uuid[], uuid[], text, uuid),
  public.confirm_match(uuid), public.resolve_match(uuid, text), public.dispute_match(uuid, text)
  from public, anon;
grant execute on function public.report_match(uuid[], uuid[], text, uuid),
  public.confirm_match(uuid), public.resolve_match(uuid, text), public.dispute_match(uuid, text)
  to authenticated;
notify pgrst, 'reload schema';
