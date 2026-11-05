-- Серверные поля профиля не должны быть доступны для изменения клиентом.
-- REVOKE UPDATE(column) не отменяет общий UPDATE на таблицу, поэтому сначала
-- убираем таблицу целиком и возвращаем только поля profileToRow(). RLS сохраняется.
-- Проверить на staging вместе с сохранением нового и существующего профиля.
revoke all privileges on table public.player_profiles from public, anon, authenticated;
grant select on public.player_profiles to authenticated;
grant insert (
  user_id, game_id, game_server, nick, age, gender, rank, roles, regions,
  bio, heroes, hero_classes, socials, extra_slots, avatar_url, screenshot_urls, updated_at
) on public.player_profiles to authenticated;
grant update (
  user_id, game_id, game_server, nick, age, gender, rank, roles, regions,
  bio, heroes, hero_classes, socials, extra_slots, avatar_url, screenshot_urls, updated_at
) on public.player_profiles to authenticated;

notify pgrst, 'reload schema';
