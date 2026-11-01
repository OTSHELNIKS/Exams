-- Realtime respects the existing authenticated SELECT policy on this public
-- appearance-only table. Entitlements and private profile data are not published.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cosmetic_loadout'
     ) then
    alter publication supabase_realtime add table public.cosmetic_loadout;
  end if;
end;
$$;
