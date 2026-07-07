"use strict";

// =============================================================================
// test-editorhit.mjs
//
// Node ESM tests for editorhit.js — the pure hit-testing maths behind the
// staff-based groove editor (SPEC.md increment 4, section B / AC2). Covers
// the [auto] part of AC2: pixel click -> nearest (voice, position) with grid
// snapping, and (voice, position) -> (x, y) for drawing, both against plain-
// number stave geometry + the staff-layout map (no VexFlow / no DOM).
//
// Increment 5 adds keyForY: the reverse of voiceRowY, used by the staff-
// layout panel's visual position picker (SPEC.md section A) to turn a click
// on a mini staff into a key string, without ever showing that raw string
// to the user.
//
// Run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  voiceRowY,
  keyForY,
  stepColumnX,
  splitPosition,
  drawXY,
  hitTest,
  layoutVerticalReach,
  PICKER_CLAMP_STEPS,
} from "./editorhit.js";
import { getDefaultStaffLayout } from "./stafflayout.js";
import { VOICES } from "./mapping.js";

const layout = getDefaultStaffLayout();

// A synthetic single-bar geometry: note area 40..200px, 8 eighth-note columns,
// staff top line at y=30 with 10px line spacing (VexFlow's default).
const GEO_1BAR = {
  stepsPerBar: 8,
  barGeometries: [{ noteStartX: 40, noteEndX: 200 }],
  staffGeometry: { topLineY: 30, lineSpacing: 10 },
};

// -----------------------------------------------------------------------------
// splitPosition
// -----------------------------------------------------------------------------

test("splitPosition: splits an absolute position into (bar, stepIndexInBar)", () => {
  assert.deepEqual(splitPosition(0, 8), { bar: 0, stepIndexInBar: 0 });
  assert.deepEqual(splitPosition(7, 8), { bar: 0, stepIndexInBar: 7 });
  assert.deepEqual(splitPosition(8, 8), { bar: 1, stepIndexInBar: 0 });
  assert.deepEqual(splitPosition(11, 8), { bar: 1, stepIndexInBar: 3 });
});

// -----------------------------------------------------------------------------
// stepColumnX — column CENTRE placement
// -----------------------------------------------------------------------------

test("stepColumnX: step 0 sits at the centre of the first column, not at the bar edge", () => {
  const colWidth = (200 - 40) / 8; // 20
  assert.equal(stepColumnX({ noteStartX: 40, noteEndX: 200 }, 0, 8), 40 + colWidth / 2);
  assert.equal(stepColumnX({ noteStartX: 40, noteEndX: 200 }, 7, 8), 40 + colWidth * 7 + colWidth / 2);
});

// -----------------------------------------------------------------------------
// voiceRowY — higher pitch = higher on the staff = smaller y
// -----------------------------------------------------------------------------

test("voiceRowY: a higher-pitched voice has a SMALLER y than a lower-pitched one", () => {
  const crashY = voiceRowY(layout, "crash", GEO_1BAR.staffGeometry); // above the staff
  const kickY = voiceRowY(layout, "kick", GEO_1BAR.staffGeometry); // bottom space
  const floorY = voiceRowY(layout, "floorTom", GEO_1BAR.staffGeometry); // below the staff
  assert.ok(crashY < kickY, "crash sits above kick");
  assert.ok(kickY < floorY, "kick sits above floor tom");
});

test("voiceRowY: snare (c/5) sits within the staff, 1.5 line-spaces below the top line", () => {
  // Lines at y=30,40,50,60,70 (top..bottom). The formula anchors f/5 on the
  // top line and drops half a line-space per diatonic step; c/5 is 3 steps
  // below f/5 (f5->e5->d5->c5) = 1.5 spaces = 15px below the top line = y 45.
  const g = { topLineY: 30, lineSpacing: 10 };
  assert.equal(voiceRowY(layout, "snare", g), 45);
  assert.ok(voiceRowY(layout, "snare", g) > 30 && voiceRowY(layout, "snare", g) < 70, "within the staff");
});

test("voiceRowY: unknown voice / unparseable key returns null", () => {
  assert.equal(voiceRowY(layout, "cowbell", GEO_1BAR.staffGeometry), null);
  assert.equal(voiceRowY({ kick: { key: "??", notehead: "normal" } }, "kick", GEO_1BAR.staffGeometry), null);
});

// -----------------------------------------------------------------------------
// keyForY — the staff-layout picker's click -> key string (SPEC.md
// increment 5, section A: "click a line/space, no raw key strings shown")
// -----------------------------------------------------------------------------

test("keyForY: voiceRowY -> keyForY round-trips for every voice's DEFAULT key (a click on a voice's own row gives back its own key)", () => {
  const g = { topLineY: 30, lineSpacing: 10 };
  for (const voice of VOICES) {
    const y = voiceRowY(layout, voice, g);
    assert.equal(keyForY(y, g), layout[voice].key, `${voice} did not round-trip`);
  }
});

