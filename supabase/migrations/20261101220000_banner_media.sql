-- Шапка профиля: своя картинка и анимация.
--
-- До этого шапка была только градиентом из каталога. Теперь можно загрузить
-- свою картинку (JPG/PNG/WebP) или анимацию (GIF/анимированный WebP) — это
-- платный контент, поэтому:
--   • сам файл лежит в публичном bucket banners/<user_id>/…;
--   • надевать его можно только с правом (entitlements: banner-photo или
--     banner-motion) — это проверяет equip_cosmetic;
--   • в профиль сохраняется только адрес в нашем хранилище, длина ограничена;
--   • лимиты по размеру и формату проверяет storage (bucket limits).
--
-- Клиент всё равно не может записать banner_id в обход RPC: политика на
-- cosmetic_loadout разрешает только чтение.

-- ------------------------------------------------------------- хранилище

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'banners', 'banners', true,
  4000000,                                   -- 4 МБ: GIF тянет больше аватара
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Banners are publicly readable" on storage.objects;
create policy "Banners are publicly readable" on storage.objects
  for select using (bucket_id = 'banners');

drop policy if exists "Users can upload their own banner" on storage.objects;
create policy "Users can upload their own banner" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'banners' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can update their own banner" on storage.objects;
create policy "Users can update their own banner" on storage.objects
  for update to authenticated using (
    bucket_id = 'banners' and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id = 'banners' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own banner" on storage.objects;
create policy "Users can delete their own banner" on storage.objects
  for delete to authenticated using (
    bucket_id = 'banners' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- --------------------------------------------------------------- слот шапки

alter table public.cosmetic_loadout
  add column if not exists banner_url text not null default ''
  check (char_length(banner_url) <= 400);

-- Новые предметы: своя картинка и анимация. Оба только за право.
insert into public.cosmetic_items (id, kind, label, req_kind, req_value, premium) values
  ('banner-photo',  'banner', 'Своя картинка', 'entitlement', 0, true),
  ('banner-motion', 'banner', 'Анимация',      'entitlement', 0, true)
on conflict (id) do update
  set kind = excluded.kind,
      label = excluded.label,
      req_kind = excluded.req_kind,
      req_value = excluded.req_value,
      premium = excluded.premium;

-- ---------------------------------------------------------- надевание шапки

-- Отдельная функция для своей картинки: проверяем право по типу файла
-- (GIF/WebP — анимация, остальное — картинка) и что адрес наш.
create or replace function public.equip_banner_media(p_item_id text, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.cosmetic_items;
  v_url text := btrim(coalesce(p_url, ''));
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  select * into v_item from public.cosmetic_items where id = p_item_id;
  if not found then
    return jsonb_build_object('error', 'no_item');
  end if;
  if v_item.kind <> 'banner' then
    return jsonb_build_object('error', 'wrong_kind');
  end if;

  -- Только наш bucket и только своя папка: чужую ссылку подставить нельзя.
  if v_url = ''
     or position('/storage/v1/object/public/banners/' || v_uid::text || '/' in v_url) = 0
     or char_length(v_url) > 400 then
    return jsonb_build_object('error', 'bad_url');
  end if;
  -- Тип файла должен совпадать с предметом: анимация — отдельное право.
  if p_item_id = 'banner-motion' and v_url !~* '\.(gif|webp)$' then
    return jsonb_build_object('error', 'bad_format');
  end if;
  if p_item_id = 'banner-photo' and v_url !~* '\.(jpe?g|png|webp)$' then
    return jsonb_build_object('error', 'bad_format');
  end if;

  if not public.cosmetic_unlocked(v_uid, p_item_id) then
    return jsonb_build_object('error', 'locked');
  end if;

  insert into public.cosmetic_loadout (user_id) values (v_uid) on conflict (user_id) do nothing;

  update public.cosmetic_loadout
     set banner_id = p_item_id,
         banner_url = v_url,
         updated_at = now()
   where user_id = v_uid;

  return jsonb_build_object('ok', true, 'kind', 'banner', 'item_id', p_item_id, 'url', v_url);
end;
$$;

revoke all on function public.equip_banner_media(text, text) from public;
grant execute on function public.equip_banner_media(text, text) to authenticated;

-- Снятие своей картинки: вернуться к градиенту.
create or replace function public.clear_banner_media()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  update public.cosmetic_loadout
     set banner_url = '', updated_at = now()
   where user_id = v_uid;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.clear_banner_media() from public;
grant execute on function public.clear_banner_media() to authenticated;

-- Публичное оформление: отдаём и адрес шапки (только наш bucket).
drop view if exists public.cosmetic_loadouts_public;
create or replace view public.cosmetic_loadouts_public as
select
  user_id,
  frame_id,
  banner_id,
  title_id,
  color_id,
  case
    when banner_url like '%/storage/v1/object/public/banners/%' then banner_url
    else ''
  end as banner_url,
  updated_at
from public.cosmetic_loadout;

revoke all on public.cosmetic_loadouts_public from anon, authenticated;
grant select on public.cosmetic_loadouts_public to authenticated;

-- Таблица лидеров: шапку рисуем и в строке рейтинга.
create or replace view public.leaderboard_ranks as
select
  l.user_id, l.nick, l.pts, l.rank, l.roles, l.avatar_url, l.updated_at,
  row_number() over (order by l.pts desc, l.updated_at asc)::int as position,
  count(*) over ()::int as total,
  case
    when row_number() over (order by l.pts desc, l.updated_at asc) = 1 then 'ТОП-1'
    when row_number() over (order by l.pts desc, l.updated_at asc) <= 3 then 'ТОП-3'
    when row_number() over (order by l.pts desc, l.updated_at asc) <= 10 then 'ТОП-10'
    else ''
  end as title,
  coalesce(cl.frame_id, 'frame-default') as frame_id,
  coalesce(cl.banner_id, 'banner-none') as banner_id,
  coalesce(cl.title_id, 'title-none') as title_id,
  coalesce(cl.color_id, 'color-default') as color_id
from public.leaderboard l
left join public.cosmetic_loadout cl on cl.user_id = l.user_id;

revoke all on public.leaderboard_ranks from anon, authenticated;
grant select on public.leaderboard_ranks to authenticated;
