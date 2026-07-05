# Datenschutz-Audit-Checkliste

Stand: 05. Juli 2026

Diese Checkliste ist ein technischer und organisatorischer Arbeitsstand für Vera Home Immobilien. Sie ersetzt keine anwaltliche Prüfung. Ziel ist, klar zu trennen, was aus dem Code ersichtlich ist, was Marcel/Julia intern bestätigen muss und was eine juristische Fachperson prüfen sollte.

## Status-Legende

- **Gefunden im Code:** Aus Repository, Supabase-Schema oder Frontend ersichtlich.
- **Von Vera Home bestätigen:** Muss im realen Betrieb, Dashboard oder Vertrag geprüft werden.
- **Juristisch prüfen:** Sollte vor produktiver Freigabe durch eine qualifizierte Schweizer Rechtsberatung beurteilt werden.

## 1. Betreiberangaben

| Punkt | Status | Befund / Aufgabe |
| --- | --- | --- |
| Offizieller Name | Von Vera Home bestätigen | Vera Home Immobilien, Einzelunternehmen Julia Allen. |
| Rechtsform | Von Vera Home bestätigen | Einzelunternehmen. |
| Vertretungsberechtigte Person | Von Vera Home bestätigen | Julia Allen. |
| Adresse | Von Vera Home bestätigen | Hauptstrasse 39, 5070 Frick, Schweiz. |
| Kontakt | Gefunden im Code | `welcome@verahome.ch`, `+41 76 336 84 38`. |
| MWST | Von Vera Home bestätigen | Aktuell nicht MWST-pflichtig. |
| Handelsregister / UID | Von Vera Home bestätigen | Nicht im Code vorhanden. Prüfen, ob eine UID existiert oder genannt werden soll. |

## 2. Externe Dienste und Anbieter

