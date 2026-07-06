# Design: Absolute Zielpfade via WebExtension Experiment API

Datum: 2026-07-06 · Status: freigegeben

## Problem / Ziel

Die `downloads`-API erlaubt nur Pfade **innerhalb** des Thunderbird-Download-
Ordners (`filename` ist „relative to the Downloads directory"). DropTo soll
Anhänge zusätzlich an **beliebige absolute Pfade** ablegen können (z. B.
`~/Documents/Rechnungen`, `/Volumes/NAS/Ablage`, `C:\Ablage`). Dafür wird ein
schmales WebExtension Experiment mitgeliefert (Ansatz A: minimale privilegierte
Fläche); relative Pfade laufen unverändert über die downloads-API.

## Entscheidungen (mit User geklärt)

1. **Eingabe: beides.** Pfad-Konvention (Ziel beginnt mit `/`, `~/` oder
   Laufwerksbuchstabe ⇒ absolut) **und** ein Ordner-Picker-Button pro
   Ziel-Zeile.
2. **Plattformneutral:** auch Windows-Pfade (`C:\…` bzw. `C:/…`) werden als
   absolut erkannt.
3. **Ansatz A:** Experiment mit genau zwei Funktionen (`saveFile`,
   `pickFolder`); kein Umbau des relativen Speicherwegs.
4. Gilt für globale wie Konto-Ziele gleichermaßen (Zieltyp ist eine Eigenschaft
   des Pfads, nicht der Zuordnung).

## Architektur

### Experiment `messenger.droptoFs`

Neue Dateien:

- `src/experiments/filesystem/schema.json` — API-Schema (Namespace `droptoFs`,
  Funktionen `saveFile`, `pickFolder`).
- `src/experiments/filesystem/implementation.js` — privilegierte Implementierung
  (`ExtensionCommon.ExtensionAPI`, geladen via `ChromeUtils.importESModule`,
  nutzt `IOUtils`/`PathUtils`, `Services`).

Manifest-Registrierung:

```json
"experiment_apis": {
  "droptoFs": {
    "schema": "experiments/filesystem/schema.json",
    "parent": {
      "scopes": ["addon_parent"],
      "paths": [["droptoFs"]],
      "script": "experiments/filesystem/implementation.js"
    }
  }
}
```

**`saveFile(dirPath, fileName, data)`** (`data`: ArrayBuffer) →

1. `dirPath` normalisieren: führendes `~` zum Home-Verzeichnis expandieren
   (`Services.dirsvc` / `PathUtils`), Backslashes tolerieren.
2. Sicherheitsprüfung: `..`-Segmente ablehnen (Fehler werfen).
3. Ordner rekursiv anlegen: `IOUtils.makeDirectory(dir, { createAncestors:
   true, ignoreExisting: true })`.
4. Namenskonflikte wie die downloads-API auflösen: existiert
   `name.ext`, dann `name(1).ext`, `name(2).ext`, … (`IOUtils.exists`-Schleife).
5. Schreiben via `IOUtils.write(path, new Uint8Array(data))`.
6. Finalen absoluten Pfad zurückgeben (für die Notification).

**`pickFolder(title)`** → öffnet `nsIFilePicker` (`modeGetFolder`) am zuletzt
fokussierten Fenster; liefert den gewählten absoluten Pfad oder `null` bei
Abbruch.

### Pfad-Erkennung (Extension-Seite)

```js
function isAbsolutePath(p) {
  return /^(\/|~[/\\]|[A-Za-z]:[/\\])/.test(p);
}
```

Wird identisch in `src/background.js` und `src/options/options.js` benötigt
(bewusst dupliziert — das Projekt hat kein Build-/Modul-Setup).

### Speichern (`src/background.js`, `onClicked`)

- `isAbsolutePath(meta.path)` **falsch** → bisheriger Weg
  (`sanitizePath` + `downloads.download`), unverändert.
- **wahr** → `const data = await file.arrayBuffer();` dann
  `messenger.droptoFs.saveFile(meta.path, sanitizeSeg(file.name), data)`.
  Der absolute Pfad läuft **nicht** durch `sanitizePath` (würde den führenden
  `/` bzw. `C:` zerstören); Segment-Bereinigung übernimmt das Experiment nur
  defensiv (`..`-Ablehnung), ansonsten gilt der Pfad wie eingegeben.
- Notification zeigt wie bisher den Zielpfad (`→ <pfad>/`).

### Options-Seite

- **`cleanPath()`** erkennt absolute Pfade und erhält deren Präfix: bei
  absoluten Pfaden werden nur die Segmente bereinigt (Steuerzeichen etc.),
  führender `/`, `~/` oder `C:\` bleibt bestehen; relative Pfade wie bisher.
- **Picker-Button:** pro Ziel-Zeile ein Button (`icon-btn`, Titel „Ordner
  wählen…", Ordner-Symbol) zwischen Pfad-Feld und Entfernen-Button. Klick →
  `messenger.droptoFs.pickFolder()`; bei Auswahl wird der Pfad ins `.d-path`-
  Feld geschrieben und `scheduleSave()` ausgelöst; bei `null` passiert nichts.
- **Hinweis-Block oben** ergänzen: absolute Pfade (beginnend mit `/`, `~/`
  oder `C:\`) speichern außerhalb des Download-Ordners.

## Konsequenzen / Doku

- Dateien, die übers Experiment geschrieben werden, erscheinen **nicht** in der
  Thunderbird-Download-Historie (akzeptiert).
- Thunderbird zeigt bei Installation/Update die Warnung über vollen Zugriff
  (Experiments sind privilegiert); für ATN-Signierung ist mit strengerer Review
  zu rechnen. Für unsignierten Eigengebrauch irrelevant.
- `README.md`: Sandbox-Abschnitt umschreiben (absolute Pfade jetzt möglich,
  wie sie erkannt werden, Hinweis auf Experiment + Warnung).
- `CLAUDE.md`: Invariante **„Download-Sandbox"** ersetzen (relative Pfade →
  downloads-API; absolute → `droptoFs`-Experiment; `sanitizePath` nur für
  relative Pfade!) und Struktur-Liste um `src/experiments/` ergänzen.
- Zielumgebung bleibt TB ≥ 115 (`ChromeUtils.importESModule`, `IOUtils`,
  `PathUtils` verfügbar).

## Fehlerfälle / Kanten

- Schreibfehler (fehlende Rechte, nicht gemountetes Volume) → Exception läuft
  in den bestehenden per-Anhang-try/catch, Fehler-Notification wie gehabt.
- `..` im absoluten Pfad → Experiment wirft, Anhang gilt als fehlgeschlagen.
- Picker-Abbruch → `null`, Feld unverändert.
- `~` ohne folgenden Separator (z. B. `~foo`) gilt **nicht** als absolut.
- Leerer Pfad nach Bereinigung → wie bisher „unbenannt" (nur relativer Weg).

## Verifikation

1. `npm run lint` + `npm run build` grün. `web-ext lint` wird das Experiment
   ggf. anmeckern (unbekannter Manifest-Key) — der Schritt bleibt informativ.
2. Manuell in Thunderbird:
   - Relatives Ziel funktioniert unverändert (Regression).
   - Ziel `~/Desktop/DropToTest` → Datei landet dort, Ordner wird angelegt,
     Doppel-Ablage erzeugt `name(1).ext`.
   - Ziel `/tmp/dropto-test` (macOS) → funktioniert.
   - Picker-Button öffnet Ordner-Dialog, übernimmt Pfad ins Feld, Autosave.
   - Fehlerfall: Ziel unter nicht beschreibbarem Pfad (z. B. `/System/…`) →
     Fehler-Notification, kein Absturz.
