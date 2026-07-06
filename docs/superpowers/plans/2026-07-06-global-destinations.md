# Kontounabhängige (globale) Ziele — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Globale Ziele unter `destinations["*"]`, die bei jeder E-Mail oben im DropTo-Menü erscheinen; das Fallback-Feature entfällt ersatzlos.

**Architecture:** MV2-MailExtension, Vanilla JS. Menülogik in `src/background.js` (persistenter Background, `messenger.menus`), Konfigurations-UI in `src/options/` (`storage.local`). Globale Ziele nutzen den reservierten Schlüssel `"*"` im bestehenden `destinations`-Objekt — die Speicher-Logik der Options-Seite bleibt dadurch unverändert.

**Tech Stack:** Thunderbird WebExtension APIs (`messenger.menus`, `messenger.storage.local`, `messenger.accounts`), ESLint 9, web-ext 10.

**Spec:** `docs/superpowers/specs/2026-07-06-global-destinations-design.md` (freigegeben).

## Global Constraints

- Es gibt **kein Test-Framework** und keine unit-testbare Menülogik (CLAUDE.md). Verifikationszyklus pro Task: `npm run lint` (harte Gate) + `npm run build` müssen grün sein; Verhaltens-Checks manuell in Thunderbird.
- Node über `.nvmrc` (22): vor npm-Befehlen `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- Deutsch für UI-Texte; ASCII-Umlaut-Schreibweise nur in JS-Kommentaren beibehalten, wo die Datei das schon so macht (`Menue`, `Eintraege`).
- **Kein Migrationscode**: alter `fallback`-Storage-Key bleibt ungenutzt liegen.
- Commit-Stil: Angular (`feat:`/`docs:`), kein Ticket, KEIN Claude-Trailer.
- `git push` NICHT ausführen.

---

### Task 1: background.js — globale Ziele im Menü, Fallback raus

**Files:**
- Modify: `src/background.js`

**Interfaces:**
- Consumes: `storage.local` → `{ debug, destinations: { "*"|<accountId>: [{label, path}] } }`
- Produces: Menüstruktur Root → globale Items (`dropto::*::<i>`, immer sichtbar) → Separator (`dropto::__sep__`) → Konto-Items (`dropto::<accountId>::<i>`, versteckt) → deaktivierter Hinweis (`dropto::__empty__`). itemMap-Meta: `{ global: true, path, label }` für globale, `{ accountId, path, label }` für Konto-Items.

- [ ] **Step 1: Konstanten & DEFAULTS umbauen**

`src/background.js` Kopfbereich (aktuell Z. 10–14 Doku, Z. 16–24 Konstanten). Doku-Kommentar: `fallback`-Zeile streichen, `destinations`-Zeile erweitern. Konstanten ersetzen:

```js
 * Konfiguration (storage.local, gepflegt in der Options-Seite):
 *   destinations : { "*" | [accountId]: [ { label, path } ] } - "*" = kontounabhaengig
 *   debug        : Konsolen-Logging
 */

const ROOT_ID = "dropto-root";
const SEPARATOR_ID = "dropto::__sep__";
const EMPTY_ID = "dropto::__empty__";
const GLOBAL_KEY = "*";
const ATTACH_CONTEXTS = ["message_attachments", "all_message_attachments"];

