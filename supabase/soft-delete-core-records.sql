-- =====================================================================
-- Vera Portal Soft-Delete — wichtige Geschäftsdaten werden archiviert
-- statt endgültig gelöscht. Wiederholbar ausführbar.
-- =====================================================================

alter table public.profiles add column if not exists archived_at timestamptz;
alter table public.profiles add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists archived_reason text;

alter table public.properties add column if not exists archived_at timestamptz;
alter table public.properties add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.properties add column if not exists archived_reason text;

alter table public.units add column if not exists archived_at timestamptz;
alter table public.units add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.units add column if not exists archived_reason text;

alter table public.tenancies add column if not exists archived_at timestamptz;
alter table public.tenancies add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.tenancies add column if not exists archived_reason text;

alter table public.ownerships add column if not exists archived_at timestamptz;
alter table public.ownerships add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.ownerships add column if not exists archived_reason text;

alter table public.job_assignments add column if not exists archived_at timestamptz;
alter table public.job_assignments add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.job_assignments add column if not exists archived_reason text;

alter table public.document_folders add column if not exists archived_at timestamptz;
alter table public.document_folders add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.document_folders add column if not exists archived_reason text;

alter table public.document_files add column if not exists archived_at timestamptz;
alter table public.document_files add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.document_files add column if not exists archived_reason text;

alter table public.invoices add column if not exists archived_at timestamptz;
alter table public.invoices add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.invoices add column if not exists archived_reason text;

alter table public.property_appliances add column if not exists archived_at timestamptz;
alter table public.property_appliances add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.property_appliances add column if not exists archived_reason text;

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.category is distinct from old.category
     or new.status is distinct from old.status
     or new.member_number is distinct from old.member_number
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.portal_invited_at is distinct from old.portal_invited_at
     or new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by
     or new.archived_reason is distinct from old.archived_reason then
    raise exception 'Nicht erlaubt: Status-/Archivfelder können nur vom Admin geändert werden.';
  end if;
  return new;
end;
$$;

create index if not exists profiles_archived_at_idx on public.profiles(archived_at);
create index if not exists properties_archived_at_idx on public.properties(archived_at);
create index if not exists units_archived_at_idx on public.units(archived_at);
create index if not exists tenancies_archived_at_idx on public.tenancies(archived_at);
create index if not exists ownerships_archived_at_idx on public.ownerships(archived_at);
create index if not exists job_assignments_archived_at_idx on public.job_assignments(archived_at);
create index if not exists document_folders_archived_at_idx on public.document_folders(archived_at);
create index if not exists document_files_archived_at_idx on public.document_files(archived_at);
create index if not exists invoices_archived_at_idx on public.invoices(archived_at);
create index if not exists property_appliances_archived_at_idx on public.property_appliances(archived_at);

create or replace function public.archive_document_folder(p_folder_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt.';
  end if;

  with recursive folder_tree as (
    select id from public.document_folders where id = p_folder_id
    union all
    select child.id
    from public.document_folders child
    join folder_tree parent on child.parent_id = parent.id
  )
  update public.document_folders
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(p_reason, 'Archiviert')
  where id in (select id from folder_tree);

  with recursive folder_tree as (
    select id from public.document_folders where id = p_folder_id
    union all
    select child.id
    from public.document_folders child
    join folder_tree parent on child.parent_id = parent.id
  )
  update public.document_files
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(p_reason, 'Archiviert')
  where folder_id in (select id from folder_tree);
end;
$$;

create or replace function public.archive_document_file(p_file_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt.';
  end if;

  update public.document_files
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(p_reason, 'Dokument archiviert')
  where id = p_file_id
    and archived_at is null;
end;
$$;
