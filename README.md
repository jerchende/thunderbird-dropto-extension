# DropTo

Thunderbird-Add-on, das E-Mail-Anhänge per Kontextmenü mit einem Klick in
vordefinierte Ordner ablegt. **Pro Konto lassen sich mehrere Ziele festlegen**;
sie erscheinen als Untermenü „DropTo". Das Konto der angezeigten Nachricht wird
automatisch erkannt – im Menü tauchen nur dessen Ziele auf.

Gespeichert wird unter `<Download-Ordner>/<Ziel-Pfad>/`, z. B.
`~/Downloads/folderA/Rechnungen/`.

## Funktionen

- Untermenü „DropTo" im Kontextmenü eines Anhangs und in der
  Anhang-Zusammenfassung („Alle Anhänge").
- Mehrere Ziele je Konto, konfigurierbar über eine Einstellungsseite.
- Automatische Kontoerkennung: nur die Ziele des passenden Kontos werden
  eingeblendet.
- Kontounabhängige Ziele („Alle Konten") erscheinen bei jeder E-Mail — oberhalb
  der Konto-Ziele, durch eine Trennlinie abgesetzt. Ohne konfigurierte Ziele
  zeigt das Menü einen deaktivierten Hinweis.
- Absolute Zielpfade (beginnend mit `/`, `~/` oder `C:\`) speichern außerhalb
  des Download-Ordners — per Eingabe oder Ordner-Dialog (📁-Button).
- Kein Speichern-Dialog, keine Ordnersuche. Bei Namensgleichheit wird
  automatisch nummeriert (`(1)`, `(2)`, …).
- Optionales Debug-Logging.

## Installation (fertiges Paket)

1. `dist/dropto-<version>.xpi` bauen (siehe [Build](#build)) oder aus den
   Release-Artefakten laden.
2. Thunderbird: **Add-ons und Themes → Zahnrad → „Add-on aus Datei
   installieren…"** → die `.xpi` wählen.
3. Falls die fehlende Signatur bemängelt wird: **Einstellungen → Allgemein →
   „Konfiguration bearbeiten"** → `xpinstall.signatures.required` auf `false`.

## Benutzung

Rechtsklick auf einen Anhang → **DropTo → \<Ziel\>**. Der Anhang wird sofort in
den gewählten Ordner gespeichert. Beim Rechtsklick auf die Anhang-Zusammenfassung
werden alle Anhänge der Mail dorthin gelegt.

## Einstellungen

**Add-ons und Themes → DropTo → Einstellungen**:

- **Alle Konten** – kontounabhängige Ziele, erscheinen bei jeder E-Mail.
- **Konten & Ziele** – je Konto beliebig viele Ziele:
  - **Name** (frei, erscheint im Menü; leer = Pfad wird angezeigt)
  - **Pfad** (relativ zum Download-Ordner von Thunderbird; Unterordner mit `/`,
    z. B. `folderA/Rechnungen` — oder absolut, z. B. `~/Documents/Rechnungen`;
    der 📁-Button öffnet einen Ordner-Dialog)
- **Debug-Logging**.

Gespeichert wird automatisch bei jeder Änderung (`storage.local`) — ein kurzes
„Gespeichert."-Toast unten rechts bestätigt das.

## Wie es funktioniert / Hinweise

- Das Menü wird beim Aufklappen dynamisch aktualisiert (`menus.onShown`):
  Kontoerkennung über die angezeigte Nachricht, dann werden die passenden Ziele
  eingeblendet und `menus.refresh()` aufgerufen.
- Der Zielpfad ist **relativ zum Thunderbird-Download-Ordner**. Damit die Pfade
  unter `~/Downloads/…` liegen, muss unter *Einstellungen → Allgemein → Dateien &
  Anhänge* „Alle Dateien in diesem Ordner ablegen" auf `~/Downloads` stehen.
  Steht dort „Immer nachfragen", wird der Dialog dank `saveAs: false` trotzdem
  übersprungen.
- Relative Ziele nutzen die `downloads`-API (Sandbox: nur Download-Ordner und
  Unterordner). Absolute Ziele schreibt das mitgelieferte Experiment `droptoFs`
  direkt via `IOUtils` — deshalb zeigt Thunderbird bei der Installation eine
  Warnung über vollen Zugriff, und diese Dateien erscheinen nicht in der
  Download-Historie.
- **Manifest V2** ist Absicht: persistenter Background, maximale Kompatibilität,
  keine Event-Page-/Service-Worker-Fallstricke. Läuft ab Thunderbird 115.

## Entwicklung

Voraussetzungen: Node.js ≥ 18.

```bash
npm install          # Dependencies
npm run lint         # ESLint über src/
npm run lint:ext     # web-ext lint (informativ; kennt TB-APIs nur teilweise)
npm run icons        # PNGs aus src/icons/icon.svg neu rendern
npm run build        # dist/dropto-<version>.xpi bauen
```

### Live-Entwicklung mit Thunderbird

`web-ext run` startet standardmäßig Firefox; für Thunderbird den Binärpfad
angeben (macOS-Beispiel):

```bash
npm run start -- --firefox="/Applications/Thunderbird.app/Contents/MacOS/thunderbird"
```

### Debugging ohne web-ext

**Add-ons und Themes → Zahnrad → „Add-ons debuggen" → DropTo → Untersuchen**
öffnet die Konsole des Background-Skripts (Debug-Logging in den Einstellungen
aktivieren).

## Build

`npm run build` verpackt `src/` via web-ext zu `dist/dropto-<version>.xpi`.

## CI

`.github/workflows/build.yml` läuft bei Push/PR: `npm ci`, ESLint, `web-ext lint`
(informativ) und Build; die fertige `.xpi` wird als Artefakt hochgeladen.

## Signieren / Verteilen

```bash
WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npm run sign
```

Für den Eigengebrauch genügt die unsignierte `.xpi` plus
`xpinstall.signatures.required=false`.

## Projektstruktur

```
src/
  manifest.json
  background.js          # Menü (dynamisch) + Speichern-Logik
  experiments/
    filesystem/          # Experiment "droptoFs" (absolute Pfade, Ordner-Dialog)
      schema.json
      implementation.js
  options/               # Einstellungsseite
    options.html
    options.css
    options.js
  icons/
    icon.svg             # Quelle
    icon-16..128.png     # generiert (npm run icons)
scripts/
  render-icons.mjs
.github/workflows/build.yml
eslint.config.mjs
package.json
```

## Lizenz

MIT – siehe [LICENSE](LICENSE).