const DEFAULTS = Object.freeze({
  destinations: {},
  debug: false,
});
```

itemMap-Kommentar (Z. 28) anpassen:

```js
// menuItemId -> { accountId, path, label } | { global: true, path, label }
```

- [ ] **Step 2: `rebuildMenu()` ersetzen**

Aktuelle Funktion (Z. 53–88) komplett ersetzen durch:

```js
async function rebuildMenu() {
  const cfg = await getConfig();
  itemMap.clear();
  try { await messenger.menus.removeAll(); } catch (e) { warn("removeAll:", e && e.message); }

  await create({
    id: ROOT_ID,
    title: "DropTo",
    contexts: ATTACH_CONTEXTS,
    icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" },
  });

  // Globale Ziele: immer sichtbar, stehen vor den Konto-Zielen.
  const globals = Array.isArray((cfg.destinations || {})[GLOBAL_KEY])
    ? cfg.destinations[GLOBAL_KEY] : [];
  let globalCount = 0;
  globals.forEach((d, i) => {
    if (!d || !d.path) return;
    const id = `dropto::${GLOBAL_KEY}::${i}`;
    const label = d.label && d.label.trim() ? d.label.trim() : d.path;
    itemMap.set(id, { global: true, path: d.path, label });
    globalCount++;
    create({ id, parentId: ROOT_ID, title: label, contexts: ATTACH_CONTEXTS, visible: true });
  });

  // Trenner zwischen globalen und Konto-Zielen; onShown blendet ihn ein.
  await create({
    id: SEPARATOR_ID,
    parentId: ROOT_ID,
    type: "separator",
    contexts: ATTACH_CONTEXTS,
    visible: false,
  });

  for (const [accountId, dests] of Object.entries(cfg.destinations || {})) {
    if (accountId === GLOBAL_KEY || !Array.isArray(dests)) continue;
    dests.forEach((d, i) => {
      if (!d || !d.path) return;
      const id = `dropto::${accountId}::${i}`;
      const label = d.label && d.label.trim() ? d.label.trim() : d.path;
      itemMap.set(id, { accountId, path: d.path, label });
      // Initial versteckt; onShown blendet die passenden Ziele ein.
      create({ id, parentId: ROOT_ID, title: label, contexts: ATTACH_CONTEXTS, visible: false });
    });
  }

  // Deaktivierter Hinweis, damit das Menue nie leer ist.
  await create({
    id: EMPTY_ID,
    parentId: ROOT_ID,
    title: "Keine Ziele konfiguriert",
    contexts: ATTACH_CONTEXTS,
    enabled: false,
    visible: globalCount === 0,
  });

  log("Menue aufgebaut:", itemMap.size, "Eintraege");
}
```

- [ ] **Step 3: `onShown`-Listener ersetzen**

Aktueller Listener (Z. 101–125). Das ungenutzte `const cfg = await getConfig();` entfällt mit:

```js
messenger.menus.onShown.addListener(async (info, tab) => {
  if (!info.contexts || !ATTACH_CONTEXTS.some((c) => info.contexts.includes(c))) return;

  const message = await getMessage(info, tab);
  const accountId = (message && message.folder && message.folder.accountId) || null;

  const updates = [];
  let hasGlobals = false;
  let anyAccountVisible = false;
  for (const [id, meta] of itemMap) {
    if (meta.global) { hasGlobals = true; continue; }
    const vis = !!accountId && meta.accountId === accountId;
    if (vis) anyAccountVisible = true;
    updates.push(messenger.menus.update(id, { visible: vis }));
  }
  updates.push(messenger.menus.update(SEPARATOR_ID, { visible: hasGlobals && anyAccountVisible }));
  updates.push(messenger.menus.update(EMPTY_ID, { visible: !hasGlobals && !anyAccountVisible }));

  try {
    await Promise.all(updates);
    await messenger.menus.refresh();
  } catch (e) { warn("onShown refresh:", e && e.message); }
});
```

- [ ] **Step 4: `onClicked` vereinfachen**

Im Click-Listener (Z. 129 ff.): die Zeile `const cfg = await getConfig();` löschen (wurde nur noch fürs Fallback gebraucht; `debugEnabled` wird weiter über `rebuildMenu`/`storage.onChanged` gesetzt) und

```js
    const relPath = meta.fallback ? cfg.fallback : meta.path;
    const dir = sanitizePath(relPath);
```

ersetzen durch:

```js
    const dir = sanitizePath(meta.path);
```

- [ ] **Step 5: Verifizieren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
grep -n "FALLBACK_ID\|cfg.fallback\|meta.fallback" src/background.js   # erwartet: keine Treffer
npm run lint    # erwartet: grün (fängt auch ungenutzte Variablen wie cfg)
npm run build   # erwartet: dist/dropto-3.0.0.xpi
```

- [ ] **Step 6: Commit**

```bash
git add src/background.js
git commit -m "feat: global destinations in menu, drop fallback"
```

---

### Task 2: Options-Seite — „Alle Konten"-Block, Fallback-UI raus

**Files:**
- Modify: `src/options/options.js`
- Modify: `src/options/options.html`
- Modify: `src/options/options.css`

**Interfaces:**
- Consumes: `destRow(dest)`, `collect()` iteriert `.dests`-Listen über `data-accountId` (bestehend, unverändert).
- Produces: Ziel-Liste mit `dataset.accountId = "*"` → `collect()` schreibt `destinations["*"]`. Neue Funktionen `renderGlobalBlock(dests)` und `renderDestBlock(name, tag, email, key, dests)` in options.js.

