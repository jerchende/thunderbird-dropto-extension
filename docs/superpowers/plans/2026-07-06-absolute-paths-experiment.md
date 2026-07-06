# Absolute Zielpfade via Experiment API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DropTo kann Anhänge an absolute Pfade außerhalb des Thunderbird-Download-Ordners ablegen (Pfad-Konvention `/`, `~/`, `C:\` + Ordner-Picker-Button), umgesetzt über ein schmales WebExtension Experiment `messenger.droptoFs`.

**Architecture:** Ansatz A der Spec: Das Experiment liefert genau zwei privilegierte Funktionen (`saveFile` via `IOUtils`, `pickFolder` via `nsIFilePicker`). Relative Pfade laufen unverändert über die `downloads`-API; die Weiche ist `isAbsolutePath()` in `background.js`. Die Options-Seite erhält Prefix-erhaltendes `cleanPath()` und einen Picker-Button pro Ziel-Zeile.

**Tech Stack:** Thunderbird WebExtension Experiment (`ExtensionCommon.ExtensionAPI`, `IOUtils`, `PathUtils`, `nsIFilePicker`), MV2, Vanilla JS, ESLint 9, web-ext 10.

**Spec:** `docs/superpowers/specs/2026-07-06-absolute-paths-experiment-design.md` (freigegeben).

## Global Constraints

- Kein Test-Framework; Gate pro Task: `npm run lint` + `npm run build` grün, Verhalten manuell in Thunderbird.
- Node via `.nvmrc`: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"` vor npm-Befehlen.
- Zielumgebung Thunderbird ≥ 115 (`strict_min_version: "115.0"` bleibt); `pickFolder` braucht einen Kompat-Fallback für `nsIFilePicker.init` (< TB 125 Window statt BrowsingContext).
- Absolut = Pfad beginnt mit `/`, `~/` (auch `~\`) oder Laufwerksbuchstabe `C:\`/`C:/`. `~foo` ist NICHT absolut.
- Absolute Pfade NIEMALS durch `sanitizePath`/Segment-Filter jagen, die den Präfix zerstören.
- **Escaping-Falle für den Ausführenden:** Zeilen mit `\u0000`-Escapes (Regex in `cleanPath`) und `→` dürfen NICHT in Edit-`old_string`s vorkommen — Edits so schneiden, dass diese Zeilen unberührt bleiben, oder zeilenbasiert mit `sed` arbeiten.
- Commit-Stil: Angular, kein Ticket, KEIN Claude-Trailer. `git push` NICHT ausführen.

---

### Task 1: Experiment `droptoFs` + Manifest + ESLint

**Files:**
- Create: `src/experiments/filesystem/schema.json`
- Create: `src/experiments/filesystem/implementation.js`
- Modify: `src/manifest.json` (Key `experiment_apis` ergänzen)
- Modify: `eslint.config.mjs` (Override-Block für `src/experiments/`)

**Interfaces:**
- Produces: `messenger.droptoFs.saveFile(dirPath: string, fileName: string, data: ArrayBuffer) → Promise<string>` (finaler absoluter Pfad; wirft `ExtensionError` bei `..` oder Schreibfehler) und `messenger.droptoFs.pickFolder(title?: string) → Promise<string|null>`.

- [ ] **Step 1: `src/experiments/filesystem/schema.json` anlegen**

```json
[
  {
    "namespace": "droptoFs",
    "functions": [
      {
        "name": "saveFile",
        "type": "function",
        "async": true,
        "description": "Schreibt data als Datei fileName in den absoluten Ordner dirPath (legt Ordner rekursiv an, nummeriert bei Namenskonflikt). Gibt den finalen Pfad zurueck.",
        "parameters": [
          { "name": "dirPath", "type": "string" },
          { "name": "fileName", "type": "string" },
          { "name": "data", "type": "object", "isInstanceOf": "ArrayBuffer", "additionalProperties": true }
        ]
      },
      {
        "name": "pickFolder",
        "type": "function",
        "async": true,
        "description": "Oeffnet einen nativen Ordner-Dialog. Gibt den gewaehlten absoluten Pfad oder null (Abbruch) zurueck.",
        "parameters": [
          { "name": "title", "type": "string", "optional": true }
        ]
      }
    ]
  }
]
```

- [ ] **Step 2: `src/experiments/filesystem/implementation.js` anlegen**

```js
"use strict";

/* DropTo - Experiment "droptoFs"
 *
 * Privilegierte Mini-API: Schreiben an absolute Pfade ausserhalb des
 * Download-Ordners (IOUtils) und nativer Ordner-Dialog (nsIFilePicker).
 * Bewusst schmal halten - siehe CLAUDE.md ("Zwei Speicherwege").
 */

/* global ChromeUtils, Components, Services, IOUtils, PathUtils */

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);

