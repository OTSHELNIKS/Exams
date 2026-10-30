-- Support: remember when the admins were pinged about a ticket, so a ticket
-- created on the site is announced in the bot exactly once.
alter table public.support_tickets
  add column if not exists notified_at timestamptz;

comment on column public.support_tickets.notified_at is
  'When the bot announced this ticket to linked admins (null = not announced yet).';
