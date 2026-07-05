# Vera Home Immobilien – Website

Professionelle, 3D-animierte Website für Julia Allen, Vera Home Immobilien, Frick AG.
Zweisprachig (DE/EN), gebaut mit Three.js (3D-Hero), GSAP/ScrollTrigger (Scroll-Animationen) und Vanilla Tilt (3D-Card-Hover).

## Dateistruktur

```
VeraHomeWeb/
├── index.html               ← Komplette Website (HTML + CSS + JS, alles inline)
├── README.md                ← Diese Datei
└── public/                  ← Alle Bilder & Downloads – wird 1:1 mitgeladen/mit-hochgeladen
    ├── README.md            ← Genaue Anleitung: welche Datei mit welchem Namen wohin
    ├── images/
    │   ├── logo/
    │   │   ├── logo.png     ← Logo (Navigation, Social-Share)
    │   │   └── favicon.png  ← Browser-Tab-Icon
    │   ├── team/
    │   │   └── julia-allen.jpg   ← Profilfoto "Über mich"
    │   └── objekte/
    │       ├── objekt-1.jpg ← Foto Objekt-Karte 1
    │       ├── objekt-2.jpg ← Foto Objekt-Karte 2
    │       └── objekt-3.jpg ← Foto Objekt-Karte 3
    └── downloads/
        ├── checkliste-wohnungsuebergabe.pdf
        ├── tipps-fuer-eigentuemer.pdf
        ├── mietbewerbung-unterlagen.pdf
        └── stweg-haeufige-fragen.pdf
```

Alle Ordner unter `public/` existieren bereits (aktuell leer) – Bilder/PDFs einfach mit exakt dem oben
genannten Dateinamen hineinlegen, `index.html` bindet sie automatisch ein. Solange eine Datei fehlt,
zeigt die Website weiterhin den bisherigen Platzhalter (Gold-Kreis-Logo, Farbverlauf-Profilbild,
Farbverlauf-Objektkarten) – nichts bricht. Details siehe [`public/README.md`](public/README.md).

Alle drei Bibliotheken (Three.js, GSAP, ScrollTrigger, Vanilla Tilt) werden per CDN geladen – es ist keine Installation nötig.

## Lokal testen

Einfach `index.html` im Browser öffnen – oder mit einem lokalen Server (empfohlen, da manche Browser CDN-Skripte bei `file://` blockieren):

```bash
python3 -m http.server 8080
# oder
npx serve .
```

Dann im Browser: `http://localhost:8080`

## Bilder ersetzen

Siehe [`public/README.md`](public/README.md) für die vollständige Liste aller erwarteten Dateinamen.
Kurzfassung – Fallback ohne Datei:

| Datei | Verwendung | Fallback ohne Datei |
|---|---|---|
| `public/images/logo/logo.png` | Logo in Navigation | Gold-Kreis mit "VH"-Initialen (automatisch generiert per JS `onerror`) |
| `public/images/logo/favicon.png` | Browser-Tab-Icon | Kein Icon (Standard-Browser-Icon) |
| `public/images/team/julia-allen.jpg` | Profilfoto "Über mich" | Animierter Gradient-Platzhalter mit Initialen "JA" |
| `public/images/objekte/objekt-1.jpg` bis `objekt-3.jpg` | Fotos der 3 Objekt-Platzhalterkarten | Farbverlauf-Kachel |
| `public/downloads/*.pdf` | Die 4 Download-Buttons im Abschnitt "Kostenlose Downloads" | Link führt zu einer nicht vorhandenen Datei (Browser-Fehlermeldung) – bis PDFs abgelegt sind |

## Deployment auf Hostpoint

1. Im Hostpoint-Kundencenter (**login.hostpoint.ch**) unter *Webhosting* die FTP-Zugangsdaten des gewünschten Pakets aufrufen.
2. Mit einem FTP-Client (z. B. FileZilla, Cyberduck) verbinden:
   - Host: der von Hostpoint angezeigte FTP-Server (meist `ftp.<domain>.ch` oder ein `*.hostpoint.ch`-Host)
   - Benutzername/Passwort: aus dem Kundencenter
   - Port: 21 (FTP) oder 22 (SFTP, falls verfügbar – empfohlen)
3. In den Webroot-Ordner wechseln (meist `htdocs/` oder `public_html/`).
4. `index.html` **und den kompletten `public/`-Ordner** (mit allen Unterordnern) in diesen Webroot hochladen.
5. Domain `www.verahome.ch` im Hostpoint-Kundencenter auf das Hosting-Paket zeigen lassen (DNS wird bei Domains, die direkt bei Hostpoint registriert sind, meist automatisch verknüpft).
6. Seite unter `https://www.verahome.ch` testen; SSL-Zertifikat (Let's Encrypt) im Kundencenter aktivieren, falls nicht automatisch vorhanden.

## Formulare

- **Kontaktformular** (`#kontakt`): validiert clientseitig (Name, gültige E-Mail, Nachricht, Datenschutz-Checkbox) und öffnet danach das Standard-E-Mail-Programm mit vorausgefülltem Entwurf an `welcome@verahome.ch`.
- **Wohnungsbewerbung** (`#mietertools`): gleiches Prinzip. Der Datei-Upload (`bw_file`) kann **nicht** automatisch per `mailto:` versendet werden (technische Grenze von Mail-Links) – Bewerber müssen die ausgewählten Dateien manuell an die sich öffnende E-Mail anhängen, bevor sie sie absenden. Für echten automatischen Upload: Formspree, Netlify Forms oder ein eigenes Backend integrieren (Stelle im Code ist mit `TODO`/Kommentar markiert).

## Offene TODOs

- [ ] Logo unter `public/images/logo/logo.png` ablegen (finales Logo)
- [ ] Favicon unter `public/images/logo/favicon.png` ablegen
- [ ] Profilfoto von Julia Allen unter `public/images/team/julia-allen.jpg` ablegen
- [ ] Instagram-Handle bestätigen (aktuell Platzhalter `@verahome_immobilien`, markiert im Code)
- [ ] Calendly-Link bestätigen/einrichten (aktuell Platzhalter `https://calendly.com/verahome`, markiert im Code)
- [ ] Geschäfts-E-Mail `julia@verahome.ch` einrichten und im Code ergänzen, sobald verfügbar
- [ ] Echte Downloads (PDFs) unter `public/downloads/` ablegen (siehe `public/README.md` für exakte Dateinamen)
- [ ] Fotos für die 3 Objekt-Platzhalterkarten unter `public/images/objekte/` ablegen (optional)
- [ ] Für produktiven E-Mail-Versand ohne Mail-Client: Formspree o. Ä. anstelle von `mailto:` einbinden

## Anpassungen

Alle Farben sind als CSS Custom Properties in `:root` definiert (`index.html`, Kopf des `<style>`-Blocks). Texte lassen sich zusätzlich zentral im `translations`-Objekt (JS, DE/EN) anpassen – jedes Element mit `data-i18n="..."` bezieht seinen Text von dort.

## Technische Hinweise

- Three.js-Hintergrund (Partikel + Wireframe-Gebäude) läuft nur auf Bildschirmen > 768px; auf Mobile wird automatisch der reine CSS-Gradient verwendet (Performance).
- `prefers-reduced-motion: reduce` deaktiviert alle GSAP-, Three.js- und CSS-Animationen automatisch.
- Aktive Navigation, Zähler-Animation und Scroll-Einblendungen laufen über `IntersectionObserver` bzw. GSAP `ScrollTrigger`.

---

Website erstellt für Vera Home Immobilien · Julia Allen · Hauptstrasse 39, 5070 Frick
