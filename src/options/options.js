"use strict";

const DEFAULTS = {
  baseDir: "000_Rechnungen",
  fallback: "Sonstige",
  destinations: {}, // { [accountId]: [ { label, path } ] }
  debug: false,
};

const $ = (sel) => document.querySelector(sel);

let statusTimer = null;
let saveTimer = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const cfg = await messenger.storage.local.get(DEFAULTS);

  $("#baseDir").value = cfg.baseDir || "";
  $("#fallback").value = cfg.fallback || "";
  $("#debug").checked = !!cfg.debug;

  await renderAccounts(cfg);
  updatePathHint();
  updatePrefixes();

  $("#baseDir").addEventListener("input", () => { updatePathHint(); updatePrefixes(); scheduleSave(); });
  $("#fallback").addEventListener("input", scheduleSave);
  $("#debug").addEventListener("change", scheduleSave);
  $("#save").addEventListener("click", () => save(true));
}

async function renderAccounts(cfg) {
  const container = $("#accounts");
  let accounts = [];
  try {
    accounts = await messenger.accounts.list();
  } catch (e) {
    showMessage(container, "Konten konnten nicht geladen werden: " + String(e));
    return;
  }

  container.replaceChildren();
  if (!accounts.length) {
    showMessage(container, "Keine Konten gefunden.");
    return;
  }

  for (const acc of accounts) {
    container.appendChild(renderAccount(acc, (cfg.destinations && cfg.destinations[acc.id]) || []));
  }
}

function renderAccount(acc, dests) {
  const email = (acc.identities && acc.identities[0] && acc.identities[0].email) || "";

  const block = document.createElement("div");
  block.className = "acct";

  const head = document.createElement("div");
  head.className = "acct-head";
  const name = document.createElement("span");
  name.className = "acct-name";
  name.textContent = acc.name || "(ohne Namen)";
  head.appendChild(name);
  if (acc.type) {
    const tag = document.createElement("span");
    tag.className = "acct-tag";
    tag.textContent = acc.type;
    head.appendChild(tag);
  }
  if (email) {
    const mail = document.createElement("span");
    mail.className = "acct-mail";
    mail.textContent = email;
    head.appendChild(mail);
  }

  const list = document.createElement("div");
  list.className = "dests";
  list.dataset.accountId = acc.id;

  (dests.length ? dests : []).forEach((d) => list.appendChild(destRow(d)));

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

function destRow(dest) {
  const row = document.createElement("div");
  row.className = "dest-row";

  const label = document.createElement("input");
  label.type = "text";
  label.className = "d-label";
  label.placeholder = "Name (optional)";
  label.autocomplete = "off";
  label.spellcheck = false;
  label.value = (dest && dest.label) || "";
  label.addEventListener("input", scheduleSave);

  const pathWrap = document.createElement("div");
  pathWrap.className = "path-wrap";
  const prefix = document.createElement("span");
  prefix.className = "path-prefix";
  prefix.textContent = prefixText();
  const path = document.createElement("input");
  path.type = "text";
  path.className = "d-path";
  path.placeholder = "z. B. folderA/Rechnungen";
  path.autocomplete = "off";
  path.spellcheck = false;
  path.value = (dest && dest.path) || "";
  path.addEventListener("input", scheduleSave);
  pathWrap.append(prefix, path);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-btn";
  remove.title = "Ziel entfernen";
  remove.setAttribute("aria-label", "Ziel entfernen");
  remove.textContent = "\u00d7";
  remove.addEventListener("click", () => { row.remove(); scheduleSave(); });

  row.append(label, pathWrap, remove);
  return row;
}

function collect() {
  const destinations = {};
  document.querySelectorAll(".dests").forEach((list) => {
    const accountId = list.dataset.accountId;
    const arr = [];
    list.querySelectorAll(".dest-row").forEach((row) => {
      const path = cleanPath(row.querySelector(".d-path").value);
      if (!path) return;
      const label = row.querySelector(".d-label").value.trim();
      arr.push(label ? { label, path } : { path });
    });
    if (arr.length) destinations[accountId] = arr;
  });

  return {
    baseDir: cleanSeg($("#baseDir").value) || DEFAULTS.baseDir,
    fallback: cleanPath($("#fallback").value) || DEFAULTS.fallback,
    debug: $("#debug").checked,
    destinations,
  };
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(false), 400);
}

async function save(explicit) {
  const cfg = collect();
  try {
    await messenger.storage.local.set(cfg);
    setStatus(explicit ? "Gespeichert." : "Automatisch gespeichert.", true);
  } catch (e) {
    setStatus("Fehler beim Speichern: " + String(e), false);
  }
}

/* --------------------------------- UI-Helfer ----------------------------- */

function prefixText() {
  const base = cleanSeg($("#baseDir").value) || DEFAULTS.baseDir;
  return `${base}/`;
}

function updatePrefixes() {
  const t = prefixText();
  document.querySelectorAll(".path-prefix").forEach((el) => { el.textContent = t; });
}

function updatePathHint() {
  const base = cleanSeg($("#baseDir").value) || DEFAULTS.baseDir;
  $("#pathHint").textContent = `~/Downloads/${base}/<Ziel>/`;
}

function setStatus(text, ok) {
  const el = $("#status");
  el.textContent = text;
  el.classList.toggle("ok", !!ok);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ""; el.classList.remove("ok"); }, 2500);
}

function showMessage(container, text) {
  const p = document.createElement("p");
  p.className = "loading";
  p.textContent = text;
  container.replaceChildren(p);
}

/* Einzelnes Segment (Basisordner): keine Schraegstriche. */
function cleanSeg(value) {
  return String(value == null ? "" : value)
    .replace(/[/\\]/g, "_")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
}

/* Relativer Pfad: Schraegstriche bleiben Trenner, Segmente werden bereinigt. */
function cleanPath(value) {
  return String(value == null ? "" : value)
    .split(/[/\\]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+/, ""))
    .join("/");
}
