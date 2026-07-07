# DropTo im „Alle speichern"-Dropdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein zweites Experiment `droptoMenu` injiziert ein DropTo-Untermenü in die Dropdowns der „Speichern"/„Alle speichern"-Buttons der Anhangsleiste; Klicks feuern ein Event, der Background speichert über die bestehende Pipeline.

**Architecture:** Experiment erkennt `about:message`-Dokumente über den `chrome-document-loaded`-Observer (+ Startup-Scan offener Fenster), hängt `popupshowing`-Listener an die verifizierten Popups `attachmentSaveAllSingleMenu`/`attachmentSaveAllMultipleMenu` und baut das Untermenü aus einer vom Background gepushten Ziel-Struktur (synchron verfügbar). Klick → Event `onTargetClicked(message, path)` → Background speichert via extrahiertem `saveAttachments()`. Keine Speicherlogik im Experiment.

**Tech Stack:** Thunderbird WebExtension Experiment (`ExtensionCommon`, `EventManager`, `MailServices`, XUL-Menü-Injektion), MV2, Vanilla JS.

**Spec:** `docs/superpowers/specs/2026-07-07-saveall-menu-experiment-design.md` (freigegeben).

## Global Constraints

- Kein Test-Framework; Gate pro Task: `npm run lint` + `npm run build` grün; Verhalten manuell in Thunderbird.
- Node via `.nvmrc`: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- Speicherlogik bleibt AUSSCHLIESSLICH im Background (`saveAttachments`); das Experiment baut nur Menüs.
- Degradation: fehlende Popup-IDs / fehlendes `gFolder`/`gMessage` dürfen nie werfen, sondern führen zu „kein Eintrag" bzw. „nur globale Ziele".
- **Escaping-Falle:** Der `onClicked`-Block in `background.js` enthält eine Notification-Zeile mit einem `→`-Escape. Diese Zeile darf in keinem Edit-`old_string`/`new_string` vorkommen — das Refactoring in Task 2 läuft deshalb über das mitgelieferte Python-Skript (arbeitet mit Anker-Strings ohne Escapes und verschiebt die Zeile unangetastet).
- Commit-Stil: Angular, kein Ticket, KEIN Claude-Trailer. `git push` NICHT ausführen.

---

### Task 1: Experiment `droptoMenu` + Manifest

**Files:**
- Create: `src/experiments/saveallmenu/schema.json`
- Create: `src/experiments/saveallmenu/implementation.js`
- Modify: `src/manifest.json` (zweiter `experiment_apis`-Eintrag)

**Interfaces:**
- Produces: `messenger.droptoMenu.setDestinations(destinations: object) → Promise<void>` (Ziel-Struktur cachen) und Event `messenger.droptoMenu.onTargetClicked(message: messages.MessageHeader, path: string)`.

- [ ] **Step 1: `src/experiments/saveallmenu/schema.json` anlegen**

```json
[
  {
    "namespace": "droptoMenu",
    "functions": [
      {
        "name": "setDestinations",
        "type": "function",
        "async": true,
        "description": "Aktuelle Ziel-Struktur (destinations aus storage.local) fuer den Menueaufbau cachen.",
        "parameters": [
          { "name": "destinations", "type": "object", "additionalProperties": true }
        ]
      }
    ],
    "events": [
      {
        "name": "onTargetClicked",
        "type": "function",
        "description": "Ein DropTo-Ziel im Speichern-Button-Dropdown wurde angeklickt.",
        "parameters": [
          { "name": "message", "$ref": "messages.MessageHeader" },
          { "name": "path", "type": "string" }
        ]
      }
    ]
  }
]
```

- [ ] **Step 2: `src/experiments/saveallmenu/implementation.js` anlegen**

