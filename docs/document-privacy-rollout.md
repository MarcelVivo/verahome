# Dokumentzugriff – Änderung vom 5. September 2026

## Stand

Die Dokumentrechte wurden am **5. September 2026 live aktiviert**. Die Migration `document_privacy_explicit_permissions` ist eingespielt; `send-document-share` Version 4 und `notify-document-share` Version 1 sind aktiv und verlangen weiterhin ein gültiges JWT. Der veröffentlichte gemeinsame Funktionscode wurde mit der lokalen Quelle verglichen.

Der erste Migrationsversuch wurde wegen eines nicht erlaubten `ALTER TABLE storage.objects` vollständig zurückgerollt. Die korrigierte Migration prüft das von Supabase verwaltete Storage-RLS ausdrücklich und bricht bei fehlendem Schutz ab. Auf den fünf eigenen Tabellen aktiviert sie RLS selbst. Alle vier restriktiven Guards und die drei privaten Dokument-Buckets sind live bestätigt. Hintergrund: [Supabase-Beschränkungen für verwaltete Schemas](https://github.com/orgs/supabase/discussions/34270).

Der Servercheck liefert im aktiven Admin-Kontext `true`; damit ist die bisherige Frontend-Sperre aufgehoben. Echte Tabellen-RLS und Listen-RPCs wurden in einer schreibgeschützten Transaktion mit `authenticated`/`anon` und den vorhandenen Profilkontexten geprüft: Admin darf lesen, Nichtadmin ohne Freigabe sowie archivierte und anonyme Konten sehen keine Dokumente. Der ältere Dokumentabschluss verweigert archivierte/anonyme Zugriffe mit SQLSTATE `42501`. Ein gesperrtes, nicht archiviertes Profil war live nicht vorhanden; dieser Fall ist durch lokale PostgreSQL-Tests abgedeckt.

Datensatzanzahlen blieben unverändert: ein Dokument, keine persönlichen Freigaben, 40 Storage-Objekte insgesamt. Das vorhandene Dokument ist somit nur für aktive Admins sichtbar. Es wurden keine echten Nachrichten versendet und keine produktiven Geschäftsdaten für Tests verändert. Eine vollständige Abnahme mit angemeldeten Testkonten über Storage-HTTP sowie eine Daten-/Dateiwiederherstellung bleiben separate, noch nicht durchgeführte Betriebsprüfungen.

## Verhalten nach Aktivierung

- Dokumentenablage (`document_files`): aktive, nicht archivierte Admins und ausdrücklich freigegebene aktive Kontakte. Gebäude, Wohnung, Kontakt, Ordner und Rollen erzeugen keine zusätzlichen Freigaben. `is_private_admin` bleibt eine Ablagezuordnung; vorhandene persönliche Freigaben bleiben auch beim Verschieben erhalten.
- Neue Dateien erhalten zunächst keine persönlichen Freigaben. Bei gezieltem Upload in eine Mieterakte wird die ausdrücklich ausgewählte Person freigegeben. Der Dokumentenmanager hat einen separaten Schritt „Freigeben“.
- Ein Mieterwechsel überträgt keine privaten Akten. Der bisherige Mieter behält seine ausdrücklich freigegebenen Unterlagen, bis Julia die Freigabe entzieht oder das Konto sperrt. Eine Sperre/Archivierung des Kontos verhindert auch Zugriffe mit noch gültiger Sitzung.
- Alte `property_documents` mit `restricted` benötigen eine persönliche Freigabe, auch für Hauswarte. Alte `public`-Dokumente bleiben Hausinformationen für aktuelle Mieter/Eigentümer/Hauswarte der Liegenschaft. Beginn und Ende werden berücksichtigt. Diese Altbestände müssen inhaltlich geprüft werden; „public“ ist keine automatische Einstufung als harmlos.
- Die drei Dokument-Buckets werden privat. Eine zusätzliche restriktive Storage-Policy verhindert, dass ältere großzügige SELECT-Policies die Regel umgehen. Öffentliche Inseratbilder bleiben unverändert.
- „Wer kann dieses Dokument öffnen?“ listet die vom Server ermittelten Personen und gesperrte Freigaben auf. Einzelne Freigaben können entzogen werden. Administration bleibt derzeit global; eine Beschränkung einzelner Verwaltungsmitarbeiter auf ihre Mandate ist noch nicht implementiert.
- E-Mails zu Freigaben enthalten nur einen Portal-Link, keine Dateianhänge, Dokumenttitel oder signierten Direktlinks. Externe E-Mail-Empfänger benötigen künftig einen Portal-Kontakt. Office-Dateien werden auf dem eigenen Gerät geöffnet; kein automatischer Microsoft-Viewer.

## Aktivierung

1. `supabase/document-privacy-audit.sql` im richtigen Projekt ausführen; insbesondere **alle** Policies, SECURITY-DEFINER-RPCs und private Bucket-Einstellungen prüfen. Vorher Backup/Snapshot nach dem vorhandenen Betriebsverfahren prüfen. Keine Testdaten mit realen Personen vermischen.
2. `supabase/document-privacy.sql` als vollständige Transaktion ausführen. Sie löscht keine Dokumente, Verknüpfungen oder Freigaben. Bestehende Dateien ohne persönliche Freigaben werden für Nicht-Admins unsichtbar; Julia muss benötigte Freigaben gezielt vergeben. Doppelte Storage-Pfade aus dem Audit vor Abschluss prüfen: mehrere Datensätze dürfen nicht widersprüchliche Freigaben für dieselben Bytes darstellen.
3. Beide Edge Functions `notify-document-share` und `send-document-share` mit dem gemeinsamen Modul `_shared/document-share.ts` deployen. Der alte Name bleibt für ältere Clients abgesichert. Nicht nur die neue Funktion veröffentlichen: Der bisherige Endpoint versendet sonst weiterhin Kopien. Das neue Frontend ruft ausschließlich den neuen Namen auf und meldet fehlende Benachrichtigung als Fehler.
4. Audit erneut ausführen. Mit einer aktiven Admin-Sitzung muss `document_privacy_ready()` `true` zurückgeben. Dieser Rolloutcheck ersetzt kein Audit unbekannter zusätzlicher RPCs.
5. Isolierte Live-Testkonten und eindeutig markierte Dateien verwenden: Mieter A, Nachbar, Nachmieter B, Eigentümer, Hauswart, Handwerker, gesperrtes Konto, Admin. Metadaten, Listen-RPC, direkte Storage-Downloads und Erstellen signierter Links prüfen. Vorher und nachher Freigabe entziehen, Konto sperren, Mieterwechsel durchführen. Es dürfen **keine echten E-Mails** ausgelöst werden. Nur eigene Testdaten anschließend entfernen.
6. Erst nach erfolgreicher Prüfung echte vertrauliche Akten wieder neu freigeben. Bei Fehlern die betroffene Regel gezielt korrigieren; die alten großzügigen Scope-Regeln nicht als pauschales Rollback reaktivieren.

## Tests und Grenzen

`tests/document-privacy.test.cjs` führt die produktive Migration in echtem PostgreSQL via PGlite aus, inklusive Rollen, RLS, SECURITY DEFINER, Storage-Objektregeln, konkurrierend großzügigen Alt-Policies, Sperren, Entzug, Mieterwechsel und wiederholter Migration. Das ersetzt **keinen realen Supabase-Storage-HTTP-Test**.

Temporäre Test-Abhängigkeiten: `@electric-sql/pglite` und `typescript@5.9.3`. Ausführung mit `PGLITE_MODULE=/pfad/node_modules/@electric-sql/pglite TYPESCRIPT_MODULE=/pfad/node_modules/typescript node --test tests/*.test.cjs`. Browserprüfung: `PLAYWRIGHT_MODULE=/pfad/playwright-core node tests/document-access-browser.cjs` (Chromium und WebKit).

Signierte Links bleiben bis zu ihrer Ablaufzeit nutzbar. Neue UI-Links verwenden 60 Sekunden; früher ausgestellte Links können länger gelten. Bereits heruntergeladene oder per alter E-Mail versandte Kopien sind nicht rückholbar. Das bestehende Öffnungsprotokoll ist eine Best-Effort-Protokollierung und kein vollständiger Nachweis aller direkten Storage-Downloads. Andere Fachmodule (Rechnungen, Schadenmeldungen, Signaturaufträge, Nachrichten usw.) benötigen jeweils eigene weitere Berechtigungsprüfungen; diese Änderung ist keine Aussage über vollständige DSG-Konformität.

Technische Grundlagen: [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [Supabase private Downloads und signierte URLs](https://supabase.com/docs/guides/storage/serving/downloads).


## Fortsetzung und Live-Abgleich (5. September 2026)

- Beim Verknüpfen vorhandener Dateien bleiben persönliche Freigaben erhalten. Eine ausdrücklich zusätzlich gewählte Person wird mit einem einzelnen konfliktfesten Insert ergänzt; Bestätigungen und gleichzeitig ergänzte Freigaben werden nicht überschrieben. Ohne neue Person werden keine Freigaben geschrieben. Die Oberfläche erklärt dies und wählt für bestehende Dokumente keinen Empfänger automatisch vor.
- Der ältere RPC `complete_document(uuid,text)` prüft jetzt aktive, nicht archivierte Konten. Live existiert nur diese Signatur; kein alter Ein-Parameter-Overload wurde gefunden. Die Migration stellt aktives RLS auf allen sechs betroffenen Tabellen sicher und prüft im Readiness-RPC auch den Schutz von `document_shares`.
- Der lesende Live-Abgleich ergab ein Dokument in `document_files`, keine persönlichen Freigaben, keine doppelten Dateipfade und keine Einträge in den beiden älteren Dokumenttabellen. Nach Aktivierung bleibt das vorhandene Dokument ausschliesslich für aktive Admins zugänglich, bis eine persönliche Freigabe gesetzt wird. Die Migration legt solche Freigaben nicht automatisch an.
- Vor der Aktivierung war `send-document-share` in Version 3 aktiv und `notify-document-share` noch nicht deployed. Beide wurden inzwischen wie oben beschrieben veröffentlicht. Die lokalen DeepSign-Funktionen sind im Projekt nicht deployed; ihre separate Rechteprüfung bleibt vor einer späteren Aktivierung erforderlich.
- Der vorherige Berechtigungsstand (Funktionsdefinitionen, Policies, RLS-/Bucket-Einstellungen, Datensatzanzahlen und bisheriger E-Mail-Funktionscode) wurde ausserhalb des Git-Repositories unter `../work/document-privacy-rollout-2026-09-05/permissions-before.json` gesichert. Das ist eine Konfigurationssicherung, kein vollständiges Datenbank- oder Dateibackup.
- Prüfstand: **154 Node-Tests und 48 Browserprüfungen** in Chromium/WebKit bei 320, 393 und 1440 Pixeln bestanden. Die neuen Tests führen die echten Zuordnungs-Handler mit simuliertem Backend aus; der ältere Dokumentabschluss wird in PostgreSQL geprüft. Die Tests versenden keine echten Nachrichten und ändern keine produktiven Geschäftsdaten.

Nach ausdrücklicher Freigabe durch den Betreiber wurden Migration und beide Serverfunktionen live aktiviert. Der Quellcode enthält auch die Korrektur zum Erhalt bestehender Freigaben beim Zuordnen.
