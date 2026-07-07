# Increment 7 – Groove library + routine builder + readability/live-hit fixes

**Project:** Drum Trainer · **PRD:** `PRDs/2-in-progress/2026-07-01-drum-trainer.md`
**Status:** Build-ready (scoped 2026-07-07, from James's inc-6 feedback)
**Runs on:** Chrome (mini), HTTPS · **Code:** `~/code/drum-trainer` (MacBook)
**Base:** `main` @ `34bd4fb` (inc 6: chart sections, drill/sequence looping, picker clip fix).

---

## Why this increment (James's feedback on inc 6)

1. **"The stitched-together parts to practice is the real gold."** Sections within
   one chart (inc 6) aren't the main workflow – his practice (e.g. **kick pattern
   practice**) is a set of **separate exercises played in sequence**, each with
   its own repeats and tempo. The routine is the product.
2. **Visual bug:** the notation area **doesn't go wide enough – couldn't see
   across**. Wants the **full window width**, rendered **clear and LARGE** so
   it's easy to read from the kit.
3. **Live hits:** hit timing currently only appears **after a round completes**.
   Wants each hit shown on the staff **live, as it lands**.

## User story

As a drummer, I save my kick-pattern exercises as named grooves, stitch them into
a "Kick practice" routine (exercise 1 ×8 @ 60 BPM → exercise 2 ×8 @ 70 BPM → …),
hit play once, and read big, clear notation that marks my hits as I play them.

---

## Scope – what's in

### A. Groove library (in-app, IndexedDB)
- **Save the current editor groove with a name**; **load, rename, duplicate,
  delete** from a library panel. Overwrite-on-save-same-name with confirm.
- Stored in **IndexedDB** (existing `dbGet`/`dbSet` store or a new object store –
  coder's call). Grooves serialise via the existing shared-model JSON (sections
  included). Presets remain read-only seeds; "save a copy to library" works.
- This is the pulled-forward slice of save/load. **Disk export/import stays
  increment 12** – no File System Access API this round.

### B. Routine builder
- A **routine** = name + **ordered list of items**, each item = **library groove
  + repeat count (1–99) + tempo (BPM)**. Per-item tempo is required – kick
  exercises rarely share one.
- Build/edit UI: pick grooves from the library, order them (up/down is fine, no
  drag needed), set repeats + BPM per item; save routines to the library too
  (own IndexedDB store).
- **Playback:** play the routine through – items in order, honouring repeats,
  **tempo switching cleanly at item boundaries** (click + transport retime, no
  gap or stutter). Reuse/extend the inc-6 sequence transport + "item n, repeat
  x/N" indicator (show groove name + tempo too).
- Also allow **drilling a single item** (loop it ×N/∞ at its tempo) without
  leaving the routine – same drill mode as inc 6, scoped to the item.
- The **pure timeline-expansion function from inc 6 extends** to routines
  (items × repeats × their grooves → flat timed bar sequence, now with per-item
  tempo). Keep it pure + unit-tested; inc 8 scores against exactly this.

### C. Notation readability: full width + LARGE
- The notation/practice staff **uses the full window width** (kill any fixed
  max-width/container clipping – this is the inc-6 "couldn't see across" bug).
- Render **larger**: scale the staff so it reads easily from behind the kit on
  the mini's screen (bigger stave, noteheads, bar numbers). A simple **size
  control** (S/M/L or a zoom slider, persisted) if a single default is
  contentious – default LARGE.
- Long charts wrap into **full-width systems** (lines), not a horizontal
  squeeze. Applies to the practice view, editor, and Test staff.

### D. Live hit rendering
- During practice playback, each incoming MIDI hit is **drawn on the staff the
  moment it lands** (position = where in the bar it hit, per the staff-layout
  map), not after the round/loop completes.
- Reuse the **inc-3 rolling Test staff approach** (it already notates hits live);
  timing colour/offset styling can stay minimal – full scoring semantics land in
  inc 8. No waiting for a round boundary anywhere in the feedback path.

---

## Out of scope (later increments)

- Scoring + record/replay + session stats (inc 8 – next, builds on the expanded
  routine timeline).
- MusicXML import (9), app sounds/mixer (10), song audio + slow-down (11),
  **disk** export/import + progress tracking (12), heavy features (13).
- Sharing/exporting routines as files (12).
- Per-item time-signature overrides (a groove owns its time sig already; flag if
  mixed-meter routines break the transport – handle simplest correct way).

---

## Acceptance criteria

1. Grooves can be **saved/loaded/renamed/duplicated/deleted** in an in-app
   library (IndexedDB), surviving reload. Presets can be copied in. `[auto for
   store round-trip + human]`
2. A **routine** (ordered items: groove + repeats + per-item BPM) can be built,
   edited, saved, loaded. `[auto + human]`
3. Routine playback runs items **in order, honouring repeats, switching tempo
   cleanly at boundaries** (no gap/stutter/dropped click), with a live "item
   name, repeat n/N, BPM" indicator. `[human + auto for the timeline]`
4. A single routine item can be **drilled** (×N/∞ at its tempo). `[human]`
5. The **timeline expansion extends to routines** with per-item tempo, stays a
   pure function, unit-tested (single item, ×N, multi-item, tempo changes,
   grooves with sections). `[auto]`
6. Notation **fills the window width** and renders **LARGE** (default) with a
   persisted size control; long charts wrap into systems; applies to practice
   view, editor, Test staff. **The inc-6 "can't see across" bug is gone.**
   `[human]`
7. Hits appear on the staff **live as they land** – nothing in the feedback path
   waits for a round to complete. `[human]`
8. **No regression** to inc 1–6: all `test-*.mjs` green; sections + drill/
   sequence modes still work; picker stays un-clipped at the new sizes. `[auto +
   human]`

## PO calls (flag to change)

- Library + routines = **IndexedDB only** this round; disk files are inc 12.
- **Per-item tempo is in scope** (core to the kick-practice use case), including
  clean tempo switches mid-routine.
- Order via up/down buttons; drag-reorder is polish, not required.
- Default notation size = **LARGE**; size control persisted (IndexedDB).
- Live hit markers this round are **presence + position**; full early/late
  scoring semantics arrive with inc 8 (don't build scoring twice).

## Notes for the coder

- `groove.js` stays the single model; a routine **references library grooves by
  id** (don't deep-copy – editing a groove updates routines that use it; note
  this behaviour in the UI copy).
- Extend the inc-6 expansion function rather than forking it: output should now
  carry **(bar, tempo, item-context)** so the transport and (inc 8) scoring both
  consume one structure.
- Web Audio scheduling across **tempo boundaries** is the risky bit – schedule
  ahead per-item and watch the seam (same care as the inc-6 loop seam).
- Full-width/LARGE: prefer scaling the VexFlow render context/stave width over
  CSS transform hacks; check the mini's actual window size is what's filled.
- Live hits: hook the existing MIDI-in path to draw on the practice staff at
  hit time (the rolling Test staff already does this – share that code path).
- Same build rules: single static `index.html`, vanilla JS ESM modules + Node
  `.mjs` tests, VexFlow from the pinned CDN, no build step.

## Test notes

- **MacBook (no kit):** unit-test library store round-trip, routine model
  validation, the extended timeline expansion (incl. tempo changes), and any
  width/system-wrapping logic that's code-derivable. All existing suites green.
- **Mini (kit):** James feel-tests – build a kick-practice routine from 2–3
  saved exercises at different tempos, play it through (clean tempo switches),
  drill one item, confirm the notation is full-width + LARGE and hits appear
  live. After the diff gate.
