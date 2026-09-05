# Vera Portal: Ausbauplan

Stand: 5. September 2026. Dieser Plan hält den besprochenen Zweck des Portals fest. Die folgenden Ausbaustufen sind noch keine Beschreibung fertig implementierter Funktionen.

## Ziel und Arbeitsweise

Vera Portal bildet den gesamten Verwaltungsablauf ab: Liegenschaften, Einheiten, Menschen, Unternehmen, Verträge, Dokumente, Geräte, Aufgaben, Schäden und Geldflüsse sind nachvollziehbar miteinander verbunden. Julia arbeitet hauptsächlich auf dem iPhone und erfasst häufig neue Gebäude und Wohnungen. Die Bedienung zeigt ihr den aktuellen Zusammenhang und den nächsten sinnvollen Schritt; das vollständige Datenmodell bleibt dahinter erhalten.

Bestehende Daten, Zuordnungen, Nummern und Funktionen werden schrittweise übernommen. Kein vollständiger Neubau und kein Austausch des vorhandenen Portals auf einmal. Nach abgeschlossenen Prüfungen werden Änderungen gemäss Nutzerauftrag committet, nach `main` gepusht und live überprüft. Änderungen an Datenbank, Storage und Edge Functions benötigen jeweils eine eigene Prüfung ihres tatsächlichen Deploymentstands.

Automationen führen eindeutige, konfigurierte Regeln aus. Fehlende Informationen, widersprüchliche Zuordnungen und benötigte Freigaben erscheinen bei Julia als konkrete Aufgabe. Ein wiederholter technischer Versuch darf keine zweite Rechnung, Zahlung oder Nachricht erzeugen.

## Fachliches Modell

| Bereich | Datensätze und Beziehungen |
| --- | --- |
| Bestand | Mandat/Verwaltungszuständigkeit → Liegenschaft → Gebäude, sofern mehrere vorhanden → Einheit oder Gemeinschaftsraum. Wohnungen, Studios, Zimmer, Gewerbe, Garagen, Parkplätze und weitere Typen bleiben unterscheidbar. |
| Personen und Organisationen | Ein Kontakt pro Person oder Organisation; Portalzugang optional und getrennt. Beschäftigte, Bevollmächtigte, Haushaltsmitglieder und Vertragspartner erhalten eigene Beziehungen. |
| Beteiligung | Eigentum, Bewohnung, Mietvertrag, Hauswartzuständigkeit und Dienstleistungsauftrag sind unterschiedliche Beziehungen mit Geltungsbereich und Beginn/Ende. Eine Person kann mehrere gleichzeitig besitzen. |
| Verträge | Miet- und Verwaltungsverträge mit mehreren Beteiligten, Versionen, Laufzeit, Konditionen, Kaution, Unterlagen und Unterschriften. Eigentümerbewohnung setzt keinen Mietvertrag voraus. |
| Räume und Geräte | Gemeinschaftliche Waschküche und Technikraum sind eigene Standorte. Geräte haben Hersteller, Modell, Seriennummer, Standortverlauf, Inbetriebnahme, Garantie, Wartung, Fotos und Anleitungen. Ersatzgeräte überschreiben die Geschichte des Vorgängers nicht. |
| Dokumente | Ein Dokument mit Versionen und mehreren fachlichen Verknüpfungen statt Dateikopien pro Bildschirm. Separate Regeln bestimmen, wer es sehen, herunterladen, bearbeiten, freigeben oder unterschreiben darf. |
| Fälle und Aufgaben | Schadensfall, betroffene Einheiten/Geräte, Termine, Angebote, Teilaufträge, Handwerker, Rapporte, Abnahme, Rechnungen und Kommunikation sind miteinander verknüpft. Ein Fall kann mehrere Aufträge und Rechnungen enthalten. |
| Finanzen | Forderung an Mieter/Eigentümer/Versicherer, Lieferantenrechnung, Kostenverteilung, Zahlungseingang, Zahlungsausgang, Gutschrift und Rückerstattung sind getrennte Vorgänge. Eine Verrechnung ersetzt keinen belegten Geldfluss. |
| Nachvollziehbarkeit | Änderungen, Freigaben, Zustellungen und Automationsversuche besitzen Zeitpunkt, Auslöser, Ergebnis und Bezug zum jeweiligen Datensatz. |

