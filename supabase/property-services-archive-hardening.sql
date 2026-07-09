-- =====================================================================
-- Vera Portal — Rundschreiben und Waschplan archivieren statt löschen
-- Zweck:
--   Rundschreiben, fixe Waschplan-Slots und Waschplan-Buchungen bleiben
--   nachvollziehbar erhalten. Aktive Ansichten zeigen nur nicht archivierte
--   Einträge. Stornierte Waschplan-Buchungen blockieren keine neuen Buchungen.
--
-- Ausführen im Supabase SQL Editor. Wiederholbar / idempotent.
-- =====================================================================

alter table public.property_announcements add column if not exists archived_at timestamptz;
alter table public.property_announcements add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.property_announcements add column if not exists archived_reason text;

alter table public.laundry_schedule_slots add column if not exists archived_at timestamptz;
alter table public.laundry_schedule_slots add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.laundry_schedule_slots add column if not exists archived_reason text;

alter table public.laundry_bookings add column if not exists archived_at timestamptz;
alter table public.laundry_bookings add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.laundry_bookings add column if not exists archived_reason text;

create index if not exists property_announcements_archived_at_idx on public.property_announcements(archived_at);
create index if not exists laundry_schedule_slots_archived_at_idx on public.laundry_schedule_slots(archived_at);
create index if not exists laundry_bookings_archived_at_idx on public.laundry_bookings(archived_at);

do $$
begin
  alter table public.laundry_bookings
    drop constraint if exists laundry_bookings_property_id_booking_date_period_tenant_profile_id_key;
exception when others then
  null;
end;
$$;

create unique index if not exists laundry_bookings_active_unique_idx
  on public.laundry_bookings(property_id, booking_date, period, tenant_profile_id)
  where archived_at is null;

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

drop policy if exists property_announcements_select on public.property_announcements;
create policy property_announcements_select on public.property_announcements
  for select using (
    archived_at is null
    and (
      public.is_admin()
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = property_announcements.property_id
          and t.tenant_profile_id = auth.uid() and t.status = 'active' and public.is_approved()
      )
      or exists (
        select 1 from public.ownerships o
        where (
          o.property_id = property_announcements.property_id
          or o.unit_id in (select id from public.units where property_id = property_announcements.property_id)
        )
        and o.owner_profile_id = auth.uid()
        and (o.end_date is null or o.end_date >= current_date)
        and public.is_approved()
      )
    )
  );

drop policy if exists property_announcements_select_hauswart on public.property_announcements;
create policy property_announcements_select_hauswart on public.property_announcements
  for select using (archived_at is null and public.has_property_permission(property_announcements.property_id, 'hauswart'));

drop policy if exists property_announcements_select_scoped on public.property_announcements;

drop policy if exists laundry_schedule_slots_select on public.laundry_schedule_slots;
create policy laundry_schedule_slots_select on public.laundry_schedule_slots
  for select using (
    archived_at is null
    and (
      public.is_admin()
      or public.has_property_permission(laundry_schedule_slots.property_id, 'waschplan')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = laundry_schedule_slots.property_id
          and t.tenant_profile_id = auth.uid() and public.is_approved()
      )
    )
  );

drop policy if exists laundry_schedule_slots_select_hauswart on public.laundry_schedule_slots;
create policy laundry_schedule_slots_select_hauswart on public.laundry_schedule_slots
  for select using (archived_at is null and public.has_property_permission(laundry_schedule_slots.property_id, 'hauswart'));

drop policy if exists laundry_bookings_select on public.laundry_bookings;
create policy laundry_bookings_select on public.laundry_bookings
  for select using (
    archived_at is null
    and (
      public.is_admin()
      or public.has_property_permission(laundry_bookings.property_id, 'waschplan')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = laundry_bookings.property_id
          and t.tenant_profile_id = auth.uid() and public.is_approved()
      )
    )
  );

create or replace function public.check_laundry_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_count int;
begin
  select laundry_machine_count into v_capacity from public.properties where id = new.property_id;

  select count(*) into v_count
  from public.laundry_schedule_slots
  where property_id = new.property_id
    and weekday = new.weekday
    and start_time = new.start_time
    and end_time = new.end_time
    and archived_at is null
    and id is distinct from new.id;

  if v_count >= coalesce(v_capacity, 2) then
    raise exception 'Für diesen Halbtag sind bereits alle Waschmaschinen/Tumbler vergeben.';
  end if;

  return new;
end;
$$;

create or replace function public.create_laundry_booking(
  p_property_id uuid, p_booking_date date, p_period text
)
returns public.laundry_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_count int;
  v_unit_id uuid;
  result public.laundry_bookings;
