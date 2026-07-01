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
// Run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  voiceRowY,
  stepColumnX,
  splitPosition,
  drawXY,
  hitTest,
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
  // The highest-placed voice in the default layout is the ride (c/6).
  assert.equal(hit.voice, "ride");
});
