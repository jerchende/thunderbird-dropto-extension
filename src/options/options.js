"use strict";

const DEFAULTS = {
  destinations: {}, // { "*" | [accountId]: [ { label, path } ] } - "*" = kontounabhaengig
  debug: false,
};

const GLOBAL_KEY = "*";

const $ = (sel) => document.querySelector(sel);

let statusTimer = null;
let saveTimer = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const cfg = await messenger.storage.local.get(DEFAULTS);

  $("#debug").checked = !!cfg.debug;

  await renderAccounts(cfg);

  $("#debug").addEventListener("change", scheduleSave);
  $("#save").addEventListener("click", () => save(true));
}

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

  const path = document.createElement("input");
  path.type = "text";
  path.className = "d-path";
  path.placeholder = "z. B. folderA/Rechnungen";
  path.autocomplete = "off";
  path.spellcheck = false;
  path.value = (dest && dest.path) || "";
  path.addEventListener("input", scheduleSave);

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

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-btn";
  remove.title = "Ziel entfernen";
  remove.setAttribute("aria-label", "Ziel entfernen");
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
