"use strict";

// =============================================================================
// test-teststaff.mjs
//
// Node ESM test for teststaff.js (pure module, zero DOM/Web MIDI/AudioContext).
// Covers SPEC.md increment 3 AC2 & AC3: voice -> staff notehead mapping,
// x-position-from-ms placement (including the WINDOW_MS_CAP clamp), and the
// roll/scroll (wrap) boundary logic with synthetic hits — including a hit
// exactly on a grid line, a hit halfway between lines (via testarea.js), and
// a hit crossing the last visible bar of a page.
//
// Run: node test-teststaff.mjs
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NOTEHEAD_KEY,
  resolveNotehead,
  xOffsetPxFromOffsetMs,
  WINDOW_MS_CAP,
  PX_PER_MS,
  VISIBLE_BARS,
  resolveStaffPosition,
} from "./teststaff.js";
import { nearestGridLine, secondsPerGridStep } from "./testarea.js";

// -----------------------------------------------------------------------------
// Voice -> staff notehead mapping
// -----------------------------------------------------------------------------

test("resolveNotehead: kick/snare/hihatClosed match the groove view's NOTEHEAD_KEY mapping", () => {
  assert.equal(resolveNotehead("kick"), "f/4");
  assert.equal(resolveNotehead("snare"), "c/5");
  assert.equal(resolveNotehead("hihatClosed"), "g/5/x2");
});

test("resolveNotehead: an out-of-scope voice (e.g. crash) returns null, not a guess", () => {
  assert.equal(resolveNotehead("crash"), null);
  assert.equal(resolveNotehead("ride"), null);
  assert.equal(resolveNotehead("tom1"), null);
});

test("NOTEHEAD_KEY: exactly the three groove-clef voices, matching index.html's mapping", () => {
  assert.deepEqual(NOTEHEAD_KEY, {
    hihatClosed: "g/5/x2",
    snare: "c/5",
    kick: "f/4",
  });
});

// -----------------------------------------------------------------------------
// x-position from timing
// -----------------------------------------------------------------------------

test("xOffsetPxFromOffsetMs: 0ms offset (exactly on the grid line) is 0px", () => {
  assert.equal(xOffsetPxFromOffsetMs(0), 0);
});

test("xOffsetPxFromOffsetMs: positive (late) offset is a positive (rightward) pixel offset", () => {
  assert.equal(xOffsetPxFromOffsetMs(20), 20 * PX_PER_MS);
});

test("xOffsetPxFromOffsetMs: negative (early) offset is a negative (leftward) pixel offset", () => {
  assert.equal(xOffsetPxFromOffsetMs(-20), -20 * PX_PER_MS);
});

test("xOffsetPxFromOffsetMs: a hit exactly halfway between two grid lines (250ms at 120bpm quarter) clamps to the cap", () => {
  const step = secondsPerGridStep(120, "quarter"); // 0.5s
  const anchor = 10;
  const halfway = anchor + step + step / 2;
  const { offsetMs } = nearestGridLine(halfway, anchor, 120, "quarter");
  assert.equal(offsetMs, -250); // matches testarea.js's documented tie-break
  // -250ms is far outside the +-80ms cap, so it clamps to -WINDOW_MS_CAP.
  assert.equal(xOffsetPxFromOffsetMs(offsetMs), -WINDOW_MS_CAP * PX_PER_MS);
});

test("xOffsetPxFromOffsetMs: exactly at the cap (+80ms) is not clamped further", () => {
  assert.equal(xOffsetPxFromOffsetMs(WINDOW_MS_CAP), WINDOW_MS_CAP * PX_PER_MS);
  assert.equal(xOffsetPxFromOffsetMs(-WINDOW_MS_CAP), -WINDOW_MS_CAP * PX_PER_MS);
});

test("xOffsetPxFromOffsetMs: a wild outlier (+500ms) clamps to +WINDOW_MS_CAP, doesn't fly off", () => {
  assert.equal(xOffsetPxFromOffsetMs(500), WINDOW_MS_CAP * PX_PER_MS);
  assert.equal(xOffsetPxFromOffsetMs(-500), -WINDOW_MS_CAP * PX_PER_MS);
});

// -----------------------------------------------------------------------------
// Roll/scroll (wrap) boundary logic
// -----------------------------------------------------------------------------

test("resolveStaffPosition: gridIndex 0 is page 0, bar 0, beat 0, step 0, isNewPage true", () => {
  const r = resolveStaffPosition(0, 2, 4); // eighth notes, 4/4
  assert.deepEqual(r, { page: 0, bar: 0, beat: 0, step: 0, columnIndex: 0, isNewPage: true });
});

test("resolveStaffPosition: second grid step (eighth notes) is beat 0, step 1, not a new page", () => {
  const r = resolveStaffPosition(1, 2, 4);
  assert.equal(r.bar, 0);
  assert.equal(r.beat, 0);
  assert.equal(r.step, 1);
  assert.equal(r.columnIndex, 1);
  assert.equal(r.isNewPage, false);
});

