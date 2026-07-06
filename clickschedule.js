"use strict";

// =============================================================================
// clickschedule.js
//
// Pure step/bar arithmetic for PracticeEngine's click scheduler (index.html).
// Extracted so "which bar does step N belong to, and should scheduling stop
// here" is unit-testable headless with `node --test`, exactly like
// editorhit.js/testarea.js pull their own pure maths out of index.html's
// inline VexFlow/scheduling glue. Zero DOM, zero Web MIDI, zero AudioContext.
//
// SPEC.md increment 6 code-review fix: the ORIGINAL auto-stop for drill xN /
// sequence mode used a separate wall-clock setTimeout racing PracticeEngine's
// own lookahead scheduler. Since the ticker schedules audio up to `lookahead`
// (100ms) ahead of real time on a `tickInterval` (25ms) poll, the timer
// always lost that race and one extra click played past the arrangement's
// last bar. The fix: PracticeEngine's own tick loop now calls the SAME
// functions this module exports to decide, in the one place that actually
// commits a click (calls onStep -> playClick), whether a step is beyond the
// arrangement — never on a parallel clock that could race it.
// =============================================================================

// Given the monotonic step counter PracticeEngine tracks (count-in steps
// first, then the looping groove bar's steps) and how many steps make up one
// bar, return which bar this step belongs to.
//   isCountIn: true for the first `stepsPerBar` steps (the 1-bar count-in).
//   barStep: 0-based step WITHIN whichever bar (count-in or groove).
//   barIndex: 0 for the count-in bar, 1 for the first real bar, 2 for the
//     second, etc — matches PracticeEngine's existing barIndex convention.
export function stepBarInfo(nextStep, stepsPerBar) {
  const isCountIn = nextStep < stepsPerBar;
  const barStep = isCountIn ? nextStep % stepsPerBar : (nextStep - stepsPerBar) % stepsPerBar;
  const barIndex = isCountIn ? 0 : Math.floor((nextStep - stepsPerBar) / stepsPerBar) + 1;
  return { isCountIn, barStep, barIndex };
}

// Should the scheduler refuse to schedule this step? True only once a REAL
// (non-count-in) bar's index exceeds maxBars — the count-in bar (barIndex 0)
// always plays regardless of maxBars, and maxBars = Infinity (the
// no-sections "loop groove" case, or drill's "loop forever") never stops
// anything, matching SPEC.md AC8's zero-regression requirement.
export function isBeyondArrangement({ isCountIn, barIndex }, maxBars) {
  return !isCountIn && barIndex > maxBars;
}

// Pure simulation of PracticeEngine's own scheduling decision — no
// AudioContext/timer involved: given a bar-count ceiling (maxBars) and the
// groove's steps-per-bar, returns every { step, isCountIn, barStep, barIndex }
// entry the real scheduler would ever call onStep() for (the count-in bar,
// then exactly `maxBars` real bars, then nothing more). This is what
// test-clickschedule.mjs asserts against directly — "given arrangement
// length N, the scheduler yields exactly N bars of clicks" (SPEC.md
// increment 6 code review).
export function simulateSchedule(maxBars, stepsPerBar) {
  const entries = [];
  let nextStep = 0;
  // Defensive cap so a caller passing a huge/Infinite maxBars in a test
  // can't spin forever — real "loop forever" runs never call this (see
  // PracticeEngine's own #tick(), which only checks isBeyondArrangement
  // against whatever finite maxBars it was given; Infinity always compares
  // false there and needs no simulation).
  const HARD_CAP_STEPS = 100_000;
  while (entries.length < HARD_CAP_STEPS) {
    const info = stepBarInfo(nextStep, stepsPerBar);
    if (isBeyondArrangement(info, maxBars)) break;
    entries.push({ step: nextStep, ...info });
    nextStep++;
  }
  return entries;
}
