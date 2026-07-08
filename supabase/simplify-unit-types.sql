-- Vera Portal: Einheitstypen auf wenige Haupttypen vereinfachen
--
-- Im Supabase SQL Editor ausführen, damit die neue reduzierte
-- Auswahl im Portal gespeichert werden kann.

alter table public.units drop constraint if exists units_unit_type_check;

alter table public.units add constraint units_unit_type_check
  check (unit_type in (
    'wohnung',
    'zimmer',
    'gewerbe',
    'garage',
    'parkplatz',
    'lager',
    'sonstiges',

    -- alte Detailwerte bleiben vorerst erlaubt, damit bestehende
    -- Daten nicht brechen; im Portal werden sie automatisch in die
    -- Hauptgruppen einsortiert.
    'haus',
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
    'tiefgaragenplatz',
    'aussenparkplatz',
    'hobbyraum',
    'gastronomie'
  ));
