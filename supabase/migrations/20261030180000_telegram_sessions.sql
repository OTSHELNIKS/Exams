-- Диалоговое состояние Telegram-бота.
--
-- Зачем: раньше админ читал заявку и должен был вручную набирать
-- «/reply 6 текст». Теперь он нажимает кнопку «Ответить» в карточке заявки,
-- бот запоминает «жду текст» в этой таблице и принимает следующее обычное
-- сообщение как ответ. То же для игрока: кнопка «Написать в поддержку»,
-- дальше просто текст без команды.
--
-- Пишет и читает только бот под service_role — клиентских политик нет.

create table if not exists public.telegram_sessions (
  chat_id bigint primary key,
  action text not null check (action in ('reply', 'support')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists telegram_sessions_expires_idx
  on public.telegram_sessions (expires_at);

alter table public.telegram_sessions enable row level security;

comment on table public.telegram_sessions is
  'Короткоживущее состояние диалога бота: chat_id -> action (reply/support) + payload. Только service_role.';

notify pgrst, 'reload schema';
