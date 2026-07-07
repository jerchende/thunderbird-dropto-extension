"use strict";

/* DropTo - Background
 *
 * Haengt ein Untermenue "DropTo" ins Anhang-Kontextmenue. Pro Konto koennen
 * mehrere Ziele konfiguriert sein; beim Aufklappen werden nur die Ziele des
 * Kontos der angezeigten Nachricht eingeblendet (onShown). Gespeichert wird
 * unter <Download-Ordner>/<Ziel-Pfad>/.
 *
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

let debugEnabled = false;

// menuItemId -> { accountId, path, label } | { global: true, path, label }
const itemMap = new Map();

/* --------------------------------- Logging ------------------------------- */

function log(...a)  { if (debugEnabled) console.log("[DropTo]", ...a); }
function warn(...a) { if (debugEnabled) console.warn("[DropTo]", ...a); }
function err(...a)  { console.error("[DropTo]", ...a); }

/* ------------------------------- Konfiguration --------------------------- */

async function getConfig() {
  const cfg = await messenger.storage.local.get(DEFAULTS);
  debugEnabled = !!cfg.debug;
  return cfg;
}

/* ------------------------------ Menue-Aufbau ----------------------------- */

function create(props) {
  return new Promise((resolve) => {
    messenger.menus.create(props, () => { void messenger.runtime.lastError; resolve(); });
  });
}

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

messenger.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.debug) debugEnabled = !!changes.debug.newValue;
  await rebuildMenu();
  try { await messenger.menus.refresh(); } catch (_) { /* Menue evtl. nicht offen */ }
});

rebuildMenu();

/* --------------------------- Dynamik beim Anzeigen ----------------------- */

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

/* -------------------------------- Klick ---------------------------------- */

messenger.menus.onClicked.addListener(async (info, tab) => {
  const meta = itemMap.get(info.menuItemId);
  if (!meta) return; // Obermenue oder fremder Eintrag

  try {
    const message = await getMessage(info, tab);
    if (!message) {
      await notify("Keine E-Mail gefunden", "Konnte die zugehoerige Nachricht nicht ermitteln.");
      return;
    }

    const partNames = await resolvePartNames(info, message.id);
    await saveAttachments(message, partNames, meta.path);
  } catch (e) {
    err("Abbruch:", e);
    await notify("Fehler beim Ablegen", String(e && e.message ? e.message : e));
  }
});

/* Anhaenge (partNames) einer Nachricht in den absoluten Zielordner path ablegen. */
async function saveAttachments(message, partNames, path) {
  const absolute = isAbsolutePath(path);
  const dir = absolute ? path.trim() : sanitizePath(path);

  if (!partNames.length) {
    await notify("Kein Anhang", "Kein Anhang zum Speichern gefunden.");
    return;
  }

  let saved = 0;
  for (const partName of partNames) {
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
      err("Anhang", partName, "fehlgeschlagen:", perAtt);
    }
  }

  if (saved > 0) {
    await notify(saved === 1 ? "Abgelegt" : `${saved} Anhaenge abgelegt`, `\u2192 ${dir}/`);
  } else {
    await notify("Nichts gespeichert", "Alle Anhaenge fehlgeschlagen (Details in der Konsole).");
  }
}

/* -------------------------------- Helfer --------------------------------- */

async function getMessage(info, tab) {
  let activeTab = null;
  try {
    const t = await messenger.tabs.query({ active: true, currentWindow: true });
    activeTab = t && t[0];
  } catch (e) { warn("tabs.query:", e && e.message); }

  const ids = [];
  if (tab && tab.id != null) ids.push(tab.id);
  if (activeTab && activeTab.id != null && !ids.includes(activeTab.id)) ids.push(activeTab.id);

  for (const id of ids) {
    try {
      const m = await messenger.messageDisplay.getDisplayedMessage(id);
      if (m) return m;
    } catch (e) { warn("getDisplayedMessage(", id, "):", e && e.message); }
  }

  try {
    const sel = await messenger.mailTabs.getSelectedMessages();
    const arr = sel && (sel.messages || sel);
    if (arr && arr.length) return arr[0];
  } catch (e) { warn("getSelectedMessages:", e && e.message); }

  try {
    const all = await messenger.tabs.query({});
    for (const t of all) {
      try {
        const m = await messenger.messageDisplay.getDisplayedMessage(t.id);
        if (m) return m;
      } catch (_) { /* skip */ }
    }
  } catch (e) { warn("Tab-Scan:", e && e.message); }

  if (info.selectedMessages && info.selectedMessages.messages && info.selectedMessages.messages.length) {
    return info.selectedMessages.messages[0];
  }
  return null;
}

async function resolvePartNames(info, messageId) {
  if (info.attachments && info.attachments.length) {
    const names = info.attachments.map((a) => a && a.partName).filter(Boolean);
    if (names.length) return names;
  }
  const all = await messenger.messages.listAttachments(messageId);
  return all.map((a) => a.partName).filter(Boolean);
}

/* Absoluter Pfad? ("/", "~/" bzw. "~\", Windows "C:\" oder "C:/") */
function isAbsolutePath(p) {
  return /^(\/|~[/\\]|[A-Za-z]:[/\\])/.test(String(p == null ? "" : p));
}

// Einzelnes Pfadsegment / Dateiname entschaerfen.
function sanitizeSeg(name) {
  const cleaned = String(name == null ? "" : name)
    .replace(/[/\\]/g, "_")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .replace(/^\.+/, "_")
    .trim();
  return cleaned || "unbenannt";
}

// Mehrsegmentigen relativen Pfad bereinigen (Schraegstriche bleiben Trenner).
function sanitizePath(p) {
  const segs = String(p == null ? "" : p)
    .split(/[/\\]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => sanitizeSeg(s));
  return segs.join("/") || "unbenannt";
}

function revokeWhenDone(downloadId, url) {
  const listener = (delta) => {
    if (delta.id === downloadId && delta.state &&
        (delta.state.current === "complete" || delta.state.current === "interrupted")) {
      URL.revokeObjectURL(url);
      messenger.downloads.onChanged.removeListener(listener);
    }
  };
  messenger.downloads.onChanged.addListener(listener);
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ } }, 120000);
}

async function notify(title, message) {
  try {
    await messenger.notifications.create({
      type: "basic",
      iconUrl: messenger.runtime.getURL("icons/icon-48.png"),
      title,
      message: message || "",
    });
  } catch (e) { warn("notify:", e && e.message); }
}
