-- Vera Portal — Pflicht-Zuordnung fuer Dokumente und parallele Ablage
-- Im Supabase SQL Editor ausführen.
--
-- Ergänzt Dokumente/Ordner um:
-- - Kontakt-Zuordnung
-- - "Admin"-private Ablage
-- - stabile Suchindizes für Objekt-/Wohnungs-/Kontaktakten

alter table public.document_folders
  add column if not exists property_id uuid references public.properties(id) on delete set null,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists contact_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists is_private_admin boolean not null default false,
  add column if not exists archive_category text;

alter table public.document_files
  add column if not exists property_id uuid references public.properties(id) on delete set null,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists contact_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists is_private_admin boolean not null default false,
  add column if not exists archive_category text;

create index if not exists document_folders_property_idx
  on public.document_folders(property_id);

create index if not exists document_folders_unit_idx
  on public.document_folders(unit_id);

create index if not exists document_folders_contact_idx
  on public.document_folders(contact_profile_id);

create index if not exists document_files_property_idx
  on public.document_files(property_id);

create index if not exists document_files_unit_idx
  on public.document_files(unit_id);

create index if not exists document_files_contact_idx
  on public.document_files(contact_profile_id);

create index if not exists document_files_private_admin_idx
  on public.document_files(is_private_admin)
  where is_private_admin = true;

create index if not exists document_folders_archive_category_idx
  on public.document_folders(archive_category);

create index if not exists document_files_archive_category_idx
  on public.document_files(archive_category);

comment on column public.document_folders.contact_profile_id is
  'Kontaktakte, falls dieser Ordner direkt einem Kontakt zugeordnet ist.';

comment on column public.document_files.contact_profile_id is
  'Kontaktakte, falls diese Datei direkt einem Kontakt zugeordnet ist.';

comment on column public.document_folders.is_private_admin is
  'Private Admin-Ablage: Dokument ist bewusst keinem Objekt, keiner Einheit und keinem Kontakt zugeordnet.';

comment on column public.document_files.is_private_admin is
  'Private Admin-Ablage: Dokument ist bewusst keinem Objekt, keiner Einheit und keinem Kontakt zugeordnet.';

comment on column public.document_folders.archive_category is
  'Aktenbereich im parallelen Objekt-/Dokumenten-Schema, z.B. stweg_verwaltung oder unit_mieter.';

comment on column public.document_files.archive_category is
  'Aktenbereich im parallelen Objekt-/Dokumenten-Schema, z.B. stweg_verwaltung oder unit_mieter.';

notify pgrst, 'reload schema';
