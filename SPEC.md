# Increment 5 – Friendly staff-layout UI + richer noteheads + new voices + collapsible panels

**Project:** Drum Trainer · **PRD:** `PRDs/2-in-progress/2026-07-01-drum-trainer.md`
**Status:** Build-ready (scoped 2026-07-02, from James's inc-4 feedback)
**Runs on:** Chrome (mini), HTTPS · **Code:** `~/code/drum-trainer` (MacBook)
**Base:** `main` @ `b15fcfd` (inc 4: groove editor + presets + shared model + staff-layout map).

---

## Why this increment (James's feedback on inc 4)

1. **The staff-layout tool is confusing.** It exposes raw VexFlow key strings
   (`f/4`, `g/5`, …) that mean nothing to a human, and only offers two notehead
   types (`normal` / `x`). James: "I don't know what f/4 etc means."
2. **Notation isn't rich enough / not standard.** Needs more notehead options –
   e.g. **open hi-hat = a circle above the x**, **ride bell = a diamond** – and the
   default positions should follow standard drum notation.
3. **Missing voices:** add **Crash 2** and **Ride Bell**.
4. **Panels are always-open and cluttered:** make the **Note Mapping** and **Staff
   Layout** panels **collapsible**.

Reference (researched 2026-07-02, standard drum key): kick bottom space; snare
middle; high tom (tom1) top space, mid tom (tom2) below snare, floor tom low; closed
hi-hat `x` above the top line; hi-hat foot pedal `x` in the space below the staff;
ride on the top line; **crash `x` on a ledger line above the staff**; **open hi-hat =
small "o" above the x**; **ride bell = diamond notehead** (on the ride line); cross-
stick = `x` on the snare line. Sources in the project references.

---

## Scope – what's in

### A. Human-friendly staff-layout editor (replace raw key strings)
- **Stop showing `f/4`-style VexFlow key strings.** Replace the position control with
  a **visual picker**: a small rendered percussion staff where the user **clicks the
  line/space** to set where a voice sits (it draws the voice's notehead there live).
  This mirrors the inc-4 click-to-place editor paradigm James already likes.
  - *Fallback if the visual picker is too big for this increment:* a **named
    dropdown** ("above top line", "top space", "top line", "middle line", "below
    staff", …) mapping to the underlying key string. Either way, **no raw key strings
    in the UI.**
- **Notehead control = a visual dropdown** showing the actual glyphs, not the words
  `normal`/`x` alone (show the shape).
- Keep it all editable + persisted (IndexedDB `staffLayout`, already wired in inc 4).

### B. Richer notehead types
Extend the notehead model beyond `normal` / `x` to at least:
- **normal** – drums (kick/snare/toms).
- **x** – cymbals / hi-hat.
- **open** (open hi-hat) – x notehead **with a small circle ("o") above it**. (VexFlow:
  x notehead + an "o" articulation/annotation above, since there's no single glyph.)
- **diamond** – ride bell / cymbal bell (VexFlow diamond notehead glyph).
- *(Optional, if cheap):* **circled-x** and **cross-stick** – nice-to-have, not required.

Map each type to the correct VexFlow notehead glyph / articulation in one place
(extend `stafflayout.js` / the notehead resolver – keep it the single source of truth,
don't scatter glyph codes).

### C. New voices: Crash 2 + Ride Bell
- Add **`crash2`** ("Crash 2") and **`rideBell`** ("Ride Bell") to `VOICES`,
  `VOICE_LABELS`, `GM_DEFAULT_MAP`, and `DEFAULT_STAFF_LAYOUT`.
- **GM/EFNOTE default MIDI notes:** Crash 2 = **57**, Ride Bell = **53** (standard GM
  percussion). Confirm against the EFNOTE if it differs; the map is editable anyway.
- **Default staff layout:** Crash 2 = `x` above the staff (near/with crash, its own
  clickable row); Ride Bell = **diamond** notehead on the ride's position/line.
- Everything that iterates `VOICES` (mapping panel, layout panel, editor rows,
  scoring, Test staff) must pick these up automatically – verify no hard-coded
  10-voice assumptions remain.

### D. Collapsible panels
- Make the **Note Mapping** and **Staff Layout** panels **collapsible** (expand/
  collapse headers), default collapsed once configured. Remember open/closed state
  (IndexedDB, same store) so the practice screen stays uncluttered.

---

## A note on the "one row per voice" compromise (flag for the PO / James)

Inc 4's coder gave **every voice its own distinct staff row** so the click-editor can
reach each one (two voices on one row → one becomes unclickable). But real notation
**shares** positions: open & closed hi-hat sit on the same line (differentiated by the
"o"), and ride & ride bell share the ride line (differentiated by the diamond).

For this increment: **keep click-reachability working** but allow shared positions by
making the editor place notes for the **currently-selected voice** (a voice picker),
rather than inferring voice purely from which row was clicked. That way notation can be
properly standard (shared lines + distinguishing noteheads) without any voice becoming
unreachable. If that's too much this round, keep distinct rows and just add the richer
noteheads – **coder's call, but note which was chosen.**

---

## Out of scope (later increments)

- App drum sounds / mixer (next: was increment 5, now 6).
- Scoring against edited grooves + record/replay (7), song import + slow-down (8),
  save/load + progress (9), heavy features / import (10).
- Full articulation layer (accents, flams, drags, rolls) beyond the noteheads above.

---

## Acceptance criteria

1. The staff-layout panel **no longer shows raw key strings**; position is set via a
   **visual staff picker** (or, fallback, named dropdowns), and notehead via a **glyph
   dropdown**. `[human]`
2. Notehead types include at least **normal, x, open (x + "o"), diamond**, each
   rendering the correct glyph in every notation view (groove, editor, Test staff).
   `[auto for the resolver map + human on screen]`
3. **Crash 2** and **Ride Bell** exist as voices across mapping, layout, editor,
   scoring and Test staff, with sensible GM defaults (57 / 53) and default positions
   (crash2 = x above; rideBell = diamond on the ride line). `[auto + human]`
4. **Note Mapping** and **Staff Layout** panels are **collapsible** with remembered
   state. `[human]`
5. Open hi-hat renders as an **x with a circle above**; ride bell renders as a
   **diamond**. `[human]`
6. **No regression** to inc 1–4: all `test-*.mjs` suites pass; existing voices keep
   their positions/behaviour; the groove editor, presets, scoring and Test staff still
   work with the (now 12) voices. `[auto]`
7. Defaults follow standard drum notation per the reference above. `[human]`

## PO calls (flag to change)

- **Visual staff picker** preferred over dropdowns for setting position (matches the
  editor). Dropdown is an acceptable fallback if the picker blows the increment size.
- Notehead set = normal / x / open / diamond this round; circled-x + cross-stick
  optional.
- Crash 2 default note 57, Ride Bell 53 (editable).
- Shared-position vs one-row-per-voice: coder's call, but document it (see the note).

## Notes for the coder

- The current defaults + rationale are in `stafflayout.js`'s header comment (the
  `f/4` etc. keys). Keep `stafflayout.js` the **single source of truth** for voice →
  position + notehead; extend it for the new notehead types + the two new voices.
- `VOICES` / `VOICE_LABELS` / `GM_DEFAULT_MAP` live in `mapping.js`; add `crash2` +
  `rideBell` there and make sure nothing hard-codes "10 voices".
- Reuse the existing IndexedDB `settings` store (`dbGet`/`dbSet`) for panel
  open/closed state.
- Keep the pixel↔(voice,position) hit-testing (`editorhit.js`) pure + unit-tested;
  if you add a voice picker for shared positions, keep that logic testable headless.
- Same build rules: single static `index.html`, vanilla JS ESM modules + Node `.mjs`
  tests, VexFlow from the pinned CDN, no build step.

## Test notes
- **MacBook (no kit):** unit-test the extended notehead resolver, the new voices in
  the layout/mapping maps, and any new hit-test/voice-picker logic. All existing
  suites stay green.
- **Mini (kit):** James confirms the layout UI is now understandable, the new
  noteheads/voices render right, and the panels collapse. After the diff gate.
