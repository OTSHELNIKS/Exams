-- Косметика: рамки, шапки, титулы, цвет ника.
--
-- Принцип: каталог предметов и условия лежат в базе, интерфейс их только
-- показывает. Поэтому «надеть» золотую рамку с 1200 MMR нельзя даже через
-- консоль браузера — функция equip_cosmetic перепроверит условие на сервере.
--
-- Платное сюда попадает правом (entitlements): оплата происходит вне
-- приложения (сайт/касса), а в базе просто появляется право. Второй путь —
-- код активации, чтобы продавать до появления кассы.

create table if not exists public.cosmetic_items (
  id text primary key,
  kind text not null check (kind in ('frame', 'hat', 'title', 'color')),
  label text not null,
  -- always | verified | matches | wins | mmr | entitlement
  req_kind text not null check (req_kind in ('always', 'verified', 'matches', 'wins', 'mmr', 'entitlement')),
  req_value integer not null default 0,
  premium boolean not null default false
);

insert into public.cosmetic_items (id, kind, label, req_kind, req_value, premium) values
  ('frame-default',  'frame', 'Классика',           'always',      0,    false),
  ('frame-verified', 'frame', 'Проверенный',        'verified',    0,    false),
  ('frame-bronze',   'frame', 'Бронза',             'matches',     10,   false),
  ('frame-silver',   'frame', 'Серебро',            'matches',     100,  false),
  ('frame-ruby',     'frame', 'Рубин',              'matches',     500,  false),
  ('frame-gold',     'frame', 'Золото',             'mmr',         1600, false),
  ('frame-emerald',  'frame', 'Изумруд',            'mmr',         1800, false),
  ('frame-neon',     'frame', 'Неон',               'entitlement', 0,    true),
  ('frame-diamond',  'frame', 'Алмаз',              'entitlement', 0,    true),

  ('hat-none',       'hat',   'Без шапки',          'always',      0,    false),
  ('hat-rookie',     'hat',   'Новобранец',         'matches',     10,   false),
  ('hat-veteran',    'hat',   'Ветеран',            'matches',     100,  false),
  ('hat-legend',     'hat',   'Легенда',            'matches',     500,  false),
  ('hat-champion',   'hat',   'Чемпион',            'wins',        50,   false),
  ('hat-top',        'hat',   'Вершина',            'mmr',         2500, false),
  ('hat-crown',      'hat',   'Корона фаундера',    'entitlement', 0,    true),
  ('hat-halo',       'hat',   'Неоновый ореол',     'entitlement', 0,    true),

  ('title-none',     'title', 'Без титула',         'always',      0,    false),
  ('title-verified', 'title', 'Проверенный',        'verified',    0,    false),
  ('title-veteran',  'title', 'Ветеран',            'matches',     100,  false),
  ('title-legend',   'title', 'Легенда',            'matches',     500,  false),
  ('title-pioneer',  'title', 'Первопроходец',      'entitlement', 0,    true),

  ('color-default',  'color', 'Белый',              'always',      0,    false),
  ('color-orange',   'color', 'Фирменный',          'always',      0,    false),
  ('color-gold',     'color', 'Золото',             'mmr',         1600, false),
  ('color-emerald',  'color', 'Изумруд',            'mmr',         1800, false),
  ('color-neon',     'color', 'Неон',               'entitlement', 0,    true)
on conflict (id) do update
  set kind = excluded.kind,
      label = excluded.label,
      req_kind = excluded.req_kind,
      req_value = excluded.req_value,
      premium = excluded.premium;

alter table public.cosmetic_items enable row level security;
drop policy if exists cosmetic_items_read on public.cosmetic_items;
create policy cosmetic_items_read on public.cosmetic_items
  for select to authenticated using (true);

-- ------------------------------------------------------------------ права

