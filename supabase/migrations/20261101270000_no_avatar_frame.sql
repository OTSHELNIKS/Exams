-- The player can opt out of a decorative frame without altering existing loadouts.
insert into public.cosmetic_items (id, kind, label, req_kind, req_value, premium)
values ('frame-none', 'frame', 'Без рамки', 'always', 0, false)
on conflict (id) do update set kind = excluded.kind, label = excluded.label,
  req_kind = excluded.req_kind, req_value = excluded.req_value, premium = excluded.premium;
