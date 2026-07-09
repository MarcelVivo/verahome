-- =====================================================================
-- Vera Portal — Termin-Archivierung statt unwiderruflichem Löschen
-- Zweck:
--   Interne Termine werden archiviert und verschwinden aus Kalender/Suche,
--   bleiben aber im Archiv und Audit nachvollziehbar. Archivierte Termine
--   blockieren keine öffentlichen Buchungsslots mehr.
--
-- Ausführen im Supabase SQL Editor. Wiederholbar / idempotent.
-- =====================================================================

alter table public.appointments add column if not exists archived_at timestamptz;
alter table public.appointments add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.appointments add column if not exists archived_reason text;

create index if not exists appointments_archived_at_idx on public.appointments(archived_at);

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

create or replace function public.get_available_slots(p_date date)
returns setof timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  duration interval := interval '60 minutes';
  wd public.weekday;
  win record;
  slot_start timestamptz;
  slot_end timestamptz;
begin
  if p_date < current_date then
    return;
  end if;
  if exists (select 1 from public.booking_blocked_dates where blocked_date = p_date) then
    return;
  end if;

  wd := (array['so','mo','di','mi','do','fr','sa'])[extract(dow from p_date)::int + 1];

  for win in
    select start_time, end_time from public.booking_availability where weekday = wd
  loop
    slot_start := p_date + win.start_time;
    while slot_start + duration <= p_date + win.end_time loop
      slot_end := slot_start + duration;
      if slot_start > now()
        and not exists (
          select 1 from public.bookings b
          where b.status in ('bestaetigt','angefragt') and b.starts_at < slot_end and b.ends_at > slot_start
        )
        and not exists (
          select 1 from public.booking_blocks k
          where k.starts_at < slot_end and k.ends_at > slot_start
        )
        and not exists (
          select 1 from public.appointments a
          where a.admin_participates
            and a.archived_at is null
            and a.starts_at < slot_end
            and a.ends_at > slot_start
        )
      then
        return next slot_start;
      end if;
      slot_start := slot_end;
    end loop;
  end loop;
  return;
end;
$$;

create or replace function public.create_booking(
  p_name text, p_email text, p_phone text, p_message text, p_starts_at timestamptz, p_property_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  duration interval := interval '60 minutes';
  slot_end timestamptz := p_starts_at + duration;
  wd public.weekday;
  slot_date date := p_starts_at::date;
  result public.bookings;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Name fehlt.';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'E-Mail fehlt.';
  end if;
  if p_starts_at < now() then
    raise exception 'Termin liegt in der Vergangenheit.';
  end if;
  if p_property_id is not null and not exists (
    select 1 from public.properties where id = p_property_id and visibility = 'public'
  ) then
    raise exception 'Objekt nicht gefunden.';
  end if;
  if exists (select 1 from public.booking_blocked_dates where blocked_date = slot_date) then
    raise exception 'An diesem Tag sind keine Termine verfügbar.';
  end if;

  wd := (array['so','mo','di','mi','do','fr','sa'])[extract(dow from slot_date)::int + 1];
  if not exists (
    select 1 from public.booking_availability
    where weekday = wd and start_time <= p_starts_at::time and end_time >= slot_end::time
  ) then
    raise exception 'Dieser Zeitpunkt liegt ausserhalb der Verfügbarkeit.';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.status in ('bestaetigt','angefragt') and b.starts_at < slot_end and b.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Termin ist leider bereits vergeben.';
  end if;

  if exists (
    select 1 from public.booking_blocks k
    where k.starts_at < slot_end and k.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Zeitpunkt ist gesperrt.';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.admin_participates
      and a.archived_at is null
      and a.starts_at < slot_end
      and a.ends_at > p_starts_at
  ) then
    raise exception 'Dieser Zeitpunkt ist bereits belegt.';
  end if;

  insert into public.bookings (name, email, phone, message, starts_at, ends_at, property_id)
  values (trim(p_name), trim(p_email), nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_message,'')),''), p_starts_at, slot_end, p_property_id)
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
    drop trigger if exists trg_audit_appointments on public.appointments;
    create trigger trg_audit_appointments
      after insert or update or delete on public.appointments
      for each row execute function public.audit_table_change();
  end if;
end;
$$;
