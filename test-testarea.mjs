"use strict";

// =============================================================================
// test-testarea.mjs
//
// Node ESM test for testarea.js (pure module, zero DOM/Web MIDI/AudioContext).
// Covers SPEC.md AC5: nearest-grid-line selection, ms->colour band (reusing
// scoring.js's ON_TARGET_MS/WINDOW_MS), and running-stats accumulation
// (avg signed offset, % on-target, tightest/loosest). Explicit coverage per
// spec: hits exactly between two grid lines, rapid double hits, boundaries
// at exactly 30ms and 80ms.
//
// Time convention matches scoring.js/testarea.js: all times are in SECONDS
// on the audio-clock domain. Helper `sec(ms)` converts ms to seconds.
//
// Run: node test-testarea.mjs
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUBDIVISIONS,
  secondsPerGridStep,
  nearestGridLine,
  msToBand,
  createRunningStats,
  addHitToStats,
  summarizeStats,
  ON_TARGET_MS,
  WINDOW_MS,
} from "./testarea.js";

const sec = (ms) => ms / 1000;
const ANCHOR = 10; // arbitrary anchor time, audio-clock seconds

// -----------------------------------------------------------------------------
// secondsPerGridStep
// -----------------------------------------------------------------------------

test("secondsPerGridStep: quarter at 120bpm is 0.5s", () => {
  assert.equal(secondsPerGridStep(120, "quarter"), 0.5);
});

test("secondsPerGridStep: eighth at 120bpm is 0.25s", () => {
  assert.equal(secondsPerGridStep(120, "eighth"), 0.25);
});

test("secondsPerGridStep: sixteenth at 120bpm is 0.125s", () => {
  assert.equal(secondsPerGridStep(120, "sixteenth"), 0.125);
});

test("secondsPerGridStep: accepts a raw numeric steps-per-beat", () => {
  assert.equal(secondsPerGridStep(120, 2), 0.25);
});

test("secondsPerGridStep: unknown subdivision throws", () => {
  assert.throws(() => secondsPerGridStep(120, "triplet"));
});

test("SUBDIVISIONS: exactly the three v1 subdivisions per spec", () => {
  assert.deepEqual(Object.keys(SUBDIVISIONS).sort(), ["eighth", "quarter", "sixteenth"]);
});

// -----------------------------------------------------------------------------
// nearestGridLine — basic cases
// -----------------------------------------------------------------------------

test("nearestGridLine: hit exactly on a grid line has 0 offset", () => {
  const step = secondsPerGridStep(120, "eighth"); // 0.25s
  const r = nearestGridLine(ANCHOR + 3 * step, ANCHOR, 120, "eighth");
  assert.equal(r.gridIndex, 3);
  assert.equal(r.offsetMs, 0);
});

test("nearestGridLine: hit slightly after a grid line is positive (late)", () => {
  const step = secondsPerGridStep(120, "eighth");
  const r = nearestGridLine(ANCHOR + 2 * step + sec(10), ANCHOR, 120, "eighth");
  assert.equal(r.gridIndex, 2);
  assert.equal(r.offsetMs, 10);
});

test("nearestGridLine: hit slightly before a grid line is negative (early)", () => {
  const step = secondsPerGridStep(120, "eighth");
  const r = nearestGridLine(ANCHOR + 2 * step - sec(10), ANCHOR, 120, "eighth");
  assert.equal(r.gridIndex, 2);
  assert.equal(r.offsetMs, -10);
});

test("nearestGridLine: anchor itself (gridIndex 0) round-trips to 0 offset", () => {
  const r = nearestGridLine(ANCHOR, ANCHOR, 100, "quarter");
  assert.equal(r.gridIndex, 0);
  assert.equal(r.gridTime, ANCHOR);
  assert.equal(r.offsetMs, 0);
});

// -----------------------------------------------------------------------------
// nearestGridLine — hit exactly between two grid lines (tricky case #1)
// -----------------------------------------------------------------------------

