"use strict";

/* DropTo - Experiment "droptoFs"
 *
 * Privilegierte Mini-API: Schreiben an absolute Pfade ausserhalb des
 * Download-Ordners (IOUtils) und nativer Ordner-Dialog (nsIFilePicker).
 * Bewusst schmal halten - siehe CLAUDE.md ("Zwei Speicherwege").
 * Chrome-Globals (ChromeUtils, Services, IOUtils, ...) kommen aus eslint.config.mjs.
 */

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
