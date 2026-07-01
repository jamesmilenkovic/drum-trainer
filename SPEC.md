# Increment 3 – Rolling notated Test staff + white notation backgrounds

**Product-owner spec.** Drum Trainer, third slice. Parent PRD:
`PRDs/2-in-progress/2026-07-01-drum-trainer.md`. Full source spec (iCloud docs):
`projects/personal-projects/drum-trainer/increment-3-test-staff.md`. This in-repo
copy is the build target for `/loop`. Increments 1 & 2 are committed on `main`
(inc 2 = `7b72505`).

**Runs on:** Chrome, served over HTTPS (or `http://localhost`) – Web MIDI needs a
secure context. **Static site**, single page, no framework, no build step.

---

## Why this increment (James's feedback on increment 2)

1. Make the **Test area a real, empty staff that notates each hit as it's played.**
   As James plays, each hit is written onto the staff at the position it actually
   landed (early = left of the subdivision line, late = right). The staff should
   **"just keep going"** across ~8–10 bars, rolling/scrolling so there's no hard
   stop. Colour is not required – **position carries the timing**; black noteheads
   are fine.
2. **Backgrounds must be white** on the groove + test staves so the black notes and
   staff lines read clearly.

Small, fast increment – gives James the practice/test tool he wants "for the test"
now. (The staff-based groove editor is increment 4; app drum sounds/mixer is 5.)

---

## Scope – what's in

### A. Rolling notated Test staff
- Replace/augment the current Test area with a **real VexFlow staff**, empty to
  start (no pre-written notes – just the subdivision grid implied by the metronome).
- **Span ~8–10 bars** visible; as playing crosses the last visible bar, the view
  **rolls/scrolls** (or wraps) so it keeps going – **no hard stop**. Exact bar count
  and scroll-vs-wrap = coder's best readable choice (confirm on the mini).
- On each MIDI hit, **write a notehead onto the staff** at the correct **voice
  position** (kick/snare/hi-hat per the note map, using the same percussion-clef
  line positions and x-vs-normal noteheads the groove view already uses), placed
  **horizontally by its actual timing** relative to the nearest subdivision grid
  line (early = left of the line, late = right). Position is the primary signal.
- **Black / uncoloured noteheads by default.** Position carries early/late. (A
  subtle band tint may be kept as a non-default extra, but must not be required to
  read timing – PO call: default uncoloured black noteheads.)
- Controls carried from inc 2, unchanged: **tempo**, **subdivision** (1/4, 1/8,
  1/16), start/stop, count-in. The metronome click continues as the reference.
- Keep the inc-2 **live timing meter** as a **small secondary companion readout**
  (still shows the most-recent hit's ms/direction) – now secondary to the staff.
- A **clear/reset** control that **wipes the staff** and starts the capture again.
- **In-session only** – no persistence of the captured hits this round; clear just
  empties it.

### B. White notation backgrounds
- The **groove view** and the **test staff** render on a **white background** with
  **black staff lines + noteheads**. Coloured ghost/hit marks in the groove view
  (inc-2 on-staff ghosts) still apply and must stay readable against white. The rest
  of the app chrome can stay as it is.

---

## Out of scope (later increments)

- Setting/editing what the groove is – the **staff-based editor + presets is
  increment 4**.
- The app's own drum **sounds** / per-part mixer (increment 5).
- **Saving** the test capture / progress history (increment 8) – this round's
  capture is in-session only.
- Triplet/compound subdivisions (still 1/4, 1/8, 1/16 this round).

---

## Acceptance criteria

`[auto]` = QA tests headless (keep the new maths as a pure module);
`[human]` = James accepts on screen with the kit.

1. **[human]** The Test area shows an **empty real staff** spanning ~8–10 bars on a
   **white background** with black staff lines, before any hit is played.
2. **[auto + human]** Starting the metronome and playing writes **each hit as a
   notehead** at the right **voice position**, placed **horizontally by its actual
   timing** vs the nearest subdivision line (early left / late right). The
   hit → staff-placement maths (voice → staff row, and x-position from ms offset
   relative to the nearest grid line) is a **pure module**, unit-tested headless.
3. **[auto + human]** Playing past the visible bars **keeps going**
   (rolls/scrolls/wraps) rather than stopping. The **roll/scroll boundary logic**
   (which visible bar/column a given absolute grid index maps to, and when the view
   advances) is part of the same **pure module**, unit-tested headless with
   synthetic hits.
4. **[human]** Noteheads are **black / uncoloured by default**; the inc-2 **timing
   meter remains** as a small secondary readout.
5. **[human]** A **clear/reset** control empties the staff.
6. **[human]** The **groove view** also renders on a **white background** with black
   notes/lines readable (inc-2 coloured ghost notes still legible against white).
7. **[auto]** **No regression** to increments 1 & 2: MIDI input, mapping, scoring,
   the Test-area timing maths, and the existing `mapping.js` / `scoring.js` /
   `testarea.js` tests all still pass.

## PO calls (flag to change)

- Default **uncoloured** black noteheads in the test staff (position = timing).
  Colour can be re-added as a toggle later if wanted.
- ~8–10 bars visible, then roll/scroll; **exact bar count + scroll vs wrap = coder's
  best readable choice**, confirmed on the mini.
- **In-session only**; no persistence of the test capture this round.

## Notes for the coder

- **Single `index.html`**, static, no build, vanilla JS. VexFlow already loaded from
  the pinned CDN. Reuse the existing groove-notation approach (`renderNotation()`,
  `NOTEHEAD_KEY`, percussion clef, SVG overlays positioned by computed x) rather than
  a new engine.
- Keep the **new maths as a pure module** (data in → result out, zero DOM / zero Web
  MIDI / zero AudioContext), exported so a Node `.mjs` test can import it exactly
  like `testarea.js` / `scoring.js` / `mapping.js`:
  - **voice → staff row/line-position** (reuse the same per-voice mapping the groove
    uses; don't duplicate line-position constants if avoidable).
  - **x-position from timing**: given the hit's signed ms offset from the nearest
    subdivision grid line (reuse `nearestGridLine` / `secondsPerGridStep` from
    `testarea.js` – don't re-derive grid maths), map to a horizontal position/offset
    on the staff (early = left of the line, late = right). Choose a readable pixel/
    proportional scale; document it.
  - **roll/scroll boundary logic**: given an absolute grid index (from
    `nearestGridLine`), the subdivision, and the visible bar count, return which
    visible bar/column + page the hit belongs to and whether the view has advanced.
    Deterministic and testable with synthetic hits, including the boundary where a
    hit crosses the last visible bar.
- **Reuse** the drift-free audio-clock scheduler (`PracticeEngine` / test transport)
  and `nearestGridLine` – do not fork the timing model.
- **White background**: set an explicit white fill behind the groove + test staves
  and ensure staff lines + noteheads render black (VexFlow default stroke). Don't
  restyle the rest of the app chrome.
- Don't regress the existing pure modules or their `test-*.mjs` suites.

## What QA can / cannot verify

- **Can (auto):** 2 & 3 (the new pure module – voice→row, x-from-ms placement,
  roll/scroll boundary with synthetic hits, including a hit exactly on a grid line,
  a hit halfway between lines, and a hit crossing the last visible bar), 7 (existing
  `mapping.js` / `scoring.js` / `testarea.js` tests still green).
- **Cannot – needs James + the kit on the mini:** 1, 4, 5, 6 – the empty staff
  render, white-background contrast/readability, black-by-default noteheads, the
  secondary meter, the clear/reset, and the groove-view white background in a real
  browser.