test("nearestGridLine: hit exactly halfway between two grid lines rounds to the LATER line", () => {
  const step = secondsPerGridStep(120, "quarter"); // 0.5s at 120bpm
  const halfway = ANCHOR + 1 * step + step / 2; // exactly between grid line 1 and 2
  const r = nearestGridLine(halfway, ANCHOR, 120, "quarter");
  // Documented tie-break: rounds to the later grid line (index 2), so the
  // offset is negative (early relative to line 2), matching Math.round's
  // own half-up convention rather than an arbitrary choice.
  assert.equal(r.gridIndex, 2);
  assert.equal(r.offsetMs, -250); // half of 500ms step, early side of line 2
});

test("nearestGridLine: hit exactly halfway is equally 'late' relative to the earlier line (sanity check via manual calc)", () => {
  const step = secondsPerGridStep(120, "quarter");
  const halfway = ANCHOR + 1 * step + step / 2;
  const offsetFromEarlierLine = (halfway - (ANCHOR + 1 * step)) * 1000;
  assert.equal(offsetFromEarlierLine, 250); // confirms it's truly the midpoint (+250 vs -250)
});

test("nearestGridLine: hit exactly halfway BEFORE the anchor (straddling gridIndex 0) still rounds to the LATER line", () => {
  // Math.round(-0.5) === -0 in JS, not -1: a hit exactly halfway between
  // grid line -1 (ANCHOR - step) and grid line 0 (ANCHOR itself) has
  // stepsFromAnchor = -0.5, so Math.round gives -0. This must resolve to
  // gridIndex 0 (the LATER of the two lines, per the documented tie-break),
  // not gridIndex -1. Note: gridIndex comes back as the float -0 here.
  // node:assert/strict's equal()/deepEqual() use Object.is under the hood,
  // and Object.is(-0, 0) is false — so a plain assert.equal(r.gridIndex, 0)
  // would fail here even though -0 is mathematically the same grid line as
  // 0. That's a harmless JS float quirk, not a real distinct grid line, so
  // we compare with plain `==` (which treats -0 and 0 as equal) instead of
  // assert.equal for this one field. What actually matters and IS pinned
  // down strictly here is gridTime/offsetMs: a naive implementation using
  // e.g. Math.floor(x + 0.5) instead of Math.round could accidentally land
  // one line off (gridIndex -1, gridTime = ANCHOR - step, offsetMs = +250)
  // around zero, and this test would catch that.
  const step = secondsPerGridStep(120, "quarter"); // 0.5s at 120bpm
  const halfwayBeforeAnchor = ANCHOR - step / 2; // exactly between grid line -1 and grid line 0
  const r = nearestGridLine(halfwayBeforeAnchor, ANCHOR, 120, "quarter");
  assert.ok(r.gridIndex == 0, `expected gridIndex ~0 (later line), got ${r.gridIndex}`); // the later line (ANCHOR), not -1
  assert.equal(r.gridTime, ANCHOR);
  assert.equal(r.offsetMs, -250); // early relative to line 0, by half the 500ms step
});

// -----------------------------------------------------------------------------
// nearestGridLine — rapid double hits (tricky case #2)
// -----------------------------------------------------------------------------

test("nearestGridLine: two rapid hits close together resolve to adjacent grid lines independently", () => {
  const step = secondsPerGridStep(180, "sixteenth"); // fast tempo, short grid
  const hitA = ANCHOR + 5 * step + sec(5);
  const hitB = ANCHOR + 5 * step + sec(15); // 10ms after hitA, same nominal grid line
  const rA = nearestGridLine(hitA, ANCHOR, 180, "sixteenth");
  const rB = nearestGridLine(hitB, ANCHOR, 180, "sixteenth");
  assert.equal(rA.gridIndex, 5);
  assert.equal(rB.gridIndex, 5);
  assert.equal(rA.offsetMs, 5);
  assert.equal(rB.offsetMs, 15);
});

