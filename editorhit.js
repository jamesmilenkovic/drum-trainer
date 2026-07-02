"use strict";

// =============================================================================
// editorhit.js
//
// Pure hit-testing maths for the staff-based groove editor (SPEC.md
// increment 4, section B / AC2). Zero DOM, zero VexFlow, zero Web MIDI —
// data in, result out — so it can be unit-tested headless with `node
// --test` exactly like teststaff.js isolates its own testStaffStepX-style
// maths. All VexFlow object handling and DOM event wiring stays in
// index.html; this module only takes plain-number stave geometry + the
// staff-layout map and returns plain data.
//
// Two directions:
//   1. hitTest(): pixel click (x, y) -> nearest (voice, position). This is
//      what the editor calls on every click.
//   2. drawXY(): (voice, position) -> pixel (x, y). This is what the editor
//      calls to know where to draw/highlight a note it just toggled.
//
// Both directions share the same geometry model:
//   - x comes from evenly subdividing a bar's note-drawing area into
//     stepsPerBar equal columns (same approach as index.html's
//     testStaffStepX for the Test staff — not forked, just mirrored, since
//     that one lives inline in index.html's VexFlow glue rather than a pure
//     module).
//   - y comes from each voice's staff-layout key string (e.g. "c/5"),
//     resolved to a pixel row via a diatonic-step calculation anchored on
//     the stave's own top-line y + line spacing (both plain numbers a
//     caller reads off a real VexFlow Stave with getYForLine(0) and
//     getYForLine(1) - getYForLine(0) — no VexFlow object needed here).
// =============================================================================

// ---- Diatonic step maths (letter+octave -> a single ordered integer) ----
//
// Standard staff key strings are "<letter>/<octave>", e.g. "c/5", optionally
// suffixed with a notehead modifier ("/x2") which this module ignores for
// y-positioning purposes (only the letter/octave pair matters for row
// placement — notehead shape doesn't move a note's row).
const LETTER_STEP = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

function parseKey(key) {
  const match = /^([a-g])\/(\d+)/.exec(key ?? "");
  if (!match) return null;
  const [, letter, octaveStr] = match;
  return { letter, octave: Number(octaveStr) };
}

// A single ordered integer: higher = higher pitch = higher on the staff
// (smaller y). Two adjacent diatonic steps are a half-line-spacing apart
// (VexFlow alternates line/space every diatonic step).
function diatonicStep(key) {
  const parsed = parseKey(key);
  if (!parsed) return null;
  return LETTER_STEP[parsed.letter] + parsed.octave * 7;
}

// ---- Voice -> y (pixel row) ----
//
// geometry: { topLineY, lineSpacing } — both plain numbers read off a real
// VexFlow Stave (topLineY = stave.getYForLine(0), lineSpacing =
// stave.getYForLine(1) - stave.getYForLine(0); VexFlow's own default is 10).
// layout: a staff-layout map (stafflayout.js shape: voice -> {key, notehead}).
//
// Returns the pixel y for `voice`'s row, or null if the voice has no layout
// entry or its key string doesn't parse (defensive — the shipped layout
// always parses; this guards a corrupt/edited layout from IndexedDB).
//
// Anchored on "f/5" = the top staff line (VexFlow's percussion/treble-clef
// convention: getYForLine(0) is always the top line, which is f/5), so this
// formula works for ANY topLineY/lineSpacing the caller passes in — it does
// not hardcode pixel values, only the STRUCTURE of the staff (5 lines, one
// diatonic step = half a line-spacing).
const TOP_LINE_KEY_STEP = diatonicStep("f/5");

export function voiceRowY(layout, voice, geometry) {
  const entry = layout?.[voice];
  if (!entry) return null;
  const step = diatonicStep(entry.key);
  if (step === null) return null;
  const halfSpacing = geometry.lineSpacing / 2;
  return geometry.topLineY - (step - TOP_LINE_KEY_STEP) * halfSpacing;
}

// Build a "<letter>/<octave>" key string back from a diatonic step integer —
// the inverse of diatonicStep(). Used by keyForY below (SPEC.md increment 5
// section A's visual staff-layout picker: click a line/space, get back a key
// string to save, without ever showing that string to the user).
const STEP_LETTER = Object.fromEntries(Object.entries(LETTER_STEP).map(([letter, step]) => [step, letter]));

function keyForDiatonicStep(step) {
  const octave = Math.floor(step / 7);
  const letter = STEP_LETTER[((step % 7) + 7) % 7];
  return `${letter}/${octave}`;
}

// ---- Pixel y -> nearest staff key string (the staff-layout picker) ----
//
// geometry: same { topLineY, lineSpacing } shape as voiceRowY. clampSteps:
// how many diatonic steps above the top line / below the bottom line a
// click is still allowed to snap to (default 8 — enough ledger-line room
// for every voice in the shipped default layout, above (rideBell/crash2)
// and below (floorTom), plus a little slack for a custom layout that pushes
// a voice slightly further, without letting a wild click miles off-canvas
// produce a silly key many ledger lines away).
//
// Returns the nearest "<letter>/<octave>" key string for a click at pixel
// y — the reverse of voiceRowY, used by the staff-layout panel's visual
// picker (click a line/space -> save that position for the voice being
// edited) instead of asking the user to type a raw key string.
export function keyForY(y, geometry, clampSteps = 8) {
  const halfSpacing = geometry.lineSpacing / 2;
  const rawStep = TOP_LINE_KEY_STEP - Math.round((y - geometry.topLineY) / halfSpacing);
  const minStep = TOP_LINE_KEY_STEP - 8 - clampSteps; // bottom line (f/4) minus headroom
  const maxStep = TOP_LINE_KEY_STEP + clampSteps;
  const clamped = Math.min(maxStep, Math.max(minStep, rawStep));
  return keyForDiatonicStep(clamped);
}