var { ExtensionError } = ExtensionUtils;
var Ci = Components.interfaces;
var Cc = Components.classes;

/* "~/" bzw. "~\" zum Home-Verzeichnis expandieren. */
function expandHome(p) {
  const path = String(p == null ? "" : p).trim();
  if (/^~[/\\]/.test(path)) {
    return Services.dirsvc.get("Home", Ci.nsIFile).path + path.slice(1);
  }
  return path;
}

/* Freien Dateinamen finden - wie conflictAction "uniquify" der downloads-API. */
async function uniquePath(dir, fileName) {
  let target = PathUtils.join(dir, fileName);
  if (!(await IOUtils.exists(target))) return target;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let i = 1; ; i++) {
    target = PathUtils.join(dir, `${stem}(${i})${ext}`);
    if (!(await IOUtils.exists(target))) return target;
  }
}

var droptoFs = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      droptoFs: {
        async saveFile(dirPath, fileName, data) {
          const dir = expandHome(dirPath);
          if (dir.split(/[/\\]+/).some((seg) => seg === "..")) {
            throw new ExtensionError("Pfad darf kein '..' enthalten: " + dirPath);
          }
          try {
            await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
            const target = await uniquePath(dir, fileName);
            await IOUtils.write(target, new Uint8Array(data));
            return target;
          } catch (e) {
            throw new ExtensionError(String(e && e.message ? e.message : e));
          }
        },

        async pickFolder(title) {
          const win = Services.wm.getMostRecentWindow(null);
          if (!win) return null;
          const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
          const label = title || "Ordner wählen";
          try {
            fp.init(win.browsingContext, label, Ci.nsIFilePicker.modeGetFolder);
          } catch (_) {
            // TB < 125: init erwartet ein Window statt BrowsingContext.
            fp.init(win, label, Ci.nsIFilePicker.modeGetFolder);
          }
          const rv = await new Promise((resolve) => fp.open(resolve));
          return rv === Ci.nsIFilePicker.returnOK ? fp.file.path : null;
        },
      },
    };
  }
};
```

- [ ] **Step 3: `src/manifest.json` — Experiment registrieren**

Nach dem `"background"`-Block (vor der schließenden Klammer) ergänzen — Komma an `"background"`-Block anfügen:

```json
  "background": {
    "scripts": ["background.js"]
  },
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

- [ ] **Step 4: `eslint.config.mjs` — Chrome-Globals für Experimente**

Vor der schließenden `];` als weiteres Array-Element ergänzen:

```js
  {
    files: ["src/experiments/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ChromeUtils: "readonly",
        Components: "readonly",
        Services: "readonly",
        IOUtils: "readonly",
        PathUtils: "readonly",
      },
    },
    rules: {
      // Die Experiment-Klasse (var droptoFs) laedt Thunderbird ueber den Namespace.
      "no-unused-vars": "off",
    },
  },
```

