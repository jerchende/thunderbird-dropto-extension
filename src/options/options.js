"use strict";

const DEFAULTS = {
  destinations: {}, // { "*" | [accountId]: [ { label, path } ] } - "*" = kontounabhaengig
  debug: false,
};

const GLOBAL_KEY = "*";

const $ = (sel) => document.querySelector(sel);
const t = (key, subs) => messenger.i18n.getMessage(key, subs);

let statusTimer = null;
let saveTimer = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  localize();
  const cfg = await messenger.storage.local.get(DEFAULTS);

  $("#debug").checked = !!cfg.debug;

  renderGlobalDests(cfg);
  await renderAccounts(cfg);

  $("#debug").addEventListener("change", scheduleSave);
}

/* Statische Texte (data-i18n) durch die Sprachdateien ersetzen. */
function localize() {
  document.documentElement.lang = messenger.i18n.getUILanguage();
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
}

async function renderAccounts(cfg) {
  const container = $("#accounts");
  container.replaceChildren();

  let accounts = [];
  try {
    accounts = await messenger.accounts.list();
  } catch (e) {
    showMessage(container, t("accountsLoadError") + String(e));
    return;
  }

  if (!accounts.length) {
    showMessage(container, t("noAccounts"));
    return;
  }

  for (const acc of accounts) {
    container.appendChild(renderAccount(acc, (cfg.destinations && cfg.destinations[acc.id]) || []));
  }
}

function renderAccount(acc, dests) {
  const email = (acc.identities && acc.identities[0] && acc.identities[0].email) || "";
  return renderDestBlock(acc.name || t("accountNoName"), acc.type || "", email, acc.id, dests);
}

function renderGlobalDests(cfg) {
  const container = $("#globalDests");
  container.replaceChildren(...buildDests(GLOBAL_KEY, (cfg.destinations && cfg.destinations[GLOBAL_KEY]) || []));
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

  block.append(head, ...buildDests(key, dests));
  return block;
}

/* Ziel-Liste + "Ziel hinzufuegen"-Button fuer einen Storage-Schluessel. */
function buildDests(key, dests) {
  const list = document.createElement("div");
  list.className = "dests";
  list.dataset.accountId = key;

  dests.forEach((d) => list.appendChild(destRow(d)));

  const add = document.createElement("button");
  add.type = "button";
  add.className = "add-dest";
  add.textContent = t("addTarget");
  add.addEventListener("click", () => {
    const row = destRow({ label: "", path: "" });
    list.appendChild(row);
    const pathInput = row.querySelector(".d-path");
    if (pathInput) pathInput.focus();
    scheduleSave();
  });

  return [list, add];
}

function destRow(dest) {
  const row = document.createElement("div");
  row.className = "dest-row";

  const label = document.createElement("input");
  label.type = "text";
  label.className = "d-label";
  label.placeholder = t("labelPlaceholder");
  label.autocomplete = "off";
  label.spellcheck = false;
  label.value = (dest && dest.label) || "";
  label.addEventListener("input", scheduleSave);

  const path = document.createElement("input");
  path.type = "text";
  path.className = "d-path";
  path.placeholder = t("pathPlaceholder");
  path.readOnly = true;
  path.autocomplete = "off";
  path.spellcheck = false;
  path.value = (dest && dest.path) || "";

  const openPicker = async () => {
    try {
      const chosen = await messenger.droptoFs.pickFolder(t("pickDialogTitle"));
      if (chosen) { path.value = chosen; scheduleSave(); }
    } catch (e) {
      setStatus(t("pickerError") + String(e), false);
    }
  };
  path.addEventListener("click", openPicker);

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "icon-btn";
  pick.title = t("pickFolderTitle");
  pick.setAttribute("aria-label", t("pickFolderAria"));
  pick.textContent = "📁";
  pick.addEventListener("click", openPicker);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-btn";
  remove.title = t("removeTarget");
  remove.setAttribute("aria-label", t("removeTarget"));
  remove.textContent = "\u00d7";
  remove.addEventListener("click", () => { row.remove(); scheduleSave(); });

  row.append(label, path, pick, remove);
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
    debug: $("#debug").checked,
    destinations,
  };
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

async function save() {
  const cfg = collect();
  try {
    await messenger.storage.local.set(cfg);
    setStatus(t("savedStatus"), true);
  } catch (e) {
    setStatus(t("saveError") + String(e), false);
  }
}

/* --------------------------------- UI-Helfer ----------------------------- */

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
  container.appendChild(p);
}

/* Pfad bereinigen: absolute Praefixe (/, ~/, C:\) bleiben erhalten,
   Segmente werden bereinigt, Schraegstriche bleiben Trenner. */
function cleanPath(value) {
  const raw = String(value == null ? "" : value).trim();
  const m = raw.match(/^(\/|~[/\\]|[A-Za-z]:[/\\])/);
  const prefix = m ? m[0].replace(/\\/g, "/") : "";
  const cleaned = raw.slice(prefix ? m[0].length : 0)
    .split(/[/\\]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+/, ""))
    .join("/");
  return prefix + cleaned;
}