Jeder fachliche Datensatz bekommt eine dauerhafte, lesbare Zuordnungsnummer. Bestehende interne IDs und externe Referenzen bleiben erhalten. Neue Nummern werden zentral und nebenläufigkeitssicher erzeugt, nicht aus der Anzahl sichtbarer Datensätze. Verknüpfungen funktionieren in beide Richtungen und zeigen nur Inhalte, auf die die Person Zugriff hat.

Beispiel: Ein Eigentümer bewohnt Wohnung A, vermietet Wohnung B und betreut Haus C als Hauswart. Diese drei Beziehungen sind getrennt. Eine globale Rolle „Eigentümer“ gibt ihm keinen Zugriff auf Unterlagen aller Eigentümer oder auf private Akten der Mieter von B.

## Julias Bedienung auf dem iPhone

Der häufigste Einstieg „Liegenschaft erfassen“ bekommt einen kurzen Ablauf:

1. Adresse und Art der Liegenschaft erfassen; eine verständliche Bezeichnung vorschlagen.
2. Einheiten gesammelt anlegen, beispielsweise sechs Wohnungen und vier Parkplätze. Typen, Namen und Stockwerke bleiben einzeln änderbar. Auch ein Gebäude ohne bereits bekannte Einheiten darf als unvollständig gespeichert werden.
3. Eingaben prüfen und intern speichern. Anschliessend gezielt Personen, Verträge, Geräte und Dokumente ergänzen.

Eine bestehende Liegenschaft führt direkt zu ihren Einheiten. Die Detailansicht bündelt Übersicht, Beteiligte, Dokumente, Geräte und Vorgänge mit verständlichen Rückwegen. Der Kontext wird bei neuen Einträgen übernommen. Lange Gesamtformulare werden durch passende Einzelaktionen ersetzt; weiterführende Felder bleiben erreichbar.

Entwürfe, unterbrochene Mobilverbindungen, erneutes Speichern und Kamera-Uploads werden ausdrücklich berücksichtigt. Sensible Entwürfe werden nicht ungeschützt im öffentlichen Offline-Cache abgelegt. Kontaktvorschläge vermeiden doppelte Personen. Julia sieht vor einer Dokumentfreigabe ausdrücklich „Wer kann das sehen?“. QR-Einstiege für Geräte und Räume sind eine spätere Ergänzung.

## Abläufe, die vollständig zusammenpassen müssen

### Mieterwechsel

Auszug planen → Räume, Schäden, Zählerstände und Schlüssel dokumentieren → Übergabe bestätigen → bisherige Bewohnung und Mietzuordnung zeitlich abschliessen → neue Bewohnung und Vertrag aktivieren → Freigaben und Rechnungslauf anpassen → offene Aufgaben und Kautionsabwicklung verfolgen.

Die historische Akte bleibt dem damaligen Verhältnis zugeordnet. Ein Nachmieter erhält keine privaten Dokumente des Vormieters. Hauswartzuständigkeiten und gemeinschaftliche Raumzuordnungen bestehen unabhängig vom Wechsel weiter. Rückdatierte Änderungen und überschneidende Verträge werden sichtbar geprüft.

### Schadensfall und Handwerker

Meldung mit Fotos und Ort → Julia prüft Zuständigkeit und Dringlichkeit → Angebot beziehungsweise Auftrag → Termin und Bearbeitung → Handwerker reicht Rapport, Fotos und Rechnung ein → Julia nimmt die Arbeit ab → Kosten werden bestätigt verteilt → Forderungen und Lieferantenrechnung werden bearbeitet → nach belegten Zahlungen finanzieller Abschluss.

„Handwerker fertig“, „Arbeit abgenommen“ und „finanziell abgeschlossen“ sind unterschiedliche Zustände. Meldende Person, Auftraggeber, Leistungsempfänger und Kostenträger können verschieden sein. Mehrere Gewerke, Teilrechnungen, Nacharbeit, Ablehnung, Versicherungsanteil und Selbstbehalt müssen abbildbar sein.

### Miete und Zahlung