```js
"use strict";

/* DropTo - Experiment "droptoMenu"
 *
 * Injiziert ein DropTo-Untermenue in die Dropdowns der "Speichern"/"Alle
 * speichern"-Buttons der Anhangsleiste (about:message). Baut NUR Menues -
 * die Speicherlogik liegt im Background (Event onTargetClicked).
 * Verifizierte Popup-IDs (comm-central, msgAttachmentView.inc.xhtml):
 * attachmentSaveAllSingleMenu / attachmentSaveAllMultipleMenu. Fehlen sie
 * nach einem TB-Umbau, degradiert das Feature still (kein Eintrag).
 * Chrome-Globals (ChromeUtils, Services, ...) kommen aus eslint.config.mjs.
 */

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

var POPUP_IDS = ["attachmentSaveAllSingleMenu", "attachmentSaveAllMultipleMenu"];
var GLOBAL_KEY = "*";
var MENU_CLASS = "dropto-injected";

function labelOf(d) {
  return d.label && d.label.trim() ? d.label.trim() : d.path;
}

var droptoMenu = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    if (!this.state) {
      this.state = this.initHooks();
    }
    const state = this.state;

    return {
      droptoMenu: {
        async setDestinations(destinations) {
          state.destinations = destinations || {};
        },

        onTargetClicked: new ExtensionCommon.EventManager({
          context,
          name: "droptoMenu.onTargetClicked",
          register(fire) {
            const cb = (msgHdr, path) => {
              fire.async(context.extension.messageManager.convert(msgHdr), path);
            };
            state.fireCallbacks.add(cb);
            return () => state.fireCallbacks.delete(cb);
          },
        }).api(),
      },
    };
  }

  initHooks() {
    const state = {
      destinations: {},
      fireCallbacks: new Set(),
      docEntries: new Map(), // doc -> [{ popup, listener }]
      observer: null,
    };

    const collectTargets = (win) => {
      const out = [];
      const globals = state.destinations[GLOBAL_KEY];
      if (Array.isArray(globals)) {
        for (const d of globals) {
          if (d && d.path) out.push({ group: "global", label: labelOf(d), path: d.path });
        }
      }
      let accountKey = null;
      try {
        const folder = win.gFolder;
        if (folder && folder.server) {
          const account = MailServices.accounts.findAccountForServer(folder.server);
          if (account) accountKey = account.key; // == accountId im Storage
        }
      } catch (_) { /* Nachricht ohne Konto (z. B. .eml) */ }
      const dests = accountKey ? state.destinations[accountKey] : null;
      if (Array.isArray(dests)) {
        for (const d of dests) {
          if (d && d.path) out.push({ group: "account", label: labelOf(d), path: d.path });
        }
      }
      return out;
    };

    const onPick = (win, path) => {
      const msgHdr = win.gMessage;
      if (!msgHdr) return;
      for (const fire of state.fireCallbacks) fire(msgHdr, path);
    };

    const injectMenu = (doc, popup) => {
      for (const n of popup.querySelectorAll("." + MENU_CLASS)) n.remove();

      const sep = doc.createXULElement("menuseparator");
      sep.classList.add(MENU_CLASS);
      const menu = doc.createXULElement("menu");
      menu.classList.add(MENU_CLASS);
      menu.setAttribute("label", "DropTo");
      const sub = doc.createXULElement("menupopup");

      const targets = collectTargets(doc.defaultView);
      if (!targets.length) {
        const item = doc.createXULElement("menuitem");
        item.setAttribute("label", "Keine Ziele konfiguriert");
        item.setAttribute("disabled", "true");
        sub.appendChild(item);
      } else {
        let lastGroup = null;
        for (const t of targets) {
          if (lastGroup && t.group !== lastGroup) {
            sub.appendChild(doc.createXULElement("menuseparator"));
          }
          lastGroup = t.group;
          const item = doc.createXULElement("menuitem");
          item.setAttribute("label", t.label);
          item.addEventListener("command", (ev) => {
            ev.stopPropagation();
            onPick(doc.defaultView, t.path);
          });
          sub.appendChild(item);
        }
      }

      menu.appendChild(sub);
      popup.appendChild(sep);
      popup.appendChild(menu);
    };

    const unhookDoc = (doc) => {
      const entries = state.docEntries.get(doc);
      if (!entries) return;
      for (const { popup, listener } of entries) {
        try { popup.removeEventListener("popupshowing", listener); } catch (_) { /* weg */ }
        try {
          for (const n of popup.querySelectorAll("." + MENU_CLASS)) n.remove();
        } catch (_) { /* weg */ }
      }
      state.docEntries.delete(doc);
    };

    const hookDoc = (doc) => {
      if (state.docEntries.has(doc)) return;
      const entries = [];
      for (const id of POPUP_IDS) {
        const popup = doc.getElementById(id);
        if (!popup) continue; // Degradation bei TB-Umbau
        const listener = () => {
          try { injectMenu(doc, popup); } catch (e) { console.error("[DropTo droptoMenu]", e); }
        };
        popup.addEventListener("popupshowing", listener);
        entries.push({ popup, listener });
      }
      if (!entries.length) return;
      state.docEntries.set(doc, entries);
      doc.defaultView.addEventListener("unload", () => unhookDoc(doc), { once: true });
    };

    state.observer = {
      observe(subject) {
        try {
          if (subject && subject.documentURI === "about:message") hookDoc(subject);
        } catch (e) { console.error("[DropTo droptoMenu]", e); }
      },
    };
    Services.obs.addObserver(state.observer, "chrome-document-loaded");

    // Bereits offene Nachrichten-Ansichten einsammeln.
    for (const win of Services.wm.getEnumerator(null)) {
      try {
        for (const b of win.document.querySelectorAll("browser")) {
          const doc = b.contentDocument;
          if (doc && doc.documentURI === "about:message") hookDoc(doc);
        }
      } catch (_) { /* Fenster ohne Browser */ }
    }

    this.cleanup = () => {
      try { Services.obs.removeObserver(state.observer, "chrome-document-loaded"); } catch (_) { /* schon weg */ }
      for (const doc of [...state.docEntries.keys()]) unhookDoc(doc);
    };

    return state;
  }

  onShutdown() {
    if (this.cleanup) this.cleanup();
  }
};
```