create table if not exists public.entitlements (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.cosmetic_items (id) on delete cascade,
  source text not null default 'manual' check (char_length(source) <= 40),
  granted_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.entitlements enable row level security;

-- Свои права видно, менять нельзя: их выдаёт только redeem_cosmetic_code или админ.
drop policy if exists entitlements_read_own on public.entitlements;
create policy entitlements_read_own on public.entitlements
  for select to authenticated using (user_id = auth.uid());

drop policy if exists entitlements_admin_read on public.entitlements;
create policy entitlements_admin_read on public.entitlements
  for select to authenticated using (public.is_admin());

-- --------------------------------------------------------------- что надето

create table if not exists public.cosmetic_loadout (
  user_id uuid primary key references auth.users (id) on delete cascade,
  frame_id text not null default 'frame-default',
  hat_id text not null default 'hat-none',
  title_id text not null default 'title-none',
  color_id text not null default 'color-default',
  updated_at timestamptz not null default now()
);

alter table public.cosmetic_loadout enable row level security;

-- Надевать можно только через equip_cosmetic: политика на запись запрещает
-- обходить проверку условий напрямую.
drop policy if exists cosmetic_loadout_read on public.cosmetic_loadout;
create policy cosmetic_loadout_read on public.cosmetic_loadout
  for select to authenticated using (true);

-- ---------------------------------------------------------------- коды

-- Код активации = купленный сет или подарок. Внутри приложения ничего не
-- продаётся, поэтому именно код связывает оплату на сайте с правом в базе.
create table if not exists public.cosmetic_codes (
  code text primary key check (code ~ '^[A-Z0-9-]{6,24}$'),
  item_id text not null references public.cosmetic_items (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 120),
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.cosmetic_codes enable row level security;

drop policy if exists cosmetic_codes_admin on public.cosmetic_codes;
create policy cosmetic_codes_admin on public.cosmetic_codes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------- функции

-- Открыто ли у игрока право на предмет: проверяем условие по его же данным.
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
    when 'entitlement' then exists (
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

-- Надеть предмет. Тип определяем по самому предмету, чтобы нельзя было
-- положить рамку в слот шапки.
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
    frame_id = case when v_item.kind = 'frame' then v_item.id else frame_id end,
    hat_id   = case when v_item.kind = 'hat'   then v_item.id else hat_id end,
    title_id = case when v_item.kind = 'title' then v_item.id else title_id end,
    color_id = case when v_item.kind = 'color' then v_item.id else color_id end,
    updated_at = now()
  where user_id = v_uid;

  return jsonb_build_object('ok', true, 'kind', v_item.kind, 'item_id', v_item.id);
end;
$$;

-- Активация кода: право появляется у того, кто ввёл код, и только один раз.
create or replace function public.redeem_cosmetic_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code public.cosmetic_codes;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  select * into v_code from public.cosmetic_codes
   where code = upper(trim(coalesce(p_code, '')))
   for update;
  if not found then
    return jsonb_build_object('error', 'bad_code');
  end if;
  if v_code.used_at is not null then
    return jsonb_build_object('error', 'used');
  end if;

  insert into public.entitlements (user_id, item_id, source)
  values (v_uid, v_code.item_id, 'code')
  on conflict (user_id, item_id) do nothing;

  update public.cosmetic_codes
     set used_by = v_uid, used_at = now()
   where code = v_code.code;

  return jsonb_build_object('ok', true, 'item_id', v_code.item_id);
end;
$$;

-- Выдать предмет вручную (админ): подарок стримеру, компенсация, разовый сет.
create or replace function public.grant_cosmetic(p_user_id uuid, p_item_id text, p_source text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not exists (select 1 from public.cosmetic_items where id = p_item_id) then
    return jsonb_build_object('error', 'no_item');
  end if;

  insert into public.entitlements (user_id, item_id, source)
  values (p_user_id, p_item_id, left(coalesce(p_source, 'manual'), 40))
  on conflict (user_id, item_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.equip_cosmetic(text) from public;
revoke all on function public.redeem_cosmetic_code(text) from public;
revoke all on function public.grant_cosmetic(uuid, text, text) from public;
revoke all on function public.cosmetic_unlocked(uuid, text) from public;
grant execute on function public.equip_cosmetic(text) to authenticated;
grant execute on function public.redeem_cosmetic_code(text) to authenticated;
grant execute on function public.grant_cosmetic(uuid, text, text) to authenticated;
grant execute on function public.cosmetic_unlocked(uuid, text) to authenticated;

-- --------------------------------------------------------- публичный вид

-- Что надето — видно всем: это витрина, а не приватные данные.
create or replace view public.cosmetic_loadouts_public as
select user_id, frame_id, hat_id, title_id, color_id, updated_at
from public.cosmetic_loadout;

revoke all on public.cosmetic_loadouts_public from anon, authenticated;
grant select on public.cosmetic_loadouts_public to authenticated;

comment on table public.cosmetic_items is
  'Каталог косметики и условия: всегда / подтверждённый аккаунт / матчи / победы / MMR / право (покупка вне приложения).';
comment on table public.entitlements is
  'Права на коллекционную косметику: выдаются кодом активации или админом, никогда клиентом.';
comment on table public.cosmetic_codes is
  'Коды активации для продаж вне приложения: один код = одно право, повторно не активируется.';

-- ------------------------------------------------------------------ рейтинг
-- В таблицу лидеров добавляем надетую косметику, чтобы рамки и цвет ника
-- были видны всем без отдельного запроса на каждого игрока.
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
  coalesce(cl.hat_id, 'hat-none') as hat_id,
  coalesce(cl.title_id, 'title-none') as title_id,
  coalesce(cl.color_id, 'color-default') as color_id
from public.leaderboard l
left join public.cosmetic_loadout cl on cl.user_id = l.user_id;

revoke all on public.leaderboard_ranks from anon, authenticated;
grant select on public.leaderboard_ranks to authenticated;