- [ ] **Step 5: Verifizieren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
node -e "JSON.parse(require('fs').readFileSync('src/manifest.json')); JSON.parse(require('fs').readFileSync('src/experiments/filesystem/schema.json')); console.log('JSON ok')"
npm run lint    # erwartet: grün
npm run build   # erwartet: dist/dropto-3.0.0.xpi
```

- [ ] **Step 6: Commit**

```bash
git add src/experiments/ src/manifest.json eslint.config.mjs
git commit -m "feat: add droptoFs experiment for absolute paths"
```

---

### Task 2: background.js — Speicherweiche absolut/relativ

**Files:**
- Modify: `src/background.js` (onClicked-Handler + neuer Helfer bei den Sanitize-Funktionen)

**Interfaces:**
- Consumes: `messenger.droptoFs.saveFile(dirPath, fileName, data: ArrayBuffer)` aus Task 1.
- Produces: `isAbsolutePath(p: string) → boolean` (nur intern).

- [ ] **Step 1: Helfer `isAbsolutePath` ergänzen**

In `src/background.js` im Abschnitt `/* -------- Helfer -------- */` direkt vor `function sanitizeSeg` einfügen:

```js
/* Absoluter Pfad? ("/", "~/" bzw. "~\", Windows "C:\" oder "C:/") */
function isAbsolutePath(p) {
  return /^(\/|~[/\\]|[A-Za-z]:[/\\])/.test(String(p == null ? "" : p));
}
```

- [ ] **Step 2: onClicked — Weiche einbauen**

Im Click-Handler die Zeile

```js
    const dir = sanitizePath(meta.path);
```

ersetzen durch:

```js
    const absolute = isAbsolutePath(meta.path);
    const dir = absolute ? meta.path.trim() : sanitizePath(meta.path);
