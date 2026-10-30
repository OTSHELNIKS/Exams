-- Support tickets: users ask via /support in the bot, admins read and reply.
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  num integer generated always as identity,
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_reply text,
  answered_by uuid,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  constraint support_tickets_num_key unique (num)
);

create index if not exists support_tickets_open_idx
  on public.support_tickets (created_at) where status = 'open';

alter table public.support_tickets enable row level security;

create policy "Users can read own tickets"
  on public.support_tickets for select to authenticated
  using (auth.uid() = user_id);
create policy "Users can create own tickets"
  on public.support_tickets for insert to authenticated
  with check (auth.uid() = user_id and status = 'open');

grant select, insert on public.support_tickets to authenticated;
grant usage, select on sequence public.support_tickets_num_seq to authenticated;

comment on table public.support_tickets is
  'Support tickets from /support bot command; admins read and reply via /tickets /reply.';
