# CLAUDE.md

Kontext für Claude Code. Nutzerseitige Doku steht im `README.md` — hier stehen
Befehle, Architektur und die **Invarianten/Fallstricke**, die nicht wegoptimiert
werden dürfen.

## Projekt

DropTo — Thunderbird-MailExtension (Manifest V2). Legt E-Mail-Anhänge per
Kontextmenü in Ordner unter dem Download-Ordner ab; pro Konto mehrere Ziele, die
als Untermenü erscheinen. Konfiguration in `storage.local`, gepflegt über die
Options-Seite.

## Befehle

```bash
npm install          # Dependencies
npm run lint         # ESLint (harte Gate)
npm run lint:ext     # web-ext lint (nur informativ, s. u.)
npm run icons        # PNGs aus src/icons/icon.svg rendern (sharp)
npm run build        # -> dist/dropto-<version>.xpi
npm start -- --firefox="/Applications/Thunderbird.app/Contents/MacOS/thunderbird"
```

**Vor jedem Commit:** `npm run lint` und `npm run build` müssen grün sein.

## Struktur

- `src/manifest.json` — MV2, Permissions, `options_ui`, Icons.
- `src/background.js` — Menüaufbau, `onShown`-Dynamik, `onClicked`-Speichern.
- `src/options/` — Einstellungsseite (Vanilla JS/HTML/CSS, kein Framework).
- `src/experiments/filesystem/` — Experiment `droptoFs` (privilegiert:
  IOUtils-Schreiben an absolute Pfade, nativer Ordner-Picker).
- `src/icons/icon.svg` — Icon-Quelle; PNGs sind generiert (nicht von Hand editieren).
- `scripts/render-icons.mjs`, `.github/workflows/build.yml`, `eslint.config.mjs`.

## Invarianten — nicht „vereinfachen"

- **Manifest V2 ist Absicht.** Persistenter Background, maximale Kompatibilität,
  keine Event-Page-/Service-Worker-Fallstricke. Kein Wechsel auf MV3 ohne
  konkreten Grund (u. a. `URL.createObjectURL` und `menus`-Timing).
- **Nachrichten-Ermittlung ist heikel.** Im `message_attachments`-Kontext liefert
  `info` zwar `attachments`, aber **kein** `selectedMessages`/`displayedFolder`,
  und der übergebene `tab` ist teils `{ type: null }`, sodass
  `messageDisplay.getDisplayedMessage(tab.id)` `null` liefert. `getMessage()`
  probiert deshalb mehrere Wege durch (Kandidaten-Tabs → `mailTabs`
  `getSelectedMessages` → Scan aller Tabs → `info.selectedMessages`). **Nicht** auf
  einen einzelnen Lookup zurückbauen.
- **Dynamisches Menü.** Globale Ziele (`destinations["*"]`) sind immer sichtbar
  und stehen oben; Konto-Ziele werden als versteckte Kinder von `dropto-root`
  angelegt, `onShown` erkennt das Konto der Nachricht und blendet nur dessen
  Ziele ein, danach `menus.refresh()`. Der Separator erscheint nur, wenn beide
  Gruppen sichtbar sind; sind gar keine Ziele sichtbar, zeigt ein deaktivierter
  Eintrag „Keine Ziele konfiguriert" an, dass das Menü leer ist.
- **Zwei Speicherwege.** Relative Ziele: `downloads.download` (nur
  Download-Ordner, `saveAs: false`, `filename` ist relativer Mehrsegment-Pfad).
  Absolute Ziele (`isAbsolutePath`: `/`, `~/`, `C:\`): Experiment
  `droptoFs.saveFile` via `IOUtils`. Absolute Pfade dürfen **nicht** durch
  `sanitizePath` laufen (zerstört den Präfix) — nur der Dateiname wird mit
  `sanitizeSeg` bereinigt, `..` weist das Experiment ab. Das Experiment
  (`src/experiments/filesystem/`) bewusst schmal halten.
- **Pfad-/Namens-Sanitizing** über `sanitizeSeg`/`sanitizePath`: Schrägstriche
  bleiben Trenner, Segmente werden bereinigt, `.`/`..` fallen raus. In der
  ESLint-Config ist `no-control-regex` deshalb **absichtlich aus**.
- **Storage-Schema** (`storage.local`): `debug`,
  `destinations: { "*" | [accountId]: [{ label, path }] }`. Der Schlüssel `"*"`
  hält kontounabhängige Ziele (Thunderbird-Konto-IDs heißen `account<N>`,
  Kollision ausgeschlossen). `path` ist relativ zum Thunderbird-Download-Ordner.
  Alte Schlüssel `baseDir`/`fallback` bleiben bewusst unmigriert liegen.
- **Extension-ID nicht leichtfertig ändern.** `storage.local` hängt an der ID
  (`browser_specific_settings.gecko.id`); ein Wechsel = neues Add-on = leere
  Einstellungen.

## Tooling-Hinweise

- `web-ext lint` meldet zwei `MANIFEST_PERMISSIONS`-Warnungen für `messagesRead`
  und `accountsRead` sowie einen `MANIFEST_FIELD_PRIVILEGED`-**Error** für
  `experiment_apis` — der Firefox-Linter kennt weder Thunderbird-Permissions
  noch Thunderbird-Experiments (dort regulär unterstützt). **Erwartbar, kein
  echter Fehler.** Der CI-Schritt ist deshalb informativ
  (`continue-on-error`).
- Menü-/Speicherverhalten lässt sich nicht unit-testen. Live prüfen via
  `npm start` (TB-Binary) oder Add-ons → Zahnrad → „Add-ons debuggen" →
  Untersuchen (Debug-Logging in den Einstellungen aktivieren).
- Zielumgebung: Thunderbird ab 115, getestet gegen aktuelle Releases (140+).
