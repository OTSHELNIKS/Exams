-- Подтверждение владения игровым аккаунтом.
--
-- Раньше «привязан» означало просто «в анкете заполнены Game ID и сервер» —
-- это ничего не доказывает: цифры можно вписать любые. Теперь статус
-- появляется только после кода, который пришёл на внутриигровую почту MLBB:
-- edge-функция `game-login` пишет отметку сама, после успешной проверки кода.
--
-- game_verified_id хранит тот Game ID, который подтверждали. Если игрок потом
-- поменяет ID в анкете, отметка перестаёт совпадать и статус снова «не подтверждён».
alter table public.player_profiles
  add column if not exists game_verified_at timestamptz;

alter table public.player_profiles
  add column if not exists game_verified_id text;

comment on column public.player_profiles.game_verified_at is
  'Когда игрок подтвердил владение аккаунтом кодом из внутриигровой почты MLBB';
comment on column public.player_profiles.game_verified_id is
  'Какой Game ID подтверждали: если в анкете другой — отметка недействительна';

-- Пишет только edge-функция под service role: у игрока эти поля только на
-- чтение. RLS «только владелец» разрешает владельцу обновлять свою строку,
-- поэтому отметку защищаем триггером, а не политикой.
create or replace function public.protect_game_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Клиент (anon/authenticated) не может сам себе поставить отметку.
  if auth.role() in ('anon', 'authenticated') then
    if tg_op = 'UPDATE' then
      new.game_verified_at := old.game_verified_at;
      new.game_verified_id := old.game_verified_id;
    else
      new.game_verified_at := null;
      new.game_verified_id := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_game_verification on public.player_profiles;
create trigger protect_game_verification
  before insert or update on public.player_profiles
  for each row execute function public.protect_game_verification();

revoke all on function public.protect_game_verification() from anon, authenticated;
