-- Вход через игру: два канала подтверждения.
--   ingame   — код приходит на внутриигровую почту MLBB (основной путь);
--   telegram — код приходит в привязанный Telegram-бот (запасной путь).
-- Плюс счётчик попыток: код в игре живёт 5 минут, после 5 неверных вводов
-- попытку нужно начинать заново.
alter table public.game_login_codes
  add column if not exists channel text not null default 'telegram';

alter table public.game_login_codes
  add column if not exists attempts integer not null default 0;

-- Старые коды, выданные в бота, остаются как есть: канал по умолчанию telegram.
comment on column public.game_login_codes.channel is
  'ingame — код пришёл на внутриигровую почту MLBB, telegram — в привязанный бот';
comment on column public.game_login_codes.attempts is
  'Сколько раз игрок ввёл неверный код в этой попытке (лимит 5)';

-- Чистка просроченных попыток: та же функция, что и раньше, плюс счётчик.
create or replace function public.purge_game_login_codes()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.game_login_codes where expires_at < now();
$$;

revoke all on function public.purge_game_login_codes() from anon, authenticated;

-- Быстрый поиск последней попытки игрока в канале «в игре».
create index if not exists game_login_codes_user_channel_idx
  on public.game_login_codes (user_id, channel, created_at desc);