Vertragsgültigkeit und Konditionen prüfen → periodische Rechnung einmalig erzeugen → zustellen und Zustellung protokollieren → tatsächliche Zahlung zuordnen → Restbetrag berechnen → konfigurierte Erinnerung nur für tatsächlich fälligen, offenen und nicht pausierten Betrag.

Teilzahlungen, Überzahlungen, Vorauszahlungen, Gutschriften, Raten, Mietzinsänderungen und Teilmonate sind eigene Fälle. Eine passende Rechnungsnummer allein bestätigt keine vollständige Zahlung. Unklare Bankbuchungen bleiben zur Prüfung offen. Zahlungsfreigabe, technischer Bankauftrag und bestätigte Ausführung werden getrennt geführt.

### Wiederkehrender Betrieb

Waschplan mit festen oder buchbaren Zeiten, kollisionsfreie gemeinsame Gerätebelegung, Wartungsintervalle, auslaufende Garantien und Verträge sowie offene Unterschriften erzeugen passende Aufgaben. Fristen, Zuständigkeiten, Stellvertretung, Benachrichtigungskanal und Eskalation sind konfigurierbar. Nachrichten bleiben mit ihrem fachlichen Vorgang verbunden.

Eigentümergemeinschaften können später Versammlungen, Traktanden, Vollmachten, Beschlüsse, Protokolle, Budgets und Erneuerungsfonds erhalten. Die fachlichen Abstimmungs- und Berechnungsregeln werden vor ihrer Automatisierung festgelegt.

## Rechte und Datenübernahme

Bestehende Profile, Zusatzrollen, Miet-/Eigentumszuordnungen, Objektberechtigungen, Dokumentfreigaben, RLS-Policies, private Storage-Buckets und Auditdaten werden berücksichtigt. Auswahlmöglichkeiten in der Oberfläche erteilen selbst keine neuen Zugriffsrechte.

Fachliche Kontakte sind heute an Login-Profile gebunden; die Trennung von Kontakt und optionalem Zugang ist deshalb ein eigener Migrationsschritt. Die primäre Admin-Eigenschaft bleibt von zusätzlichen fachlichen Rollen getrennt. Bestehende Mitglieds-/Rechnungsnummern, Dateipfade, Signatur-/Bestätigungsdaten und kontrollierte Statusübergänge bleiben erhalten.

Seit der Live-Aktivierung vom 5. September 2026 verwendet die Dokumentenablage ausdrücklich persönliche Freigaben; Objekt-, Einheits- und Kontaktzuordnungen erzeugen keine zusätzlichen Leserechte. Die früher abgeleiteten Freigaben wurden durch `supabase/document-privacy.sql` ersetzt; `supabase/document-vault-scoped-access.sql` bleibt ein Hinweis für ältere Installationsabläufe. Tabellen-, Datei- und neu signierte Downloadzugriffe verwenden dieselben Berechtigungsregeln. Aktiver Stand, historische Hausinformationen und Grenzen bereits ausgestellter Links sind im [Rolloutbericht](document-privacy-rollout.md) dokumentiert.

Für jede Migration: bestehende Daten und Referenzen inventarisieren, additive Strukturen anlegen, Zuordnungen überprüfbar übertragen, Konflikte separat ausweisen, Rechte und Datensatzanzahl vergleichen, dann die Oberfläche umstellen. Alte Beziehungen erst nach bestätigter Übernahme ablösen. Datenbank und tatsächliche Dokumentdateien müssen wiederherstellbar gesichert sein; die Wiederherstellung wird getestet.

## Reihenfolge und Abnahme

