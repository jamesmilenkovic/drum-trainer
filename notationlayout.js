"use strict";

// =============================================================================
// notationlayout.js
//
// Pure row-wrapping/scale-sizing maths for notation surfaces (SPEC.md
// increment 7, section C: full-width + LARGE notation, "long charts wrap
// into full-width systems (lines), not a horizontal squeeze"). Zero DOM,
// zero VexFlow, zero AudioContext — data in, result out — so it can be
// unit-tested headless with `node --test`, exactly like editorhit.js/
// clickschedule.js pull their own pure maths out of index.html's inline
// VexFlow/scheduling glue.
//
// This is the code-derivable half of the increment-7 "any width/system-
// wrapping logic" test-notes requirement. The OTHER half — actually
// creating a VexFlow renderer/context at a given physical size
// (renderWithScale), and reading a real DOM element's clientWidth
// (logicalContainerWidth) — stays in index.html since it's inherently
// DOM/VexFlow-dependent and can't be pure.
//
// All three notation surfaces (the Groove/practice view, the editor, and
// the Test staff) share this ONE layout function rather than three
// separately hand-rolled wrapping schemes.
// =============================================================================

// Scaling approach (see index.html's renderWithScale for the full story):
// VexFlow's own SVGContext.scale(sx, sy) sets a VIEWBOX on the rendered
// <svg> (confirmed by reading vexflow's own source), not a transform on a
// group — renderer.resize(w, h) sets the physical width/height, then
// context.scale(s, s) sets viewBox="0 0 w/s h/s". S/M/L are the three
// supported scale factors; L (LARGE) is SPEC.md's explicit default.
export const NOTATION_SCALE = { S: 1, M: 1.35, L: 1.7 };

// Row layout constants — logical px, scaled uniformly with everything else
// at render time (so they hold at any notation size). ROW_HEIGHT matches
// this app's pre-increment-7 single-row canvas height (already comfortably
// fits the shipped default layout's full off-staff reach, e.g. rideBell
// above / floorTom below).
export const ROW_MARGIN_X = 10;
export const ROW_TOP_Y = 30;
export const ROW_HEIGHT = 190;

// Row-based bar layout: given a total bar count, a per-bar LOGICAL width,
// and the LOGICAL container width available, lays bars left-to-right and
// wraps onto a new row once a row is full — "full-width systems (lines),
// not a horizontal squeeze" (SPEC.md section C).
//
// Returns:
//   positions:   [{ row, col, x, y }] — one entry per bar (0-based, bar 0
//                first), the (x, y) to construct that bar's Stave at.
//   barsPerRow:  how many bars fit across one row at this width.
//   rows:        total number of rows the layout needs.
//   totalWidth:  the LOGICAL canvas width needed to fit the widest row.
//   totalHeight: the LOGICAL canvas height needed to fit every row.
export function computeBarLayout(totalBars, barWidth, containerWidthLogical) {
  const usableWidth = Math.max(barWidth, containerWidthLogical - ROW_MARGIN_X * 2);
  const barsPerRow = Math.max(1, Math.floor(usableWidth / barWidth));
  const rows = Math.max(1, Math.ceil(totalBars / barsPerRow));
  const positions = [];
  for (let i = 0; i < totalBars; i++) {
    const row = Math.floor(i / barsPerRow);
    const col = i % barsPerRow;
    positions.push({ row, col, x: ROW_MARGIN_X + col * barWidth, y: ROW_TOP_Y + row * ROW_HEIGHT });
  }
  const barsInWidestRow = Math.min(totalBars, barsPerRow);
  return {
    positions,
    barsPerRow,
    rows,
    totalWidth: ROW_MARGIN_X * 2 + barsInWidestRow * barWidth,
    totalHeight: ROW_TOP_Y + rows * ROW_HEIGHT + 20,
  };
}
