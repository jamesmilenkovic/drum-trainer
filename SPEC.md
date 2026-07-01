# Increment 1 – MIDI-in + note-mapping settings + live scoring

**Product-owner spec.** Drum Trainer, first slice. Parent PRD:
`PRDs/2-in-progress/2026-07-01-drum-trainer.md`. Full source spec (iCloud docs):
`projects/personal-projects/drum-trainer/increment-1-midi-scoring.md`. This in-repo
copy is the build target for `/loop`.

**Runs on:** Chrome, served over HTTPS (or `http://localhost`) – Web MIDI needs a
secure context. **Static site**, single page, no framework, no build step.

---

## Goal of this increment

Prove the novel core end-to-end: plug the EFNOTE 5 in, tell the app which pad is
which drum, play a simple fixed groove to a click, and get per-hit
on-target/early/late/missed feedback with a summary. No authoring, no notation
rendering, no app drum sounds yet – those are later increments.

## User story

As a drummer, I plug my EFNOTE 5 into the mini, open the site, confirm my pad
mapping, pick a tempo, hit start, play a basic rock beat, and see which hits were
early/late/on-target plus an accuracy score for the loop.

---

## Scope – what's in

### 1. Web MIDI connection
- Request MIDI access (`navigator.requestMIDIAccess`, `sysex: false`).
- List available MIDI **inputs**; let the user pick one (default to the first, or
  remember last-used). Show connection status (connected / none found / permission
  denied) with a clear message.
- Live "last hit" read-out: show the incoming **note number + velocity** of the most
  recent Note-On, so the user can see the kit is talking to the app. Doubles as the
  mapping diagnostic.
- Handle device connect/disconnect events gracefully (re-populate the input list).

### 2. Note-mapping settings panel *(James's priority – make it prominent)*
- A settings panel listing the **drum voices** for this increment:
  kick, snare, hi-hat (closed), hi-hat (open), hi-hat pedal, tom 1, tom 2, floor
  tom, crash, ride. (Enough for a basic groove + headroom; expandable.)
- Each voice shows its assigned **MIDI note number**, editable two ways:
  1. Type/select the note number directly.
  2. **"Learn" mode:** click Learn on a voice, hit that pad, the app captures the
     incoming note and assigns it.
- **Default map = EFNOTE 5 / General MIDI** pre-filled so it works out of the box:
  kick 36, snare 38, closed hat 42, open hat 46, hat pedal 44, toms 48/45/43,
  crash 49, ride 51. User can override any of them.
- Persist the map (see Persistence). A "reset to GM default" button.
- Edge cases: warn if two voices are mapped to the same note; a pad that hits an
  unmapped note is shown in the "last hit" read-out as unmapped.

### 3. The practice loop
- **One fixed groove:** a 1-bar 4/4 basic rock beat (hi-hat on 8ths, kick on 1 & 3,
  snare on 2 & 4). Hard-coded; no editing.
- **Minimal grid display** (NOT full notation): a row per active voice, columns =
  subdivisions of the bar (8th-note grid), cells marked where a hit is expected. A
  moving playhead shows the current position.
- **Transport:** tempo (BPM, manual entry + fine +/-), count-in (1 bar of clicks),
  start/stop (button + spacebar). Loop the bar continuously until stopped.
- **Click:** Web Audio look-ahead scheduling (schedule on the audio clock, not
  `setInterval` for the audio itself). Accent on beat 1. This is the timing
  reference the scoring is measured against.

### 4. Scoring
- For each expected hit (voice + expected time), compare the **actual MIDI hit
  timestamp** to the expected time and classify:
  - **On-target:** within **±30 ms**
  - **Early / Late:** between 30 ms and **±80 ms** (signed – early vs late)
  - **Miss:** no matching hit within ±80 ms of the expected time
  - **Extra:** a hit with no expected note nearby (counted, shown, not fatal)
- Use the MIDI event timestamp (`event.timeStamp` / a `performance.now()` capture),
  reconciled to the audio-clock schedule, for accuracy – don't score off render
  timing.
- **Visual feedback:** colour each grid cell as it's judged (on-target/early/late/
  miss), live during the loop.