| Stufe | Lieferumfang | Abnahme |
| --- | --- | --- |
| 1 – Grundlagen | Mehrfachrollen in Miet-/Eigentums-/Auftragsauswahl; korrekte Dashboard-Priorität; konservative CAMT-Zuordnung; dieser Plan. | Regressionstests, isolierte Browserprüfung, Commit/Push und Live-Dateien prüfen. Kein Schreiben in echte Geschäftsdaten für Tests. |
| 2 – Bestand einfach erfassen | Kurzer iPhone-Ablauf, Sammelerfassung, editierbare Einheiten, bestehende Liegenschaften ergänzen, Entwürfe und klare Detailnavigation. | Julia kann Gebäude und verschiedene Einheiten erfassen; Abbruch, Zurück und wiederholtes Speichern verlieren keine Daten und erzeugen keine Duplikate. Bestehende Funktionen bleiben erreichbar. |
| 3 – Beziehungen und Freigaben | Person/Organisation/Zugang unterscheiden, Bewohner und mehrere Vertragspartner, zeitliche Zuständigkeiten, Sichtbarkeitsklassen und eindeutige Nummern. | Mehrfachrollen, Eigentümerbewohnung, Vertreter, Mieterwechsel und unberechtigte Direktzugriffe mit getrennten Testkonten prüfen. Migration erweitert keine Freigabe unbeabsichtigt. |
| 4 – Räume, Geräte, Dokumente | Gemeinschaftsräume, Standort-/Gerätehistorie, Versionen, verknüpfte Akten, mobiles Erfassen und Dokumentzugriff. | Gerät vom Schaden bis zur Anleitung verfolgbar; Vorgängerhistorie erhalten; private Unterlagen bleiben beim berechtigten Personenkreis. |
| 5 – Fälle und Übergaben | Mehrere Aufträge/Rechnungen pro Fall, Angebote, Rapporte, Abnahme, Aufgaben sowie vollständiger Ein-/Auszug. | Fall mit zwei Handwerkern und Nacharbeit; Übergabe A→B mit Fotos, Zählern, Schlüsseln und nachgewiesener Trennung der privaten Akten. |
| 6 – Finanzen | Zahlungsbewegungen, Restbeträge, Kostenaufteilung, Lieferantenrechnungen, Bankabgleich und kontrollierte Freigaben. | Teilzahlung, Fremdwährung, Dublette, Versicherungsanteil, Gutschrift und fehlgeschlagene Bankausführung buchen nichts falsch oder doppelt. |
| 7 – Automationen | Dauerhafter Auftragslauf mit Ereignissen, Zeitplänen, Wiederholungen, Zustellprotokollen und Julias Ausnahme-/Freigabeaufgaben. | Abbruch und erneuter Lauf erzeugen genau einen Geschäftsvorgang; Zahlung stoppt Mahnung; Fehler ist sichtbar und erneut bearbeitbar. |
| 8 – Betrieb und Ergänzungen | Betriebskontrolle, Stellvertretung, Wiederherstellung, Eigentümerauswertungen und weitere Gemeinschaftsprozesse. | Wiederherstellungsprobe, Rollenregression, mobile Kernabläufe und nachvollziehbare Betriebs-/Fehlerhistorie. |

Die Stufen sind fachlich aufeinander abgestimmt; innerhalb einer Stufe werden kleine abgeschlossene Änderungen veröffentlicht. Automatische echte Zahlungen und neue Nachrichtenauslöser werden erst mit ausdrücklich festgelegten Empfängern, Regeln und Freigabeschritten aktiviert.

Die CAMT-Korrektur in Stufe 1 schützt den vorhandenen manuellen Abgleich in der Oberfläche. Der bestehende Bezahlt-RPC erhält weiterhin nur eine Rechnungs-ID. Ein atomarer serverseitiger Zahlungsabgleich mit gespeicherten Banktransaktionen, Teilzahlungen und importübergreifendem Dublettenschutz gehört zu Stufe 6.

### Verbindliche Szenarien für spätere Rechte- und Ablaufprüfungen

- Eine Person mit Eigentümerrolle und Mietbeziehung sieht beide zulässigen Kontexte, aber keine fremden Objekte. Eine zusätzliche Rolle allein eröffnet keine fremde Akte.
- Ein ausgezogener Mieter und sein Nachmieter behalten jeweils nur die vorgesehenen historischen beziehungsweise aktuellen Unterlagen. Direkte Tabellen- und Dateiabrufe werden ebenfalls geprüft.
- Ein Hauswart sieht zuständige Häuser und operative Aufträge; Mietverträge und private Korrespondenz sind nicht allein wegen der Hauswartfunktion sichtbar. Ein Handwerker sieht nur die für seinen Auftrag freigegebenen Informationen.
- Eine widerrufene Freigabe greift auch beim erneuten Dateiaufruf. Bereits ausgestellte Downloadlinks und deren Laufzeit werden berücksichtigt.
- Zwei gleichzeitige Speichervorgänge erzeugen keine doppelte Zuordnungsnummer, Rechnung oder Bankausführung. Fehlgeschlagene Schritte lassen sich wiederaufnehmen.
- CHF 100 auf eine Forderung über CHF 1’000 lässt CHF 900 offen. Ein Zahlungseingang nach bereits vorbereiteter Erinnerung verhindert deren ungeprüften Versand.

