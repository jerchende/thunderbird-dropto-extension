# Design: DropTo im „Speichern"/„Alle speichern"-Dropdown (Experiment `droptoMenu`)

Datum: 2026-07-07 · Status: freigegeben

## Problem / Ziel

Die DropTo-Ziele sollen zusätzlich im Dropdown des „Speichern"- bzw. „Alle
speichern"-Buttons der Anhangsleiste erscheinen. Die WebExtension-`menus`-API
kennt dafür keinen Kontext (nur Rechtsklick-Kontexte `message_attachments` /
`all_message_attachments`) — es braucht ein zweites, UI-manipulierendes
Experiment. Das Risiko (Thunderbird-Interna, kann bei Updates brechen) ist mit
dem User besprochen und akzeptiert; das Feature degradiert bei Bruch sauber
(Einträge fehlen einfach).

## Verifizierte Fakten (comm-central, `mail/base/content/msgAttachmentView.inc.xhtml`)

- Die beiden Popups heißen `attachmentSaveAllSingleMenu` (Button
  `attachmentSaveAllSingle`, ein Anhang) und `attachmentSaveAllMultipleMenu`
  (Button `attachmentSaveAllMultiple`, mehrere Anhänge).
- Die Anhangsleiste lebt in `about:message` (eingebettet in 3-Pane, in
  Nachrichten-Tabs und im eigenständigen Nachrichtenfenster).
- `about:message` stellt `gMessage` (`nsIMsgDBHdr`) und `gFolder` bereit.

## Architektur

### Experiment `messenger.droptoMenu` (`src/experiments/saveallmenu/`)

- `schema.json` — Namespace `droptoMenu`: Funktion `setDestinations(destinations)`,
  Event `onTargetClicked(message, path)`.
- `implementation.js` — `ExtensionCommon.ExtensionAPI`:
  - **Dokument-Erkennung:** Observer auf `chrome-document-loaded`; jedes
    Dokument mit `documentURI === "about:message"` wird gehookt. Beim Start
    werden bereits offene Fenster durchlaufen (alle `browser`-Elemente, deren
    `contentDocument` `about:message` ist). Kein Fenster-Typ-Raten.
  - **Hook:** `popupshowing`-Listener auf beiden Popups (per
    `getElementById`; fehlt eines, wird es still übersprungen —
    Degradations-Pfad für künftige TB-Umbauten).
  - **Injektion bei `popupshowing`:** zuvor injizierte Knoten entfernen, dann
    `menuseparator` + `menu` „DropTo" (mit `menupopup`) anhängen. Inhalt wie im
    Kontextmenü: globale Ziele oben, `menuseparator`, dann Ziele des Kontos der
    angezeigten Nachricht. Konto nativ: 
    `MailServices.accounts.findAccountForServer(gFolder.server).key` — `key`
    ist exakt die `accountId` des Storage-Schemas. Gibt es gar keine Ziele:
    ein deaktivierter Eintrag „Keine Ziele konfiguriert".
  - **Klick:** `oncommand` ruft einen internen Callback mit
    (`gMessage`, `path`) auf; das Event konvertiert die Nachricht via
    `context.extension.messageManager.convert(...)` in einen regulären
    WebExtension-`MessageHeader` und feuert `onTargetClicked(message, path)`.
    KEINE Speicherlogik im Experiment.
  - **Konfig-Cache:** `setDestinations(destinations)` legt die aktuelle
    Ziel-Struktur in einer Modul-Variable ab — beim `popupshowing` ist sie
    synchron verfügbar (kein asynchroner Roundtrip im Menüaufbau).
  - **Cleanup:** Liste gehookter Dokumente; `onShutdown` entfernt Observer,
    Listener und injizierte Knoten (sauberes Unload/Update ohne Neustart).

### Background (`src/background.js`)

- **Refactoring:** Die Speicher-Schleife aus dem `menus.onClicked`-Handler wird
  in `saveAttachments(message, partNames, path)` extrahiert (Pfad-Weiche
  relativ/absolut, Notifications inklusive). Der Menü-Handler und der neue
  Event-Handler nutzen dieselbe Funktion — Save-Logik bleibt an einer Stelle.
- **Anbindung:** 
  - `messenger.droptoMenu.onTargetClicked.addListener(async (message, path) =>
    { alle Anhänge via messages.listAttachments(message.id) → saveAttachments })`.
  - Nach jedem `rebuildMenu()` (läuft initial und bei jedem Storage-Change)
    zusätzlich `droptoMenu.setDestinations(cfg.destinations)` pushen.

### Manifest

Zweiter Eintrag unter `experiment_apis` (`droptoMenu`), analog zu `droptoFs`.

## Fehlerfälle / Kanten

- Popups nicht gefunden (TB-Umbau) → kein Eintrag, Rest des Add-ons unberührt.
- Nachricht ohne Ordner/Konto (z. B. externe .eml) → nur globale Ziele.
- Keine Ziele konfiguriert → deaktivierter Hinweis-Eintrag im Untermenü.
- Anhang-Speichern-Fehler → bestehende Fehler-Notification aus
  `saveAttachments`.
- Add-on-Update/-Deaktivierung → `onShutdown` räumt Menüs/Listener weg.

## Doku

- `README.md`: Features-Bullet (DropTo auch im Speichern-Button-Dropdown);
  Hinweis-Abschnitt erwähnt das zweite Experiment.
- `CLAUDE.md`: neue Invariante (Experiment `droptoMenu`: verifizierte Popup-IDs,
  Degradations-Verhalten, Save-Logik NUR im Background) + Struktur-Liste.

## Verifikation

1. `npm run lint` + `npm run build` grün (ESLint-Block für `src/experiments/`
   greift bereits).
2. Manuell in Thunderbird:
   - Mail mit mehreren Anhängen: „Alle speichern"-Dropdown zeigt DropTo-Untermenü
     (globale + Konto-Ziele), Klick speichert ALLE Anhänge ins Ziel (relativ und
     absolut testen).
   - Mail mit einem Anhang: „Speichern"-Dropdown zeigt dasselbe Untermenü.
   - Eigenständiges Nachrichtenfenster (Doppelklick auf Mail): Untermenü da.
   - Storage-Änderung (Ziel umbenennen) → Dropdown zeigt beim nächsten Öffnen
     den neuen Stand.
   - Add-on deaktivieren → Einträge verschwinden ohne Neustart.
