-- =====================================================================
-- Vera Portal — Handwerker/Partner duerfen die Liegenschaft/Einheit
-- ihres zugewiesenen Auftrags sehen.
-- Zweck:
--   job_assignments_own_or_admin erlaubt einem Handwerker/Partner
--   bereits, die eigene Auftragszeile zu sehen -- properties_scoped/
--   units_scoped kennen aber nur Mieter/Eigentuemer-Zugriff, nicht
--   "hat einen offenen Auftrag an diesem Objekt". Ohne diese Policy
--   bleibt property_id/unit_id in einer eingebetteten Abfrage (z.B.
--   "Meine Zuordnungen" im Dashboard) leer, obwohl der Auftrag selbst
--   sichtbar ist. Gleiches Muster wie properties_hauswart_read.
--
-- Ausfuehren im Supabase SQL Editor. Wiederholbar / idempotent.
-- =====================================================================

drop policy if exists properties_job_assignee_read on public.properties;
create policy properties_job_assignee_read on public.properties
  for select using (
    exists (
      select 1 from public.job_assignments ja
      where ja.property_id = properties.id
        and ja.profile_id = auth.uid()
        and ja.archived_at is null
    )
  );

drop policy if exists units_job_assignee_read on public.units;
create policy units_job_assignee_read on public.units
  for select using (
    exists (
      select 1 from public.job_assignments ja
      where ja.unit_id = units.id
        and ja.profile_id = auth.uid()
        and ja.archived_at is null
    )
  );
