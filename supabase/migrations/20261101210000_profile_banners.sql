-- Шапка профиля вместо «шапки-глифа».
--
-- Раньше четвёртый вид косметики назывался hat и рисовал эмодзи рядом с ником.
-- Шапка профиля — это полоса-баннер над аватаром, как в Discord, поэтому вид
-- переименован в banner, а слот в loadout — в banner_id.
--
-- Рамки тоже стали настоящими: у предмета есть палитра и уровень орнамента,
-- а рисует их вектор (app/src/frames.jsx). В базе это просто данные — серверу
-- достаточно id, чтобы проверить условие при надевании.

-- ------------------------------------------------------------ вид предмета

alter table public.cosmetic_items drop constraint if exists cosmetic_items_kind_check;
alter table public.cosmetic_items
  add constraint cosmetic_items_kind_check check (kind in ('frame', 'banner', 'title', 'color'));

-- Старые «шапки-глифы» больше не существуют: их заменяют баннеры.
delete from public.entitlements where item_id in (select id from public.cosmetic_items where kind = 'hat');
delete from public.cosmetic_items where kind = 'hat';

-- ------------------------------------------------------------- слот в loadout

alter table public.cosmetic_loadout rename column hat_id to banner_id;
alter table public.cosmetic_loadout alter column banner_id set default 'banner-none';

-- У тех, кто надевал шапку-глиф, слот теперь пустой: ставим базовую шапку.
update public.cosmetic_loadout set banner_id = 'banner-none' where banner_id like 'hat-%';

-- ------------------------------------------------------------------ каталог

insert into public.cosmetic_items (id, kind, label, req_kind, req_value, premium) values
  ('banner-none',     'banner', 'Без шапки',     'always',      0,    false),
  ('banner-ember',    'banner', 'Закат',         'always',      0,    false),
  ('banner-verified', 'banner', 'Проверенный',   'verified',    0,    false),
  ('banner-bronze',   'banner', 'Бронза',        'matches',     10,   false),
  ('banner-legend',   'banner', 'Легенда',       'matches',     500,  false),
  ('banner-gold',     'banner', 'Золото',        'mmr',         1600, false),
  ('banner-emerald',  'banner', 'Изумруд',       'mmr',         1800, false),
  ('banner-neon',     'banner', 'Неон',          'entitlement', 0,    true),
  ('banner-aurora',   'banner', 'Аврора',        'entitlement', 0,    true)
on conflict (id) do update
  set kind = excluded.kind,
      label = excluded.label,
      req_kind = excluded.req_kind,
      req_value = excluded.req_value,
      premium = excluded.premium;

-- --------------------------------------------------------- надевание и вьюха

-- equip_cosmetic теперь пишет в banner_id (раньше — в hat_id).
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

-- Публичный вид оформления для таблицы лидеров: только то, что игрок надел.
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

-- Публичное оформление чужих профилей: вьюха ссылалась на hat_id, после
-- переименования колонки её нужно пересобрать — иначе карточка игрока будет
-- искать несуществующее поле.
drop view if exists public.cosmetic_loadouts_public;
create or replace view public.cosmetic_loadouts_public as
select user_id, frame_id, banner_id, title_id, color_id, updated_at
from public.cosmetic_loadout;

revoke all on public.cosmetic_loadouts_public from anon, authenticated;
grant select on public.cosmetic_loadouts_public to authenticated;
