-- Vera Portal — Registrierungsstatus für eingeladene Kontakte
-- Im Supabase SQL Editor ausführen.
--
-- Ziel:
-- - Admin sieht pro Kontakt, ob der Portal-Zugang bereits aktiv genutzt
--   werden kann ("Nutzer aktiv") oder ob die Registrierung/Passwortsetzung
--   noch aussteht.
-- - profiles.status bleibt weiterhin der technische Konto-Status
--   (active/pending/suspended) und wird nicht für den Einladungsfortschritt
--   zweckentfremdet.

alter table public.profiles
  add column if not exists portal_invited_at timestamptz,
  add column if not exists portal_registered_at timestamptz;

comment on column public.profiles.portal_invited_at is
  'Zeitpunkt, an dem ein Vera-Portal-Einladungs-/Passwortlink versendet oder erneut erzeugt wurde.';

comment on column public.profiles.portal_registered_at is
  'Zeitpunkt, an dem der Nutzer sein Passwort gesetzt und den Portal-Zugang abgeschlossen hat.';

create index if not exists profiles_portal_registered_at_idx
  on public.profiles(portal_registered_at);

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
     or new.portal_invited_at is distinct from old.portal_invited_at then
    raise exception 'Nicht erlaubt: Kategorie/Status/Mitgliedsnummer/Einladung können nur vom Admin geändert werden.';
  end if;
  return new;
end;
$$;

-- Bestmöglicher Backfill aus auth.users:
-- - invited_at/confirmation_sent_at markieren bestehende Einladungen.
-- - encrypted_password ist erst vorhanden, wenn ein Passwort gesetzt wurde.
--   Dann gilt der Zugang als registriert/aktiv.
update public.profiles p
set
  portal_invited_at = coalesce(
    p.portal_invited_at,
    u.invited_at,
    u.confirmation_sent_at,
    p.created_at
  ),
  portal_registered_at = coalesce(
    p.portal_registered_at,
    case
      when nullif(u.encrypted_password, '') is not null
      then coalesce(u.last_sign_in_at, u.email_confirmed_at, u.updated_at, now())
      else null
    end
  )
from auth.users u
where u.id = p.id
  and (
    p.portal_invited_at is null
    or p.portal_registered_at is null
  );