```

Und im per-Anhang-Loop den try-Block

```js
      try {
        const file = await messenger.messages.getAttachmentFile(message.id, partName);
        const url = URL.createObjectURL(file);
        const id = await messenger.downloads.download({
          url,
          filename: `${dir}/${sanitizeSeg(file.name)}`,
          conflictAction: "uniquify",
          saveAs: false,
        });
        revokeWhenDone(id, url);
        saved++;
      } catch (perAtt) {
```

ersetzen durch:

```js
      try {
        const file = await messenger.messages.getAttachmentFile(message.id, partName);
        if (absolute) {
          await messenger.droptoFs.saveFile(dir, sanitizeSeg(file.name), await file.arrayBuffer());
        } else {
          const url = URL.createObjectURL(file);
          const id = await messenger.downloads.download({
            url,
            filename: `${dir}/${sanitizeSeg(file.name)}`,
            conflictAction: "uniquify",
            saveAs: false,
          });
          revokeWhenDone(id, url);
        }
        saved++;
      } catch (perAtt) {
```

(Die Erfolgs-Notification `→ ${dir}/` weiter unten bleibt unverändert und passt für beide Wege. Deren Zeile enthält `→` — nicht anfassen.)

- [ ] **Step 3: Verifizieren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
npm run lint && npm run build   # erwartet: grün + XPI
```

- [ ] **Step 4: Commit**

```bash
git add src/background.js
git commit -m "feat: save to absolute paths via experiment"
```

---

### Task 3: Options-Seite — Prefix-erhaltendes cleanPath + Picker-Button

**Files:**
- Modify: `src/options/options.js` (`cleanPath`, `destRow`)
- Modify: `src/options/options.html` (Hinweis-Block)
- Modify: `src/options/options.css` (`.dest-row`-Grid)

**Interfaces:**
- Consumes: `messenger.droptoFs.pickFolder(title)` aus Task 1; bestehende `destRow`/`scheduleSave`/`setStatus`.
- Produces: `cleanPath()` erhält absolute Präfixe (`/`, `~/`, `C:/`); Rückgabe normalisiert Backslashes im Präfix zu `/`.

- [ ] **Step 1: `cleanPath()` prefix-erhaltend machen**

ACHTUNG Escaping-Falle: Die Regex-Zeile mit `\u0000-\u001f` NICHT in einen Edit-`old_string` aufnehmen. Zwei getrennte Edits:

Edit A — den Funktionskopf (Kommentar + erste zwei Codezeilen)

```js
/* Relativer Pfad: Schraegstriche bleiben Trenner, Segmente werden bereinigt. */
function cleanPath(value) {
  return String(value == null ? "" : value)
    .split(/[/\\]+/)
```

ersetzen durch:

```js
/* Pfad bereinigen: absolute Praefixe (/, ~/, C:\) bleiben erhalten,
   Segmente werden bereinigt, Schraegstriche bleiben Trenner. */
function cleanPath(value) {
  const raw = String(value == null ? "" : value).trim();
  const m = raw.match(/^(\/|~[/\\]|[A-Za-z]:[/\\])/);
  const prefix = m ? m[0].replace(/\\/g, "/") : "";
  const cleaned = raw.slice(prefix ? m[0].length : 0)
    .split(/[/\\]+/)
```

Edit B — das Funktionsende

```js
    .join("/");
}
```

ersetzen durch:

```js
    .join("/");
  return prefix + cleaned;
}
```

(Die `.map(...)`-/`.filter(...)`-Zeilen dazwischen bleiben unberührt.)

- [ ] **Step 2: Picker-Button in `destRow()`**

In `src/options/options.js` in `destRow()` nach der Zeile `path.addEventListener("input", scheduleSave);` einfügen:

```js
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "icon-btn";
  pick.title = "Ordner wählen…";
  pick.setAttribute("aria-label", "Ordner wählen");
  pick.textContent = "📁";
  pick.addEventListener("click", async () => {
    try {
      const chosen = await messenger.droptoFs.pickFolder("Zielordner wählen");
      if (chosen) { path.value = chosen; scheduleSave(); }
    } catch (e) {
      setStatus("Ordner-Dialog fehlgeschlagen: " + String(e), false);
    }
  });
```

Und die Zeile `row.append(label, path, remove);` ersetzen durch:

```js
  row.append(label, path, pick, remove);
```

- [ ] **Step 3: Hinweis-Block in `options.html` ergänzen**

Im `.notice`-Block nach dem Beispiel-Satz (endet auf `abgelegt.`) vor `</p>` ergänzen:

```html
        Pfade, die mit <code>/</code>, <code>~/</code> oder <code>C:\</code> beginnen,
        sind absolut und speichern außerhalb des Download-Ordners.
```

- [ ] **Step 4: `.dest-row`-Grid um Picker-Spalte erweitern**

In `src/options/options.css`:

```css
.dest-row { display: grid; grid-template-columns: 190px 1fr auto; gap: 8px; align-items: center; }
```

ersetzen durch:

```css
.dest-row { display: grid; grid-template-columns: 190px 1fr auto auto; gap: 8px; align-items: center; }
```

- [ ] **Step 5: Verifizieren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
npm run lint && npm run build   # erwartet: grün + XPI
node -e "
const s = require('fs').readFileSync('src/options/options.js','utf8');
const fn = new Function(s.match(/function cleanPath[\\s\\S]*?\\n}/)[0] + '; return cleanPath;')();
console.log(fn('~/Documents/Rechnungen'));   // ~/Documents/Rechnungen
console.log(fn('C:\\\\Ablage\\\\2026'));     // C:/Ablage/2026
console.log(fn('/Volumes/NAS/../etc'));      // /Volumes/NAS/etc (.. gefiltert)
console.log(fn('folderA/Rechnungen'));       // folderA/Rechnungen (unveraendert)
"
```

- [ ] **Step 6: Commit**

```bash
git add src/options/
git commit -m "feat: absolute paths and folder picker in options"
```

---

### Task 4: Doku + Abschluss-Verifikation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Verhalten aus Task 1–3.

- [ ] **Step 1: README.md**

a) In der Funktionen-Liste nach dem „Kontounabhängige Ziele…"-Bullet ergänzen:

```markdown
- Absolute Zielpfade (beginnend mit `/`, `~/` oder `C:\`) speichern außerhalb
  des Download-Ordners — per Eingabe oder Ordner-Dialog (📁-Button).
```

b) Einstellungen-Abschnitt, den **Pfad**-Bullet ersetzen:

```markdown
  - **Pfad** (relativ zum Download-Ordner von Thunderbird; Unterordner mit `/`,
    z. B. `folderA/Rechnungen` — oder absolut, z. B. `~/Documents/Rechnungen`;
    der 📁-Button öffnet einen Ordner-Dialog)
```

c) Den Sandbox-Bullet unter „Wie es funktioniert / Hinweise"