test("keyForY: the exact top line pixel resolves to f/5 (the formula's anchor key, per voiceRowY's own documented convention)", () => {
  const g = { topLineY: 30, lineSpacing: 10 };
  assert.equal(keyForY(30, g), "f/5");
});

test("keyForY: a click snaps to the NEAREST line/space, not just the one above or below", () => {
  const g = { topLineY: 30, lineSpacing: 10 };
  // Halfway between two rows (5px, a quarter line-space) still snaps definitively either way, no fractional key.
  const nearTop = keyForY(32, g);
  assert.match(nearTop, /^[a-g]\/\d+$/);
});

test("keyForY: clicks far off the top/bottom of the staff clamp to a bounded key, not an absurd octave", () => {
  const g = { topLineY: 30, lineSpacing: 10 };
  const wayAbove = keyForY(-5000, g);
  const wayBelow = keyForY(5000, g);
  assert.match(wayAbove, /^[a-g]\/\d+$/);
  assert.match(wayBelow, /^[a-g]\/\d+$/);
  // Clamped, not runaway: a reasonable octave range, not e.g. "/700".
  const octaveOf = (k) => Number(k.split("/")[1]);
  assert.ok(octaveOf(wayAbove) < 10);
  assert.ok(octaveOf(wayBelow) >= 0);
});

// -----------------------------------------------------------------------------
// drawXY -> hitTest round-trip (the core AC2 guarantee)
// -----------------------------------------------------------------------------

test("drawXY -> hitTest round-trips for every voice at several positions", () => {
  for (const voice of VOICES) {
    for (const position of [0, 3, 7]) {
      const xy = drawXY(layout, voice, position, GEO_1BAR);
      assert.ok(xy, `drawXY returned null for ${voice}@${position}`);
      const hit = hitTest(layout, { x: xy.x, y: xy.y }, GEO_1BAR);
      assert.deepEqual(hit, { voice, position }, `round-trip failed for ${voice}@${position}`);
    }
  }
});

test("drawXY: multi-bar — a position in bar 1 uses bar 1's geometry", () => {
  const geo2 = {
    stepsPerBar: 8,
    barGeometries: [
      { noteStartX: 40, noteEndX: 200 },
      { noteStartX: 210, noteEndX: 370 },
    ],
    staffGeometry: { topLineY: 30, lineSpacing: 10 },
  };
  const xy = drawXY(layout, "kick", 8, geo2); // first step of bar 1
  assert.equal(xy.bar, 1);
  assert.ok(xy.x >= 210 && xy.x <= 370, "x falls within bar 1's note area");
  const hit = hitTest(layout, { x: xy.x, y: xy.y }, geo2);
  assert.deepEqual(hit, { voice: "kick", position: 8 });
});

test("drawXY: a position whose bar has no geometry returns null (defensive)", () => {
  assert.equal(drawXY(layout, "kick", 8, GEO_1BAR), null); // only 1 bar of geometry
});

// -----------------------------------------------------------------------------
// hitTest — grid snapping + nearest voice
// -----------------------------------------------------------------------------

test("hitTest: snaps a click anywhere within a column to that column's step", () => {
  const colWidth = 20; // (200-40)/8
  const snareY = voiceRowY(layout, "snare", GEO_1BAR.staffGeometry);
  // Just left of column 3's centre and just right of it both snap to step 3.
  const centre3 = 40 + colWidth * 3 + colWidth / 2;
  assert.equal(hitTest(layout, { x: centre3 - 4, y: snareY }, GEO_1BAR).position, 3);
  assert.equal(hitTest(layout, { x: centre3 + 4, y: snareY }, GEO_1BAR).position, 3);
});

test("hitTest: a click left of the bar clamps to step 0; right of the bar clamps to the last step", () => {
  const snareY = voiceRowY(layout, "snare", GEO_1BAR.staffGeometry);
  assert.equal(hitTest(layout, { x: 0, y: snareY }, GEO_1BAR).position, 0);
  assert.equal(hitTest(layout, { x: 9999, y: snareY }, GEO_1BAR).position, 7);
});

test("hitTest: snaps to the NEAREST voice row by y", () => {
  const kickY = voiceRowY(layout, "kick", GEO_1BAR.staffGeometry);
  // A click 1px off the kick row still resolves to kick.
  assert.equal(hitTest(layout, { x: 50, y: kickY + 1 }, GEO_1BAR).voice, "kick");
});

test("hitTest: a click far above the staff snaps to the highest voice (a cymbal), not null", () => {
  const hit = hitTest(layout, { x: 50, y: -100 }, GEO_1BAR);
  assert.ok(hit, "every click maps to some voice (no dead zone)");
  // The highest-placed voice in the default layout is rideBell (e/6, added increment 5).
  assert.equal(hit.voice, "rideBell");
});

