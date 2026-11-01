-- Админ видит и может надеть весь платный контент.
--
-- Платные предметы (premium) открываются правом в entitlements: покупка на
-- сайте или код активации. Владельцу платформы ждать кода бессмысленно — ему
-- нужно проверять, как оформление выглядит и работает.
--
-- Поэтому: для админа условие «нужно право» считается выполненным, а при
-- первом надевании право действительно записывается (source = 'admin'). Так
-- предмет остаётся у него и после того, как он займёт обычным игроком, а
-- клиент видит его как открытый без отдельной ветки логики.
--
-- Что это НЕ делает: бесплатные условия (матчи, победы, MMR, подтверждённый
-- Game ID) для админа не подменяются — иначе легко выпустить баг, которого у
-- игроков не будет.

-- Проверка «этот пользователь — админ» по id. is_admin() смотрит на текущий
-- JWT, а функциям ниже нужен произвольный пользователь.
create or replace function public.is_admin_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins a where a.user_id = p_user_id);
$$;

revoke all on function public.is_admin_user(uuid) from public;
revoke all on function public.is_admin_user(uuid) from anon;
grant execute on function public.is_admin_user(uuid) to authenticated;

comment on function public.is_admin_user(uuid) is
  'True when the given user id is in public.admins (не зависит от текущего JWT).';

-- ------------------------------------------------------------------ условия

create or replace function public.cosmetic_unlocked(p_user_id uuid, p_item_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.cosmetic_items;
  v_profile public.player_profiles;
begin
  select * into v_item from public.cosmetic_items where id = p_item_id;
  if not found then
    return false;
  end if;

  select * into v_profile from public.player_profiles where user_id = p_user_id;

  return case v_item.req_kind
    when 'always' then true
    -- Платный контент: право из покупки/кода. Админу — сразу, без покупки.
    when 'entitlement' then public.is_admin_user(p_user_id) or exists (
      select 1 from public.entitlements e where e.user_id = p_user_id and e.item_id = p_item_id
    )
    when 'verified' then exists (
      select 1 from public.player_profiles p
      where p.user_id = p_user_id
        and p.game_verified_at is not null
        and coalesce(p.game_verified_id, '') <> ''
        and p.game_verified_id = p.game_id
    )
    when 'matches' then coalesce(v_profile.matches_played, 0) >= v_item.req_value
    when 'wins' then coalesce(v_profile.wins, 0) >= v_item.req_value
    when 'mmr' then coalesce(v_profile.pts, 1000) >= v_item.req_value
    else false
  end;
end;
$$;

-- ------------------------------------------------------- надевание предмета

-- То же, что и раньше, плюс одна строка: админу платный предмет ещё и
-- записывается правом, чтобы он остался после снятия роли и был виден клиенту.
create or replace function public.equip_cosmetic(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.cosmetic_items;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  select * into v_item from public.cosmetic_items where id = p_item_id;
  if not found then
    return jsonb_build_object('error', 'no_item');
  end if;
  if not public.cosmetic_unlocked(v_uid, p_item_id) then
    return jsonb_build_object('error', 'locked');
  end if;

  -- Админ получает право навсегда: source = 'admin' видно в админке.
  if v_item.premium and public.is_admin_user(v_uid) then
    insert into public.entitlements (user_id, item_id, source)
    values (v_uid, p_item_id, 'admin')
    on conflict (user_id, item_id) do nothing;
  end if;

  insert into public.cosmetic_loadout (user_id) values (v_uid) on conflict (user_id) do nothing;

  update public.cosmetic_loadout set
    frame_id  = case when v_item.kind = 'frame'  then v_item.id else frame_id end,
    banner_id = case when v_item.kind = 'banner' then v_item.id else banner_id end,
    title_id  = case when v_item.kind = 'title'  then v_item.id else title_id end,
    color_id  = case when v_item.kind = 'color'  then v_item.id else color_id end,
    updated_at = now()
  where user_id = v_uid;

  return jsonb_build_object('ok', true, 'kind', v_item.kind, 'item_id', v_item.id);
end;
$$;

-- ---------------------------------------------------------- своя шапка

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

  if v_url = ''
     or position('/storage/v1/object/public/banners/' || v_uid::text || '/' in v_url) = 0
     or char_length(v_url) > 400 then
    return jsonb_build_object('error', 'bad_url');
  end if;
  if p_item_id = 'banner-motion' and v_url !~* '\.(gif|webp)$' then
    return jsonb_build_object('error', 'bad_format');
  end if;
  if p_item_id = 'banner-photo' and v_url !~* '\.(jpe?g|png|webp)$' then
    return jsonb_build_object('error', 'bad_format');
  end if;
  if not public.cosmetic_unlocked(v_uid, p_item_id) then
    return jsonb_build_object('error', 'locked');
  end if;

  if v_item.premium and public.is_admin_user(v_uid) then
    insert into public.entitlements (user_id, item_id, source)
    values (v_uid, p_item_id, 'admin')
    on conflict (user_id, item_id) do nothing;
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

-- --------------------------------------------- выдать себе всё сразу (админ)

-- Полезно после сброса базы или новой коллекции: одно нажатие — все платные
-- предметы у админа. Обычному игроку вернёт forbidden.
create or replace function public.admin_grant_all_premium()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  if not public.is_admin_user(v_uid) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  insert into public.entitlements (user_id, item_id, source)
  select v_uid, i.id, 'admin'
    from public.cosmetic_items i
   where i.premium
  on conflict (user_id, item_id) do nothing;

  select count(*) into v_count
    from public.entitlements e
   where e.user_id = v_uid;

  return jsonb_build_object('ok', true, 'entitlements', v_count);
end;
$$;

revoke all on function public.admin_grant_all_premium() from public;
revoke all on function public.admin_grant_all_premium() from anon;
grant execute on function public.admin_grant_all_premium() to authenticated;
