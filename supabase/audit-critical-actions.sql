-- =====================================================================
-- Vera Portal Audit — kritische Datenänderungen automatisch protokollieren.
-- Diese Migration ist wiederholbar ausführbar.
-- =====================================================================

create or replace function public.audit_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  row_data jsonb := coalesce(new_row, old_row, '{}'::jsonb);
  changed_columns jsonb := '[]'::jsonb;
  entity_id text;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
    into changed_columns
    from (
      select key
      from (
        select jsonb_object_keys(coalesce(old_row, '{}'::jsonb) || coalesce(new_row, '{}'::jsonb)) as key
      ) keys
      where old_row->keys.key is distinct from new_row->keys.key
    ) changed;
  end if;

  entity_id := coalesce(
    row_data->>'id',
    nullif(concat_ws(':', row_data->>'profile_id', row_data->>'category'), ''),
    nullif(concat_ws(':', row_data->>'file_id', row_data->>'profile_id'), ''),
    nullif(concat_ws(':', row_data->>'property_id', row_data->>'profile_id', row_data->>'permission'), '')
  );

  insert into public.audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (
    auth.uid(),
    lower(tg_table_name) || '.' || lower(tg_op),
    tg_table_schema || '.' || tg_table_name,
    entity_id,
    jsonb_build_object(
      'operation', tg_op,
      'changed_columns', changed_columns,
      'old_record', case when tg_op in ('UPDATE', 'DELETE') then old_row else null end,
      'new_record', case when tg_op in ('INSERT', 'UPDATE') then new_row else null end
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
exception when others then
  -- Audit darf nie die eigentliche Fachaktion blockieren.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_profiles on public.profiles;
create trigger trg_audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_profile_role_assignments on public.profile_role_assignments;
create trigger trg_audit_profile_role_assignments
  after insert or update or delete on public.profile_role_assignments
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_properties on public.properties;
create trigger trg_audit_properties
  after insert or update or delete on public.properties
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_units on public.units;
create trigger trg_audit_units
  after insert or update or delete on public.units
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_tenancies on public.tenancies;
create trigger trg_audit_tenancies
  after insert or update or delete on public.tenancies
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_ownerships on public.ownerships;
create trigger trg_audit_ownerships
  after insert or update or delete on public.ownerships
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_job_assignments on public.job_assignments;
create trigger trg_audit_job_assignments
  after insert or update or delete on public.job_assignments
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_property_permissions on public.property_permissions;
create trigger trg_audit_property_permissions
  after insert or update or delete on public.property_permissions
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_document_files on public.document_files;
create trigger trg_audit_document_files
  after insert or update or delete on public.document_files
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_document_shares on public.document_shares;
create trigger trg_audit_document_shares
  after insert or update or delete on public.document_shares
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_invoices on public.invoices;
create trigger trg_audit_invoices
  after insert or update or delete on public.invoices
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_invoice_line_items on public.invoice_line_items;
create trigger trg_audit_invoice_line_items
  after insert or update or delete on public.invoice_line_items
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_appointments on public.appointments;
create trigger trg_audit_appointments
  after insert or update or delete on public.appointments
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_property_announcements on public.property_announcements;
create trigger trg_audit_property_announcements
  after insert or update or delete on public.property_announcements
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_laundry_schedule_slots on public.laundry_schedule_slots;
create trigger trg_audit_laundry_schedule_slots
  after insert or update or delete on public.laundry_schedule_slots
  for each row execute function public.audit_table_change();

drop trigger if exists trg_audit_laundry_bookings on public.laundry_bookings;
create trigger trg_audit_laundry_bookings
  after insert or update or delete on public.laundry_bookings
  for each row execute function public.audit_table_change();