## Was später vom Betreiber benötigt wird

Für die ersten Grundlagen und die iPhone-Erfassung reichen das vorhandene Projekt und die bereits genannten Anforderungen. Vor der jeweiligen Integration werden konkret benötigt:

- Bank-/Buchhaltungsanbieter, technische Testzugänge und die Zuordnung von Rechnungsausstellern, Mandaten und Zahlungskonten; Zugangsdaten über die vorgesehene sichere Konfiguration.
- Geschäftliche Regeln für Fälligkeit, Erinnerungen, Gebühren, strittige Forderungen, Kostenverteilung und Geldfreigaben; wer welchen Betrag freigeben darf.
- Verwendete Vorlagen für Mietvertrag, Übergabe, Rechnung und Hausregeln sowie die gewünschten Unterschrifts- und Versicherungsabläufe.
- Bestätigung der Standardfreigaben für Eigentümer, Bewohner, Hauswart und Handwerker anhand konkreter Beispiele.
- Deploymentzugang und abgeglichener Stand für Datenbank, Storage und benötigte externe Dienste, bevor neue serverseitige Funktionen aktiviert werden.

Offene fachliche Regeln werden nicht als vermeintlich feststehende Rechts- oder Finanzvorgaben einprogrammiert.

## Prüfungen ausführen

Die ersten Regressionstests benötigen nur Node.js und keine neuen Abhängigkeiten:

```sh
node --test tests/*.test.cjs
```

Sie prüfen lokale Logik und simulierte Daten. Sie ersetzen keine Prüfung der tatsächlich deployten Supabase-Regeln, Bankanbindung oder kompletten Rollenabläufe mit Testkonten.

Prüfstand des ersten Pakets: 55 Regressionstests bestanden; die drei Personen-Auswahldialoge und der CAMT-Upload wurden mit Chromium und WebKit bei 393 und 1440 Pixeln geprüft. Die Browserprüfung verwendete die tatsächlichen Seitenskripte, native XML-Parser und ausschliesslich simulierte Backenddaten. Teilzahlung, Fremdwährung, Sammelbuchung, doppelte und unbekannte Referenzen, ungültiges XML, geänderte Rechnung und gültige Bestätigung wurden durchgespielt. Syntaxprüfung, Diffprüfung und Vorbereitung der Capacitor-Webdateien waren erfolgreich. Eine vollständige native iOS- oder Live-RLS-Abnahme ist damit nicht behauptet.

## Stufe 2: kurze Objekterfassung

Der neue Einstieg unter **Objekte → Liegenschaft erfassen** führt über `/portal/admin/property-create.html` durch Adresse, Einheiten und Kontrolle. Die Bezeichnung wird aus der Adresse vorgeschlagen und bleibt änderbar. Bis zu 100 Einheiten lassen sich pro Erfassung gesammelt hinzufügen, einzeln benennen, kopieren oder entfernen; Stockwerk, Zimmer und Fläche sind optional. Studio und vorhandene detaillierte Einheitstypen bleiben eigene Werte. Eine neue Liegenschaft darf zunächst ohne Einheiten gespeichert werden.

Das Plus bei einer bestehenden Liegenschaft übernimmt sie als Kontext und beginnt direkt mit den Einheiten. Nach Erfolg führen Links zur erfassten Liegenschaft oder Einheit; auf dem iPhone springt die Übersicht zum zugehörigen Bereich. Die bestehenden Detailformulare für Personen, Bilder, Dokumente, Geräte, Waschplan und Inserate bleiben erreichbar. Vor Beginn eines Kurz-Entwurfs ist auch das bisherige ausführliche Erfassungsformular verfügbar.

