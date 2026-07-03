# Bilder & Dateien ablegen

Dieser Ordner wird 1:1 mit hochgeladen (Hostpoint-Upload = `index.html` + kompletter `public/`-Ordner).
Einfach die Dateien mit **genau diesem Dateinamen** in den passenden Unterordner legen – die Website
bindet sie automatisch ein. Fehlt eine Datei, zeigt die Website weiterhin den bisherigen
Platzhalter (Gold-Kreis-Logo, Farbverlauf-Profilbild, Farbverlauf-Objektkarten) – nichts bricht.

## `images/logo/`

| Datei | Verwendung | Empfehlung |
|---|---|---|
| `logo.png` | Logo in der Navigation (und als Social-Share-Bild) | Transparenter Hintergrund, quadratisch, mind. 200×200px |
| `favicon.png` | Browser-Tab-Icon | Quadratisch, 512×512px (wird vom Browser automatisch skaliert) |

## `images/team/`

| Datei | Verwendung | Empfehlung |
|---|---|---|
| `julia-allen.jpg` | Profilfoto im Abschnitt "Über mich" | Quadratisch (bzw. leicht hochkant), mind. 800×800px, freundlich/professionell |

## `images/objekte/`

| Datei | Verwendung | Empfehlung |
|---|---|---|
| `objekt-1.jpg` | Erste Objekt-Karte ("Wohnung, Frick") im Abschnitt "Aktuelle Objekte" | Querformat, mind. 800×600px |
| `objekt-2.jpg` | Zweite Objekt-Karte ("Haus, Rheinfelden") | Querformat, mind. 800×600px |
| `objekt-3.jpg` | Dritte Objekt-Karte ("STWEG, Möhlin") | Querformat, mind. 800×600px |

Diese drei Karten sind aktuell Platzhalter ("Auf Anfrage"). Sobald echte, aktuell zu bewerbende Objekte
feststehen, können hier passende Fotos abgelegt werden – Titel/Text lassen sich direkt in `index.html`
im Abschnitt `#objekte` anpassen.

## `downloads/`

| Datei | Verwendung |
|---|---|
| `checkliste-wohnungsuebergabe.pdf` | Download-Button "Checkliste Wohnungsübergabe" |
| `tipps-fuer-eigentuemer.pdf` | Download-Button "Tipps für Eigentümer" |
| `mietbewerbung-unterlagen.pdf` | Download-Button "Mietbewerbung – was brauche ich?" |
| `stweg-haeufige-fragen.pdf` | Download-Button "STWEG – häufige Fragen" |

Alle vier Buttons sind bereits im Code auf diese Dateinamen verlinkt (inkl. `download`-Attribut, öffnet
also direkt den Download-Dialog statt einer leeren Seite) – einfach die passenden PDFs hier ablegen.
