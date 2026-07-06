"use strict";

// =============================================================================
// test-clickschedule.mjs
//
// Node ESM tests for clickschedule.js — the pure step/bar arithmetic behind
// PracticeEngine's click scheduler (SPEC.md increment 6 code-review fix).
// Covers the auto-stop boundary directly: "given arrangement length N, the
// scheduler yields exactly N bars of clicks, never N+1" — the bug the
// original wall-clock-timer approach had (one extra click past the last
// arrangement bar for every finite drill/sequence run).
//
// Pure module, zero DOM/AudioContext — run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import { stepBarInfo, isBeyondArrangement, simulateSchedule } from "./clickschedule.js";

const STEPS_PER_BAR = 8; // matches index.html's own constant (8th-note grid, 4/4)

// -----------------------------------------------------------------------------
// stepBarInfo
// -----------------------------------------------------------------------------

test("stepBarInfo: the first stepsPerBar steps are the count-in bar (barIndex 0)", () => {
  for (let step = 0; step < STEPS_PER_BAR; step++) {
    const info = stepBarInfo(step, STEPS_PER_BAR);
    assert.equal(info.isCountIn, true);
    assert.equal(info.barIndex, 0);
    assert.equal(info.barStep, step);
  }
});

test("stepBarInfo: step stepsPerBar is the first real bar (barIndex 1), barStep 0", () => {
  const info = stepBarInfo(STEPS_PER_BAR, STEPS_PER_BAR);
  assert.equal(info.isCountIn, false);
  assert.equal(info.barIndex, 1);
  assert.equal(info.barStep, 0);
});

test("stepBarInfo: barIndex advances by one every stepsPerBar steps thereafter", () => {
  // Step 8 = bar 1 step 0; step 16 = bar 2 step 0; step 23 = bar 2 step 7.
  assert.deepEqual(stepBarInfo(16, STEPS_PER_BAR), { isCountIn: false, barStep: 0, barIndex: 2 });
  assert.deepEqual(stepBarInfo(23, STEPS_PER_BAR), { isCountIn: false, barStep: 7, barIndex: 2 });
  assert.deepEqual(stepBarInfo(24, STEPS_PER_BAR), { isCountIn: false, barStep: 0, barIndex: 3 });
});

// -----------------------------------------------------------------------------
// isBeyondArrangement
// -----------------------------------------------------------------------------

test("isBeyondArrangement: the count-in bar is never beyond the arrangement, regardless of maxBars", () => {
  assert.equal(isBeyondArrangement({ isCountIn: true, barIndex: 0 }, 1), false);
  assert.equal(isBeyondArrangement({ isCountIn: true, barIndex: 0 }, 0), false);
});

test("isBeyondArrangement: a real bar within maxBars is not beyond it; exceeding it is", () => {
  assert.equal(isBeyondArrangement({ isCountIn: false, barIndex: 3 }, 3), false, "bar 3 of 3 is in range");
  assert.equal(isBeyondArrangement({ isCountIn: false, barIndex: 4 }, 3), true, "bar 4 exceeds a 3-bar arrangement");
});

test("isBeyondArrangement: maxBars = Infinity (loop-forever / no-sections case) never stops anything", () => {
  assert.equal(isBeyondArrangement({ isCountIn: false, barIndex: 1 }, Infinity), false);
  assert.equal(isBeyondArrangement({ isCountIn: false, barIndex: 1_000_000 }, Infinity), false);
});

// -----------------------------------------------------------------------------
// simulateSchedule — the actual regression guard for the code-review bug:
// "given arrangement length N, the scheduler yields exactly N bars of
// clicks" — not N+1 (the original bug: one extra click past the boundary).
// -----------------------------------------------------------------------------

test("simulateSchedule: maxBars=1 yields the count-in bar + exactly 1 real bar, nothing more", () => {
  const entries = simulateSchedule(1, STEPS_PER_BAR);
  // 1 count-in bar (8 steps) + 1 real bar (8 steps) = 16 steps total.
  assert.equal(entries.length, STEPS_PER_BAR * 2);
  const realBars = new Set(entries.filter((e) => !e.isCountIn).map((e) => e.barIndex));
  assert.deepEqual([...realBars], [1], "exactly bar 1, never bar 2");
});

test("simulateSchedule: maxBars=N yields exactly N real bars (regression guard for the 'one extra click' bug)", () => {
  for (const maxBars of [1, 2, 3, 4, 8]) {
    const entries = simulateSchedule(maxBars, STEPS_PER_BAR);
    const realBars = new Set(entries.filter((e) => !e.isCountIn).map((e) => e.barIndex));
    assert.equal(realBars.size, maxBars, `maxBars=${maxBars} should yield exactly ${maxBars} distinct real bars`);
    assert.equal(Math.max(...realBars), maxBars, `the LAST bar scheduled must be bar ${maxBars}, not ${maxBars + 1}`);
    // Every real bar has exactly stepsPerBar steps — no partial/doubled bar.
    for (const barIndex of realBars) {
      const stepsInBar = entries.filter((e) => e.barIndex === barIndex && !e.isCountIn).length;
      assert.equal(stepsInBar, STEPS_PER_BAR);
    }
  }
});

test("simulateSchedule: the very next step after the last one returned would be beyond the arrangement", () => {
  const maxBars = 2;
  const entries = simulateSchedule(maxBars, STEPS_PER_BAR);
  const lastEntry = entries[entries.length - 1];
  const nextInfo = stepBarInfo(lastEntry.step + 1, STEPS_PER_BAR);
  assert.equal(
    isBeyondArrangement(nextInfo, maxBars),
    true,
    "the step immediately after the simulated schedule must be rejected — this is the exact boundary the wall-clock-timer bug crossed"
  );
});

test("simulateSchedule: works for different stepsPerBar (e.g. a 16-step subdivision)", () => {
  const entries = simulateSchedule(2, 16);
  const realBars = new Set(entries.filter((e) => !e.isCountIn).map((e) => e.barIndex));
  assert.deepEqual([...realBars], [1, 2]);
  assert.equal(entries.length, 16 * 3); // count-in + 2 real bars, 16 steps each
});
