-- Новый набор рамок: дивизионы и коллекционные по мотивам MLBB.
--
-- Старые девять рамок заменены целиком (их рисунки удалены из frames.jsx):
-- id остались прежними, чтобы не сломать уже надетые рамки и внешние ключи в
-- cosmetic_loadout, но названия, условия и орнаменты новые.
--
-- frame-neon и frame-diamond раньше были платными. Теперь это «Мифическая
-- слава» и «Бессмертный» — бесплатные за MMR, поэтому premium снимаем:
-- право в entitlements у кого-то могло остаться, и оно просто ничего не даёт.
--
-- Одиннадцать коллекционных рамок — только за право (покупка/код), как и
-- раньше: в приложении кнопки оплаты по-прежнему нет.

update public.cosmetic_items set label = 'Классика',           req_kind = 'always',       req_value = 0,    premium = false where id = 'frame-default';
update public.cosmetic_items set label = 'Страж рассвета',     req_kind = 'verified',     req_value = 0,    premium = false where id = 'frame-verified';
update public.cosmetic_items set label = 'Воин',               req_kind = 'matches',      req_value = 10,   premium = false where id = 'frame-bronze';
update public.cosmetic_items set label = 'Элита',              req_kind = 'matches',      req_value = 100,  premium = false where id = 'frame-silver';
update public.cosmetic_items set label = 'Мастер',             req_kind = 'matches',      req_value = 500,  premium = false where id = 'frame-ruby';
update public.cosmetic_items set label = 'Легенда',            req_kind = 'mmr',          req_value = 1600, premium = false where id = 'frame-gold';
update public.cosmetic_items set label = 'Мифик',              req_kind = 'mmr',          req_value = 1800, premium = false where id = 'frame-emerald';
update public.cosmetic_items set label = 'Мифическая слава',   req_kind = 'mmr',          req_value = 2200, premium = false where id = 'frame-neon';
update public.cosmetic_items set label = 'Бессмертный',        req_kind = 'mmr',          req_value = 2600, premium = false where id = 'frame-diamond';

insert into public.cosmetic_items (id, kind, label, req_kind, req_value, premium) values
  ('frame-starlight', 'frame', 'Звёздный свет',      'entitlement', 0, true),
  ('frame-crown',     'frame', 'Королевская корона', 'entitlement', 0, true),
  ('frame-scepter',   'frame', 'Скипетр герцога',    'entitlement', 0, true),
  ('frame-knight',    'frame', 'Крест рыцаря',       'entitlement', 0, true),
  ('frame-dragon',    'frame', 'Дракон',             'entitlement', 0, true),
  ('frame-abyss',     'frame', 'Бездна',             'entitlement', 0, true),
  ('frame-pumpkin',   'frame', 'Тыква',              'entitlement', 0, true),
  ('frame-frost',     'frame', 'Мороз',              'entitlement', 0, true),
  ('frame-lunar',     'frame', 'Лунный фестиваль',   'entitlement', 0, true),
  ('frame-bling',     'frame', 'Неон',               'entitlement', 0, true),
  ('frame-serpent',   'frame', 'Змей',               'entitlement', 0, true)
on conflict (id) do update
  set kind = excluded.kind,
      label = excluded.label,
      req_kind = excluded.req_kind,
      req_value = excluded.req_value,
      premium = excluded.premium;