- [ ] **Step 3: `src/manifest.json` — zweites Experiment registrieren**

Im bestehenden `experiment_apis`-Objekt nach dem `droptoFs`-Eintrag (Komma ergänzen):

```json
    "droptoMenu": {
      "schema": "experiments/saveallmenu/schema.json",
      "parent": {
        "scopes": ["addon_parent"],
        "paths": [["droptoMenu"]],
        "script": "experiments/saveallmenu/implementation.js"
      }
    }
```

- [ ] **Step 4: Verifizieren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
node -e "JSON.parse(require('fs').readFileSync('src/manifest.json')); JSON.parse(require('fs').readFileSync('src/experiments/saveallmenu/schema.json')); console.log('JSON ok')"
npm run lint    # erwartet: grün (Experiment-Globals-Block existiert bereits)
npm run build   # erwartet: dist/dropto-3.0.0.xpi
```

- [ ] **Step 5: Commit**

```bash
git add src/experiments/saveallmenu/ src/manifest.json
git commit -m "feat: add droptoMenu experiment for save-all dropdown"
```

---

### Task 2: background.js — saveAttachments-Refactor + Event-Anbindung

**Files:**
- Modify: `src/background.js`

**Interfaces:**
- Consumes: `messenger.droptoMenu.setDestinations`, `messenger.droptoMenu.onTargetClicked` (Task 1); bestehende `isAbsolutePath`, `sanitizePath`, `sanitizeSeg`, `notify`, `revokeWhenDone`, `resolvePartNames`.
- Produces: `saveAttachments(message, partNames, path) → Promise<void>` (komplette Speicher-Pipeline inkl. Notifications).

- [ ] **Step 1: Refactor per Python-Skript (Escaping-sicher)**

Das Skript extrahiert die Speicher-Schleife samt Notifications aus dem `onClicked`-Handler in eine neue Top-Level-Funktion `saveAttachments(message, partNames, path)` und lässt die `→`-Zeile dabei byte-identisch. Ausführen mit `python3 <<'EOF' ... EOF`:

```python
import re, sys

P = "src/background.js"
s = open(P, encoding="utf-8").read()

# 1) Kopf des Handlers: Weiche + Leer-Check raus, Delegation rein.
old_head = (
    "    const absolute = isAbsolutePath(meta.path);\n"
    "    const dir = absolute ? meta.path.trim() : sanitizePath(meta.path);\n"
    "\n"
    "    const partNames = await resolvePartNames(info, message.id);\n"
    "    if (!partNames.length) {\n"
    '      await notify("Kein Anhang", "Kein Anhang zum Speichern gefunden.");\n'
    "      return;\n"
    "    }\n"
    "\n"
)
assert s.count(old_head) == 1, "Handler-Kopf nicht (eindeutig) gefunden"

# 2) Rumpf ausschneiden: von 'let saved = 0;' bis vor das aeussere catch.
m = re.search(r"\n(    let saved = 0;\n.*?\n    \}\n)(  \} catch \(e\) \{)", s, re.S)
assert m, "Speicher-Rumpf nicht gefunden"
body = m.group(1)

# Rumpf um 2 Spaces ausruecken (kommt aus try{} in eine Top-Level-Funktion).
dedented = "".join(
    (line[2:] if line.startswith("  ") else line) for line in body.splitlines(keepends=True)
)

new_head = (
    "    const partNames = await resolvePartNames(info, message.id);\n"
    "    await saveAttachments(message, partNames, meta.path);\n"
)

func = (
    "\n/* Anhaenge (partNames) einer Nachricht ins Ziel path ablegen (relativ oder absolut). */\n"
    "async function saveAttachments(message, partNames, path) {\n"
    "  const absolute = isAbsolutePath(path);\n"
    "  const dir = absolute ? path.trim() : sanitizePath(path);\n"
    "\n"
    "  if (!partNames.length) {\n"
    '    await notify("Kein Anhang", "Kein Anhang zum Speichern gefunden.");\n'
    "    return;\n"
    "  }\n"
    "\n"
    + dedented +
    "}\n"
)

# 3) Zusammensetzen: Kopf ersetzen, Rumpf aus dem Handler entfernen,
#    Funktion nach dem Handler ('});' + Leerzeile) einfuegen.
s = s.replace(old_head, new_head)
s = s.replace("\n" + body, "\n", 1)

