# DropTo

Thunderbird-Add-on, das E-Mail-Anhänge per Kontextmenü mit einem Klick in
vordefinierte Ordner ablegt. **Pro Konto lassen sich mehrere Ziele festlegen**;
sie erscheinen als Untermenü „DropTo". Das Konto der angezeigten Nachricht wird
automatisch erkannt – im Menü tauchen nur dessen Ziele auf.

Jedes Ziel ist ein frei gewählter Ordner; die Anhänge landen mit einem Klick
direkt darin — an beliebiger Stelle im Dateisystem.

## Funktionen

- Untermenü „DropTo" im Kontextmenü eines Anhangs und in der
  Anhang-Zusammenfassung („Alle Anhänge").
- Mehrere Ziele je Konto, konfigurierbar über eine Einstellungsseite.
- Automatische Kontoerkennung: nur die Ziele des passenden Kontos werden
  eingeblendet.
- Kontounabhängige Ziele („Alle Konten") erscheinen bei jeder E-Mail — oberhalb
  der Konto-Ziele, durch eine Trennlinie abgesetzt. Ohne konfigurierte Ziele
  zeigt das Menü einen deaktivierten Hinweis.
- Jedes Ziel ist ein frei gewählter Ordner (über den 📁-Button); die Anhänge
  landen direkt darin — an beliebiger Stelle im Dateisystem.
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
  - **Name** (frei, erscheint im Menü; leer = Ordnerpfad wird angezeigt)
  - **Ordner** (über den 📁-Button gewählt; beliebige Stelle im Dateisystem)
- **Debug-Logging**.

Gespeichert wird automatisch bei jeder Änderung (`storage.local`) — ein kurzes
„Gespeichert."-Toast unten rechts bestätigt das.

## Wie es funktioniert / Hinweise

- Das Menü wird beim Aufklappen dynamisch aktualisiert (`menus.onShown`):
  Kontoerkennung über die angezeigte Nachricht, dann werden die passenden Ziele
  eingeblendet und `menus.refresh()` aufgerufen.
- Die Anhänge schreibt das mitgelieferte Experiment `droptoFs` direkt via
  `IOUtils` in den gewählten Ordner — deshalb zeigt Thunderbird bei der
  Installation eine Warnung über vollen Zugriff, und diese Dateien erscheinen
  nicht in der Download-Historie.
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
    filesystem/          # Experiment "droptoFs" (Ordner-Dialog + Schreiben)
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
