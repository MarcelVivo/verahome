-- Objekt-Aktenplan: STWEG/Mietobjekt und Dokument-Aktenkategorien
-- Im Supabase SQL Editor ausführen.

alter table public.properties
  add column if not exists property_type text not null default 'mietobjekt';

alter table public.properties
  drop constraint if exists properties_property_type_check;

alter table public.properties
  add constraint properties_property_type_check
  check (property_type in ('mietobjekt', 'stweg'));

alter table public.document_files
  add column if not exists archive_category text;

alter table public.document_folders
  add column if not exists archive_category text;

create index if not exists document_files_archive_category_idx
  on public.document_files (archive_category);

create index if not exists document_files_property_archive_idx
  on public.document_files (property_id, unit_id, archive_category);
