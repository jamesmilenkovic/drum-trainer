"use strict";

// =============================================================================
// teststaff.js
//
// Pure maths for the rolling notated Test staff (SPEC.md increment 3,
// section A). Zero DOM, zero Web MIDI, zero AudioContext references — data
// in, result out — so it can be unit-tested headless with `node --test`
// exactly like testarea.js / scoring.js / mapping.js.
//
// Responsibilities:
//   1. Voice -> staff line-position: the SAME per-voice percussion-clef
//      key/notehead mapping the groove view uses (NOTEHEAD_KEY), so the
//      test staff and groove staff always agree on where a voice sits and
//      whether it's an x-notehead or a normal notehead. This is the single
//      source of truth — index.html imports it rather than keeping its own
//      copy.
//   2. x-position from timing: given a hit's signed ms offset from the
//      nearest subdivision grid line (from testarea.js's nearestGridLine),
//      map it to a horizontal pixel offset from that grid line's notehead —
//      early = negative (left), late = positive (right). See
//      xOffsetPxFromOffsetMs for the documented scale.
//   3. Roll/scroll boundary logic: given an absolute grid index (from
//      nearestGridLine) and the subdivision's steps-per-bar, resolve which
//      visible column and page a hit belongs to, and whether this hit is
//      the first one to land on a new page (i.e. the view just advanced).
//
// Time/offset convention matches testarea.js: offsetMs = hitTime - gridTime.
// Positive = late (dragging), negative = early (rushing).
// =============================================================================

// ---- Voice -> staff line-position (percussion clef) ----
//
// Identical mapping to the groove view's NOTEHEAD_KEY (index.html). Kept
// here as the single source of truth per SPEC.md's instruction not to
// duplicate line-position constants; index.html imports this rather than
// declaring its own copy.
//   hihatClosed -> "g/5/x2"  (x notehead, top space)
//   snare       -> "c/5"     (normal notehead, middle line)
//   kick        -> "f/4"     (normal notehead, bottom space)
//
// Only the three groove voices are mapped (kick/snare/hihatClosed) because
// that's all NOTEHEAD_KEY covered as of increment 2. A hit on any other
// mapped voice (e.g. crash, ride, toms) has no defined staff line yet —
// resolveNotehead returns null for those so the caller can decide how to
// handle an out-of-scope voice rather than silently guessing a position.
export const NOTEHEAD_KEY = {
  hihatClosed: "g/5/x2",
  snare: "c/5",
  kick: "f/4",
};

// Given a voice name, return its VexFlow key/notehead string, or null if
// the voice has no defined staff position (out of scope for this
// increment's fixed three-voice groove clef).
export function resolveNotehead(voice) {
  return NOTEHEAD_KEY[voice] ?? null;
}

// ---- x-position from timing ----
//
// Documented scale: 0.1 pixels per millisecond of signed offset, clamped to
// +-WINDOW_MS_CAP ms (mirroring scoring.js's WINDOW_MS — the same 80ms
// already treated as "the whole judged range" everywhere else in the app),
// giving a max nudge of +-8px either side of the grid line's notehead.
//
// Why so small compared to the live meter's +-120px lane: the test staff's
// columns (one per subdivision step) are only a few pixels to a few tens of
// pixels wide at typical render sizes — much narrower than the meter's
// dedicated 120px-wide lane — so an offset scaled to "read like the meter"
// would overshoot into the NEXT beat's column and look like a different
// note entirely, defeating the point of position-encodes-timing. +-8px
// keeps a miss-boundary hit clearly, visibly displaced from the black
// grid-line position without leaving its own column at any subdivision
// this app supports (quarter/eighth/sixteenth), while an on-target hit
// (<=30ms, i.e. <=3px) still reads as "basically on the line".
export const WINDOW_MS_CAP = 80;
export const PX_PER_MS = 0.1;

// offsetMs: signed ms offset from the nearest grid line (testarea.js
// nearestGridLine's offsetMs field). Returns a signed pixel offset to add
// to the grid line's notehead x position: negative = left (early),
// positive = right (late), 0 = exactly on the line.
export function xOffsetPxFromOffsetMs(offsetMs) {
  const clamped = Math.max(-WINDOW_MS_CAP, Math.min(WINDOW_MS_CAP, offsetMs));
  return clamped * PX_PER_MS;
}

