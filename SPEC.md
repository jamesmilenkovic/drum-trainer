# Increment 6 – Section looping + repeats + layout-picker clipping fix

**Project:** Drum Trainer · **PRD:** `PRDs/2-in-progress/2026-07-01-drum-trainer.md`
**Status:** Build-ready (scoped 2026-07-04, from James's inc-5 feedback)
**Runs on:** Chrome (mini), HTTPS · **Code:** `~/code/drum-trainer` (MacBook)
**Base:** `main` @ `537457d` (inc 5: staff-layout picker, richer noteheads, crash2/rideBell, collapsible panels).

---

## Why this increment (James's feedback on inc 5)

1. **He wants to practise in chunks.** Split a chart into sections, pick one (e.g.
   the hard two bars), **loop it with a repeat count**, and play sections in
   sequence. This is the core "drill the hard part" drummer workflow, and it's
   groundwork for imported charts (inc 8 MusicXML) – an imported song is only
   useful if you can chunk it.
2. **Bug from inc 5:** the visual staff-layout picker was **clipped – the whole
   staff wasn't visible** (Chrome on the mini). Still functional (positions could
   be set), but unusable-looking. Pure rendering fix, folded in here.

## User story

As a drummer, I mark up my chart into named sections ("intro", "groove", "fill"),
set the fill to repeat ×8, and either drill one section on loop or play the whole
sequence through – with the staff showing me where I am.

---

## Scope – what's in

### A. Section layer on the shared groove model
- Extend the shared groove model (`groove.js`) with an ordered list of
  **sections**: each = **name, start bar, end bar (contiguous range), repeat
  count** (1–99). Sections must not overlap; together they may cover all or part
  of the chart (uncovered bars just aren't in the arrangement).
- **Serialises with the groove JSON** (same single model – presets and inc-8
  imports carry sections the same way). Keep the shape import-friendly: a
  MusicXML part with repeats/rehearsal marks should map onto it.
- **Raise the practical bar count** – chunking implies longer charts. Editor
  supports at least **16 bars** (target 32) without layout falling apart; the
  staff can wrap/scroll rather than squeeze.

### B. Section UI in the editor
- A **section strip** above/beside the editor stave: list of sections with name,
  bar range, repeat count; add / edit / delete. Simple inputs are fine (name +
  start/end bar + repeats) – no drag-selection required this round.
- The staff **highlights the active/selected section's bars** so the mapping from
  strip to notation is obvious.
- Validation: ranges in-bounds, no overlaps, end ≥ start.

### C. Playback: loop + sequence modes
- **Drill mode:** select a section → **loop it** with a repeat count (×N) or
  **∞ until stop**. Count-in (existing click behaviour) before the first pass
  only; seamless loop after that (no gap, no re-count-in).
- **Sequence mode:** play the sections **in order, honouring each repeat count**
  (intro ×1 → groove ×4 → fill ×8 → …). Show which section + which repeat you're
  on (e.g. "groove 3/4").
- No sections defined → playback behaves exactly as today (whole groove loops).
  Zero regression for existing flows.
- Scoring hookup is **inc 7** – but build the playback timeline expansion
  (sections + repeats → flat bar sequence) as a **pure, unit-testable function**,
  since inc 7 will score against exactly that expanded timeline.

### D. Bugfix: staff-layout picker clipping
- **Repro (James, 2026-07-04, Chrome on mini):** the visual staff picker renders
  **clipped – the whole staff isn't visible**. Positions can still be set, so
  it's a sizing/overflow issue (likely fixed-height container or SVG
  viewBox/height mismatch), possibly aggravated by the collapsible-panel work.
- Fix so the **full staff + above/below-staff positions** (ledger-line rows for
  crash/kick-pedal etc.) are always visible, at both default window sizes and
  when panels expand/collapse.

---

## Out of scope (later increments)

- Scoring against sections/edited grooves + record/replay (inc 7 – next).
- MusicXML import (inc 8), app sounds/mixer (9), song audio + slow-down (10),
  save/load to disk (11), heavy features (12).
- Per-section tempo changes (single tempo per chart for now – flag if trivial).
- Drag-to-select section ranges on the staff (polish, later).
- A/B looping by timestamp on audio (that's the inc-10 song world, not charts).

---

## Acceptance criteria

1. Sections (name + bar range + repeat count) can be **created, edited, deleted**
   in the editor, with validation (no overlaps, in-bounds). `[auto + human]`
2. Sections **serialise with the groove JSON** and round-trip intact (model →
   JSON → model identical). `[auto]`
3. **Drill mode** loops a selected section ×N or ∞, count-in once, seamless
   thereafter. `[human + auto for the timeline expansion]`
4. **Sequence mode** plays sections in order honouring repeat counts, with a
   visible "section X, repeat n/N" indicator. `[human + auto]`
5. The **timeline expansion** (sections + repeats → flat bar sequence) is a pure
   function with unit tests (empty sections, ×1, ×N, partial coverage). `[auto]`
6. Editor handles **≥16 bars** with the staff wrapping/scrolling readably.
   `[human]`
7. **Picker bug fixed:** the staff-layout picker shows the **entire staff
   including above/below-staff rows**, un-clipped, with panels expanded or
   collapsed. `[human]`
8. **No regression** to inc 1–5: all `test-*.mjs` suites green; no-section
   playback identical to today; presets still load. `[auto + human]`

## PO calls (flag to change)

- Sections = **contiguous, non-overlapping bar ranges** over one chart – not
  separate grooves stitched together. (Import-friendly and simpler; revisit if
  inc 8 demands otherwise.)
- Repeat counts live **on the section** (data), and drill-mode ×N/∞ is a
  **playback control** – both exist.
- Simple inputs over drag-selection this round.
- Count-in on first pass only; seamless looping is the point of drill mode.
- Single tempo per chart.

## Notes for the coder

- `groove.js` stays the single source of truth – sections are part of the groove
  model, not a parallel structure. Presets (`presets.js`) may optionally gain
  sections on one or two entries to prove the shape.
- Keep the timeline expansion pure + headless-testable (new module or `groove.js`
  export, e.g. `expandArrangement(groove) → [barIndex, …]`), mirroring how
  `editorhit.js` stays testable.
- The transport/click scheduler must consume the expanded timeline; watch
  Web Audio scheduling across the loop seam (no dropped/doubled clicks at the
  boundary).
- For the picker fix: check container CSS height/overflow vs the rendered SVG
  size; make the picker size to its content (all rows incl. ledger positions).
  Add a cheap guard test if the row count → height mapping is code-derivable.
- Same build rules: single static `index.html`, vanilla JS ESM modules + Node
  `.mjs` tests, VexFlow from the pinned CDN, no build step.

## Test notes

- **MacBook (no kit):** unit-test the section model (validation, serialisation
  round-trip) + timeline expansion (all edge cases) + any height/row-count logic
  for the picker. All existing suites stay green.
- **Mini (kit):** James feel-tests – define sections on a lesson groove, drill
  the hard bars ×8 (loop feels seamless), run the full sequence, and confirm the
  picker now shows the whole staff. After the diff gate.
