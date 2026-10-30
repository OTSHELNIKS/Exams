-- Game ID и сервер (зона) теперь хранятся отдельно.
-- В MLBB идентификатор аккаунта выглядит как «123456789 (1234)», где второе
-- число — сервер. Раньше обе части писались в одну строку game_id; добавляем
-- отдельную колонку и разбираем уже сохранённые значения.

alter table public.player_profiles
  add column if not exists game_server text not null default '';

alter table public.player_profiles
  drop constraint if exists player_profiles_game_server_len;
alter table public.player_profiles
  add constraint player_profiles_game_server_len check (char_length(game_server) <= 10);

-- «123456789 (1234)», «123456789(1234)», «123456789 1234» -> id + сервер.
-- Трогаем только строки, где сервер ещё не заполнен, а формат составной.
with parsed as (
  select
    user_id,
    trim(regexp_replace(game_id, '\s*[\(\s]\s*[0-9]{1,6}\)?\s*$', '')) as id_part,
    substring(game_id from '([0-9]{1,6})\)?\s*$') as server_part
  from public.player_profiles
  where coalesce(game_server, '') = ''
    and game_id ~ '^\s*[0-9]+\s*[\(\s]\s*[0-9]{1,6}\)?\s*$'
)
update public.player_profiles p
set game_id = parsed.id_part,
    game_server = coalesce(parsed.server_part, '')
from parsed
where p.user_id = parsed.user_id;

comment on column public.player_profiles.game_server is
  'Сервер (зона) аккаунта MLBB. Хранится отдельно от game_id, чтобы их можно было править независимо.';
