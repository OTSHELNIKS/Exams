-- Вход через саму игру: Game ID + сервер + одноразовый код из Telegram-бота.
--
-- Аккаунт на платформе по-прежнему создаётся один раз (почта или Google), но
-- дальше игрок может заходить, не вспоминая пароль: вводит свой Game ID и
-- сервер, получает шестизначный код в Telegram от бота @name_mlbb_bot и
-- вводит его на сайте. Код живёт 5 минут и одноразовый.
--
-- Таблицу читает и пишет только edge-функция telegram-bot (service role):
-- для anon/authenticated доступа нет вообще, чтобы коды нельзя было перебрать
-- через REST.

create table if not exists public.game_login_codes (
  code text primary key,
  user_id uuid not null,
  game_id text not null,
  game_server text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists game_login_codes_user_idx
  on public.game_login_codes (user_id);

alter table public.game_login_codes enable row level security;

-- Никаких политик: доступ только через service role (edge-функция).
revoke all on public.game_login_codes from anon, authenticated;

comment on table public.game_login_codes is
  'Одноразовые коды входа через игровой аккаунт (Game ID + сервер). Пишет только telegram-bot.';

-- Чистим просроченные коды при вставке нового (дешёвая уборка вместо cron).
create or replace function public.purge_game_login_codes() returns void
language sql security definer set search_path = public as $$
  delete from public.game_login_codes where expires_at < now() - interval '1 day';
$$;
