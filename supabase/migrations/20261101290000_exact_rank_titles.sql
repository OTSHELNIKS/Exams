-- Место и подпись берутся из одного серверного порядка. Состав колонок и
-- права вьюхи сохраняются; старые категории ТОП-3/ТОП-10 не маскируют место.
create or replace view public.leaderboard_ranks as
select
  l.user_id, l.nick, l.pts, l.rank, l.roles, l.avatar_url, l.updated_at,
  row_number() over (order by l.pts desc, l.updated_at asc)::int as position,
  count(*) over ()::int as total,
  'ТОП-' || row_number() over (order by l.pts desc, l.updated_at asc) as title,
  coalesce(cl.frame_id, 'frame-default') as frame_id,
  coalesce(cl.banner_id, 'banner-none') as banner_id,
  coalesce(cl.plate_id, 'plate-none') as plate_id,
  coalesce(cl.title_id, 'title-none') as title_id,
  coalesce(cl.color_id, 'color-default') as color_id
from public.leaderboard l
left join public.cosmetic_loadout cl on cl.user_id = l.user_id;

comment on view public.leaderboard_ranks is
  'Место и титул ТОП-N считаются из pts и показывают фактическую позицию.';
