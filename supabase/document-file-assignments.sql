-- Dokumente und Ordner im Finder-/Explorer-Dateimanager optional
-- Objekten oder Wohnungen/Einheiten zuordnen.
--
-- Ausfuehren im Supabase SQL Editor, falls document_files bereits
-- existiert und diese Spalten noch fehlen.

alter table public.document_folders
  add column if not exists property_id uuid references public.properties(id) on delete set null;

alter table public.document_folders
  add column if not exists unit_id uuid references public.units(id) on delete set null;

alter table public.document_files
  add column if not exists property_id uuid references public.properties(id) on delete set null;

alter table public.document_files
  add column if not exists unit_id uuid references public.units(id) on delete set null;