begin
  if p_period not in ('vormittag', 'nachmittag') then
    raise exception 'Ungültiger Zeitraum.';
  end if;
  if p_booking_date < current_date then
    raise exception 'Datum liegt in der Vergangenheit.';
  end if;

  select laundry_machine_count into v_capacity
  from public.properties
  where id = p_property_id and laundry_mode = 'self_service';
  if v_capacity is null then
    raise exception 'Für dieses Objekt ist kein Waschplan-Kalender aktiv.';
  end if;

  select u.id into v_unit_id
  from public.units u
  join public.tenancies t on t.unit_id = u.id
  where u.property_id = p_property_id and t.tenant_profile_id = auth.uid()
    and t.status in ('active', 'upcoming')
  limit 1;

  if v_unit_id is null and not public.is_admin() then
    raise exception 'Sie sind keinem Mietverhältnis in diesem Objekt zugeordnet.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_property_id::text || p_booking_date::text || p_period));

  if exists (
    select 1 from public.laundry_bookings
    where property_id = p_property_id and booking_date = p_booking_date and period = p_period
      and tenant_profile_id = auth.uid()
      and archived_at is null
  ) then
    raise exception 'Sie sind für diesen Zeitraum bereits eingetragen.';
  end if;

  select count(*) into v_count
  from public.laundry_bookings
  where property_id = p_property_id and booking_date = p_booking_date and period = p_period
    and archived_at is null;

  if v_count >= v_capacity then
    raise exception 'Dieser Zeitraum ist bereits ausgebucht.';
  end if;

  insert into public.laundry_bookings (property_id, unit_id, tenant_profile_id, booking_date, period)
  values (p_property_id, v_unit_id, auth.uid(), p_booking_date, p_period)
  returning * into result;

  return result;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'audit_table_change'
  ) then
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
  end if;
end;
$$;

-- Badge-Zähler ebenfalls aktualisieren: archivierte Rundschreiben/Waschplan-Slots
-- erzeugen keine neuen Hinweise mehr.
create or replace function public.get_unread_counts()
returns table(section text, unread_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  am_admin boolean;
  c_messages int;
  c_invoices int;
  c_meldungen int;
  c_documents int;
  c_announcements int;
  c_calendar int;
  c_waschplan int;
  c_tickets int;
  c_rapporte int;
  c_termine int;
begin
  if me is null then
    return;
  end if;

  am_admin := public.is_admin();

  select count(*) into c_messages
  from public.messages
  where recipient_profile_id = me and read_at is null;

  select count(*) into c_invoices
  from public.invoices
  where recipient_profile_id = me
    and issuer_profile_id <> me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'invoices'),
      '-infinity'::timestamptz
    );

  if am_admin then
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_meldungen
    from public.issue_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'meldungen'),
        '-infinity'::timestamptz
      );
  end if;

  if am_admin then
    c_documents := 0;
  else
    select count(*) into c_documents
    from public.document_shares ds
    where ds.profile_id = me
      and ds.created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
        '-infinity'::timestamptz
      );
  end if;

  select count(*) into c_announcements
  from public.property_announcements pa
  where pa.archived_at is null
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'documents'),
      '-infinity'::timestamptz
    )
    and (
      exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = pa.property_id
          and t.tenant_profile_id = me and t.status = 'active' and public.is_approved()
      )
      or exists (
        select 1 from public.ownerships o
        where (o.property_id = pa.property_id or o.unit_id in (select id from public.units where property_id = pa.property_id))
          and o.owner_profile_id = me
          and (o.end_date is null or o.end_date >= current_date)
          and public.is_approved()
      )
      or public.has_property_permission(pa.property_id, 'hauswart')
    );

  c_documents := c_documents + c_announcements;

  select count(*) into c_calendar
  from public.calendar_events
  where profile_id = me
    and created_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'calendar'),
      '-infinity'::timestamptz
    );

  select count(*) into c_waschplan
  from public.laundry_schedule_slots l
  where l.archived_at is null
    and l.updated_at > coalesce(
      (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'waschplan'),
      '-infinity'::timestamptz
    )
    and l.created_by is distinct from me
    and (
      am_admin
      or public.has_property_permission(l.property_id, 'waschplan')
      or public.has_property_permission(l.property_id, 'hauswart')
      or exists (
        select 1 from public.units u
        join public.tenancies t on t.unit_id = u.id
        where u.property_id = l.property_id
          and t.tenant_profile_id = me and public.is_approved()
      )
    );

  if am_admin then
    select count(*) into c_tickets
    from public.admin_tickets
    where (
      (created_by <> me and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
      or
      (updated_by is distinct from me and updated_at > created_at and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'tickets'),
        '-infinity'::timestamptz
      ))
    );
  else
    c_tickets := 0;
  end if;

  if am_admin then
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id <> me
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  else
    select count(*) into c_rapporte
    from public.hauswart_reports
    where reporter_profile_id = me
      and updated_at > created_at
      and updated_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'rapporte'),
        '-infinity'::timestamptz
      );
  end if;

  if am_admin then
    select count(*) into c_termine
    from public.bookings
    where status in ('bestaetigt','angefragt')
      and created_at > coalesce(
        (select sv.last_seen_at from public.section_views sv where sv.profile_id = me and sv.section = 'termine'),
        '-infinity'::timestamptz
      );
  else
    c_termine := 0;
  end if;

  return query values
    ('messages',  c_messages),
    ('invoices',  c_invoices),
    ('meldungen', c_meldungen),
    ('documents', c_documents),
    ('calendar',  c_calendar),
    ('waschplan', c_waschplan),
    ('tickets',   c_tickets),
    ('rapporte',  c_rapporte),
    ('termine',   c_termine);
end;
$$;
