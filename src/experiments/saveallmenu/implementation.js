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