// ---- Roll/scroll boundary logic ----
//
// The test staff shows a fixed number of bars at a time (VISIBLE_BARS).
// Grid steps advance forever (nearestGridLine's gridIndex is an
// ever-increasing integer once the transport is running), so they must be
// folded onto a bounded set of visible columns. This module's choice
// (documented, coder's call per SPEC.md's PO note): WRAP, not scroll — once
// playing crosses the last visible bar, the view wraps back to column 0 of
// a new "page" and keeps going, rather than smoothly scrolling a wider
// canvas. This is simpler to render correctly with VexFlow (a fixed-width
// SVG redrawn per page) and simpler to reason about/test (a deterministic
// modulo), while still satisfying "keeps going, no hard stop".
//
// VISIBLE_BARS: 8 bars visible at a time, within the spec's ~8-10 range.
export const VISIBLE_BARS = 8;

// A "column" is one grid step's slot on the visible staff: columnIndex
// counts steps within the current page (0 .. VISIBLE_BARS*stepsPerBar - 1).
// bar/beat/step are that column's position broken down for rendering
// (bar = which of the VISIBLE_BARS bars, 0-based; beat = which beat within
// the bar, 0-based; step = which subdivision step within the beat, 0-based).
//
// gridIndex:     integer grid-line index from nearestGridLine (can be 0 or
//                negative before the transport's first grid line; treated
//                the same as gridIndex 0's page/column, since that shouldn't
//                happen once running in practice — see testarea.js's own
//                note on this).
// stepsPerBeat:  subdivision steps per beat (SUBDIVISIONS value from
//                testarea.js: 1/2/4 for quarter/eighth/sixteenth).
// beatsPerBar:   time-signature beats per bar (4 for 4/4).
//
// Returns { page, bar, beat, step, columnIndex, isNewPage }:
//   page:        integer, 0-based, which "page" of VISIBLE_BARS bars this
//                grid index falls on (page 0 = bars 0..VISIBLE_BARS-1, etc).
//   bar:         0-based bar index WITHIN the page (0..VISIBLE_BARS-1).
//   beat:        0-based beat index within the bar (0..beatsPerBar-1).
//   step:        0-based subdivision step within the beat (0..stepsPerBeat-1).
//   columnIndex: 0-based step index within the page
//                (0..VISIBLE_BARS*beatsPerBar*stepsPerBeat - 1) — the
//                overall horizontal slot the caller draws into.
//   isNewPage:   true iff this gridIndex is the FIRST step of its page (i.e.
//                the view just wrapped/advanced to a new page on this hit).
export function resolveStaffPosition(gridIndex, stepsPerBeat, beatsPerBar = 4) {
  if (!Number.isFinite(stepsPerBeat) || stepsPerBeat <= 0) {
    throw new Error(`teststaff: invalid stepsPerBeat ${JSON.stringify(stepsPerBeat)}`);
  }
  if (!Number.isFinite(beatsPerBar) || beatsPerBar <= 0) {
    throw new Error(`teststaff: invalid beatsPerBar ${JSON.stringify(beatsPerBar)}`);
  }

  const stepsPerBar = stepsPerBeat * beatsPerBar;
  const stepsPerPage = stepsPerBar * VISIBLE_BARS;

  // Clamp negative gridIndex (pre-anchor hits) to 0, same "shouldn't happen
  // once running, but don't produce a nonsensical negative column" stance
  // testarea.js documents for nearestGridLine's own gridIndex.
  const idx = Math.max(0, Math.trunc(gridIndex));

  const page = Math.floor(idx / stepsPerPage);
  const columnIndex = idx % stepsPerPage;
  const bar = Math.floor(columnIndex / stepsPerBar);
  const stepInBar = columnIndex % stepsPerBar;
  const beat = Math.floor(stepInBar / stepsPerBeat);
  const step = stepInBar % stepsPerBeat;
  const isNewPage = columnIndex === 0;

  return { page, bar, beat, step, columnIndex, isNewPage };
}
