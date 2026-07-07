"use strict";

// =============================================================================
// test-routineschedule.mjs
//
// Node ESM tests for routineschedule.js — the pure click-timing maths behind
// routine playback's tempo-boundary handover (SPEC.md increment 7, AC3: "no
// gap/stutter/dropped click" when a routine switches tempo between items).
//
// Pure module, zero DOM/AudioContext — run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClickPlan, secondsPerStepForBpm, planDuration } from "./routineschedule.js";

const EPS = 1e-9;

test("secondsPerStepForBpm: quarter notes at 120bpm is exactly 0.5s per step", () => {
  assert.equal(secondsPerStepForBpm(120, 1), 0.5);
});

test("secondsPerStepForBpm: eighth notes at 120bpm is half a quarter note (0.25s)", () => {
  assert.equal(secondsPerStepForBpm(120, 2), 0.25);
});

test("buildClickPlan: a single constant-tempo bar produces evenly spaced clicks starting at relTime 0", () => {
  const secondsPerStep = secondsPerStepForBpm(120, 2); // 0.25s
  const plan = buildClickPlan([{ stepsPerBar: 8, secondsPerStep, meta: { bar: 0 } }]);
  assert.equal(plan.length, 8);
  assert.equal(plan[0].relTime, 0);
  for (let i = 0; i < 8; i++) {
    assert.ok(Math.abs(plan[i].relTime - i * secondsPerStep) < EPS, `step ${i} relTime`);
    assert.equal(plan[i].step, i);
    assert.equal(plan[i].barIndex, 0);
    assert.equal(plan[i].isAccent, i === 0);
  }
});

test("buildClickPlan: two bars at the SAME tempo are perfectly evenly spaced across the bar boundary too (no regression for the constant-tempo case)", () => {
  const secondsPerStep = secondsPerStepForBpm(100, 2);
  const plan = buildClickPlan([
    { stepsPerBar: 4, secondsPerStep, meta: null },
    { stepsPerBar: 4, secondsPerStep, meta: null },
  ]);
  assert.equal(plan.length, 8);
  for (let i = 1; i < plan.length; i++) {
    const delta = plan[i].relTime - plan[i - 1].relTime;
    assert.ok(Math.abs(delta - secondsPerStep) < EPS, `gap between click ${i - 1} and ${i} should equal one step`);
  }
});

test("buildClickPlan: a tempo change at a bar boundary — every click WITHIN a bar is evenly spaced at that bar's own tempo", () => {
  const slow = secondsPerStepForBpm(60, 2); // item A: slow
  const fast = secondsPerStepForBpm(180, 2); // item B: fast
  const plan = buildClickPlan([
    { stepsPerBar: 4, secondsPerStep: slow, meta: { item: "A" } },
    { stepsPerBar: 4, secondsPerStep: fast, meta: { item: "B" } },
  ]);
  const barA = plan.filter((e) => e.barIndex === 0);
  const barB = plan.filter((e) => e.barIndex === 1);
  for (let i = 1; i < barA.length; i++) {
    assert.ok(Math.abs(barA[i].relTime - barA[i - 1].relTime - slow) < EPS, "bar A internal spacing uses bar A's own tempo");
  }
  for (let i = 1; i < barB.length; i++) {
    assert.ok(Math.abs(barB[i].relTime - barB[i - 1].relTime - fast) < EPS, "bar B internal spacing uses bar B's own (new) tempo");
  }
});

test("buildClickPlan: the handover at a tempo-change boundary is exactly ONE of the ENDING bar's own step durations — no gap, no double-length gap, no overlap", () => {
  const slow = secondsPerStepForBpm(60, 2);
  const fast = secondsPerStepForBpm(180, 2);
  const plan = buildClickPlan([
    { stepsPerBar: 4, secondsPerStep: slow, meta: { item: "A" } },
    { stepsPerBar: 4, secondsPerStep: fast, meta: { item: "B" } },
  ]);
  const lastOfA = plan.filter((e) => e.barIndex === 0).at(-1);
  const firstOfB = plan.find((e) => e.barIndex === 1);
  const gap = firstOfB.relTime - lastOfA.relTime;
  // The gap between the two bars is exactly ONE step at the OLD (item A)
  // tempo — bar A finishes its own measure at its own speed, then bar B
  // begins immediately at the new speed. Not slow+fast averaged, not zero
  // (which would double up two clicks at once), not some other value.
  assert.ok(Math.abs(gap - slow) < EPS, `expected the boundary gap to equal item A's own step (${slow}), got ${gap}`);
  assert.notEqual(gap, 0, "must not be a simultaneous/overlapping click");
});