- **Summary:** after each loop pass (and a running tally), show counts and an
  accuracy %: on-target / early / late / miss, plus average signed timing offset
  (ms) so the user learns if they rush or drag.

### 5. Persistence
- Save the **MIDI map**, **selected input**, and **tempo** so the app reopens where
  it was. Use **IndexedDB**. No accounts, single machine.

---

## Out of scope (this increment)

- App's own drum sounds / hearing the groove played back (increment 2).
- Real notation rendering – Verovio/VexFlow (increment 2).
- Per-part volume mixer (increment 3).
- Authoring / editing grooves, multiple grooves, sections (increment 4).
- Recording/replaying the performance, cross-session progress (increments 5/7).
- Adjustable scoring tolerance UI (fixed bands this round; expose later).

---

## Acceptance criteria

`[auto]` = QA tests headless (keep the scoring + mapping logic as pure modules);
`[human]` = James accepts on screen with the kit.

1. **[human]** On load, the app requests MIDI access and lists inputs; selecting the
   EFNOTE shows "connected" and the last-hit read-out updates when any pad is struck.
2. **[auto]** The mapping panel shows all listed voices with the GM defaults
   pre-filled and persists edits across a reload (map logic + storage is a pure
   module; UI wires to it).
3. **[human]** "Learn" mode assigns a voice's note by capturing the next pad hit.
4. **[auto]** A hit on a note number not in the map is classified/flagged as
   **unmapped** by the pure input handler (read-out shows it as unmapped).
5. **[human]** Setting a tempo and pressing start gives a 1-bar count-in, then loops
   the fixed groove with a moving playhead and an accented beat 1.
6. **[auto]** The scoring module classifies hits on-target/early/late/miss/extra
   using ±30/±80 ms bands and produces a summary (counts, accuracy %, average signed
   offset). **Boundary cases covered:** exactly 30 ms, exactly 80 ms, double hits on
   one expected note, unmapped notes, early vs late sign.
7. **[auto]** Selected input, map, and tempo survive a reload (persisted in
   IndexedDB and restored).
8. **[human]** Works in Chrome over HTTPS; degrades with a clear message if Web MIDI
   is unavailable (Safari / `file://`).

## PO calls (flag to change)

- Scoring bands **±30 ms on-target / ±80 ms early-late**, fixed this round.
- Voice list capped at the 10 above for the basic groove; grow when authoring lands.
- Minimal grid, not notation – deferring the rendering engine to increment 2.
- IndexedDB for persistence (not File System Access) this round.

## Notes for the coder

- **Single `index.html`**, static, no build. Vanilla JS. Deploys to GitHub Pages /
  Cloudflare Pages as-is.
- Keep **scoring** and **note-mapping** as **pure modules** (data in → result out,
  zero DOM / zero Web MIDI references) so QA can unit-test criteria 2, 4, 6, 7
  headless by feeding synthetic Note-On timestamps at known offsets. Export them in
  a way a Node `.mjs` test can import (e.g. a shared `scoring.js`/`mapping.js` the
  page and the tests both load, or guarded `export`s).
- **Look-ahead click:** reuse the metronome's drift-free audio-clock scheduler
  approach (anchor time + beatIndex, no beat-to-beat accumulation). The expected-hit
  times for scoring come from the same anchored schedule so scoring and click share
  one clock.
- Reconcile `event.timeStamp` (Web MIDI, `performance.now()` domain) to the audio
  clock once at start (capture the offset between `performance.now()` and
  `audioCtx.currentTime`) so hit timestamps compare cleanly to scheduled hit times.

## What QA can / cannot verify

- **Can (auto):** 2, 4, 6, 7 – mapping defaults + persistence, unmapped-note
  detection, the full scoring classification/summary incl. boundary cases, and
  IndexedDB round-trip. Assert on the pure modules + storage.
- **Cannot – needs James + the kit on the mini:** 1, 3, 5, 8 – live MIDI connect,
  Learn-mode pad capture, the transport/playhead/count-in on screen, and the
  HTTPS/Web-MIDI-unavailable behaviour in a real browser.
