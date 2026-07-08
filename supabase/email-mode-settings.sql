-- Globaler E-Mail-Modus fuer Vera Portal.
-- mode = 'live'  -> Edge Functions versenden echte E-Mails.
-- mode = 'test'  -> Edge Functions speichern Daten, unterdruecken aber ausgehende E-Mails.

create table if not exists public.portal_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (key ~ '^[a-z0-9_:-]+$')
);

alter table public.portal_settings enable row level security;
alter table public.portal_settings force row level security;

drop policy if exists portal_settings_admin_select on public.portal_settings;
drop policy if exists portal_settings_admin_write on public.portal_settings;
drop policy if exists portal_settings_public_homepage_select on public.portal_settings;

create policy portal_settings_admin_select on public.portal_settings
  for select using (public.is_admin());

create policy portal_settings_public_homepage_select on public.portal_settings
  for select using (key = 'homepage_services');

create policy portal_settings_admin_write on public.portal_settings
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.portal_settings (key, value)
values ('outbound_email_mode', '{"mode":"live"}'::jsonb)
on conflict (key) do nothing;

insert into public.portal_settings (key, value)
values ('homepage_services', '{
  "items": [
    {"key":"stockwerkeigentum","visible":true,"title":"Stockwerkeigentum","text":"Eigentümerversammlungen, Budgetierung, Jahresrechnungen, Unterhaltsplanung, Versicherungswesen.","badge":"Kernleistung"},
    {"key":"mietverwaltung","visible":true,"title":"Liegenschafts Verwaltung","text":"Mietermanagement, Inkasso, Nebenkostenabrechnungen, Unterhaltskoordination, Wiedervermietungen.","badge":"Kernleistung"},
    {"key":"erstvermietung","visible":true,"title":"Erstvermietung","text":"Mietzinsfestlegung, Vermarktung, Bonitätsprüfung, Vertragsabwicklung und Übergabe.","badge":"Kernleistung"},
    {"key":"bauleitung","visible":true,"title":"Bauleitung","text":"Ausschreibungen, Offertvergleiche, Terminplanung, Kostenkontrolle, Qualitätsüberwachung.","badge":""},
    {"key":"immobilienverkauf","visible":true,"title":"Immobilienverkauf","text":"Marktwertschätzung, Verkaufsstrategie, Vermarktung und Begleitung, in Kooperation mit erfahrener Maklerin.","badge":"Kooperation"},
    {"key":"projektentwicklung","visible":false,"title":"Projektentwicklung","text":"Machbarkeitsanalysen, Begleitung von Neubauprojekten, Koordination mit Behörden.","badge":"Aufbauphase"}
  ]
}'::jsonb)
on conflict (key) do nothing;
