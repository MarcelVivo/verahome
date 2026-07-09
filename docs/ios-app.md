# Vera Home iPhone-App testen

Diese Struktur verpackt das bestehende Vera Portal mit Capacitor als iOS-App. Die App startet direkt im Portal-Login und nutzt weiterhin die produktive Supabase-Datenbank.

## Aktuelle Konfiguration

- App-Name: `Vera Home`
- Bundle ID: `ch.verahome.portal`
- Einstieg: `/portal/login.html`
- Datenbank/API: unverändert über die bestehende Supabase-Konfiguration im Portal
- Ziel: lokaler iPhone-Test über Xcode, noch kein App-Store-Release

## Voraussetzungen auf dem Mac

- Node.js und npm
- Xcode
- iPhone per Kabel oder drahtlos mit dem Mac gekoppelt
- Apple-ID in Xcode unter `Settings > Accounts`
- Für längerfristige TestFlight/App-Store-Verteilung: Apple Developer Account

## Einmalig installieren

Im Projektordner ausführen:

```bash
npm install
npm run ios:add
```

Damit werden die Capacitor-Pakete installiert und der native Ordner `ios/` erzeugt.

## Portal-Code in die App synchronisieren

Nach jeder Änderung am Vera Portal:

```bash
npm run ios:sync
```

Das kopiert den aktuellen Web-/Portal-Code in die iOS-App.

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
