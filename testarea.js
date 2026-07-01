"use strict";

// =============================================================================
// testarea.js
//
// Pure maths for the Test / free-play area (SPEC.md increment 2, section D).
// Zero DOM, zero Web MIDI, zero AudioContext references — data in, result
// out — so it can be unit-tested headless with `node --test` exactly like
// scoring.js / mapping.js.
//
// Responsibilities:
//   1. Nearest-grid-line selection: given a hit time and the metronome's
//      grid (anchor time + seconds-per-beat + subdivision), find the closest
//      grid line and the signed ms offset from it.
//   2. ms -> colour band: reuses scoring.js's ON_TARGET_MS/WINDOW_MS
//      thresholds (does NOT duplicate the 30/80 constants) to classify a
//      hit's closeness, then maps that to the three-colour palette
//      (green/amber/red) mandated by SPEC.md section C. Colour encodes
//      closeness only; direction (early/late) is a separate field the
//      caller uses for position, never for colour.
//   3. Running stats: average signed offset, % on-target, tightest/loosest
//      hit, all resettable.
//
// Time units: SECONDS on the audio-clock domain, matching scoring.js and
// PracticeEngine's convention (AudioContext.currentTime), so callers can
// feed the same reconciled hit times used for scoring.
//
// Offset sign convention (matches scoring.js): offset = hitTime - gridTime.
// Positive = hit came after the grid line (late/dragging). Negative = hit
// came before (early/rushing).
// =============================================================================

import { ON_TARGET_MS, WINDOW_MS, classifyOffset } from "./scoring.js";

// Round to a hundredth of a millisecond before any boundary-sensitive
// comparison. Same rationale as scoring.js's roundMs: seconds<->ms float
// conversions introduce ~1e-13 noise that can otherwise flip a value that
// should land exactly on a spec boundary (e.g. a hit exactly halfway
// between two grid lines) to the wrong side.
function roundMs(ms) {
  return Math.round(ms * 100) / 100;
}

// ---- Subdivision -> steps per beat ----
// v1 subdivisions per SPEC.md: quarter, eighth, sixteenth (no triplets yet).
export const SUBDIVISIONS = Object.freeze({
  quarter: 1,
  eighth: 2,
  sixteenth: 4,
});

// Seconds between adjacent grid lines for a given bpm + subdivision.
// subdivision may be a key of SUBDIVISIONS ("quarter"/"eighth"/"sixteenth")
// or a raw steps-per-beat number (2 = eighth, etc) for callers that already
// have the numeric form.
export function secondsPerGridStep(bpm, subdivision) {
  const stepsPerBeat = typeof subdivision === "number" ? subdivision : SUBDIVISIONS[subdivision];
  if (!Number.isFinite(stepsPerBeat) || stepsPerBeat <= 0) {
    throw new Error(`testarea: unknown subdivision ${JSON.stringify(subdivision)}`);
  }
  const secondsPerBeat = 60 / bpm;
  return secondsPerBeat / stepsPerBeat;
}

// ---- Nearest-grid-line selection ----
//
// hitTime:    seconds, audio-clock domain
// anchorTime: seconds, audio-clock domain — time of grid line index 0
//             (e.g. the moment the Test-area transport started, post count-in)
// bpm, subdivision: as above
//
// Returns { gridIndex, gridTime, offsetMs }:
//   gridIndex: integer index of the nearest grid line (can be 0 or negative
//              if hitTime is before anchorTime, though that shouldn't
//              happen in practice once the transport is running)
//   gridTime:  seconds, the nearest grid line's time
//   offsetMs:  signed ms offset, hitTime - gridTime, rounded per roundMs
//
// Tie-break for a hit exactly equidistant between two grid lines (exactly
// half a step early vs late): rounds to the LATER grid line. This matches
// JS's own Math.round() half-up convention (Math.round(0.5) === 1) and
// gives one deterministic, documented answer rather than an implementation
// accident.
export function nearestGridLine(hitTime, anchorTime, bpm, subdivision) {
  const step = secondsPerGridStep(bpm, subdivision);
  const stepsFromAnchor = (hitTime - anchorTime) / step;
  const gridIndex = Math.round(stepsFromAnchor);
  const gridTime = anchorTime + gridIndex * step;
  const offsetMs = roundMs((hitTime - gridTime) * 1000);
  return { gridIndex, gridTime, offsetMs };
}

// ---- ms -> colour band ----
//
// Reuses scoring.js's classifyOffset (on-target/early/late/miss, using the
// shared ON_TARGET_MS/WINDOW_MS thresholds) and maps it to the three-colour
// palette from SPEC.md section C:
//   on-target        -> green
//   early or late    -> amber  (30-80ms either direction = "close")
//   miss (>80ms)     -> red
// Colour only ever encodes CLOSENESS. Direction (early/late) is returned
// separately so the caller can use it for position (meter side / staff
// offset) without conflating it with colour, per the PO's explicit call
// that colour and position must stay decoupled.
export function msToBand(offsetMs) {
  const classification = classifyOffset(offsetMs);
  const direction = offsetMs < 0 ? "early" : offsetMs > 0 ? "late" : "on-time";
  const color = classification === "on-target" ? "green" : classification === "miss" ? "red" : "amber";
  return { classification, color, direction };
}

// Re-exported so callers/tests that only touch testarea.js can still see
// the shared thresholds without a second import.
export { ON_TARGET_MS, WINDOW_MS };

// ---- Running stats ----
//
// Simple resettable accumulator: average signed offset (rush vs drag
// tendency), % on-target, tightest/loosest hit (by absolute ms). No
// persistence — SPEC.md explicitly says "simple, no persistence needed this
// round".
//
// Shape: { count, onTargetCount, sumOffsetMs, tightestMs, loosestMs }
// tightestMs/loosestMs store the SIGNED offset of the smallest/largest
// |offset| seen (signed, so the caller can still show direction), or null
// if no hits yet.
export function createRunningStats() {
  return {
    count: 0,
    onTargetCount: 0,
    sumOffsetMs: 0,
    tightestMs: null,
    loosestMs: null,
  };
}

// Returns a NEW stats object with one more hit folded in (does not mutate
// the input, matching scoreAgainstConsumed's immutability convention).
export function addHitToStats(stats, offsetMs) {
  const ms = roundMs(offsetMs);
  const { classification } = msToBand(ms);
  const next = {
    count: stats.count + 1,
    onTargetCount: stats.onTargetCount + (classification === "on-target" ? 1 : 0),
    sumOffsetMs: stats.sumOffsetMs + ms,
    tightestMs: stats.tightestMs === null || Math.abs(ms) < Math.abs(stats.tightestMs) ? ms : stats.tightestMs,
    loosestMs: stats.loosestMs === null || Math.abs(ms) > Math.abs(stats.loosestMs) ? ms : stats.loosestMs,
  };
  return next;
}

// Derived summary view of a stats accumulator: avgOffsetMs (null if no
// hits), onTargetPct (0 if no hits, no divide-by-zero), tightestMs,
// loosestMs. Mirrors scoring.js's summarize() shape/conventions.
export function summarizeStats(stats) {
  return {
    count: stats.count,
    avgOffsetMs: stats.count > 0 ? stats.sumOffsetMs / stats.count : null,
    onTargetPct: stats.count > 0 ? (stats.onTargetCount / stats.count) * 100 : 0,
    tightestMs: stats.tightestMs,
    loosestMs: stats.loosestMs,
  };
}
