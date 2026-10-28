-- Media storage for player profiles: avatars + MLBB stat screenshots.
-- Buckets are public-read (profile media is displayed to other players),
-- but only the owning authenticated user can write under their own folder.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true), ('screenshots', 'screenshots', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Avatars are publicly readable" on storage.objects;
create policy "Avatars are publicly readable" on storage.objects
  for select using (bucket_id = 'avatars');
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar" on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar" on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Screenshots are publicly readable" on storage.objects;
create policy "Screenshots are publicly readable" on storage.objects
  for select using (bucket_id = 'screenshots');
drop policy if exists "Users can upload their own screenshots" on storage.objects;
create policy "Users can upload their own screenshots" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can update their own screenshots" on storage.objects;
create policy "Users can update their own screenshots" on storage.objects
  for update to authenticated using (
    bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can delete their own screenshots" on storage.objects;
create policy "Users can delete their own screenshots" on storage.objects
  for delete to authenticated using (
    bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

alter table public.player_profiles
  add column if not exists avatar_url text not null default '' check (char_length(avatar_url) <= 500);
alter table public.player_profiles
  add column if not exists screenshot_urls text[] not null default '{}'
  check (cardinality(screenshot_urls) <= 6);
