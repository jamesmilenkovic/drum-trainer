"use strict";

// =============================================================================
// test-notationlayout.mjs
//
// Node ESM tests for notationlayout.js — the pure row-wrapping/scale-sizing
// maths behind SPEC.md increment 7, section C ("long charts wrap into
// full-width systems (lines), not a horizontal squeeze"). Covers the
// code-derivable width/system-wrapping logic the SPEC's own test notes ask
// for: systems/rows given N bars + width + scale.
//
// Pure module, zero DOM/VexFlow — run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTATION_SCALE, ROW_MARGIN_X, ROW_TOP_Y, ROW_HEIGHT, computeBarLayout } from "./notationlayout.js";

// -----------------------------------------------------------------------------
// NOTATION_SCALE
// -----------------------------------------------------------------------------

test("NOTATION_SCALE: exposes exactly S/M/L, with L (LARGE) the biggest — SPEC.md's default", () => {
  assert.deepEqual(Object.keys(NOTATION_SCALE).sort(), ["L", "M", "S"]);
  assert.ok(NOTATION_SCALE.L > NOTATION_SCALE.M);
  assert.ok(NOTATION_SCALE.M > NOTATION_SCALE.S);
  assert.equal(NOTATION_SCALE.S, 1, "S is the pre-increment-7 baseline (unscaled)");
});

// -----------------------------------------------------------------------------
// computeBarLayout — single row (everything fits)
// -----------------------------------------------------------------------------

test("computeBarLayout: bars that all fit in one row stay on row 0, left to right", () => {
  const layout = computeBarLayout(4, 150, 1000);
  assert.equal(layout.rows, 1);
  assert.equal(layout.barsPerRow, Math.floor((1000 - ROW_MARGIN_X * 2) / 150));
  assert.deepEqual(
    layout.positions.map((p) => p.row),
    [0, 0, 0, 0]
  );
  assert.deepEqual(
    layout.positions.map((p) => p.col),
    [0, 1, 2, 3]
  );
  // x positions step by exactly barWidth, starting at the left margin.
  for (let i = 0; i < 4; i++) {
    assert.equal(layout.positions[i].x, ROW_MARGIN_X + i * 150);
    assert.equal(layout.positions[i].y, ROW_TOP_Y);
  }
});

test("computeBarLayout: a single bar always fits on its own row regardless of width", () => {
  const layout = computeBarLayout(1, 150, 200);
  assert.equal(layout.rows, 1);
  assert.equal(layout.positions.length, 1);
  assert.deepEqual(layout.positions[0], { row: 0, col: 0, x: ROW_MARGIN_X, y: ROW_TOP_Y });
});

// -----------------------------------------------------------------------------
// computeBarLayout — wrapping into multiple rows ("systems")
// -----------------------------------------------------------------------------

test("computeBarLayout: bars that don't all fit wrap onto a new row, not squeezed narrower", () => {
  // Container fits exactly 4 bars of 150 logical px (600 + 20 margin = 620).
  const layout = computeBarLayout(9, 150, 620);
  assert.equal(layout.barsPerRow, 4);
  assert.equal(layout.rows, 3); // ceil(9/4)
  assert.deepEqual(
    layout.positions.map((p) => p.row),
    [0, 0, 0, 0, 1, 1, 1, 1, 2]
  );
  assert.deepEqual(
    layout.positions.map((p) => p.col),
    [0, 1, 2, 3, 0, 1, 2, 3, 0]
  );
  // Every bar keeps the SAME width (150) regardless of row — never squeezed.
  const xsRow0 = layout.positions.filter((p) => p.row === 0).map((p) => p.x);
  assert.deepEqual(xsRow0, [10, 160, 310, 460]);
});

test("computeBarLayout: 16 bars at 8 bars/row wraps into exactly 2 rows of 8 (regression guard for the exact scenario verified live in increment 7)", () => {
  const layout = computeBarLayout(16, 150, 1220); // (1220-20)/150 = 8 bars/row
  assert.equal(layout.barsPerRow, 8);
  assert.equal(layout.rows, 2);
  const row0 = layout.positions.filter((p) => p.row === 0);
  const row1 = layout.positions.filter((p) => p.row === 1);
  assert.equal(row0.length, 8);
  assert.equal(row1.length, 8);
  assert.equal(row1[0].y, ROW_TOP_Y + ROW_HEIGHT);
});

test("computeBarLayout: successive rows are spaced by exactly ROW_HEIGHT, never overlapping", () => {
  const layout = computeBarLayout(20, 150, 620); // 4 bars/row -> 5 rows
  assert.equal(layout.rows, 5);
  const rowYs = [...new Set(layout.positions.map((p) => p.y))].sort((a, b) => a - b);
  assert.equal(rowYs.length, 5);
  for (let i = 1; i < rowYs.length; i++) {
    assert.equal(rowYs[i] - rowYs[i - 1], ROW_HEIGHT);
  }
});

// -----------------------------------------------------------------------------
// computeBarLayout — total canvas size
// -----------------------------------------------------------------------------

test("computeBarLayout: totalWidth fits the WIDEST row exactly (not the full container, not a partial last row)", () => {
  const layout = computeBarLayout(9, 150, 620); // 4/row, last row has only 1 bar
  assert.equal(layout.totalWidth, ROW_MARGIN_X * 2 + 4 * 150); // widest row (4 bars), not 1
});

test("computeBarLayout: totalHeight grows with the number of rows needed", () => {
  const oneRow = computeBarLayout(4, 150, 1000);
  const twoRows = computeBarLayout(9, 150, 620);
  assert.equal(oneRow.totalHeight, ROW_TOP_Y + 1 * ROW_HEIGHT + 20);
  assert.equal(twoRows.totalHeight, ROW_TOP_Y + 3 * ROW_HEIGHT + 20);
  assert.ok(twoRows.totalHeight > oneRow.totalHeight);
});

// -----------------------------------------------------------------------------
// computeBarLayout — edge cases
// -----------------------------------------------------------------------------

test("computeBarLayout: a container narrower than one bar still fits exactly 1 bar per row (never 0)", () => {
  const layout = computeBarLayout(3, 150, 50); // container much narrower than barWidth
  assert.equal(layout.barsPerRow, 1);
  assert.equal(layout.rows, 3);
  assert.deepEqual(
    layout.positions.map((p) => p.row),
    [0, 1, 2]
  );
});

test("computeBarLayout: zero bars produces an empty layout without throwing", () => {
  const layout = computeBarLayout(0, 150, 1000);
  assert.deepEqual(layout.positions, []);
  assert.equal(layout.rows, 1); // Math.max(1, ceil(0/N)) — still a well-defined single (empty) row
});

test("computeBarLayout: scaling up the LOGICAL container width (simulating a smaller notation-size scale factor) fits more bars per row", () => {
  // At scale L (1.7), a 1300-physical-px panel gives ~765 logical px; at
  // scale S (1), the SAME physical panel gives the full 1300 logical px —
  // more logical room, so more bars fit per row before wrapping. This
  // mirrors index.html's logicalContainerWidth() dividing physical width by
  // the current scale factor.
  const smallScaleLayout = computeBarLayout(10, 150, 1300); // as if scale S
  const largeScaleLayout = computeBarLayout(10, 150, 1300 / 1.7); // as if scale L
  assert.ok(smallScaleLayout.barsPerRow >= largeScaleLayout.barsPerRow);
});
