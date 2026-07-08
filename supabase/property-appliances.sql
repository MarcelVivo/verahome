-- Vera Portal: fix eingebaute Geräte pro Liegenschaft oder Einheit
--
-- Beispiele:
-- - Liegenschaft: Waschmaschine, Tumbler, Lift, Heizung
-- - Einheit: Kochherd, Kühlschrank, Backofen, Mikrowelle
--
-- Im Supabase SQL Editor ausführen.

create table if not exists public.property_appliances (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties(id) on delete cascade,
  unit_id        uuid references public.units(id) on delete cascade,
  category       text not null,
  label          text not null,
  manufacturer   text,
  model          text,
  serial_number  text,
  installed_at   date,
  maintenance_at date,
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id)
);

alter table public.property_appliances enable row level security;
alter table public.property_appliances force row level security;

drop policy if exists property_appliances_admin_all on public.property_appliances;
create policy property_appliances_admin_all on public.property_appliances
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists property_appliances_scoped_select on public.property_appliances;
create policy property_appliances_scoped_select on public.property_appliances
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.units u
      join public.tenancies t on t.unit_id = u.id
      where u.property_id = property_appliances.property_id
        and (property_appliances.unit_id is null or property_appliances.unit_id = u.id)
        and t.tenant_profile_id = auth.uid()
        and t.status = 'active'
        and public.is_approved()
    )
    or exists (
      select 1 from public.ownerships o
      where o.owner_profile_id = auth.uid()
        and public.is_approved()
        and (
          o.property_id = property_appliances.property_id
          or (property_appliances.unit_id is not null and o.unit_id = property_appliances.unit_id)
        )
    )
    or public.has_property_permission(property_appliances.property_id, 'hauswart')
  );