- [ ] **Step 1: options.js — DEFAULTS, init, collect entschlacken**

`DEFAULTS` (Z. 3–7) ersetzen und `GLOBAL_KEY` ergänzen:

```js
const DEFAULTS = {
  destinations: {}, // { "*" | [accountId]: [ { label, path } ] } - "*" = kontounabhaengig
  debug: false,
};

const GLOBAL_KEY = "*";
```

In `init()`: Zeile `$("#fallback").value = cfg.fallback || "";` (Z. 19) und Zeile `$("#fallback").addEventListener("input", scheduleSave);` (Z. 24) löschen.

In `collect()`: Zeile `fallback: cleanPath($("#fallback").value) || DEFAULTS.fallback,` (Z. 146) löschen.

- [ ] **Step 2: options.js — Render-Logik verallgemeinern**

`renderAccounts()` (Z. 33–52) ersetzen durch (globaler Block wird immer zuerst gerendert, auch wenn Konten nicht laden):

```js
async function renderAccounts(cfg) {
  const container = $("#accounts");
  container.replaceChildren();
  container.appendChild(renderGlobalBlock((cfg.destinations && cfg.destinations[GLOBAL_KEY]) || []));

  let accounts = [];
  try {
    accounts = await messenger.accounts.list();
  } catch (e) {
    showMessage(container, "Konten konnten nicht geladen werden: " + String(e));
    return;
  }

  if (!accounts.length) {
    showMessage(container, "Keine Konten gefunden.");
    return;
  }

  for (const acc of accounts) {
    container.appendChild(renderAccount(acc, (cfg.destinations && cfg.destinations[acc.id]) || []));
  }
}
```

`renderAccount()` (Z. 55–100) ersetzen durch Wrapper + generischen Block-Builder + globalen Block:

```js
function renderAccount(acc, dests) {
  const email = (acc.identities && acc.identities[0] && acc.identities[0].email) || "";
  return renderDestBlock(acc.name || "(ohne Namen)", acc.type || "", email, acc.id, dests);
}

function renderGlobalBlock(dests) {
  return renderDestBlock("Alle Konten", "kontounabhängig", "", GLOBAL_KEY, dests);
}

function renderDestBlock(name, tag, email, key, dests) {
  const block = document.createElement("div");
  block.className = "acct";

  const head = document.createElement("div");
  head.className = "acct-head";
  const nameEl = document.createElement("span");
  nameEl.className = "acct-name";
  nameEl.textContent = name;
  head.appendChild(nameEl);
  if (tag) {
    const tagEl = document.createElement("span");
    tagEl.className = "acct-tag";
    tagEl.textContent = tag;
    head.appendChild(tagEl);
  }
  if (email) {
    const mail = document.createElement("span");
    mail.className = "acct-mail";
    mail.textContent = email;
    head.appendChild(mail);
  }

  const list = document.createElement("div");
  list.className = "dests";
  list.dataset.accountId = key;

  dests.forEach((d) => list.appendChild(destRow(d)));

  const add = document.createElement("button");
  add.type = "button";
  add.className = "add-dest";
  add.textContent = "+ Ziel hinzufügen";
  add.addEventListener("click", () => {
    const row = destRow({ label: "", path: "" });
    list.appendChild(row);
    const pathInput = row.querySelector(".d-path");
    if (pathInput) pathInput.focus();
    scheduleSave();
  });

  block.append(head, list, add);
  return block;
}
```

`showMessage()` (Z. 165–170): `container.replaceChildren(p)` durch `container.appendChild(p)` ersetzen, damit der globale Block bei Konto-Fehlern erhalten bleibt:

```js
function showMessage(container, text) {
  const p = document.createElement("p");
  p.className = "loading";
  p.textContent = text;
  container.appendChild(p);
}
```

- [ ] **Step 3: options.html — „Allgemein"-Card raus, Hilfetext anpassen**

Die komplette Card (enthält nur noch das Fallback-Feld) löschen:

```html
    <section class="card">
      <h2>Allgemein</h2>
      <div class="grid">
        <label class="field">
          <span>Fallback-Ziel (Konto ohne eigenes Ziel)</span>
          <input type="text" id="fallback" placeholder="Sonstige" autocomplete="off" spellcheck="false">
        </label>
      </div>
    </section>
```

