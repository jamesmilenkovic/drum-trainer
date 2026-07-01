# Increment 4 – Staff-based groove editor + presets + staff-layout map

**Product-owner spec.** Drum Trainer, fourth slice. Parent PRD:
`PRDs/2-in-progress/2026-07-01-drum-trainer.md`. Full source spec (iCloud docs):
`projects/personal-projects/drum-trainer/increment-4-groove-editor.md`. This in-repo
copy is the build target for `/loop`. Increments 1–3 are committed on `main`
(inc 3 = `7f03b06`).

**Runs on:** Chrome, served over HTTPS (or `http://localhost`) – Web MIDI needs a
secure context. **Static site**, single page, no framework, no build step, vanilla
JS. VexFlow already loaded from the pinned CDN.

---

## Why this increment (James's ask)

He wants to **set what groove he's working on**, via a **click-on-the-stave editor**
so he can place **any note, any voice** (not a fixed block grid, not just a preset
list), plus **a few presets** to load as starting points. **James's own insight:**
presets and future PDF/MusicXML import are the same underlying thing – a stored
groove the app loads. So the architecture is **one shared groove data model**: the
editor, the presets, and (increment 9) import all read/write the same format.

He also reported a bug from inc 3: in the Test staff, **toms / crash / floor tom /
ride land in the wrong place** because there's no defined map for where each voice
sits on the stave. This increment adds that display map and fixes the placement
everywhere.

---

## Build order (MANDATORY): data model FIRST

Design and build the **shared groove data model** and the **staff-layout map** as
pure modules *before* any editor/preset/rendering UI. Everything else consumes them.

---

## Scope – what's in

### A. Shared groove data model (design first) — new pure module `groove.js`