// ---- Position <-> x (pixel column) ----
//
// geometry additionally carries: noteStartX/noteEndX (a single bar's
// note-drawing area, e.g. stave.getNoteStartX()/getNoteEndX() — the same
// pair index.html's testStaffStepX reads off a Test-staff Stave), barWidth
// in x pixels being (noteEndX - noteStartX), and stepsPerBar (from
// groove.js's stepsPerBar()). For a MULTI-BAR editor, the caller supplies
// one geometry entry per bar (see barGeometryFor below) since each bar has
// its own Stave/x-origin in a side-by-side layout, matching how the Test
// staff already lays out multiple bars.
//
// stepIndexInBar: 0-based column within one bar (0..stepsPerBar-1).
export function stepColumnX(barGeometry, stepIndexInBar, stepsPerBar) {
  const { noteStartX, noteEndX } = barGeometry;
  const colWidth = (noteEndX - noteStartX) / stepsPerBar;
  return noteStartX + colWidth * stepIndexInBar + colWidth / 2;
}

// Given an absolute grid-step position and the groove's stepsPerBar, split
// it into (bar, stepIndexInBar) — which bar's geometry to use and which
// column within that bar.
export function splitPosition(position, stepsPerBar) {
  return {
    bar: Math.floor(position / stepsPerBar),
    stepIndexInBar: position % stepsPerBar,
  };
}

// ---- (voice, position) -> (x, y) for drawing ----
//
// barGeometries: array, one entry per bar, each { noteStartX, noteEndX }
// (bar 0 first). staffGeometry: { topLineY, lineSpacing } (shared across
// bars — they're all drawn on the same horizontal staff lines).
export function drawXY(layout, voice, position, { stepsPerBar, barGeometries, staffGeometry }) {
  const { bar, stepIndexInBar } = splitPosition(position, stepsPerBar);
  const barGeometry = barGeometries[bar];
  if (!barGeometry) return null;
  const y = voiceRowY(layout, voice, staffGeometry);
  if (y === null) return null;
  const x = stepColumnX(barGeometry, stepIndexInBar, stepsPerBar);
  return { x, y, bar, stepIndexInBar };
}

// ---- Pixel click -> nearest (voice, position) ----
//
// Snapping rule (SPEC.md AC2's "grid snapping"): nearest subdivision COLUMN
// by x (clamped into [0, stepsPerBar-1] within whichever bar's x-range the
// click falls in, or the nearest bar if the click is outside all of them),
// and nearest VOICE ROW by y (whichever of the 10 voices' rows in `layout`
// is closest, no distance cutoff — every click maps to some voice, since
// the whole point is "any voice, any position" per James's ask, not a
// dead-zone between rows).
//
// Returns { voice, position } — position is the ABSOLUTE grid-step index
// (bar * stepsPerBar + stepIndexInBar), ready to pass straight to groove.js's
// toggleNote(). Returns null only if `layout` has no resolvable voices at
// all (defensive; shouldn't happen with a valid layout).
export function hitTest(layout, { x, y }, { stepsPerBar, barGeometries, staffGeometry }) {
  // ---- Nearest bar + column by x ----
  let bestBar = 0;
  let bestBarDist = Infinity;
  barGeometries.forEach((bg, i) => {
    const mid = (bg.noteStartX + bg.noteEndX) / 2;
    const halfWidth = (bg.noteEndX - bg.noteStartX) / 2;
    const dist = Math.max(0, Math.abs(x - mid) - halfWidth); // 0 if x is inside this bar's span
    if (dist < bestBarDist) {
      bestBarDist = dist;
      bestBar = i;
    }
  });

  const barGeometry = barGeometries[bestBar];
  const colWidth = (barGeometry.noteEndX - barGeometry.noteStartX) / stepsPerBar;
  const rawStep = (x - barGeometry.noteStartX) / colWidth;
  const stepIndexInBar = Math.min(stepsPerBar - 1, Math.max(0, Math.round(rawStep - 0.5)));

  // ---- Nearest voice by y ----
  let bestVoice = null;
  let bestVoiceDist = Infinity;
  for (const voice of Object.keys(layout)) {
    const rowY = voiceRowY(layout, voice, staffGeometry);
    if (rowY === null) continue;
    const dist = Math.abs(y - rowY);
    if (dist < bestVoiceDist) {
      bestVoiceDist = dist;
      bestVoice = voice;
    }
  }
  if (bestVoice === null) return null;

  const position = bestBar * stepsPerBar + stepIndexInBar;
  return { voice: bestVoice, position };
}
