# Vera Portal — Supabase Setup

Diese Anleitung richtet die Datenbank hinter dem "Vera Portal" (Login unter
`/portal/login.html`) ein. Sie muss nur **einmal** ausgeführt werden.

## 1. Schema einspielen

1. Supabase Dashboard öffnen → **SQL Editor**.
2. Inhalt von [`schema.sql`](./schema.sql) komplett hineinkopieren.
3. **Run** klicken. Das Skript legt alle Tabellen, Rollen-Logik und
   Zugriffsregeln (Row Level Security) in einem Rutsch an.

## 2. Zugangsdaten eintragen

Dashboard → **Project Settings → API**:
- **Project URL** und **anon/public key** kopieren (niemals den
  `service_role`-Key verwenden — der ist geheim und wird im Portal nicht
  gebraucht).
- Beide Werte in `public/js/supabase-config.js` eintragen:
  ```js
  window.VERA_SUPABASE_CONFIG = {
    url: "https://DEIN-PROJEKT.supabase.co",
    anonKey: "DEIN-ANON-KEY"
  };
  ```

## 3. Auth-Einstellungen prüfen

Dashboard → **Authentication → Providers → Email**:
- "Confirm email" **aktiviert lassen** (Nutzer müssen ihre E-Mail-Adresse
  bestätigen, bevor sie sich einloggen können).
- Minimale Passwortlänge auf **8** setzen (passt zur Prüfung im
  Registrierungsformular).

Dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://www.verahome.ch`
- **Redirect URLs**: zusätzlich `https://www.verahome.ch/portal/update-password.html`
  eintragen (und für lokale Tests `http://localhost:8080/portal/update-password.html`).

## 4. Region prüfen

Für den Umgang mit sensiblen Mieter-/Eigentümerdaten empfiehlt sich eine
**EU-Region** (z.B. Frankfurt) für das Supabase-Projekt. Die Region lässt
sich nach dem Erstellen des Projekts nicht mehr ändern — falls das Projekt
bereits in einer anderen Region liegt, bitte melden.

## 5. Neue Registrierungen — sofort aktiv

Neue Konten werden automatisch **sofort aktiv**, sobald die E-Mail-Adresse
bestätigt wurde — kein manueller Freigabe-Schritt nötig. `status` kann
weiterhin von Hand auf `pending` oder `suspended` gesetzt werden (Dashboard
→ **Table Editor → profiles**), falls du ein Konto später sperren möchtest.

## 6. Sich selbst als Admin einrichten

Es gibt nur einen Admin-Zugang (Julia). Kategorie "Admin" kann nicht über
das Registrierungsformular gewählt werden — aus Sicherheitsgründen ist das
serverseitig blockiert.

1. Einmal ganz normal über `/portal/register.html` registrieren (beliebige
   Kategorie wählen, z.B. "Eigentümer").
2. Dashboard → **Table Editor → profiles** → die eigene Zeile finden.
3. `category` auf `admin` und `status` auf `active` setzen.
4. Optional: im SQL Editor
   `select public.generate_member_number('admin');` ausführen und das
   Ergebnis (z.B. `AD-00001`) in `member_number` eintragen, damit die
   eigene Mitgliedsnummer auch als Admin-Nummer aussieht.

## 7. Dashboard-Erweiterung einspielen

Ein zweiter SQL-Block wurde an `schema.sql` angehängt (Admin-Schreibzugriff
auf Objekte/Einheiten/Mietverhältnisse/Eigentümerschaften/Auftragszuweisungen,
Nachrichten- und Kalender-Berechtigungen, das "Ausfüllen"-Feld bei Dokumenten,
sowie `get_admin_id()`/`mark_message_read()`). Falls dieser Block noch nicht
im SQL Editor ausgeführt wurde: öffne `schema.sql`, kopiere alles ab dem
Kommentar `VERA PORTAL DASHBOARD — ADDITIONS` bis zum Ende der Datei, und
führe es im SQL Editor aus.

Danach ist alles über die Oberfläche nutzbar — kein Table Editor mehr nötig:

- **`/portal/admin/properties.html`** — Objekte und Einheiten anlegen.
- **`/portal/admin/tenancies.html`** — Mietverhältnisse, Eigentümerschaften
  und Auftragszuweisungen (Partner/Handwerker) anlegen.
- **`/portal/documents.html`** (als Admin) — Dokument hochladen und einem
  Nutzer zuweisen, optional einem Mietverhältnis zugeordnet. Beispiel
  Wohnungsübergabe: zwei Dokumente anlegen — eines für den Auszüger
  (Aktionstyp "Unterschreiben"), eines für den Einzüger (Aktionstyp
  "Ausfüllen").
- **`/portal/messages.html`** / **`/portal/calendar.html`** — Nachrichten und
  Termine, sowohl als Admin (alle Nutzer/Termine) als auch als Nutzer
  (eigene Ansicht).
- **`/portal/admin/users.html`** — Nutzer aktivieren/sperren. Kategorie-
  Änderungen (insbesondere Admin-Rechte vergeben) bleiben bewusst ausserhalb
  der Oberfläche — das geht weiterhin nur manuell im Table Editor.

## 8. Kontakt-Adressen-Erweiterung einspielen

Falls die bestehende Datenbank bereits läuft, zusätzlich
[`contact-addresses-migration.sql`](./contact-addresses-migration.sql) im
Supabase SQL Editor ausführen. Das ergänzt zwei weitere Adressen pro Kontakt
und aktualisiert den Signup-Trigger, damit neu eingeladene Kontakte diese
Adressfelder direkt mitbekommen.

## 9. Registrierungsstatus für eingeladene Kontakte einspielen

Zusätzlich [`registration-status.sql`](./registration-status.sql) im
Supabase SQL Editor ausführen. Dadurch sieht der Admin in der Kontaktmaske,
ob ein eingeladener Kontakt sein Passwort bereits gesetzt hat
(`Nutzer aktiv`) oder ob die `Registrierung noch ausstehend` ist.

## Testen

Registrieren → E-Mail bestätigen → einloggen → Status "aktiv" sehen (kein
Warten mehr nötig). Zwei Testkonten anlegen und prüfen, dass keines die
Daten des anderen sehen kann — z.B. über `/portal/documents.html`: ein
Dokument für Testkonto A anlegen, als Testkonto B einloggen und bestätigen,
dass es dort nicht erscheint.

## Hinweis zu bereits bestehenden Testkonten

Falls du schon vor der "sofort aktiv"-Anpassung ein Testkonto registriert
hast, hängt es noch auf `status = pending` fest. Einmalig im SQL Editor
beheben:
```sql
update public.profiles set status = 'active' where status = 'pending';
```