Entwürfe werden pro angemeldetem Verwaltungskonto **im aktuellen Browser-Tab** gesichert und nach Neuladen wieder aufgenommen. Sie werden noch nicht zwischen Geräten synchronisiert und stehen nach Schliessen des Tabs nicht als Cloud-Entwurf bereit. Zugangstokens und Dateien werden darin nicht abgelegt. Bei gesperrtem Tab-Speicher beginnt keine Datenbankanlage.

Vor der ersten Speicherung wird ein fester Plan mit UUIDs gesichert. Die Liegenschaft wird zuerst angelegt, danach die fehlenden Einheiten gemeinsam; bereits vorhandene IDs werden geprüft. Verlorene Antworten und wiederholtes Speichern erzeugen dadurch keine zweite Anlage desselben Plans. Ein unklarer oder teilweise gespeicherter Plan bleibt zur Wiederaufnahme erhalten und wird nicht durch eine neue Anlage ersetzt. Es gibt keine gemeinsame Transaktion über beide Tabellen und keine automatische Löschung zur Fehlerbereinigung. Zwischenzeitlich abweichende oder archivierte Datensätze werden nicht überschrieben. Neue Datensätze verwenden ausdrücklich `visibility: private`.

Die Sitzung wird vor Speicherung erneut geprüft; ein Versuch verwendet einen an dieses Konto gebundenen Client. Kontowechsel und Abmeldung verbergen den Entwurf und stoppen weitere Schritte. Technische Grundlage sind die dokumentierte [Client-Konfiguration mit eigener Fetch-Funktion](https://supabase.com/docs/reference/javascript/initializing) und [Benachrichtigungen über Sitzungsänderungen](https://supabase.com/docs/reference/javascript/auth-onauthstatechange). Datenbankrechte bleiben zusätzlich massgeblich.

Für diese Stufe ist keine neue Migration erforderlich. Eine noch nicht vorhandene `property_type`-Spalte wird von einem Verbindungsfehler unterschieden; STWEG wird in diesem Fall nicht still als Mietliegenschaft gespeichert. Der tatsächlich deployte Einheitstyp-Constraint bleibt verbindlich. Die vorhandenen SQL-Erweiterungen werden durch den Frontend-Push nicht automatisch eingespielt.

Die zusätzliche Browserabnahme lädt die tatsächlichen lokalen Seiten und Skripte mit simuliertem Login und isolierten Tabellendaten. Sie erzeugt keine produktiven Liegenschaften und benötigt eine vorhandene Playwright-Installation:

```sh
PLAYWRIGHT_MODULE=/pfad/zu/playwright-core node tests/property-create-browser.cjs
```

Kernfälle sind Neu-/Sammelerfassung, Null-Einheiten-Liegenschaft, bestehende Liegenschaft, Rücknavigation und Reload, Antwortverlust nach erfolgreichem Insert, fehlgeschlagener Einheiten-Insert, gesperrter Tab-Speicher, fehlender Verwaltungszugang sowie Kontowechsel während einer Erfassung.

Prüfstand der Stufe 2: insgesamt 98 Node-Regressionstests sowie 66 Browserfälle in Chromium und WebKit bei 320, 393 und 1440 Pixeln bestanden. Die mobile Ansicht wurde zusätzlich visuell geprüft. Sitzungsbindung, tokenfreie Entwürfe, ausbleibende Folgeschritte nach Kontowechsel sowie Syntaxprüfung und Vorbereitung der Capacitor-Webdateien wurden geprüft. Es wurden keine produktiven Datensätze für diese Abnahme angelegt.


### Dokumentberechtigungen – live aktiviert (5. September 2026)

Ablage und Leserechte sind im neuen Code getrennt. Die Datenbankmigration, serverseitige Leseranzeige mit Entzug, Benachrichtigungen ohne Anhänge sowie RLS- und Browsertests liegen vor. Die Supabase-Migration und beide Benachrichtigungsfunktionen wurden am 5. September 2026 live aktiviert und mit schreibgeschützten Rollenprüfungen kontrolliert. Siehe [Aktivierung, Tests und verbleibende Grenzen](document-privacy-rollout.md). Der Admin-Servercheck bestätigt die Aktivierung; Dokument-Uploads und ausdrückliche Freigaben sind damit wieder freigeschaltet. Bestehende Freigaben bleiben beim Zuordnen erhalten.
