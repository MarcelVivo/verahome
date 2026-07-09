-- =====================================================================
-- Vera Portal — Archiv-Filter fuer bestehende SELECT-Policies nachziehen
-- Zweck:
--   properties_scoped/units_scoped/tenancies_own_or_admin/
--   ownerships_own_or_admin/job_assignments_own_or_admin/
--   appointments_participant_select wurden beim Einfuehren von
--   archived_at (soft-delete-core-records.sql, appointment-archive-
--   hardening.sql) nie um einen "archived_at is null"-Filter ergaenzt,
--   anders als invoices_select/laundry_*_select/property_announcements_
--   select. Folge: ein Mieter/Eigentuemer/Handwerker/Termin-Teilnehmer
--   sieht einen fuer ihn archivierten Datensatz weiterhin in seinem
--   eigenen Portal-Login. Admins sehen weiterhin alles (Archiv-Ansicht).
--
--   Zusaetzlich: properties_public_read/units_public_read (oeffentliche
--   Website-Anzeige) kannten archived_at ebenfalls nicht — ein
--   archiviertes, aber weiterhin "public" sichtbares Inserat blieb live
--   auf der Marketing-Seite abrufbar.
--
-- Ausfuehren im Supabase SQL Editor. Wiederholbar / idempotent.
-- =====================================================================

drop policy if exists properties_scoped on public.properties;
create policy properties_scoped on public.properties
  for select using (
    public.is_admin()
    or (
      archived_at is null
      and (
        exists (
          select 1 from public.units u
          join public.tenancies t on t.unit_id = u.id
          where u.property_id = properties.id
            and u.archived_at is null
            and t.archived_at is null
            and t.tenant_profile_id = auth.uid() and public.is_approved()
        )
        or exists (
          select 1 from public.ownerships o
          where (
              o.property_id = properties.id
              or o.unit_id in (select id from public.units where property_id = properties.id and archived_at is null)
            )
            and o.archived_at is null
            and o.owner_profile_id = auth.uid() and public.is_approved()
        )
      )
    )
  );

drop policy if exists units_scoped on public.units;
create policy units_scoped on public.units
  for select using (
    public.is_admin()
    or (
      archived_at is null
      and (
        exists (
          select 1 from public.tenancies t
          where t.unit_id = units.id and t.archived_at is null
            and t.tenant_profile_id = auth.uid() and public.is_approved()
        )
        or exists (
          select 1 from public.ownerships o
          where o.unit_id = units.id and o.archived_at is null
            and o.owner_profile_id = auth.uid() and public.is_approved()
        )
      )
    )
  );

drop policy if exists tenancies_own_or_admin on public.tenancies;
create policy tenancies_own_or_admin on public.tenancies
  for select using (
    public.is_admin() or (archived_at is null and tenant_profile_id = auth.uid() and public.is_approved())
  );

drop policy if exists ownerships_own_or_admin on public.ownerships;
create policy ownerships_own_or_admin on public.ownerships
  for select using (
    public.is_admin() or (archived_at is null and owner_profile_id = auth.uid() and public.is_approved())
  );

drop policy if exists job_assignments_own_or_admin on public.job_assignments;
create policy job_assignments_own_or_admin on public.job_assignments
  for select using (
    public.is_admin() or (archived_at is null and profile_id = auth.uid() and public.is_approved())
  );

-- appointments_admin_all (for all using is_admin()) already covers the
-- admin case as a separate permissive policy, so this one only needs
-- the archived_at filter added for the participant branch.
drop policy if exists appointments_participant_select on public.appointments;
create policy appointments_participant_select on public.appointments
  for select using (
    archived_at is null
    and exists (
      select 1 from public.appointment_participants ap
      where ap.appointment_id = appointments.id and ap.profile_id = auth.uid()
    )
  );

drop policy if exists properties_public_read on public.properties;
create policy properties_public_read on public.properties
  for select using (
    archived_at is null
    and (
      visibility = 'public'
      or exists (
        select 1 from public.units u
        where u.property_id = properties.id and u.visibility = 'public' and u.archived_at is null
      )
    )
  );

drop policy if exists units_public_read on public.units;
create policy units_public_read on public.units
  for select using (archived_at is null and visibility = 'public');
