# Increment 2 – Real notation + readable timing feedback + Test area

**Product-owner spec.** Drum Trainer, second slice. Parent PRD:
`PRDs/2-in-progress/2026-07-01-drum-trainer.md`. Full source spec (iCloud docs):
`projects/personal-projects/drum-trainer/increment-2-notation-timing-feedback.md`.
This in-repo copy is the build target for `/loop`. Increment 1 is committed on
`main` (`98d138c`).

**Runs on:** Chrome, served over HTTPS (or `http://localhost`) – Web MIDI needs a
secure context. **Static site**, single page, no framework, no build step.

---

## Why this increment (James's feedback on increment 1)

1. **Feedback is unreadable while playing.** It's just red/blue/yellow symbols with
   no legend and no sense of *where* a hit fell. James can't decode it mid-play.
2. **Blocks, not notation.** He wants real sheet-music-style drum notation, with the
   expected note in black and his actual hit shown as a ghosted/coloured note where
   it landed.

Core fix: **make timing = position, not just colour**, in two complementary views,
replace the grid with real notation, and add a dedicated **Test / free-play area**
so he can just run the metronome and see where his hits land.

---

## Scope – what's in

### A. Real notation rendering (VexFlow)
- **Engine: VexFlow** (programmatic – needed to draw live ghost notes at arbitrary
  offsets and recolour them; PO call, reversible). Load it as a pinned static
  library (CDN `<script>` tag or vendored file) – no build step.
- Render a proper **5-line percussion staff** with correct drum notation:
  **x-noteheads** for hi-hat/cymbals, **normal noteheads** for kick/snare/toms,
  standard staff positions, stems/beams for the subdivision.
- Re-render the **fixed 1-bar rock groove** from increment 1 (hi-hat on 8ths, kick
  on 1 & 3, snare on 2 & 4) as real notation, **replacing the block grid entirely**.
- **Moving playhead** sweeps the staff in time with the metronome click.

### B. Readable timing feedback (BOTH views)
- **Live timing meter** (read-while-playing view): a horizontal lane with a centre
  **ON** zone and **EARLY** (left) / **LATE** (right) sides. Each hit appears as a
  marker positioned by its ms offset, colour-coded, with the **numeric ms** shown.
  Most-recent hit is prominent; glanceable at speed. Primary fix for "I can't tell
  where things are falling."
- **On-staff ghost notes** (study-after view): for each expected note, when James
  hits it, draw his **actual hit as a ghosted/coloured notehead** horizontally
  offset from the black target note (left = early, right = late), coloured by band.
  The expected note stays **black**.
- **Legend, always visible.** State plainly what each colour means and that
  horizontal position = early/late. Palette = **three clear states** (below).

### C. Colour + meaning (fixed, with legend)
- **Green = on-target** (within ±30 ms).
- **Amber = close** (30–80 ms early or late).
- **Red = off / miss** (>80 ms or no matching hit).
- **Direction (early vs late) is shown by position** (meter side + staff offset),
  not by colour – colour only ever encodes *how close*, position encodes *which
  way*. A small always-on legend explains this.

### D. Test / free-play area (built first in this increment)
- A **mode/tab** separate from groove-scoring. Metronome runs; **no prescribed
  pattern**.
- Controls: **tempo**, **subdivision** (1/4, 1/8, 1/16 for v1; triplets later),
  start/stop, count-in.
- Every hit is measured to the **nearest grid line** of the chosen subdivision and
  shown on the **live timing meter** (early/on/late + ms). Optional light reference
  staff/grid showing the subdivision with ghost notes at the hit positions.
- **Running stats** (resettable): average signed offset (rush vs drag tendency),
  % on-target, tightest/loosest hit. Simple, no persistence needed this round.

---

## Out of scope (later increments)

- The app's own drum **sounds** / hearing the groove played back → **increment 3**.
  This increment stays visual + metronome click only.
- Per-part volume mixer (increment 3).
- Authoring/editing grooves, multiple grooves, sections (increment 4).
- MusicXML/PDF import + Verovio display (increment 8).
- Adjustable scoring tolerance UI (bands stay ±30/±80 ms; expose later).
- Triplet/compound subdivisions in the Test area (v1 = 1/4, 1/8, 1/16).

---

## Acceptance criteria

`[auto]` = QA tests headless (keep the new maths as pure modules);
`[human]` = James accepts on screen with the kit.

1. **[human]** The fixed groove renders as **real drum notation** on a 5-line staff
   (correct noteheads: x for hats/cymbals, normal for kick/snare/toms), not blocks,
   with a moving playhead in time with the click.
2. **[human]** A **live timing meter** shows each hit positioned by ms offset
   (EARLY|ON|LATE), colour-coded green/amber/red, with the numeric ms – readable
   while playing.
3. **[human]** Each expected note shows the **black target** plus the
   **ghosted/coloured actual hit** offset left (early) / right (late) on the staff.
4. **[human]** An **always-visible legend** explains the three colours and that
   position = early/late.
5. **[auto + human]** A **Test / free-play area** runs the metronome with a
   selectable subdivision (1/4, 1/8, 1/16), measures each hit to the **nearest grid
   line**, shows it on the meter, and displays **resettable running stats** (avg
   offset, % on-target). The nearest-grid-line selection, ms→colour band, avg signed
   offset, and % on-target maths are a **pure module**, unit-tested headless.
6. **[auto]** No regression to increment 1's MIDI input, mapping panel, or scoring
   maths (existing `mapping.js` / `scoring.js` tests still pass).
7. **[human]** Works in Chrome over HTTPS; clear message if Web MIDI is unavailable.

## PO calls (flag to change)

- VexFlow (not Verovio) for the rendering engine this round.
- Three-state colour (green/amber/red) = closeness; position = direction; legend on.
- Test area first, then apply the same feedback views to the groove.
- Bands unchanged (±30 / ±80 ms). No app sounds this increment.

## Notes for the coder

- **Single `index.html`**, static, no build. Vanilla JS. Deploys to GitHub Pages /
  Cloudflare Pages as-is. Load **VexFlow** from a pinned CDN URL (or vendor the file
  in-repo) via a plain `<script>` tag – no bundler.
- Keep the **Test-area maths as a pure module** (data in → result out, zero DOM /
  zero Web MIDI): nearest-grid-line selection given (hitTime, tempo, subdivision,
  bar anchor), ms→colour band (reuse the ±30/±80 thresholds from `scoring.js` –
  don't duplicate the constants), running stats (avg signed offset, % on-target,
  tightest/loosest). Export in a way a Node `.mjs` test can import, like the
  existing pure modules.
- **Reuse** the drift-free audio-clock scheduler pattern (`PracticeEngine`) for the
  Test-area metronome and the moving playhead. Reconcile `event.timeStamp` to the
  audio clock exactly as increment 1 does.
- Don't regress the existing scoring/mapping pure modules or their tests.

## What QA can / cannot verify

- **Can (auto):** 5 (the new Test-area maths – nearest-grid selection, ms→band, avg
  signed offset, % on-target, boundaries at exactly 30 ms and 80 ms, hits exactly
  between two grid lines, rapid double hits), 6 (existing tests still green).
- **Cannot – needs James + the kit on the mini:** 1, 2, 3, 4, 7 – the VexFlow
  staff/noteheads/playhead, the live meter readability, on-staff ghost notes, the
  legend, and the HTTPS/Web-MIDI-unavailable behaviour in a real browser.