test("resolveStaffPosition: first step of beat 2 (3rd beat) lands on the right beat/step", () => {
  // eighth notes: 2 steps per beat, so beat index 2 starts at columnIndex 4
  const r = resolveStaffPosition(4, 2, 4);
  assert.equal(r.bar, 0);
  assert.equal(r.beat, 2);
  assert.equal(r.step, 0);
});

test("resolveStaffPosition: first step of bar 1 (columnIndex = stepsPerBar) is bar 1, beat 0, step 0", () => {
  const stepsPerBar = 2 * 4; // eighth notes, 4/4
  const r = resolveStaffPosition(stepsPerBar, 2, 4);
  assert.equal(r.page, 0);
  assert.equal(r.bar, 1);
  assert.equal(r.beat, 0);
  assert.equal(r.step, 0);
  assert.equal(r.isNewPage, false); // new BAR, but not a new PAGE
});

test("resolveStaffPosition: last step of the last visible bar is still page 0", () => {
  const stepsPerBar = 2 * 4;
  const lastStepOfPage = VISIBLE_BARS * stepsPerBar - 1;
  const r = resolveStaffPosition(lastStepOfPage, 2, 4);
  assert.equal(r.page, 0);
  assert.equal(r.bar, VISIBLE_BARS - 1);
  assert.equal(r.isNewPage, false);
});

test("resolveStaffPosition: BOUNDARY — the step that crosses past the last visible bar wraps to page 1, bar 0, and flags isNewPage", () => {
  const stepsPerBar = 2 * 4;
  const firstStepOfNextPage = VISIBLE_BARS * stepsPerBar;
  const r = resolveStaffPosition(firstStepOfNextPage, 2, 4);
  assert.equal(r.page, 1);
  assert.equal(r.bar, 0);
  assert.equal(r.beat, 0);
  assert.equal(r.step, 0);
  assert.equal(r.columnIndex, 0);
  assert.equal(r.isNewPage, true);
});

test("resolveStaffPosition: page 2 boundary also wraps correctly (not just the first wrap)", () => {
  const stepsPerBar = 2 * 4;
  const firstStepOfPage2 = VISIBLE_BARS * stepsPerBar * 2;
  const r = resolveStaffPosition(firstStepOfPage2, 2, 4);
  assert.equal(r.page, 2);
  assert.equal(r.bar, 0);
  assert.equal(r.isNewPage, true);
});

test("resolveStaffPosition: works for sixteenth-note subdivision (4 steps per beat)", () => {
  const stepsPerBar = 4 * 4; // sixteenth notes, 4/4
  const r = resolveStaffPosition(stepsPerBar * 3 + 5, 4, 4); // bar 3, step 5 => beat 1, step 1
  assert.equal(r.bar, 3);
  assert.equal(r.beat, 1);
  assert.equal(r.step, 1);
});

test("resolveStaffPosition: works for quarter-note subdivision (1 step per beat)", () => {
  const r = resolveStaffPosition(4, 1, 4); // 4 steps in = start of bar 1
  assert.equal(r.bar, 1);
  assert.equal(r.beat, 0);
  assert.equal(r.step, 0);
});

test("resolveStaffPosition: a negative gridIndex (pre-anchor, shouldn't happen in practice) clamps to gridIndex 0's position rather than throwing", () => {
  const r = resolveStaffPosition(-1, 2, 4);
  assert.equal(r.page, 0);
  assert.equal(r.bar, 0);
  assert.equal(r.beat, 0);
  assert.equal(r.step, 0);
});

test("resolveStaffPosition: invalid stepsPerBeat throws", () => {
  assert.throws(() => resolveStaffPosition(0, 0, 4));
  assert.throws(() => resolveStaffPosition(0, -1, 4));
  assert.throws(() => resolveStaffPosition(0, NaN, 4));
});

test("resolveStaffPosition: invalid beatsPerBar throws", () => {
  assert.throws(() => resolveStaffPosition(0, 2, 0));
});

test("resolveStaffPosition: default beatsPerBar is 4 (4/4 time)", () => {
  const stepsPerBar = 2 * 4;
  const r = resolveStaffPosition(stepsPerBar, 2);
  assert.equal(r.bar, 1);
});

// QA-added gap-fill tests below (2026-07-01) — see notes at each test.

test("VISIBLE_BARS: is 8, within SPEC.md's ~8-10 visible-bar range (regression guard on the exact value, not just its symbolic use)", () => {
  // The rest of this suite uses VISIBLE_BARS symbolically (e.g.
  // VISIBLE_BARS * stepsPerBar), which would still pass even if the
  // constant were accidentally changed to 1 or 100. Pin the actual
  // documented value so a silent change to the page size is caught.
  assert.equal(VISIBLE_BARS, 8);
  assert.ok(VISIBLE_BARS >= 8 && VISIBLE_BARS <= 10);
});

test("resolveStaffPosition: a non-integer gridIndex is truncated (floor toward zero), not rounded or thrown", () => {
  // Code takes Math.trunc(gridIndex) internally; nearestGridLine always
  // returns integers in practice, but guard the defensive truncation
  // behavior explicitly since it's untested otherwise.
  const stepsPerBeat = 2;
  const beatsPerBar = 4;
  const whole = resolveStaffPosition(5, stepsPerBeat, beatsPerBar);
  const truncatedDown = resolveStaffPosition(5.9, stepsPerBeat, beatsPerBar);
  const truncatedUp = resolveStaffPosition(5.1, stepsPerBeat, beatsPerBar);
  assert.deepEqual(truncatedDown, whole);
  assert.deepEqual(truncatedUp, whole);
});

