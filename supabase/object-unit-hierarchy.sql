-- Vera Portal: Objekt-/Einheiten-Hierarchie
-- Erweitert die erlaubten Einheitstypen fuer die neue Verwaltung
-- Gebäude -> Einheiten -> Rollen/Dokumente.
--
-- Im Supabase SQL Editor ausfuehren, falls beim Speichern von
-- Einheiten ein unit_type-Constraint-Fehler erscheint.

alter table public.units drop constraint if exists units_unit_type_check;

alter table public.units add constraint units_unit_type_check
  check (unit_type in (
    'wohnung',
    'einfamilienhaus',
    'reihenhaus',
    'doppelhaushaelfte',
    'villa',
    'maisonette',
    'attika',
    'penthouse',
    'triplex',
    'dachwohnung',
    'etagenwohnung',
    'loft',
    'einliegerwohnung',
    'zimmer_moebliert',
    'wohnung_moebliert',
    'studio',
    'garage',
    'tiefgaragenplatz',
    'aussenparkplatz',
    'hobbyraum',
    'lager',
    'gewerbe',
    'gastronomie',
    'sonstiges'
  ));
