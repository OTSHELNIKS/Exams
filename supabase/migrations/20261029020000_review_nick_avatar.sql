-- Moderation v1.1: review nicknames and avatars alongside screenshots.
-- Generalizes screenshot_reviews into moderation_reviews with a kind column.

alter table public.screenshot_reviews rename to moderation_reviews;

alter table public.moderation_reviews
  add column if not exists kind text not null default 'screenshot',
  add column if not exists text_value text;

alter table public.moderation_reviews alter column url drop not null;
alter table public.moderation_reviews drop constraint if exists screenshot_reviews_user_id_url_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'moderation_reviews_kind_check') then
    alter table public.moderation_reviews
      add constraint moderation_reviews_kind_check
      check (kind in ('screenshot', 'nick', 'avatar'));
  end if;
end $$;

create unique index if not exists moderation_reviews_user_url_key
  on public.moderation_reviews (user_id, kind, url) where url is not null;
create unique index if not exists moderation_reviews_user_text_key
  on public.moderation_reviews (user_id, kind, text_value) where text_value is not null;

alter policy "Users can read own reviews" on public.moderation_reviews
  rename to "Users can read own moderation reviews";
alter policy "Users can submit own screenshots" on public.moderation_reviews
  rename to "Users can submit own items for review";
alter policy "Users can withdraw own pending reviews" on public.moderation_reviews
  rename to "Users can withdraw own pending items";

create policy "Users can resubmit rejected items"
  on public.moderation_reviews for update to authenticated
  using (auth.uid() = user_id and status = 'rejected')
  with check (auth.uid() = user_id and status = 'pending');

comment on table public.moderation_reviews is
  'Moderation queue: nicknames, avatars and screenshots pending admin review via the Telegram bot.';