- A single JSON-serialisable representation of a groove:
  - **time signature** (beats-per-bar + beat-value, e.g. 4/4),
  - **bar count** (1–2 this increment),
  - **subdivision resolution** (1/4, 1/8, 1/16 — reuse `SUBDIVISIONS` from
    `testarea.js`, don't fork it),
  - **notes**: a set, each = **voice** (a key from `mapping.js`'s `VOICES`) +
    **position** within the bar(s) (an absolute integer grid-step index over the
    whole groove) + **optional accent** (boolean; full velocity is later).
- **Import-friendly (increment 9):** note in the code that this is the target format
  for PDF/MusicXML import — a drum MusicXML part (voice + onset + duration) must map
  cleanly onto `{ voice, position, accent }`. Keep positions expressed in
  subdivision grid steps so an importer can quantise onto them.
- Pure module, zero DOM / zero Web MIDI / zero AudioContext, ESM, importable from a
  Node `.mjs` test exactly like `scoring.js` / `mapping.js` / `testarea.js`.
- Provide, at minimum:
  - a constructor/factory for an empty groove (time sig, bars, subdivision),
  - **add-note** and **remove-note** (idempotent toggle semantics: adding a note that
    already exists at that voice+position is a no-op; removing one that isn't there is
    a no-op), returning a new groove (immutable style, matching the other modules),
  - a **toggle** helper (add if absent, remove if present) — the editor's click,
  - `serialize` / `deserialize` (round-trip to JSON and back must be identical),
  - derived helpers the rest of the app needs (e.g. total grid steps, steps-per-bar,
    query notes at a position), without duplicating grid maths that already lives in
    `testarea.js`.
- **Validation:** deserialize rejects/normalises malformed input (unknown voice,
  out-of-range position, bad time sig) deterministically rather than silently
  corrupting state.

### A2. Staff-layout (notation display) map — new pure module, fixes the inc-3 Test bug

- **Problem (James, 2026-07-01):** the Test staff has no defined map for where each
  voice sits, so toms/crash/etc. render wrong. Inc 1 gave the **input** map
  (MIDI note → voice); this is the missing **display** map (voice → staff position +
  notehead).
- A map from **each of the 10 voices** (`VOICES` in `mapping.js`: kick, snare,
  hihatClosed, hihatOpen, hihatPedal, tom1, tom2, floorTom, crash, ride) to:
  - a **staff line/space position** (a VexFlow key string, e.g. `"c/5"`, in the same
    percussion-clef convention the groove view already uses), and
  - a **notehead type** (`normal` / `x` for hats+cymbals / optional others).
- **Default = standard drum notation:** kick bottom space, snare 3rd (middle) space,
  hi-hats x above the top line, ride/crash x above, toms on their conventional lines,
  floor tom low. Closed/open/pedal hats and crash/ride distinguished sensibly
  (coder's readable call; document it).
- **Editable in a settings panel that mirrors the inc-1 MIDI-mapping panel**, and
  **persisted** (IndexedDB, alongside the existing `noteMap`, via the same
  `dbGet`/`dbSet` store).
- **This single map feeds ALL notation rendering** — the groove view, the editor
  stave, **and the inc-3 Test staff**. `teststaff.js`'s `NOTEHEAD_KEY` /
  `resolveNotehead` currently only covers kick/snare/hihatClosed; extend the display
  map to all 10 voices and wire it through so `drawTestStaffHit` places
  tom/crash/floorTom/ride correctly. Keep it as the **single source of truth** — do
  not leave a second hard-coded copy in `index.html`.
- **Pure where it can be:** the default map + the voice→position/notehead lookups are
  a pure module (Node-testable). The panel/persistence wiring lives in `index.html`.

### B. Staff-based groove editor

- A **VexFlow drum stave** the user edits **by clicking**: click a voice's line/space
  at a subdivision position to **add a note**, click the same spot to **remove** it.
  Any voice, any position — on the stave, not a separate block grid.
- Settable **time signature**, **number of bars** (1–2 to start, extendable), and
  **subdivision resolution** (1/4, 1/8, 1/16) for placement. Changing any of these
  re-renders the stave. (Reducing bars/resolution may drop now-invalid notes — do it
  deterministically and keep the model valid.)
- **Grid snapping:** clicks snap to the nearest subdivision column and to the nearest
  voice row (using the staff-layout map's positions), then toggle the note there.
- Renders **live as real notation** as it's edited, with **correct noteheads**
  (x for hats/cymbals, normal for kick/snare/toms) from the staff-layout map.
- **Clear/reset** control that empties the editor groove.
- The edited groove is held in memory as a shared-model instance (JSON shape ready
  for increment 8's save/load; no disk persistence of user grooves this round).

### C. Presets

- **~4–6 built-in grooves** (e.g. basic rock, funk, bossa) **+ 1–2 lesson patterns**,
  each stored **as an instance of the shared model** (proving the import-ready shape).
- Loading a preset **populates the editor** and **sets it as the current practice
  groove**; it is then freely editable.

### D. Edited/loaded groove becomes the practice groove

- The edited/loaded groove **replaces the fixed hard-coded `GROOVE`** as what the
  Groove view **displays**. (Scoring wires to it from inc 6 on; this increment just
  needs display + the shape ready — do not regress inc-1–3 scoring behaviour for the
  default groove.)
- The default on load is a shared-model instance equivalent to the current hard-coded
  groove (so existing behaviour/tests hold), now flowing through the model.

### E. White notation background (from inc 3) applies to the editor stave

- The editor stave renders on a **white background** with black staff lines +
  noteheads, consistent with the groove + test staves.

---

## Out of scope (later increments)

- **Sections / sequencing** multiple grooves into an arrangement (keep to a single
  groove of 1–2 bars).
- App drum **sounds** / per-part mixer (increment 5).
- **Saving** user-created grooves to disk / a library (increment 8) — in-memory only
  this round, JSON shape ready.
- **PDF/MusicXML import** itself (increment 9) — but the model must be built to
  receive it (note the mapping in code; a headless sanity test asserts the shape).
- **Velocity/dynamics** editing beyond a basic accent toggle.
- **Wiring scoring** to arbitrary edited grooves (increment 6) — display only here.

---

## Acceptance criteria

`[auto]` = QA tests headless (pure modules); `[human]` = James accepts on screen
with the kit.

1. **[auto]** A **groove data model** (`groove.js`) exists: time sig, bars,
   subdivision, notes = voice + position [+ accent]; **serialisable to JSON with an
   identical round-trip** (build → serialise → deserialise → deep-equal); add/remove/
   toggle-note logic is correct and idempotent; malformed input is rejected/normalised.
   It is the single source the editor, presets, and (later) scoring use.
1b. **[auto + human]** A **staff-layout map** (voice → staff position + notehead)
   exists with a **standard drum-notation default** for all 10 voices, is **editable
   in a settings panel**, **persists** (IndexedDB), and is used by **all** notation
   rendering **including the inc-3 Test staff** — toms/crash/floor tom/ride now render
   in the correct place everywhere (fixes the reported Test bug). The default map +
   lookups are unit-tested headless; the panel/placement is human-confirmed.
2. **[human]** The **staff editor** lets the user click notes on/off at any voice +
   subdivision position on a real VexFlow stave, with correct noteheads and grid
   snapping. (The **snap/hit-testing maths** — pixel → (voice, position) and back —
   is a **pure, unit-tested function** `[auto]`.)
3. **[auto + human]** Time signature, bar count, and subdivision are **settable** and
   re-render the stave; the model stays valid across changes (auto-tests the model
   transforms; human confirms the render).
4. **[auto + human]** **Presets** load into the editor as shared-model instances and
   become the current practice groove; they're then editable. Each built-in preset is
   a **valid** groove-model instance (auto); loading/editing is human-confirmed.
5. **[human]** The edited/loaded groove is what the **practice (Groove) view
   displays** — no fixed hard-coded groove required any more.
6. **[human]** White notation background applies to the **editor stave**.
7. **[auto]** **No regression** to increments 1–3: `mapping.js`, `scoring.js`,
   `testarea.js`, `teststaff.js` and their `test-*.mjs` suites all still pass; the
   Test-staff placement for kick/snare/hihatClosed is unchanged for those voices.
8. **[auto]** A **MusicXML-style drum part sanity check**: a small synthetic drum
   part `[{voice, onsetStep, ...}]` maps cleanly onto the groove model via a
   documented adapter/shape, proving the model is import-ready for increment 9.

---

## PO calls (flag to change)

- Editor works **on the stave by clicking**, per James — not a separate block grid.
- Start with **1–2 bars**; multi-bar/sections deferred.
- Presets are **seeds to edit**, stored in the shared model. Pick ~4–6 common grooves
  + a lesson pattern or two.
- **Accent toggle only** for dynamics this round; full velocity later.
- The staff-layout map is the **single source of truth** for voice→staff position
  everywhere (retire the partial `NOTEHEAD_KEY` in favour of the full 10-voice map).

---

## Notes for the coder

- **Single `index.html`**, static, no build, vanilla JS. New pure logic goes in new
  `.js` ESM modules (e.g. `groove.js`, `stafflayout.js`) importable by both the page
  and Node `.mjs` tests — same pattern as `mapping.js` / `scoring.js` / `testarea.js`
  / `teststaff.js`.
- **Data model FIRST.** Build and test `groove.js` (+ the staff-layout module) before
  the editor UI. Keep positions in subdivision grid steps; **reuse** `SUBDIVISIONS` /
  `secondsPerGridStep` / grid maths from `testarea.js` — do not fork the timing model.
- **Don't duplicate line-position constants.** Extend/replace `teststaff.js`'s
  `NOTEHEAD_KEY`/`resolveNotehead` with the full 10-voice staff-layout map (or have
  `teststaff.js` import it) so there is one source of truth wired into the groove
  view, the editor stave, AND the Test staff. Fix `drawTestStaffHit` to place all
  voices, not just three.
- **Persistence:** reuse the existing IndexedDB `settings` store (`dbGet`/`dbSet`);
  add a `staffLayout` key alongside `noteMap`. The editor groove is in-memory only.
- **Editor hit-testing** (pixel click → nearest (voice, position); and (voice,
  position) → x/y for drawing) should be a **pure function** taking stave geometry +
  the layout map as inputs, so it's Node-testable without a browser (mirror how
  `teststaff.js` isolates `testStaffStepX`-style maths). Keep the VexFlow/DOM glue in
  `index.html`.
- **White background:** the editor stave reuses the same white-fill treatment the
  groove + test staves already have (CSS `background:#ffffff` on the output div).
- **Don't regress** the existing pure modules or their `test-*.mjs` suites, or inc-1
  MIDI input / mapping / scoring behaviour.

## What QA can / cannot verify

- **Can (auto):** AC1 (model round-trip, add/remove/toggle, validation), AC1b's
  default map + lookups, AC2's snap/hit-testing pure function, AC3's model transforms
  (set time sig/bars/subdivision keeps the model valid), AC4's presets are valid
  model instances, AC7 (existing suites still green + kick/snare/hihat placement
  unchanged), AC8 (MusicXML-shape sanity map).
- **Cannot — needs James + the kit on the mini:** the actual click-to-place editing
  feel, the settings-panel edit + persistence across reload, the Test-staff placement
  fix on a real screen, preset load feel, the Groove view showing the edited groove,
  and the editor's white background — all the on-screen/browser `[human]` items.
