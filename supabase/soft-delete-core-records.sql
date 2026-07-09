-- =====================================================================
-- Vera Portal Soft-Delete — wichtige Geschäftsdaten werden archiviert
-- statt endgültig gelöscht. Wiederholbar ausführbar.
-- =====================================================================

alter table public.profiles add column if not exists portal_invited_at timestamptz;
alter table public.profiles add column if not exists portal_registered_at timestamptz;
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

alter table public.appointments add column if not exists archived_at timestamptz;
alter table public.appointments add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.appointments add column if not exists archived_reason text;

alter table public.property_announcements add column if not exists archived_at timestamptz;
alter table public.property_announcements add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.property_announcements add column if not exists archived_reason text;

alter table public.laundry_schedule_slots add column if not exists archived_at timestamptz;
alter table public.laundry_schedule_slots add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.laundry_schedule_slots add column if not exists archived_reason text;

alter table public.laundry_bookings add column if not exists archived_at timestamptz;
alter table public.laundry_bookings add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.laundry_bookings add column if not exists archived_reason text;

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
     or new.portal_registered_at is distinct from old.portal_registered_at
     or new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by
     or new.archived_reason is distinct from old.archived_reason then
    raise exception 'Nicht erlaubt: Status-/Archivfelder können nur vom Admin geändert werden.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_columns on public.profiles;
create trigger trg_protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

create or replace function public.protect_owner_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_email constant text := 'kontakt@marcelspahr.ch';
begin
  if tg_op = 'DELETE' then
    if lower(coalesce(old.email, '')) = owner_email then
      raise exception 'Der Owner-Admin darf nicht gelöscht werden.';
    end if;
    return old;
  end if;

  if lower(coalesce(old.email, new.email, '')) = owner_email
     or lower(coalesce(new.email, old.email, '')) = owner_email then
    if lower(coalesce(new.email, '')) <> owner_email
       or new.category <> 'admin'
       or new.status <> 'active'
       or new.archived_at is not null then
      raise exception 'Der Owner-Admin muss aktiv bleiben und darf nicht archiviert oder demoted werden.';
    end if;
  end if;

  if auth.uid() = old.id
     and (
       new.category is distinct from old.category
       or new.status is distinct from old.status
       or new.archived_at is distinct from old.archived_at
     ) then
    raise exception 'Das eigene Admin-Konto kann nicht deaktiviert, demoted oder archiviert werden.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_owner_admin_profile on public.profiles;
create trigger trg_protect_owner_admin_profile
  before update or delete on public.profiles
  for each row execute function public.protect_owner_admin_profile();

create or replace function public.archive_profile(p_profile_id uuid, p_reason text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles;
  result public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt.';
  end if;

  if p_profile_id = auth.uid() then
    raise exception 'Das eigene Admin-Konto kann nicht archiviert werden.';
  end if;

  select *
  into target
  from public.profiles
  where id = p_profile_id;

  if not found then
    raise exception 'Kontakt nicht gefunden.';
  end if;

  if lower(coalesce(target.email, '')) = 'kontakt@marcelspahr.ch' then
    raise exception 'Der Owner-Admin kann nicht archiviert werden.';
  end if;

  update public.profiles
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(nullif(p_reason, ''), 'Kontakt archiviert'),
      status = 'suspended'
  where id = p_profile_id
    and archived_at is null
  returning * into result;

  return coalesce(result, target);
end;
$$;

create or replace function public.set_profile_roles(p_profile_id uuid, p_categories public.profile_category[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt.';
  end if;

  select *
  into target
  from public.profiles
  where id = p_profile_id;

  if not found then
    raise exception 'Kontakt nicht gefunden.';
  end if;

  if lower(coalesce(target.email, '')) = 'kontakt@marcelspahr.ch' then
    raise exception 'Owner-Admin-Rollen dürfen nicht über die Kontaktmaske geändert werden.';
  end if;

  if coalesce(array_length(p_categories, 1), 0) = 0 then
    raise exception 'Mindestens eine Kategorie ist erforderlich.';
  end if;

  delete from public.profile_role_assignments
  where profile_id = p_profile_id;

  insert into public.profile_role_assignments (profile_id, category)
  select p_profile_id, category
  from unnest(p_categories) as category
  on conflict do nothing;
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
create index if not exists appointments_archived_at_idx on public.appointments(archived_at);
create index if not exists property_announcements_archived_at_idx on public.property_announcements(archived_at);
create index if not exists laundry_schedule_slots_archived_at_idx on public.laundry_schedule_slots(archived_at);
create index if not exists laundry_bookings_archived_at_idx on public.laundry_bookings(archived_at);

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

create or replace function public.archive_appointment(p_appointment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt.';
  end if;

  update public.appointments
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(p_reason, 'Termin archiviert')
  where id = p_appointment_id
    and archived_at is null;
end;
$$;

create or replace function public.archive_property_announcement(p_announcement_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nicht erlaubt.';
  end if;

  update public.property_announcements
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(p_reason, 'Rundschreiben archiviert')
  where id = p_announcement_id
    and archived_at is null;
end;
$$;

create or replace function public.archive_laundry_schedule_slot(p_slot_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.is_admin()
    or exists (
      select 1
      from public.laundry_schedule_slots s
      where s.id = p_slot_id
        and public.has_property_permission(s.property_id, 'waschplan')
    )
  ) then
    raise exception 'Nicht erlaubt.';
  end if;

  update public.laundry_schedule_slots
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(p_reason, 'Waschplan-Slot archiviert')
  where id = p_slot_id
    and archived_at is null;
end;
$$;

create or replace function public.cancel_laundry_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.laundry_bookings b
    where b.id = p_booking_id
      and b.archived_at is null
      and (
        b.tenant_profile_id = auth.uid()
        or public.is_admin()
        or public.has_property_permission(b.property_id, 'waschplan')
      )
  ) then
    raise exception 'Nicht erlaubt.';
  end if;

  update public.laundry_bookings
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(p_reason, 'Waschplan-Buchung storniert')
  where id = p_booking_id
    and archived_at is null;
end;
$$;

create or replace function public.archive_invoice(p_invoice_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.invoices
  set archived_at = now(),
      archived_by = auth.uid(),
      archived_reason = coalesce(p_reason, 'Rechnung archiviert')
  where id = p_invoice_id
    and archived_at is null
    and status in ('entwurf', 'bezahlt', 'storniert')
    and (issuer_profile_id = auth.uid() or public.is_admin());

  if not found then
    raise exception 'Rechnung nicht gefunden, offene Rechnung nicht archivierbar oder keine Berechtigung.';
  end if;
end;
$$;
