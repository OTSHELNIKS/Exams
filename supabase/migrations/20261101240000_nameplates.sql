-- Рамки имени (nameplate) и анимированный блеск.
--
-- Ник — самое заметное место в профиле, но до сих пор его можно было только
-- перекрасить. Теперь есть отдельный слот: рамка вокруг ника, как в MLBB.
--
-- Варианты (см. app/src/cosmetics.js — id должны совпадать):
--   • без рамки и «Сталь» — без блеска, для тех, кто не любит анимацию;
--   • золотой ник без рамки — переливается сам текст, рамки нет;
--   • золото/изумруд/иней/багрянец/аврора — рамка с бегущим бликом.
-- Платные (premium) открываются правом; админу доступны целиком (см.
-- 20261101230000_admin_premium.sql — там проверка общая, по флагу premium).

alter table public.cosmetic_items drop constraint if exists cosmetic_items_kind_check;
alter table public.cosmetic_items
  add constraint cosmetic_items_kind_check check (kind in ('frame', 'banner', 'nameplate', 'title', 'color'));

insert into public.cosmetic_items (id, kind, label, req_kind, req_value, premium) values
  ('plate-none',     'nameplate', 'Без рамки',         'always',      0,    false),
  ('plate-steel',    'nameplate', 'Сталь',             'matches',     100,  false),
  ('plate-gold',     'nameplate', 'Золото',            'entitlement', 0,    true),
  ('plate-gold-nick','nameplate', 'Золотой ник',       'entitlement', 0,    true),
  ('plate-emerald',  'nameplate', 'Изумруд',           'entitlement', 0,    true),
  ('plate-ice',      'nameplate', 'Иней',              'entitlement', 0,    true),
  ('plate-crimson',  'nameplate', 'Багрянец',          'entitlement', 0,    true),
  ('plate-aurora',   'nameplate', 'Аврора',            'entitlement', 0,    true)
on conflict (id) do update
  set kind = excluded.kind,
      label = excluded.label,
      req_kind = excluded.req_kind,
      req_value = excluded.req_value,
      premium = excluded.premium;

-- ------------------------------------------------------------------- слот

alter table public.cosmetic_loadout
  add column if not exists plate_id text not null default 'plate-none';

comment on column public.cosmetic_loadout.plate_id is
  'Рамка имени: plate-none | plate-steel | платные. Рисуется в NickPlate.';

-- -------------------------------------------------------- надевание

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
    frame_id  = case when v_item.kind = 'frame'     then v_item.id else frame_id end,
    banner_id = case when v_item.kind = 'banner'    then v_item.id else banner_id end,
    plate_id  = case when v_item.kind = 'nameplate' then v_item.id else plate_id end,
    title_id  = case when v_item.kind = 'title'     then v_item.id else title_id end,
    color_id  = case when v_item.kind = 'color'     then v_item.id else color_id end,
    updated_at = now()
  where user_id = v_uid;

  return jsonb_build_object('ok', true, 'kind', v_item.kind, 'item_id', v_item.id);
end;
$$;

-- ------------------------------------------------------------------- вьюхи

-- Вьюхи пересобираем с нуля: в cosmetic_loadouts_public добавилась колонка, а
-- CREATE OR REPLACE VIEW не умеет менять состав колонок. Права выдаём заново.
drop view if exists public.leaderboard_ranks;
drop view if exists public.cosmetic_loadouts_public;

create view public.cosmetic_loadouts_public as
select
  user_id,
  frame_id,
  banner_id,
  plate_id,
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

-- Таблица лидеров: рамку имени рисуем и в строке рейтинга.
create view public.leaderboard_ranks as
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
  coalesce(cl.plate_id, 'plate-none') as plate_id,
  coalesce(cl.title_id, 'title-none') as title_id,
  coalesce(cl.color_id, 'color-default') as color_id
from public.leaderboard l
left join public.cosmetic_loadout cl on cl.user_id = l.user_id;

revoke all on public.leaderboard_ranks from anon, authenticated;
grant select on public.leaderboard_ranks to authenticated;
