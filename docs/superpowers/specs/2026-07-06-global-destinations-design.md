# Design: Kontounabhängige (globale) Ziele

Datum: 2026-07-06 · Status: freigegeben

## Problem / Ziel

DropTo kennt bisher nur Ziele pro Konto plus ein separates Fallback-Ziel
(„Sonstige") für Konten ohne eigene Ziele. Es fehlen Ziele, die bei **jeder**
E-Mail unabhängig vom Konto angeboten werden (z. B. „Scans", „Ablage"). Globale
Ziele decken den Fallback-Anwendungsfall mit ab — das Fallback-Feature wird
daher ersatzlos entfernt.

## Entscheidungen (mit User geklärt)

1. **Menü-Reihenfolge:** globale Ziele **über** den Konto-Zielen, getrennt durch
   eine Trennlinie.
2. **Fallback entfällt komplett.** Wer ein Auffang-Ziel will, legt es als
   globales Ziel an. Ist gar nichts konfiguriert bzw. nichts sichtbar, zeigt das
   Menü einen **deaktivierten** Eintrag „Keine Ziele konfiguriert".
3. **Options-UI:** Pflege als erster Block „Alle Konten" (Tag „kontounabhängig")
   innerhalb der Card „Konten & Ziele", identische Ziel-Zeilen-UI wie bei Konten.
4. **Storage:** reservierter Schlüssel `"*"` in `destinations`
   (Thunderbird-Konto-IDs heißen `account<N>`, Kollision ausgeschlossen).
   Kein Migrationscode; ein alter `fallback`-Wert bleibt ungenutzt liegen
   (gleiche Linie wie zuvor bei `baseDir`).

## Storage-Schema (danach)

```json
{
  "debug": false,
  "destinations": {
    "*":        [ { "label": "Scans",  "path": "Scans" } ],
    "account1": [ { "label": "Steuer", "path": "Steuer/2026" } ]
  }
}
```

`label` optional (leer ⇒ Pfad wird angezeigt), `path` relativ zum
Thunderbird-Download-Ordner.

## Menü-Verhalten (`src/background.js`)

Aufbau-Reihenfolge in `rebuildMenu()` (Reihenfolge der `create`-Aufrufe =
Anzeige-Reihenfolge):

1. Root „DropTo" (unverändert).
2. Globale Ziele aus `destinations["*"]` — `visible: true`, itemMap-Meta
   `{ global: true, path, label }`, IDs `dropto::*::<i>`.
3. Trennlinie (`type: "separator"`, eigene ID, initial `visible: false`).
4. Konto-Ziele (wie bisher initial versteckt, IDs `dropto::<accountId>::<i>`);
   die Iteration über `destinations` überspringt den Schlüssel `"*"`.
5. Hinweis-Eintrag „Keine Ziele konfiguriert" (`enabled: false`, eigene ID,
   initial sichtbar nur wenn keine globalen Ziele existieren).

`onShown` (ersetzt das bisherige Fallback-Umschalten):

- Konto-Ziele des erkannten Kontos einblenden (unverändert).
- Trennlinie sichtbar ⇔ globale Ziele vorhanden **und** mindestens ein
  Konto-Ziel sichtbar.
- Hinweis-Eintrag sichtbar ⇔ keine globalen Ziele **und** kein Konto-Ziel
  sichtbar.
- `menus.refresh()` wie bisher.

`onClicked`: `FALLBACK_ID`-Konstante und `meta.fallback`-Zweig entfallen;
Zielpfad ist immer `meta.path`. Der Hinweis-Eintrag ist deaktiviert und steht
nicht in der itemMap.

Entfällt: `FALLBACK_ID`, jegliches `cfg.fallback`-Handling, `fallback` aus
`DEFAULTS` (background + options).

## Einstellungsseite

- **`options.html`:** Card „Allgemein" komplett entfernen (enthielt nur noch das
  Fallback-Feld). Hilfetext in „Konten & Ziele" ergänzen: Ziele unter „Alle
  Konten" erscheinen bei jeder E-Mail; Hinweis auf Fallback („Kein Ziel =
  Fallback.") streichen.
- **`options.js`:** In `renderAccounts()` vor den echten Konten einen Block
  „Alle Konten" rendern (Tag „kontounabhängig" statt Konto-Typ, keine
  E-Mail-Zeile), dessen Ziel-Liste `data-accountId="*"` trägt. `destRow()`,
  Add-Button und `collect()` funktionieren dadurch unverändert.
  Fallback-Bezüge entfernen (`DEFAULTS.fallback`, `#fallback`-Load/Listener,
  `fallback:`-Zeile in `collect()`).
- **`options.css`:** ungenutzt gewordene Regeln `.grid`/`.field` entfernen.

## Doku

- `README.md`: Features/Einstellungen aktualisieren (globale Ziele rein,
  Fallback-Erwähnungen raus, Menü-Reihenfolge kurz erklären).
- `CLAUDE.md`: Storage-Schema-Invariante (`"*"`-Schlüssel), Invariante
  „Dynamisches Menü" (Trenner/Hinweis statt Fallback-Sicherheitsnetz).

## Fehlerfälle / Kanten

- Kontoerkennung schlägt fehl → globale Ziele bleiben nutzbar (immer sichtbar),
  Konto-Ziele bleiben versteckt, Trenner versteckt.
- `destinations["*"]` leer/fehlt → Verhalten wie bisher ohne Globals.
- Leere Gesamt-Konfiguration → nur deaktivierter Hinweis-Eintrag im Menü.
- `path` wird weiterhin durch `sanitizePath` bereinigt (leer ⇒ „unbenannt").

## Verifikation

1. `grep -rni fallback src/ README.md CLAUDE.md` → keine Treffer.
2. `npm run lint` und `npm run build` grün (CLAUDE.md-Gate).
3. Manuell in Thunderbird (temporäres Add-on): Menü zeigt Globals oben +
   Trenner + Konto-Ziele; Konto ohne Ziele → nur Globals ohne Trenner; leere
   Config → deaktivierter Hinweis; Klick auf globales Ziel legt Anhang unter
   `<Download-Ordner>/<Pfad>/` ab; Options-Seite: „Alle Konten"-Block speichert
   unter `destinations["*"]` (Autosave + Button).