```markdown
- Eine MailExtension kann via `downloads`-API **ohne Dialog nur in den
  Download-Ordner bzw. dessen Unterordner** schreiben (Sandbox). Beliebige
  absolute Pfade außerhalb bräuchten eine Experiment-API (Kern-Eingriff) – bewusst
  nicht enthalten.
```

ersetzen durch:

```markdown
- Relative Ziele nutzen die `downloads`-API (Sandbox: nur Download-Ordner und
  Unterordner). Absolute Ziele schreibt das mitgelieferte Experiment `droptoFs`
  direkt via `IOUtils` — deshalb zeigt Thunderbird bei der Installation eine
  Warnung über vollen Zugriff, und diese Dateien erscheinen nicht in der
  Download-Historie.
```

d) Projektstruktur-Block: unter `background.js` ergänzen:

```
  experiments/
    filesystem/          # Experiment "droptoFs" (absolute Pfade, Ordner-Dialog)
      schema.json
      implementation.js
```

- [ ] **Step 2: CLAUDE.md**

a) Invariante **„Download-Sandbox"** komplett ersetzen durch:

```markdown
- **Zwei Speicherwege.** Relative Ziele: `downloads.download` (nur
  Download-Ordner, `saveAs: false`, `filename` ist relativer Mehrsegment-Pfad).
  Absolute Ziele (`isAbsolutePath`: `/`, `~/`, `C:\`): Experiment
  `droptoFs.saveFile` via `IOUtils`. Absolute Pfade dürfen **nicht** durch
  `sanitizePath` laufen (zerstört den Präfix) — nur der Dateiname wird mit
  `sanitizeSeg` bereinigt, `..` weist das Experiment ab. Das Experiment
  (`src/experiments/filesystem/`) bewusst schmal halten.
```

b) Struktur-Liste: nach der `src/options/`-Zeile ergänzen:

```markdown
- `src/experiments/filesystem/` — Experiment `droptoFs` (privilegiert:
  IOUtils-Schreiben an absolute Pfade, nativer Ordner-Picker).
```

c) Tooling-Hinweis zu `web-ext lint` ergänzen (im bestehenden Bullet): der
unbekannte Manifest-Key `experiment_apis` erzeugt dort eine zusätzliche
Warnung — erwartbar, der Schritt bleibt informativ.

- [ ] **Step 3: Gesamt-Verifikation**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
npm run lint && npm run build   # grün + dist/dropto-3.0.0.xpi
npm run lint:ext 2>&1 | grep -E "errors|warnings"   # 0 errors (Warnungen ok)
```

Manuell in Thunderbird (XPI neu installieren — Experiments laden bei temporärem Add-on ebenfalls):
1. Regression: relatives Ziel speichert wie bisher in den Download-Ordner.
2. Ziel `~/Desktop/DropToTest`: Datei landet dort, Ordner wird angelegt; zweite Ablage erzeugt `name(1).ext`.
3. Options: 📁-Button öffnet Ordner-Dialog; Auswahl übernimmt absoluten Pfad ins Feld, Autosave greift; Abbruch lässt das Feld unverändert.
4. Fehlerfall: nicht beschreibbares Ziel (z. B. `/System/DropToTest` auf macOS) → Fehler-Notification, kein Absturz.
5. Installation zeigt die „voller Zugriff"-Warnung (erwartet, dokumentiert).

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document absolute path support"
```
