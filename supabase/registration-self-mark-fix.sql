-- =====================================================================
-- Vera Portal — Selbst-Markierung "Registrierung abgeschlossen" reparieren
-- Zweck:
--   protect_profile_columns() sperrte portal_registered_at pauschal fuer
--   Nicht-Admins -- inklusive des Nutzers auf seiner EIGENEN Zeile. Genau
--   das braucht aber update-password.html direkt nach dem Passwort-Setzen
--   (client.from('profiles').update({portal_registered_at: now()})
--   .eq('id', session.user.id)), damit "Registrierung noch ausstehend"
--   im Admin-Kontaktmanager auf "abgeschlossen" wechselt. Der Fehler
--   wurde bisher in einem try/catch verschluckt -- die Markierung landete
--   nie in der Datenbank, unabhaengig davon wie viele Nutzer sich
--   registriert haben.
--
--   Fix: ein Nutzer darf portal_registered_at auf der eigenen Zeile genau
--   EINMAL von null auf einen Wert setzen (Registrierung abschliessen).
--   Zuruecksetzen, Vordatieren oder Aendern fremder Zeilen bleibt weiterhin
--   ausschliesslich Admin-Sache -- alle anderen Sperr-Spalten unveraendert.
--
-- Ausfuehren im Supabase SQL Editor. Wiederholbar / idempotent.
-- =====================================================================

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.portal_registered_at is distinct from old.portal_registered_at then
    if not (
      auth.uid() = old.id
      and old.portal_registered_at is null
      and new.portal_registered_at is not null
    ) then
      raise exception 'Nicht erlaubt: Status-/Rollen-/Archivfelder können nur vom Admin geändert werden.';
    end if;
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
    raise exception 'Nicht erlaubt: Status-/Rollen-/Archivfelder können nur vom Admin geändert werden.';
  end if;

  return new;
end;
$$;