test("buildClickPlan: three items (tempo changes at TWO boundaries) stay gapless/continuous at each one", () => {
  const bpms = [60, 120, 90];
  const specs = bpms.map((bpm, i) => ({ stepsPerBar: 4, secondsPerStep: secondsPerStepForBpm(bpm, 2), meta: { item: i } }));
  const plan = buildClickPlan(specs);
  // Every consecutive pair of clicks within the SAME bar must match that
  // bar's own secondsPerStep; every bar-boundary gap must match the ENDING
  // bar's own secondsPerStep (same rule as the two-item case above, applied
  // at both boundaries here).
  for (let i = 1; i < plan.length; i++) {
    const prev = plan[i - 1];
    const cur = plan[i];
    const expected = secondsPerStepForBpm(bpms[prev.barIndex], 2);
    const gap = cur.relTime - prev.relTime;
    assert.ok(Math.abs(gap - expected) < EPS, `click ${i}: expected gap ${expected}, got ${gap}`);
  }
});

test("buildClickPlan: a bar with a different stepsPerBar (e.g. 3/4 vs 4/4) is handled without breaking the boundary handover", () => {
  const secondsPerStep = secondsPerStepForBpm(100, 2);
  const plan = buildClickPlan([
    { stepsPerBar: 6, secondsPerStep, meta: { item: "3/4-eighths" } }, // 3/4 time at eighth-note subdivision = 6 steps/bar
    { stepsPerBar: 8, secondsPerStep, meta: { item: "4/4-eighths" } },
  ]);
  assert.equal(plan.filter((e) => e.barIndex === 0).length, 6);
  assert.equal(plan.filter((e) => e.barIndex === 1).length, 8);
  const lastOfBar0 = plan.filter((e) => e.barIndex === 0).at(-1);
  const firstOfBar1 = plan.find((e) => e.barIndex === 1);
  assert.ok(Math.abs(firstOfBar1.relTime - lastOfBar0.relTime - secondsPerStep) < EPS);
});

test("buildClickPlan: meta is passed through unchanged per bar, and isAccent is true only for step 0 of each bar", () => {
  const plan = buildClickPlan([
    { stepsPerBar: 3, secondsPerStep: 0.1, meta: { itemIndex: 2, grooveName: "Fill" } },
  ]);
  assert.deepEqual(plan.map((e) => e.meta), [
    { itemIndex: 2, grooveName: "Fill" },
    { itemIndex: 2, grooveName: "Fill" },
    { itemIndex: 2, grooveName: "Fill" },
  ]);
  assert.deepEqual(plan.map((e) => e.isAccent), [true, false, false]);
});

test("buildClickPlan: an empty barSpecs list produces an empty plan", () => {
  assert.deepEqual(buildClickPlan([]), []);
});

// -----------------------------------------------------------------------------
// planDuration
// -----------------------------------------------------------------------------

test("planDuration: sums stepsPerBar * secondsPerStep across every bar", () => {
  const specs = [
    { stepsPerBar: 4, secondsPerStep: 0.5 },
    { stepsPerBar: 8, secondsPerStep: 0.25 },
  ];
  assert.ok(Math.abs(planDuration(specs) - (4 * 0.5 + 8 * 0.25)) < EPS);
});

test("planDuration: matches the last click's relTime plus one more of its own bar's step (the moment the plan is truly done)", () => {
  const secondsPerStep = secondsPerStepForBpm(100, 2);
  const specs = [{ stepsPerBar: 8, secondsPerStep, meta: null }];
  const plan = buildClickPlan(specs);
  const lastClick = plan.at(-1);
  assert.ok(Math.abs(planDuration(specs) - (lastClick.relTime + secondsPerStep)) < EPS);
});