anchor = new_head + "  } catch (e) {"
i = s.index(anchor)
end = s.index("\n});\n", i) + len("\n});\n")
s = s[:end] + func + s[end:]

open(P, "w", encoding="utf-8").write(s)
print("Refactor ok")
```

Danach prüfen: `node --check src/background.js` → kein Fehler.

- [ ] **Step 2: Event-Anbindung + Destinations-Push**

Edit 1 — am Ende von `rebuildMenu()` (nach dem `create({ id: EMPTY_ID, ... });`-Block, vor der `log("Menue aufgebaut:...`-Zeile) einfügen:

```js
  // Ziel-Struktur ans Save-Button-Dropdown-Experiment pushen.
  try {
    await messenger.droptoMenu.setDestinations(cfg.destinations || {});
  } catch (e) { warn("setDestinations:", e && e.message); }

```

Edit 2 — nach dem Ende des `menus.onClicked`-Handlers (`});`) einfügen:

```js

/* DropTo-Eintraege im "Speichern"/"Alle speichern"-Dropdown (Experiment droptoMenu). */
messenger.droptoMenu.onTargetClicked.addListener(async (message, path) => {
  try {
    const atts = await messenger.messages.listAttachments(message.id);
    await saveAttachments(message, atts.map((a) => a.partName), path);
  } catch (e) {
    err("SaveAll-Menue:", e);
    await notify("Fehler beim Ablegen", String(e && e.message ? e.message : e));
  }
});
```

- [ ] **Step 3: Verifizieren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
node --check src/background.js
npm run lint && npm run build   # erwartet: grün + XPI
grep -c "let saved = 0;" src/background.js   # erwartet: 1 (nur noch in saveAttachments)
```

- [ ] **Step 4: Commit**

```bash
git add src/background.js
git commit -m "feat: offer targets in save-all dropdown"
```

---

### Task 3: Doku + Abschluss-Verifikation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README.md**

a) Funktionen-Liste, nach dem Bullet zu absoluten Zielpfaden:

```markdown
- DropTo-Untermenü auch im Dropdown des „Speichern"/„Alle speichern"-Buttons
  der Anhangsleiste (speichert alle Anhänge der Mail).
```

b) Im Abschnitt „Wie es funktioniert / Hinweise" nach dem `droptoFs`-Bullet:

```markdown
- Das zweite Experiment `droptoMenu` hängt das DropTo-Untermenü in die
  Dropdowns der Speichern-Buttons der Anhangsleiste. Es nutzt
  Thunderbird-interne IDs — nach einem TB-Umbau fehlt der Eintrag schlimmstenfalls
  einfach, der Rest des Add-ons bleibt unberührt.
```

c) Projektstruktur: unter dem `filesystem/`-Block:

```
    saveallmenu/         # Experiment "droptoMenu" (Save-Button-Dropdown)
      schema.json
      implementation.js
```

- [ ] **Step 2: CLAUDE.md**

a) Neue Invariante nach „Zwei Speicherwege":

```markdown
- **Save-Button-Dropdown (`droptoMenu`).** Das Experiment
  `src/experiments/saveallmenu/` injiziert bei `popupshowing` in die Popups
  `attachmentSaveAllSingleMenu`/`attachmentSaveAllMultipleMenu` von
  `about:message` (IDs gegen comm-central verifiziert). Es baut NUR Menüs;
  Klicks feuern `onTargetClicked(message, path)`, gespeichert wird im
  Background über `saveAttachments`. Fehlen die Popups nach einem TB-Umbau,
  degradiert das Feature still — niemals werfen. Ziel-Struktur wird per
  `setDestinations` aus `rebuildMenu()` gepusht.
```

b) Struktur-Liste, die `src/experiments/filesystem/`-Zeile ergänzen um:

```markdown
- `src/experiments/saveallmenu/` — Experiment `droptoMenu` (DropTo im
  Speichern-Button-Dropdown; nur Menü-Injektion, keine Speicherlogik).
```

- [ ] **Step 3: Gesamt-Verifikation**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
npm run lint && npm run build   # grün + XPI
```

Manuell in Thunderbird (XPI neu installieren):
1. Mail mit mehreren Anhängen: „Alle speichern"-Dropdown → Trenner + „DropTo"-Untermenü (globale Ziele, Trenner, Konto-Ziele); Klick speichert alle Anhänge (relativ und absolut testen).
2. Mail mit einem Anhang: „Speichern"-Dropdown zeigt dasselbe.
3. Eigenständiges Nachrichtenfenster: Untermenü vorhanden.
4. Ziel in den Einstellungen umbenennen → Dropdown zeigt beim nächsten Öffnen den neuen Namen.
5. Add-on deaktivieren → Einträge verschwinden ohne Neustart.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document save-all menu integration"
```
