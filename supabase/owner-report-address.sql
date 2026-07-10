-- =====================================================================
-- Vera Portal — Adresse zum Owner-Report hinzufuegen (fuer Lageplan)
-- Zweck:
--   get_owner_property_report() lieferte bisher nur Ertrag/Kosten,
--   keine Adresse -- owner-report.html kann so keine Karte je Objekt
--   zeigen. Aendert nur den Rueckgabetyp (zusaetzliche Spalten
--   street/zip/city), die Berechnungslogik bleibt unveraendert.
--   Signatur bleibt gleich (p_year int), daher erst DROP noetig --
--   "create or replace" erlaubt keine Aenderung des Rueckgabetyps.
--
-- Ausfuehren im Supabase SQL Editor. Wiederholbar / idempotent.
-- =====================================================================

drop function if exists public.get_owner_property_report(int);

create function public.get_owner_property_report(p_year int default null)
returns table (
  property_id    uuid,
  property_label text,
  unit_id        uuid,
  unit_label     text,
  street         text,
  zip            text,
  city           text,
  income         numeric,
  costs          numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  yr int := coalesce(p_year, extract(year from current_date)::int);
begin
  if not public.is_approved() then
    return;
  end if;

  return query
  select
    coalesce(o.property_id, un.property_id) as property_id,
    prop.label as property_label,
    o.unit_id as unit_id,
    un.label as unit_label,
    prop.street as street,
    prop.zip as zip,
    prop.city as city,
    coalesce((
      select sum(i.total) from public.invoices i
      where i.status = 'bezahlt' and i.category = 'miete'
        and extract(year from i.issue_date) = yr
        and (
          (o.unit_id is not null and i.unit_id = o.unit_id) or
          (o.unit_id is null and i.property_id = o.property_id)
        )
    ), 0) as income,
    coalesce((
      select sum(i.total) from public.invoices i
      where i.status = 'bezahlt' and i.category in ('schaden_reparatur','handwerkerrechnung')
        and extract(year from i.issue_date) = yr
        and (
          (o.unit_id is not null and i.unit_id = o.unit_id) or
          (o.unit_id is null and i.property_id = o.property_id)
        )
    ), 0) as costs
  from public.ownerships o
  left join public.units un on un.id = o.unit_id
  left join public.properties prop on prop.id = coalesce(o.property_id, un.property_id)
  where o.owner_profile_id = auth.uid()
    and (o.end_date is null or o.end_date >= current_date);
end;
$$;

grant execute on function public.get_owner_property_report(int) to authenticated;
