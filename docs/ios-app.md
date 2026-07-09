# Vera Home iPhone-App testen

Diese Struktur verpackt das bestehende Vera Portal mit Capacitor als iOS-App. Die App startet direkt im Portal-Login und nutzt weiterhin die produktive Supabase-Datenbank.

## Aktuelle Konfiguration

- App-Name: `Vera Home`
- Bundle ID: `ch.verahome.portal`
- Einstieg: `/portal/login.html`
- Datenbank/API: unverändert über die bestehende Supabase-Konfiguration im Portal
- Ziel: lokaler iPhone-Test über Xcode, noch kein App-Store-Release
- Native iOS-Struktur: `ios/` ist im Repo bereits angelegt
- Capacitor: v7, kompatibel mit der aktuell lokalen Node-20-Umgebung

## Voraussetzungen auf dem Mac

- Node.js und npm
- Xcode
- iPhone per Kabel oder drahtlos mit dem Mac gekoppelt
- Apple-ID in Xcode unter `Settings > Accounts`
- Für längerfristige TestFlight/App-Store-Verteilung: Apple Developer Account

## Einmalig installieren / aktualisieren

Im Projektordner ausführen:

```bash
npm install
npm run ios:sync
```

Damit werden die Capacitor-Pakete installiert, `dist/ios-web` erzeugt und der aktuelle Portal-Code in `ios/` synchronisiert.

Falls dabei diese Meldung erscheint:

```text
xcode-select: error: tool 'xcodebuild' requires Xcode
```

dann ist auf dem Mac noch nicht Xcode, sondern nur die Command Line Tools aktiv. Danach einmal ausführen:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
npm run ios:sync
```

`npm run ios:add` wird nur benötigt, falls der Ordner `ios/` absichtlich gelöscht und neu erzeugt wurde.

## Portal-Code in die App synchronisieren

Nach jeder Änderung am Vera Portal:

```bash
npm run ios:sync
```

Das erstellt zuerst `dist/ios-web` aus der statischen Website und kopiert danach den aktuellen Web-/Portal-Code in die iOS-App.

## In Xcode öffnen

```bash
npm run ios:open
```

Dann in Xcode:

1. Oben das angeschlossene iPhone als Ziel auswählen.
2. Unter `Signing & Capabilities` dein Apple-Team auswählen.
3. Falls nötig die Bundle ID eindeutig lassen: `ch.verahome.portal`.
4. Play drücken.
5. Auf dem iPhone den Entwickler als vertrauenswürdig bestätigen, falls iOS danach fragt.

## Direkt per Terminal starten

Alternativ:

```bash
npm run ios:run
```

Der Befehl zeigt verfügbare Simulatoren oder Geräte an und startet die App dort.

## Wichtige Hinweise

- Die App enthält den aktuellen lokalen Portal-Code zum Zeitpunkt von `npm run ios:sync`.
- Die Daten sind live, weil Supabase weiterhin dieselbe produktive Datenbank nutzt.
- Passwort-Reset- und Einladungslinks laufen aktuell weiterhin über die Web-URLs. Deep Links in die App können später ergänzt werden.
- Push-Benachrichtigungen, Kamera/Scan, native Dokument-Auswahl und App-Icons sind die nächsten sinnvollen Ausbaustufen.
- Für App Store/TestFlight sollte die App nicht nur eine entfernte Website laden, sondern den Portal-Code gebündelt enthalten. Diese Struktur ist darauf vorbereitet.
