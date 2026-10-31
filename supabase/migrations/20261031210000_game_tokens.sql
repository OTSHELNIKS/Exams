-- NAME MLBB — обновление КДА и винрейта без повторного ввода кода.
--
-- Код из внутриигровой почты нужен ровно один раз: он доказывает владение
-- аккаунтом и даёт игровой JWT. Дальше этот JWT хранится ТОЛЬКО на сервере
-- (service role) и используется, чтобы перечитывать цифры из игры без кода.
--
-- Таблица приватная: RLS включён, политик нет, у anon/authenticated прав нет.
-- Читает и пишет её только edge-функция game-login сервисным ключом.
-- Клиенту JWT игры не отдаётся никогда.

create table if not exists public.game_tokens (
  user_id uuid primary key references public.player_profiles (user_id) on delete cascade,
  jwt text not null,
  updated_at timestamptz not null default now()
);

comment on table public.game_tokens is
  'Игровой JWT MLBB для обновления КДА и винрейта без нового кода. Только service role.';
comment on column public.game_tokens.jwt is
  'JWT шлюза MLBB, полученный при подтверждении кодом. В браузер не попадает.';

alter table public.game_tokens enable row level security;
revoke all on public.game_tokens from anon, authenticated;
grant select, insert, update, delete on public.game_tokens to service_role;
