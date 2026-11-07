-- Запрещаем анонимным Supabase-сессиям создавать и изменять профили.
-- Применять только после тестов в изолированном проекте. Эти restrictive
-- политики дополняют (а не заменяют) существующие политики владельца.
drop policy if exists profile_registered_insert on public.player_profiles;
create policy profile_registered_insert on public.player_profiles
  as restrictive for insert to authenticated
  with check (coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false);

drop policy if exists profile_registered_update on public.player_profiles;
create policy profile_registered_update on public.player_profiles
  as restrictive for update to authenticated
  using (coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false);
notify pgrst, 'reload schema';