Den `p.hint` in „Konten & Ziele" ersetzen durch:

```html
      <p class="hint">Ziele unter <strong>Alle Konten</strong> erscheinen bei jeder E-Mail,
        Konto-Ziele nur bei E-Mails des jeweiligen Kontos. Der <strong>Pfad</strong> ist relativ zum
        Download-Ordner von Thunderbird; Unterordner mit <code>/</code> möglich (z.&nbsp;B.
        <code>folderA/Rechnungen</code>). Der <strong>Name</strong> ist frei und erscheint im Menü
        (leer = Pfad).</p>
```

- [ ] **Step 4: options.css — tote Regeln entfernen**

Löschen (Z. 61–65; `input[type="text"]` ist global gestylt und bleibt):

```css
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }

.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: 12.5px; color: var(--muted); }
```

- [ ] **Step 5: Verifizieren**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
grep -rn "fallback\|\.grid\|\.field" src/options/   # erwartet: keine Treffer
npm run lint    # erwartet: grün
npm run build   # erwartet: dist/dropto-3.0.0.xpi
```

- [ ] **Step 6: Commit**

```bash
git add src/options/
git commit -m "feat: manage global destinations on options page"
```

---

### Task 3: Doku aktualisieren + Abschluss-Verifikation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Verhalten aus Task 1/2.
- Produces: konsistente Doku (keine Fallback-Erwähnungen mehr).

- [ ] **Step 1: README.md anpassen**

Z. 18 (`- Fallback-Ziel für Konten ohne eigene Ziele.`) ersetzen durch:

```markdown
- Kontounabhängige Ziele („Alle Konten") erscheinen bei jeder E-Mail — oberhalb
  der Konto-Ziele, durch eine Trennlinie abgesetzt. Ohne konfigurierte Ziele
  zeigt das Menü einen deaktivierten Hinweis.
```

Z. 42 (`- **Fallback-Ziel** – für Konten ohne eigenes Ziel (Standard \`Sonstige\`).`) ersetzen durch:

```markdown
- **Alle Konten** – kontounabhängige Ziele, erscheinen bei jeder E-Mail.
```

- [ ] **Step 2: CLAUDE.md-Invarianten anpassen**

Invariante „Dynamisches Menü" ersetzen durch:

```markdown
- **Dynamisches Menü.** Globale Ziele (`destinations["*"]`) sind immer sichtbar
  und stehen oben; Konto-Ziele werden als versteckte Kinder von `dropto-root`
  angelegt, `onShown` erkennt das Konto der Nachricht und blendet nur dessen
  Ziele ein, danach `menus.refresh()`. Der Separator erscheint nur, wenn beide
  Gruppen sichtbar sind; sind gar keine Ziele sichtbar, zeigt ein deaktivierter
  Eintrag „Keine Ziele konfiguriert" an, dass das Menü leer ist.
```

Storage-Schema-Invariante ersetzen durch:

```markdown
- **Storage-Schema** (`storage.local`): `debug`,
  `destinations: { "*" | [accountId]: [{ label, path }] }`. Der Schlüssel `"*"`
  hält kontounabhängige Ziele (Thunderbird-Konto-IDs heißen `account<N>`,
  Kollision ausgeschlossen). `path` ist relativ zum Thunderbird-Download-Ordner.
  Alte Schlüssel `baseDir`/`fallback` bleiben bewusst unmigriert liegen.
```

- [ ] **Step 3: Gesamt-Verifikation**

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
grep -rni fallback src/ README.md CLAUDE.md   # erwartet: keine Treffer
npm run lint && npm run build                 # erwartet: grün + XPI
```

Manuell in Thunderbird (temporäres Add-on oder XPI neu installieren):
1. Options: „Alle Konten"-Block oben mit Tag „kontounabhängig", Ziel anlegen → Autosave; Reload der Seite zeigt Ziel wieder (steht unter `destinations["*"]`).
2. Menü bei E-Mail eines Kontos mit eigenen Zielen: Globals oben, Trenner, Konto-Ziele darunter.
3. Konto ohne Ziele: nur Globals, kein Trenner.
4. Alle Ziele löschen: deaktivierter Eintrag „Keine Ziele konfiguriert".
5. Klick auf globales Ziel: Datei landet unter `<Download-Ordner>/<Pfad>/`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document global destinations"
```
