# Vera Portal Abnahmedurchlauf – 10.07.2026

Ziel: Vera Portal fachlich, technisch, datenschutzbezogen und mobil auf produktionsnahe Nutzung prüfen.

## Automatisierte Prüfungen

- [x] Git-Arbeitsbaum geprüft; keine unerwarteten tracked Änderungen vor Start.
- [x] Alle lokalen HTML-Inline-Skripte und JS-Dateien syntaktisch geprüft.
- [x] Interne `href`-/`src`-Referenzen geprüft; keine fehlenden lokalen Ziele gefunden.
- [x] Mobile/Capacitor-Webassets mit `npm run mobile:prepare` erfolgreich erzeugt.
- [x] Supabase-/RLS-Dateien gegen Portal-Tabellen/RPCs inventarisiert.

## Kritische Prozessbereiche

- [x] Dokument öffnen: Fehler werden sichtbar gemeldet.
- [x] Nachrichten laden/senden: zentrale Fehlerfälle werden sichtbar gemeldet.
- [x] Dashboard laden: technische Fehler werden konkret angezeigt.
- [x] Rechnungen: Positionen, E-Mail-Status, CAMT-Unsicherheit und Warnungen gehärtet.
- [x] Termine/Tickets/Dokumentfreigaben: E-Mail-Testmodus/Fehlerstatus sichtbar.
- [x] Meldungen/Rapporte: Foto-Upload-Teilfehler sichtbar.
- [x] Waschplan: Slot-Erfassung gegen Lade-/Doppelsubmit-Fehler gehärtet.

## Noch manuell in Supabase/Browser abzunehmen

- [ ] Admin `kontakt@marcelspahr.ch`: Vollzugriff, Portal-Editor sichtbar.
- [ ] Admin `welcome@verahome.ch`: kein Portal-Editor, fachliche Admin-Funktionen sichtbar.
- [ ] Mieter: nur eigene Einheit, eigene Dokumente, eigene Rechnungen, eigene Nachrichten.
- [ ] Eigentümer: nur eigene Liegenschaft/Einheit und freigegebene Dokumente.
- [ ] Hauswart: nur zugewiesene Liegenschaften, Rapporte, Meldungen, relevante Dokumente.
- [ ] Dokument-Upload in Objekte erzeugt korrekte Ablage unter Dokumente.
- [ ] Dokument-Upload in Dokumente erzwingt Zuordnung oder Admin-Ablage.
- [ ] E-Mail-Aus: keine externen Mails, UI zeigt Testmodus.
- [ ] E-Mail-Ein: Einladung/Rechnung/Dokument/Termin/Ticket werden korrekt versendet.
- [ ] iPhone Safari: Navigation, Modale, Dokument-Upload, Kalender, Objekte, Nachrichten.
- [ ] iPad/Tablet: Seitenleisten, Modale, Tabellen, Dokumentvorschau.

## Offene technische Abnahmepunkte

- [ ] Edge Functions live deployed und Versionen mit Repo abgeglichen.
- [ ] Supabase RLS Policies direkt mit Testnutzern geprüft.
- [ ] Storage Buckets `document-vault`, `property-images`, `message-attachments`, Report-Fotos mit RLS geprüft.
- [ ] Datenqualitäts-Kacheln im Dashboard mit echten Testdaten validiert.
- [ ] Portal-/Homepage-Editor mit Speichern, Löschen, Ausblenden und Rollenrechten getestet.

## Ergebnis dieses Durchlaufs

Der statische Code- und Mobile-Build-Abnahmeteil ist erfolgreich. Für die finale Produktionsfreigabe bleibt zwingend die manuelle Rollen-/RLS-/Storage-Abnahme mit echten Supabase-Testnutzern offen.