test("nearestGridLine: rapid double hit straddling a grid line assigns each to its own nearest line", () => {
  const step = secondsPerGridStep(200, "sixteenth"); // 75ms step
  const hitA = ANCHOR + 4 * step - sec(5); // just before line 4
  const hitB = ANCHOR + 4 * step + sec(5); // just after line 4, 10ms after hitA
  const rA = nearestGridLine(hitA, ANCHOR, 200, "sixteenth");
  const rB = nearestGridLine(hitB, ANCHOR, 200, "sixteenth");
  assert.equal(rA.gridIndex, 4);
  assert.equal(rB.gridIndex, 4);
  assert.equal(rA.offsetMs, -5);
  assert.equal(rB.offsetMs, 5);
});

// -----------------------------------------------------------------------------
// msToBand — boundaries at exactly 30ms and 80ms (tricky case #3)
// -----------------------------------------------------------------------------

test("sanity: reused thresholds are 30ms / 80ms, not duplicated constants", () => {
  assert.equal(ON_TARGET_MS, 30);
  assert.equal(WINDOW_MS, 80);
});

test("msToBand: 0ms is green, on-target", () => {
  const b = msToBand(0);
  assert.equal(b.color, "green");
  assert.equal(b.classification, "on-target");
  assert.equal(b.direction, "on-time");
});

test("msToBand: exactly +30ms is green (inclusive boundary)", () => {
  const b = msToBand(30);
  assert.equal(b.color, "green");
  assert.equal(b.classification, "on-target");
  assert.equal(b.direction, "late");
});

test("msToBand: exactly -30ms is green (inclusive boundary)", () => {
  const b = msToBand(-30);
  assert.equal(b.color, "green");
  assert.equal(b.direction, "early");
});

test("msToBand: just past +30ms (30.5ms) is amber, direction late", () => {
  const b = msToBand(30.5);
  assert.equal(b.color, "amber");
  assert.equal(b.classification, "late");
  assert.equal(b.direction, "late");
});

test("msToBand: just past -30ms (-30.5ms) is amber, direction early", () => {
  const b = msToBand(-30.5);
  assert.equal(b.color, "amber");
  assert.equal(b.classification, "early");
  assert.equal(b.direction, "early");
});

test("msToBand: exactly +80ms is amber, not red (inclusive boundary)", () => {
  const b = msToBand(80);
  assert.equal(b.color, "amber");
  assert.equal(b.classification, "late");
});

test("msToBand: exactly -80ms is amber, not red (inclusive boundary)", () => {
  const b = msToBand(-80);
  assert.equal(b.color, "amber");
  assert.equal(b.classification, "early");
});

test("msToBand: just past +80ms (80.5ms) is red, a miss", () => {
  const b = msToBand(80.5);
  assert.equal(b.color, "red");
  assert.equal(b.classification, "miss");
  assert.equal(b.direction, "late");
});

test("msToBand: just past -80ms (-80.5ms) is red, a miss", () => {
  const b = msToBand(-80.5);
  assert.equal(b.color, "red");
  assert.equal(b.classification, "miss");
  assert.equal(b.direction, "early");
});

test("msToBand: colour never encodes direction — both +30 and -30 are the same green", () => {
  assert.equal(msToBand(30).color, msToBand(-30).color);
});

// -----------------------------------------------------------------------------
// Running stats
// -----------------------------------------------------------------------------

test("createRunningStats: starts empty", () => {
  const s = createRunningStats();
  assert.equal(s.count, 0);
  assert.equal(s.onTargetCount, 0);
  assert.equal(s.tightestMs, null);
  assert.equal(s.loosestMs, null);
});

test("summarizeStats: empty stats has null avg, 0% on-target, no divide-by-zero throw", () => {
  const s = createRunningStats();
  const summary = summarizeStats(s);
  assert.equal(summary.avgOffsetMs, null);
  assert.equal(summary.onTargetPct, 0);
  assert.equal(summary.count, 0);
});

