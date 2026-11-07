-- Staging only: secondary per-client throttling for the public Telegram login.
-- Identity is an HMAC supplied by the trusted Edge function; raw IPs are never
-- stored. This does not replace a gateway/WAF limit against distributed abuse.
create table if not exists public.telegram_auth_rate_limits (
  identity_hash text not null check (identity_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('begin','complete')),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0),
  touched_at timestamptz not null,
  primary key(identity_hash,action)
);
alter table public.telegram_auth_rate_limits enable row level security;
revoke all on public.telegram_auth_rate_limits from public, anon, authenticated;
create index if not exists telegram_auth_rate_limits_touched_idx on public.telegram_auth_rate_limits(touched_at);
create index if not exists telegram_auth_requests_pending_expiry_idx on public.telegram_auth_requests(expires_at) where status='pending';

create or replace function public.claim_telegram_auth_rate_limit(p_identity_hash text,p_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_max integer; v_window interval; v_claim integer; v_now timestamptz := clock_timestamp();
begin
  if p_identity_hash is null or p_identity_hash !~ '^[0-9a-f]{64}$' or p_action is null then return jsonb_build_object('error','invalid'); end if;
  if p_action='begin' then v_max:=8; v_window:=interval '5 minutes';
  elsif p_action='complete' then v_max:=120; v_window:=interval '1 minute';
  else return jsonb_build_object('error','invalid'); end if;
  -- Cleanup is bounded and amortized; the gateway must still limit traffic.
  if random() < 0.01 then
    delete from public.telegram_auth_rate_limits where (identity_hash,action) in
      (select identity_hash,action from public.telegram_auth_rate_limits where touched_at < v_now-interval '1 day' order by touched_at limit 200);
  end if;
  insert into public.telegram_auth_rate_limits(identity_hash,action,window_started_at,attempts,touched_at)
    values(p_identity_hash,p_action,v_now,1,v_now)
  on conflict(identity_hash,action) do update set
    window_started_at=case when telegram_auth_rate_limits.window_started_at <= v_now-v_window then v_now else telegram_auth_rate_limits.window_started_at end,
    attempts=case when telegram_auth_rate_limits.window_started_at <= v_now-v_window then 1 else telegram_auth_rate_limits.attempts+1 end,
    touched_at=v_now
  where telegram_auth_rate_limits.window_started_at <= v_now-v_window or telegram_auth_rate_limits.attempts < v_max
  returning attempts into v_claim;
  return jsonb_build_object('ok',v_claim is not null);
end $$;
revoke all on function public.claim_telegram_auth_rate_limit(text,text) from public, anon, authenticated;
grant execute on function public.claim_telegram_auth_rate_limit(text,text) to service_role;
notify pgrst, 'reload schema';