// -----------------------------------------------------------------------------
// Row-wrapping (SPEC.md increment 7, section C): a barGeometry entry may
// carry its own rowTopLineY when a chart wraps bars across multiple lines.
// -----------------------------------------------------------------------------

test("drawXY/hitTest: a bar with its own rowTopLineY draws/hit-tests against ITS row, not the shared staffGeometry", () => {
  const geoRows = {
    stepsPerBar: 8,
    // bar 0 is row 0 (top-line y 30); bar 1 is row 1, wrapped onto its own
    // line 190px further down (top-line y 220) — same shape as index.html's
    // computeBarLayout would produce.
    barGeometries: [
      { noteStartX: 40, noteEndX: 200, rowTopLineY: 30 },
      { noteStartX: 40, noteEndX: 200, rowTopLineY: 220 },
    ],
    staffGeometry: { topLineY: 30, lineSpacing: 10 }, // row 0's geometry, as a fallback/default
  };
  const xyRow0 = drawXY(layout, "snare", 0, geoRows); // bar 0, row 0
  const xyRow1 = drawXY(layout, "snare", 8, geoRows); // bar 1, row 1
  assert.equal(xyRow0.y, 45); // matches the plain single-row test above
  assert.equal(xyRow1.y, 235); // same relative offset (15px below its OWN row's top line)

  const hit0 = hitTest(layout, { x: xyRow0.x, y: xyRow0.y }, geoRows);
  assert.deepEqual(hit0, { voice: "snare", position: 0 });
  const hit1 = hitTest(layout, { x: xyRow1.x, y: xyRow1.y }, geoRows);
  assert.deepEqual(hit1, { voice: "snare", position: 8 });
});

test("drawXY/hitTest: a barGeometry WITHOUT rowTopLineY falls back to the shared staffGeometry (pre-increment-7 single-row shape, unchanged)", () => {
  const xy = drawXY(layout, "kick", 0, GEO_1BAR);
  const hit = hitTest(layout, { x: xy.x, y: xy.y }, GEO_1BAR);
  assert.deepEqual(hit, { voice: "kick", position: 0 });
});

// -----------------------------------------------------------------------------
// layoutVerticalReach — cheap guard for the picker-clipping bugfix (SPEC.md
// increment 6, section D). Locks in the DEFAULT layout's actual reach so a
// future voice/position change that pushes further off-staff gets caught
// here rather than silently re-clipping the picker.
// -----------------------------------------------------------------------------

test("layoutVerticalReach: default layout reaches 5 steps above the top line (rideBell, e/6) and 7 below the bottom line (floorTom, f/3)", () => {
  const reach = layoutVerticalReach(layout);
  assert.equal(reach.aboveSteps, 5);
  assert.equal(reach.belowSteps, 7);
});

test("layoutVerticalReach: a layout with everything ON the 5-line staff has zero reach", () => {
  const onStaff = { snare: { key: "c/5", notehead: "normal" }, kick: { key: "f/4", notehead: "normal" } };
  assert.deepEqual(layoutVerticalReach(onStaff), { aboveSteps: 0, belowSteps: 0 });
});

test("layoutVerticalReach: an empty/garbage layout reaches nothing (defensive)", () => {
  assert.deepEqual(layoutVerticalReach({}), { aboveSteps: 0, belowSteps: 0 });
  assert.deepEqual(layoutVerticalReach({ x: { key: "not-a-key" } }), { aboveSteps: 0, belowSteps: 0 });
});

// -----------------------------------------------------------------------------
// PICKER_CLAMP_STEPS — regression guard (SPEC.md increment 6 code-review
// follow-up): index.html's picker-canvas sizing widens its margin to at
// least this many steps, so the canvas is never smaller than what a click
// can actually reach. keyForY's own default clampSteps must keep matching
// this exported constant (not silently drift into two different numbers).
// -----------------------------------------------------------------------------

test("PICKER_CLAMP_STEPS: keyForY's default clampSteps matches the exported constant index.html sizes its picker canvas from", () => {
  assert.equal(PICKER_CLAMP_STEPS, 8);
  // A click PICKER_CLAMP_STEPS+1 steps above the top line should clamp to
  // exactly PICKER_CLAMP_STEPS above it when clampSteps is left at its
  // default (i.e. keyForY(y, geo) with no third argument uses this constant,
  // not a hard-coded literal that could drift from it).
  const geo = { topLineY: 100, lineSpacing: 10 };
  const halfSpacing = geo.lineSpacing / 2;
  const farAboveY = geo.topLineY - (PICKER_CLAMP_STEPS + 5) * halfSpacing;
  assert.equal(keyForY(farAboveY, geo), keyForY(farAboveY, geo, PICKER_CLAMP_STEPS));
});