test("addHitToStats: does not mutate the input stats object", () => {
  const s = createRunningStats();
  const frozen = JSON.stringify(s);
  addHitToStats(s, 10);
  assert.equal(JSON.stringify(s), frozen);
});

test("addHitToStats + summarizeStats: average signed offset — positive average signals dragging (late)", () => {
  let s = createRunningStats();
  s = addHitToStats(s, 20);
  s = addHitToStats(s, 40);
  const summary = summarizeStats(s);
  assert.equal(summary.avgOffsetMs, 30);
});

test("addHitToStats + summarizeStats: average signed offset — negative average signals rushing (early)", () => {
  let s = createRunningStats();
  s = addHitToStats(s, -10);
  s = addHitToStats(s, -30);
  const summary = summarizeStats(s);
  assert.equal(summary.avgOffsetMs, -20);
});

test("addHitToStats + summarizeStats: % on-target counts only green (|offset| <= 30ms) hits", () => {
  let s = createRunningStats();
  s = addHitToStats(s, 10); // on-target
  s = addHitToStats(s, 30); // on-target (boundary)
  s = addHitToStats(s, 31); // late, not on-target
  s = addHitToStats(s, 90); // miss, not on-target
  const summary = summarizeStats(s);
  assert.equal(summary.count, 4);
  assert.equal(summary.onTargetPct, 50);
});

test("addHitToStats + summarizeStats: tightest/loosest track smallest/largest absolute offset, signed", () => {
  let s = createRunningStats();
  s = addHitToStats(s, 40);
  s = addHitToStats(s, -5);
  s = addHitToStats(s, 70);
  s = addHitToStats(s, -60);
  const summary = summarizeStats(s);
  assert.equal(summary.tightestMs, -5);
  assert.equal(summary.loosestMs, 70);
});

test("addHitToStats: tightest/loosest correctly compare by absolute value, not raw signed value", () => {
  let s = createRunningStats();
  s = addHitToStats(s, -50); // abs 50, larger than a later +10
  s = addHitToStats(s, 10); // abs 10, should become new tightest
  const summary = summarizeStats(s);
  assert.equal(summary.tightestMs, 10);
  assert.equal(summary.loosestMs, -50);
});

test("addHitToStats: rapid double hits both fold into stats independently (no dedup)", () => {
  let s = createRunningStats();
  s = addHitToStats(s, 5);
  s = addHitToStats(s, 15); // 10ms later, still folds in as its own hit
  const summary = summarizeStats(s);
  assert.equal(summary.count, 2);
  assert.equal(summary.avgOffsetMs, 10);
});

test("addHitToStats: a single hit is both tightest and loosest", () => {
  let s = createRunningStats();
  s = addHitToStats(s, 42);
  const summary = summarizeStats(s);
  assert.equal(summary.tightestMs, 42);
  assert.equal(summary.loosestMs, 42);
});

test("resettable: a fresh createRunningStats() after hits is indistinguishable from a never-used one", () => {
  let s = createRunningStats();
  s = addHitToStats(s, 999); // not realistic (would classify as miss but stats don't reject it) — just checking reset works
  const reset = createRunningStats();
  assert.deepEqual(reset, createRunningStats());
  assert.notDeepEqual(s, reset);
});

// -----------------------------------------------------------------------------
// Purity check — no DOM/window/navigator API usage in the source text.
// -----------------------------------------------------------------------------

test("purity: testarea.js source has no DOM/window/navigator API usage (comments excluded)", async () => {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(new URL("./testarea.js", import.meta.url), "utf8");
  // Strip // line comments before scanning so explanatory prose that
  // mentions these globals (e.g. "matching AudioContext.currentTime's
  // convention") doesn't false-positive a purity check aimed at actual
  // code usage.
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