test("resolveStaffPosition: first grid line of the LAST visible bar (not just its last step) resolves to bar VISIBLE_BARS-1, beat 0, step 0, still page 0", () => {
  const stepsPerBeat = 2;
  const beatsPerBar = 4;
  const stepsPerBar = stepsPerBeat * beatsPerBar;
  const firstStepOfLastBar = (VISIBLE_BARS - 1) * stepsPerBar;
  const r = resolveStaffPosition(firstStepOfLastBar, stepsPerBeat, beatsPerBar);
  assert.equal(r.page, 0);
  assert.equal(r.bar, VISIBLE_BARS - 1);
  assert.equal(r.beat, 0);
  assert.equal(r.step, 0);
  assert.equal(r.isNewPage, false);
});

test("resolveStaffPosition: quarter-note subdivision also wraps correctly at the page boundary (not just eighth/sixteenth)", () => {
  // The existing page-boundary-cross tests (page 0->1, page 1->2) only
  // exercise stepsPerBeat=2 (eighth notes). Quarter notes (stepsPerBeat=1)
  // only got a plain bar-boundary check, not a full-page-wrap check.
  const stepsPerBeat = 1; // quarter notes
  const beatsPerBar = 4;
  const stepsPerBar = stepsPerBeat * beatsPerBar; // 4
  const lastStepOfPage = VISIBLE_BARS * stepsPerBar - 1;
  const firstStepOfNextPage = VISIBLE_BARS * stepsPerBar;

  const last = resolveStaffPosition(lastStepOfPage, stepsPerBeat, beatsPerBar);
  assert.equal(last.page, 0);
  assert.equal(last.bar, VISIBLE_BARS - 1);
  assert.equal(last.isNewPage, false);

  const first = resolveStaffPosition(firstStepOfNextPage, stepsPerBeat, beatsPerBar);
  assert.equal(first.page, 1);
  assert.equal(first.bar, 0);
  assert.equal(first.beat, 0);
  assert.equal(first.step, 0);
  assert.equal(first.isNewPage, true);
});

test("resolveStaffPosition: sixteenth-note subdivision also wraps correctly at the page boundary", () => {
  const stepsPerBeat = 4; // sixteenth notes
  const beatsPerBar = 4;
  const stepsPerBar = stepsPerBeat * beatsPerBar; // 16
  const firstStepOfNextPage = VISIBLE_BARS * stepsPerBar;
  const r = resolveStaffPosition(firstStepOfNextPage, stepsPerBeat, beatsPerBar);
  assert.equal(r.page, 1);
  assert.equal(r.bar, 0);
  assert.equal(r.isNewPage, true);
});

// -----------------------------------------------------------------------------
// Integration: nearestGridLine's gridIndex feeds resolveStaffPosition directly
// -----------------------------------------------------------------------------

test("integration: a stream of synthetic hits across a page boundary resolves consistently", () => {
  const bpm = 120;
  const subdivision = "eighth";
  const stepsPerBeat = 2;
  const anchor = 0;
  const step = secondsPerGridStep(bpm, subdivision);
  const stepsPerBar = stepsPerBeat * 4;
  const lastStepOfPage = VISIBLE_BARS * stepsPerBar - 1;

  // Hit that lands (slightly late) on the very last grid step of page 0.
  const hitTimeLastOfPage = anchor + lastStepOfPage * step + 0.005;
  const { gridIndex: gi1 } = nearestGridLine(hitTimeLastOfPage, anchor, bpm, subdivision);
  const pos1 = resolveStaffPosition(gi1, stepsPerBeat, 4);
  assert.equal(pos1.page, 0);
  assert.equal(pos1.isNewPage, false);

  // Next hit, one grid step later, crosses into the new page.
  const hitTimeFirstOfNextPage = anchor + (lastStepOfPage + 1) * step + 0.005;
  const { gridIndex: gi2 } = nearestGridLine(hitTimeFirstOfNextPage, anchor, bpm, subdivision);
  const pos2 = resolveStaffPosition(gi2, stepsPerBeat, 4);
  assert.equal(pos2.page, 1);
  assert.equal(pos2.isNewPage, true);
});

// -----------------------------------------------------------------------------
// Purity check — no DOM/window/navigator API usage in the source text.
// -----------------------------------------------------------------------------

test("purity: teststaff.js source has no DOM/window/navigator API usage (comments excluded)", async () => {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(new URL("./teststaff.js", import.meta.url), "utf8");
  const src = raw
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.doesNotMatch(src, /\bdocument\./);
  assert.doesNotMatch(src, /\bwindow\./);
  assert.doesNotMatch(src, /\bnavigator\./);
  assert.doesNotMatch(src, /requestMIDIAccess/);
  assert.doesNotMatch(src, /new AudioContext/);
});
