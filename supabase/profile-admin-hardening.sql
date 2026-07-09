-- =====================================================================
-- Vera Portal Profile Admin Hardening
-- Wiederholbar ausführbar im Supabase SQL Editor.
--
-- Ziel:
-- - Owner-Admin kontakt@marcelspahr.ch kann nicht versehentlich gesperrt,
--   archiviert, gelöscht oder demoted werden.
-- - Admins können sich nicht selbst archivieren.
-- - Kontakt-Archivierung läuft über eine kontrollierte RPC-Funktion.
-- =====================================================================

alter table public.profiles add column if not exists portal_invited_at timestamptz;
alter table public.profiles add column if not exists portal_registered_at timestamptz;
alter table public.profiles add column if not exists archived_at timestamptz;
alter table public.profiles add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists archived_reason text;

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
    raise exception 'Nicht erlaubt: Status-/Rollen-/Archivfelder können nur vom Admin geändert werden.';
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
