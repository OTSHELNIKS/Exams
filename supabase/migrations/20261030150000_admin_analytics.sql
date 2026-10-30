-- Admin analytics v1 -------------------------------------------------------------
-- Every number the admin dashboard shows, in one gated call.
--
-- Why an RPC instead of wider RLS: regular users must never be able to read
-- other people's rows (verified: an authenticated non-admin sees 0 rows in
-- player_profiles / support_tickets / admins). This function is SECURITY
-- DEFINER, so it *can* read everything, but it refuses to run unless the
-- caller is listed in public.admins.
--
-- The browser only ever gets the aggregated jsonb below — never raw rows.

-- Helper used by the dashboard and by policies: is the current JWT an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;

comment on function public.is_admin() is
  'True when the current JWT belongs to a row in public.admins.';

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- Aggregated dashboard payload. Raises 42501 for anyone who is not an admin,
-- so a forged client cannot get statistics without a real admin JWT.
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  series jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_stats: forbidden' using errcode = '42501';
  end if;

  -- 30-day timeline: registrations, profile updates, support tickets.
  with days as (
    select d::date as d
    from generate_series(current_date - interval '29 days', current_date, interval '1 day') d
  ),
  signups as (
    select created_at::date as d, count(*) as c from auth.users group by 1
  ),
  active as (
    select updated_at::date as d, count(*) as c from public.player_profiles group by 1
  ),
  tickets as (
    select created_at::date as d, count(*) as c from public.support_tickets group by 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'iso', to_char(days.d, 'YYYY-MM-DD'),
        'label', to_char(days.d, 'DD.MM'),
        'signups', coalesce(signups.c, 0),
        'active', coalesce(active.c, 0),
        'tickets', coalesce(tickets.c, 0)
      ) order by days.d
    ), '[]'::jsonb
  )
  into series
  from days
  left join signups on signups.d = days.d
  left join active on active.d = days.d
  left join tickets on tickets.d = days.d;

  return jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'users', (select count(*) from auth.users),
      'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
      'unconfirmed', (select count(*) from auth.users where email_confirmed_at is null),
      'profiles', (select count(*) from public.player_profiles),
      'admins', (select count(*) from public.admins),
      'banned', (select count(*) from public.player_profiles where coalesce(is_banned, false)),
      'telegram', (select count(*) from public.telegram_links),
      'with_nick', (select count(*) from public.player_profiles where coalesce(nick, '') <> ''),
      'with_game_id', (select count(*) from public.player_profiles where coalesce(game_id, '') <> ''),
      'with_avatar', (select count(*) from public.player_profiles where coalesce(avatar_url, '') <> ''),
      'with_screenshots', (select count(*) from public.player_profiles where cardinality(coalesce(screenshot_urls, '{}'::text[])) > 0),
      'complete', (
        select count(*) from public.player_profiles
        where coalesce(nick, '') <> '' and coalesce(game_id, '') <> ''
          and coalesce(avatar_url, '') <> ''
          and cardinality(coalesce(screenshot_urls, '{}'::text[])) > 0
      ),
      'signups_today', (select count(*) from auth.users where created_at >= current_date),
      'signups_7d', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
      'signups_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
      'active_24h', (select count(*) from public.player_profiles where updated_at >= now() - interval '24 hours'),
      'active_7d', (select count(*) from public.player_profiles where updated_at >= now() - interval '7 days'),
      'avg_pts', (select coalesce(round(avg(pts)), 0) from public.player_profiles),
      'max_pts', (select coalesce(max(pts), 0) from public.player_profiles),
      'total_pts', (select coalesce(sum(pts), 0) from public.player_profiles),
      'avg_screenshots', (
        select coalesce(round(avg(cardinality(coalesce(screenshot_urls, '{}'::text[])))::numeric, 1), 0)
        from public.player_profiles
      ),
      'tickets_total', (select count(*) from public.support_tickets),
      'tickets_open', (select count(*) from public.support_tickets where status = 'open'),
      'tickets_answered', (select count(*) from public.support_tickets where status = 'answered'),
      'tickets_closed', (select count(*) from public.support_tickets where status = 'closed'),
      'reviews_pending', (select count(*) from public.moderation_reviews where status = 'pending'),
      'reviews_approved', (select count(*) from public.moderation_reviews where status = 'approved'),
      'reviews_rejected', (select count(*) from public.moderation_reviews where status = 'rejected'),
      'db_size_bytes', pg_database_size(current_database())
    ),
    'series', series,
    'ranks', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', c) order by c desc), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(rank), ''), 'Не указан') as label, count(*) as c
        from public.player_profiles
        group by 1
        order by c desc
        limit 8
      ) t
    ),
    'regions', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', c) order by c desc), '[]'::jsonb)
      from (
        select r as label, count(*) as c
        from public.player_profiles, unnest(coalesce(regions, '{}'::text[])) r
        group by 1
        order by c desc
        limit 6
      ) t
    ),
    'roles', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', c) order by c desc), '[]'::jsonb)
      from (
        select r as label, count(*) as c
        from public.player_profiles, unnest(coalesce(roles, '{}'::text[])) r
        group by 1
        order by c desc
        limit 6
      ) t
    ),
    'socials', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', c) order by c desc), '[]'::jsonb)
      from (
        select s as label, count(*) as c
        from public.player_profiles, unnest(coalesce(socials, '{}'::text[])) s
        group by 1
        order by c desc
      ) t
    ),
    'top_players', (
      select coalesce(
        jsonb_agg(jsonb_build_object('nick', nick, 'pts', pts, 'rank', rank) order by pts desc),
        '[]'::jsonb
      )
      from (
        select coalesce(nullif(nick, ''), 'Без ника') as nick, pts, coalesce(nullif(rank, ''), '—') as rank
        from public.player_profiles
        order by pts desc
        limit 5
      ) t
    ),
    'latest', (
      select coalesce(
        jsonb_agg(jsonb_build_object('nick', nick, 'rank', rank, 'at', updated_at) order by updated_at desc),
        '[]'::jsonb
      )
      from (
        select coalesce(nullif(nick, ''), 'Без ника') as nick,
               coalesce(nullif(rank, ''), '—') as rank,
               updated_at
        from public.player_profiles
        order by updated_at desc
        limit 5
      ) t
    )
  );
end;
$$;

comment on function public.admin_stats() is
  'Aggregated site statistics for the admin dashboard. Raises 42501 for non-admins.';

revoke all on function public.admin_stats() from public;
revoke all on function public.admin_stats() from anon;
grant execute on function public.admin_stats() to authenticated;

-- Hygiene: these three policies were created for role PUBLIC. Tighten them to
-- authenticated — an anonymous request has no auth.uid() and gets nothing.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'moderation_reviews' and policyname = 'Users can read own moderation reviews') then
    execute 'alter policy "Users can read own moderation reviews" on public.moderation_reviews to authenticated';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'moderation_reviews' and policyname = 'Users can submit own items for review') then
    execute 'alter policy "Users can submit own items for review" on public.moderation_reviews to authenticated';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'moderation_reviews' and policyname = 'Users can withdraw own pending items') then
    execute 'alter policy "Users can withdraw own pending items" on public.moderation_reviews to authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