| Dienst | Status | Befund / Aufgabe |
| --- | --- | --- |
| Vercel | Von Vera Home bestätigen | Hosting laut Betreiberangabe. Projekt, Region, Log-Aufbewahrung und Vertrag/DPA prüfen. |
| Supabase | Von Vera Home bestätigen | Projekt nutzt `https://uulwvnoaszbnbhybssqr.supabase.co`; Region laut Angabe: Ireland. DPA, Subprozessoren, Backups, Auth-Logs und Storage-Region im Dashboard prüfen. |
| Google Fonts | Gefunden im Code | Fonts werden extern über `fonts.googleapis.com` / `fonts.gstatic.com` geladen. Prüfen, ob lokale Einbindung bevorzugt wird. |
| Google Maps | Gefunden im Code | Karte im Kontaktbereich über `maps.google.com`. Prüfen, ob Consent-Mechanismus oder statischer Link gewünscht ist. |
| CDNs | Gefunden im Code | `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `esm.sh` für JavaScript-Bibliotheken. Integrität, Drittlandtransfer und lokale Alternativen prüfen. |
| Instagram / Meta | Gefunden im Code | Externe Links auf Instagram. Keine Einbettung, aber Datenübertragung beim Anklicken durch Nutzer. |
| WhatsApp | Gefunden im Code | Externe Links auf `wa.me`. Datenübertragung beim Anklicken durch Nutzer. |
| E-Mail-Provider | Von Vera Home bestätigen | Aus Code nicht eindeutig erkennbar. Provider, DPA und Serverstandort prüfen. |
| Analytics / Tracking | Von Vera Home bestätigen | Im Code keine Google Analytics-/Meta-Pixel-Tags gefunden. Im Hosting und externen Tools trotzdem bestätigen. |

## 3. Öffentliche Website-Datenflüsse

| Bereich | Status | Befund / Aufgabe |
| --- | --- | --- |
| Kontaktformular | Gefunden im Code | Name, E-Mail, Telefon, Betreff, Nachricht, Datenschutz-Checkbox. Versand über `mailto:`. |
| Wohnungsbewerbung | Gefunden im Code | Name, E-Mail, Telefon, gewünschtes Objekt, Datei-Auswahl, Kurztext. Dateien werden laut Code nicht automatisch versendet, sondern müssen im E-Mail-Client angehängt werden. |
| Terminbuchung | Gefunden im Code | Name, E-Mail, Telefon, Nachricht, Objekt, Zeitpunkt. Buchung wird über Supabase-Funktion gespeichert. |
| Objektanzeige | Gefunden im Code | Öffentliche Objekte und Bilder werden aus Supabase geladen. |
| Karte | Gefunden im Code | Google Maps iframe im Kontaktbereich. |
| Datenschutz-Einwilligung | Gefunden im Code | Checkbox im Kontaktformular vorhanden. Prüfen, ob Datenschutzerklärung direkt im Text verlinkt werden soll. |

## 4. Vera Portal-Datenflüsse

| Bereich | Status | Befund / Aufgabe |
| --- | --- | --- |
| Registrierung / Login | Gefunden im Code | Supabase Auth, Profile, Kategorien, Mitgliedernummern, Status `pending/active/suspended`. |
| Profile | Gefunden im Code | Vorname, Nachname, Telefon, Kategorie, Adresse, Status, Mitgliedernummer, Genehmigungsdaten. |
| Liegenschaften / Einheiten | Gefunden im Code | Objekte, Einheiten, Sichtbarkeit, Bilder, Zuordnungen. |
| Mietverhältnisse / Eigentümerschaften | Gefunden im Code | Mieter-, Eigentümer-, Objekt- und Einheitenzuweisungen. |
| Dokumente | Gefunden im Code | Dokumenttitel, Kategorie, Status, Signatur-/Ausfüllstatus, private Storage-Buckets. |
| Nachrichten | Gefunden im Code | Sender, Empfänger, Inhalt, Lesestatus. |
| Termine / Kalender | Gefunden im Code | Kalenderereignisse, Buchungen, Verfügbarkeiten, Sperrdaten. |
| Schadensmeldungen | Gefunden im Code | Typ, Titel, Beschreibung, Status, Admin-Notiz, Fotos. |
| Hauswart-Rapporte | Gefunden im Code | Titel, Beschreibung, Objekt, Status, Fotos. |
| Rechnungen | Gefunden im Code | Rechnungen, Positionen, Zahlungsstatus, Bankangaben, wiederkehrende Rechnungen. |
| Nebenkostenabrechnungen | Gefunden im Code | Perioden, Kosten, Mieteranteile, generierte Rechnungen. |
| Waschplan | Gefunden im Code | Waschplan-Slots, Zuständigkeiten, Objektberechtigungen. |
| Admin-Tickets | Gefunden im Code | Interne Tickets, Status, Fotos. |

## 5. Datenkategorien mit erhöhtem Risiko

| Kategorie | Status | Aufgabe |
| --- | --- | --- |
| Bewerbungsunterlagen | Juristisch prüfen | Können Betreibungsregisterauszug, Lohn-/Bonitätsangaben oder weitere sensible Informationen enthalten. Zweck, Zugriff, Aufbewahrung und Löschung konkret regeln. |
| Schadens- und Rapportfotos | Juristisch prüfen | Können private Wohnräume, Personen oder persönliche Gegenstände zeigen. Zugriff und Speicherfristen prüfen. |
| Rechnungen und Bankdaten | Juristisch prüfen | Finanzdaten und Zahlungsstatus. Rollen, Zugriff und Export prüfen. |
| Portal-Dokumente | Juristisch prüfen | Können Verträge, Übergabeprotokolle, persönliche Angaben und Unterschriften enthalten. |
| Nachrichten | Juristisch prüfen | Können vertrauliche Inhalte enthalten. Interne Zugriffsbeschränkung dokumentieren. |

## 6. Zugriff, Rollen und Berechtigungen

| Punkt | Status | Befund / Aufgabe |
| --- | --- | --- |
| Row Level Security | Gefunden im Code | Supabase-Schema aktiviert RLS für zentrale Tabellen und Storage-Buckets. |
| Rollen | Gefunden im Code | Kategorien u.a. `admin`, `mieter`, `eigentuemer`, `partner`, `handwerker`, `hauswart`. |
| Admin-Rechte | Juristisch prüfen | Klären, wer Admin-Zugang erhält und wie Zugriffe protokolliert oder intern geregelt werden. |
| Genehmigungsprozess | Gefunden im Code | Profile haben Status und Genehmigungsfelder. Realen Prozess dokumentieren. |
| Storage-Zugriffe | Gefunden im Code | Private Buckets für Dokumente/Fotos; öffentliche Objektbilder. RLS-Policies und Signed URLs prüfen. |
| Offboarding | Von Vera Home bestätigen | Prozess für Austritt von Mitarbeitenden, Partnern und Hauswarten definieren. |

## 7. Aufbewahrung und Löschung

| Punkt | Status | Aufgabe |
| --- | --- | --- |
| Standardfrist | Von Vera Home bestätigen | Angegeben: 10 Jahre. Prüfen, ob für alle Datenarten angemessen. |
| Bewerbungsdaten nicht angenommener Bewerber | Juristisch prüfen | Wahrscheinlich kürzere Frist sinnvoll. Konkrete Löschregel definieren. |
| Kontaktanfragen | Juristisch prüfen | Frist nach Zweck definieren, z.B. Anfrage erledigt plus interne Nachfrist. |
| Portal-Dokumente und Rechnungen | Juristisch prüfen | 10 Jahre kann für geschäftliche Unterlagen plausibel sein; Datenarten einzeln prüfen. |
| Fotos aus Meldungen/Rapporten | Juristisch prüfen | Löschfrist nach Fallabschluss definieren. |
| Technische Logs | Von Vera Home bestätigen | Vercel/Supabase Log-Aufbewahrung prüfen und dokumentieren. |
| Löschprozess | Von Vera Home bestätigen | Wer löscht wann, wie wird Löschung dokumentiert, was passiert mit Backups? |

## 8. Verträge und Nachweise

| Nachweis | Status | Aufgabe |
| --- | --- | --- |
| Supabase DPA | Von Vera Home bestätigen | Abschliessen/ablegen; Region Ireland und Subprozessoren dokumentieren. |
| Vercel DPA | Von Vera Home bestätigen | Abschliessen/ablegen; Serverstandorte und Logs dokumentieren. |
| E-Mail-Provider DPA | Von Vera Home bestätigen | Provider identifizieren und Vertrag prüfen. |
| Google-Dienste | Juristisch prüfen | Fonts/Maps datenschutzrechtlich beurteilen; lokale Fonts oder Consent-Alternative prüfen. |
| CDN-Dienste | Juristisch prüfen | Externe Script-Lieferung beurteilen; lokale Auslieferung oder Subresource Integrity prüfen. |
| Interne Weisungen | Von Vera Home bestätigen | Zugriffsregeln, Passwortrichtlinie, Datenlöschung und Incident-Prozess schriftlich festhalten. |

## 9. Technische To-dos aus dem Codebefund

| Priorität | Aufgabe | Begründung |
| --- | --- | --- |
| Hoch | Datenschutz-Link direkt im Kontaktformular-Text anklickbar machen. | Nutzer sollen die Erklärung unmittelbar vor Einwilligung erreichen. |
| Hoch | Bewerbungsunterlagen-Prozess konkretisieren. | Aktuell Datei-Auswahl, aber Versand per Mailto erfordert manuelles Anhängen; rechtlich und UX-seitig unklar. |
| Hoch | Supabase/Vercel DPA und Region im Betreiberordner ablegen. | Grundlage für Auftragsbearbeitung und Auskunft gegenüber Betroffenen. |
| Mittel | Google Fonts lokal hosten oder bewusst dokumentieren. | Reduziert externe Datenübertragung beim Seitenaufruf. |
| Mittel | Google Maps erst nach Nutzeraktion laden oder statischen Link nutzen. | Reduziert Drittanbieterübertragung ohne Interaktion. |
| Mittel | CDN-Skripte lokal hosten oder SRI einsetzen. | Reduziert Abhängigkeiten und Drittanbieterzugriffe. |
| Mittel | Löschfristen je Datenart technisch abbilden. | 10 Jahre ist pauschal; nicht jede Datenart braucht gleich lange Aufbewahrung. |
| Mittel | Admin-/Partner-Offboarding dokumentieren. | Verhindert unnötige Zugriffe nach Rollenwechsel. |
| Niedrig | Datenschutzerklärung mit konkreten DPA-/Providerdetails nachpflegen. | Der aktuelle Text ist allgemein, kann mit bestätigten Verträgen präziser werden. |

## 10. Fragen für die anwaltliche Prüfung

1. Reicht die Anbieterkennzeichnung für ein Einzelunternehmen ohne MWST-Pflicht und ohne UID-Angabe?
2. Ist die pauschale Aufbewahrungsfrist von 10 Jahren für alle Portal- und Kommunikationsdaten zulässig oder zu weit?
3. Welche Datenarten aus Bewerbungen gelten im konkreten Prozess als besonders schützenswert?
4. Muss für Google Maps, Google Fonts oder CDN-Skripte ein Consent-Mechanismus eingebaut werden?
5. Sind Supabase Ireland und Vercel mit den vorgesehenen Verträgen und Subprozessoren ausreichend abgedeckt?
6. Müssen Betroffene gesondert über öffentliche Objektbilder, Portalrollen oder Dokumentzugriffe informiert werden?
7. Welche Mindestprozesse braucht Vera Home für Auskunft, Berichtigung, Löschung und Datenpannen?
8. Ist die Datenschutzerklärung für Mieter, Eigentümer, Partner, Handwerker und Hauswarte verständlich genug?

## 11. Nächste sinnvolle Schritte

1. Supabase- und Vercel-DPA sowie E-Mail-Provider-DPA beschaffen und ablegen.
2. Supabase-Projektregion, Auth-/Storage-/Backup-Einstellungen mit Screenshots dokumentieren.
3. Rollenmatrix erstellen: Wer darf welche Portal-Daten sehen, bearbeiten, löschen und exportieren?
4. Löschkonzept je Datenart definieren, insbesondere Bewerbungen, Fotos, Nachrichten und Logs.
5. Datenschutz-Link im Kontaktformular direkt verlinken.
6. Entscheidung treffen: Google Fonts/Maps/CDNs extern lassen, lokal hosten oder per Consent laden.
7. Rechtstexte mit Anwalt anhand dieser Checkliste final prüfen lassen.
