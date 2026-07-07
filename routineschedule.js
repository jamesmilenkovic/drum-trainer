"use strict";

// =============================================================================
// routineschedule.js
//
// Pure click-timing maths for routine playback (SPEC.md increment 7, section
// B/C): "tempo switching cleanly at item boundaries (no gap/stutter/dropped
// click)" — the risky Web Audio seam SPEC.md's "notes for the coder" flags,
// same care as the increment-6 loop-seam fix (clickschedule.js). Zero DOM,
// zero AudioContext — data in, result out — so the timing arithmetic itself
// is unit-testable headless with `node --test`, independently of the real
// scheduler (index.html's RoutineEngine) that walks this plan against a real
// AudioContext clock.
//
// Design: a routine's expanded timeline (routine.js's expandRoutine()) is a
// flat list of BARS, each carrying its own item's bpm and its groove's own
// steps-per-bar/time-signature. buildClickPlan() turns that into a flat list
// of individual CLICK events, each with a `relTime` (seconds since the plan's
// own start, i.e. since the first click) — a single monotonically increasing
// anchor, exactly like clickschedule.js/PracticeEngine's own drift-free
// "anchor + elapsed" pattern, except the "rate" (secondsPerStep) can change
// at a BAR boundary instead of staying constant for the whole run.
//
// Continuity guarantee: bar N's own last click still plays at bar N's own
// (old) tempo; bar N+1's first click is scheduled exactly bar N's OWN
// secondsPerStep after bar N's last click (i.e. bar N "finishes its own
// measure" at its own speed), and every click INSIDE bar N+1 then uses bar
// N+1's (new) tempo. This is a single clean handover with no pause and no
// double-spaced/overlapping click — see the tests below for the exact
// arithmetic this guarantees.
// =============================================================================

// barSpecs: an array of { stepsPerBar, secondsPerStep, meta }, one entry per
// BAR to play, in order (the caller builds this from a routine's expanded
// timeline: each bar's meta is that timeline entry, stepsPerBar/secondsPerStep
// derived from that bar's own groove/time-signature/subdivision and the
// item's own bpm — see secondsPerStepForBpm()).
//
// Returns a flat array of click events, one per grid step across every bar:
//   { relTime, barIndex, step, isAccent, meta }
// relTime: seconds from the very first click of the plan (bar 0 step 0 is
//   always relTime 0). barIndex: index into barSpecs. step: 0-based step
//   within that bar. isAccent: true for step 0 of each bar (the existing
//   accent-on-beat-1 convention, matching PracticeEngine's playClick usage).
//   meta: whatever the caller attached to that bar's spec, passed through
//   unchanged (routine.js's expandRoutine() entry, typically).
export function buildClickPlan(barSpecs) {
  const events = [];
  let barStart = 0;
  for (let barIndex = 0; barIndex < barSpecs.length; barIndex++) {
    const { stepsPerBar, secondsPerStep, meta } = barSpecs[barIndex];
    for (let step = 0; step < stepsPerBar; step++) {
      events.push({
        relTime: barStart + step * secondsPerStep,
        barIndex,
        step,
        isAccent: step === 0,
        meta,
      });
    }
    barStart += stepsPerBar * secondsPerStep;
  }
  return events;
}

// Seconds per ONE grid step at a given bpm/subdivision. stepsPerBeat: 1 for
// quarter notes, 2 for eighth notes, 4 for sixteenth notes (testarea.js's
// SUBDIVISIONS convention) — the caller passes the groove's own subdivision
// value through, so a routine item can carry any of the app's supported
// subdivisions, not just the fixed eighth-note grid PracticeEngine's click
// uses for the plain Groove-editor transport.
export function secondsPerStepForBpm(bpm, stepsPerBeat) {
  return 60 / bpm / stepsPerBeat;
}

// Total duration (seconds) of a click plan — the moment after the LAST
// click's own step has elapsed, i.e. when the run is truly "done" (matches
// clickschedule.js's onArrangementDone timing convention: the last click's
// own scheduled time, not one step further).
export function planDuration(barSpecs) {
  let total = 0;
  for (const { stepsPerBar, secondsPerStep } of barSpecs) {
    total += stepsPerBar * secondsPerStep;
  }
  return total;
}
