"use strict";

// =============================================================================
// scoring.js
//
// Pure scoring logic. Zero DOM, zero Web MIDI references. Given a list of
// expected hits (voice + expected time on the audio clock) and a list of
// actual hits (voice + actual time on the SAME audio clock, already
// reconciled from performance.now() by the caller), classify each expected
// hit as on-target / early / late / miss, classify unmatched actual hits as
// extra, and produce a summary.
//
// Time units: all timestamps are in SECONDS on the audio-clock domain
// (AudioContext.currentTime), matching the metronome's scheduler convention.
// The tolerance bands below are specified in ms by the spec; converted to
// seconds internally.
//
// Offset sign convention (documented per spec requirement):
//   offset = actualTime - expectedTime
//   offset > 0  => the hit came AFTER the expected time => LATE / dragging.
//   offset < 0  => the hit came BEFORE the expected time => EARLY / rushing.
// The summary's "average signed offset" follows the same convention: a
// positive average means the player tends to drag (late), a negative
// average means the player tends to rush (early).
//
// Boundary handling (inclusive per spec):
//   |offset| <= 30ms                       -> on-target
//   -80ms <= offset < -30ms                -> early
//    30ms <  offset <= 80ms                -> late
//   otherwise (no hit within 80ms)         -> miss
// So exactly 30ms is on-target, exactly 80ms is early/late (not miss).
//
// Double-hits: if two actual same-voice hits both fall within the 80ms
// window of one expected hit, the CLOSEST one (by absolute offset) is
// matched to the expected hit; the other is left unmatched and reported as
// an "extra" hit (ties broken by earliest actual time).
//
// Cross-window double-counting (see scoreAgainstConsumed below): callers
// that score a stream of hits in successive windows (e.g. one grid bar at a
// time, sliced by time) must not let a single physical hit be matched by
// two different windows. This can happen for real when the 8th-note
// interval is shorter than the 80ms judging window (BPM > 187.5, i.e. the
// upper half of the spec's 30-300 BPM range) and the last expected hit of
// one bar and the first expected hit of the next both claim the same
// nearby actual hit. scoreAgainstConsumed() guards against this by sharing
// one "already consumed" set across all calls for a given run.
// =============================================================================

export const ON_TARGET_MS = 30;
export const WINDOW_MS = 80;

// Round to a hundredth of a millisecond before comparing to a boundary.
// Real timing signals have no meaningful precision below this, and it
// eliminates float noise from the seconds<->ms conversions elsewhere in this
// module (e.g. 1970/1000 - 2000/1000 in JS is -30.00000000000003, not exactly
// -30) so exactly-30ms / exactly-80ms inputs land on their spec-defined side
// of the boundary instead of drifting across it due to float representation.
function roundMs(ms) {
  return Math.round(ms * 100) / 100;
}

// ---- Classification of a single offset (ms) ----
// Returns "on-target" | "early" | "late" | "miss".
export function classifyOffset(rawOffsetMs) {
  const offsetMs = roundMs(rawOffsetMs);
  if (Math.abs(offsetMs) <= ON_TARGET_MS) return "on-target";
  if (offsetMs < 0 && offsetMs >= -WINDOW_MS) return "early";
  if (offsetMs > 0 && offsetMs <= WINDOW_MS) return "late";
  return "miss";
}

// ---- Core matching/scoring ----
//
// expectedHits: [{ voice, time }]  time in seconds (audio clock)
// actualHits:   [{ voice, time }]  time in seconds (audio clock, reconciled)
//               voice may be null for unmapped notes – unmapped hits can
//               never match an expected hit and are always reported as
//               "extra" with unmapped: true.
//
// Returns:
//   {
//     results: [
//       { expected: {voice, time}, actual: {voice, time} | null,
//         offsetMs: number | null, classification: "on-target"|"early"|"late"|"miss" }
//       ...one entry per expected hit, same order as input...
//     ],
//     extras: [
//       { voice, time, unmapped }
//       ...actual hits that did not match any expected hit...
//     ]
//   }
export function scoreHits(expectedHits, actualHits) {
  const expected = expectedHits.map((e, i) => ({ ...e, _idx: i }));
  const actual = actualHits.map((a, i) => ({ ...a, _idx: i, _used: false }));

  const results = new Array(expected.length);

  for (const exp of expected) {
    // Candidates: same voice, unused, within the 80ms window.
    let best = null;
    let bestAbsMs = Infinity;
    for (const act of actual) {
      if (act._used) continue;
      if (act.voice === null || act.voice === undefined) continue; // unmapped never matches
      if (act.voice !== exp.voice) continue;
      const offsetMs = roundMs((act.time - exp.time) * 1000);
      if (Math.abs(offsetMs) > WINDOW_MS) continue;
      const absMs = Math.abs(offsetMs);
      // Closest wins; tie broken by earliest actual time.
      if (
        absMs < bestAbsMs ||
        (absMs === bestAbsMs && (best === null || act.time < best.time))
      ) {
        best = act;
        bestAbsMs = absMs;
      }
    }

    if (best) {
      best._used = true;
      const offsetMs = roundMs((best.time - exp.time) * 1000);
      results[exp._idx] = {
        expected: { voice: exp.voice, time: exp.time },
        actual: { voice: best.voice, time: best.time },
        offsetMs,
        classification: classifyOffset(offsetMs),
      };
    } else {
      results[exp._idx] = {
        expected: { voice: exp.voice, time: exp.time },
        actual: null,
        offsetMs: null,
        classification: "miss",
      };
    }
  }

  const extras = actual
    .filter((a) => !a._used)
    .map((a) => ({
      voice: a.voice ?? null,
      time: a.time,
      unmapped: a.voice === null || a.voice === undefined,
    }));

  return { results, extras };
}

// ---- Cross-window scoring without double-counting a physical hit ----
//
// scoreHits() alone is safe for a single, self-contained call: each call
// gets its own fresh "used" bookkeeping. That becomes UNSAFE when a caller
// scores a long stream of hits in successive, overlapping time windows
// (e.g. one groove bar at a time) — a single physical hit that falls in the
// overlap between two windows can be matched by both calls, double-counting
// it in the running tally.
//
// scoreAgainstConsumed() fixes this by taking the FULL list of actual hits
// captured so far (stable indices – always the same array/order across
// calls for one run) plus a Set of indices already consumed by earlier
// calls. It only offers up not-yet-consumed hits as match candidates, and
// returns the indices it consumed this call so the caller can merge them
// into its running "consumed" Set before the next call.
//
// allActualHits: [{ voice, time }]  the FULL, stable-order list of actual
//                hits captured so far for this run (not just this window's
//                slice)
// consumedIndices: Set<number>      indices into allActualHits already
//                matched by a PREVIOUS call (pass a fresh Set() for the
//                first call of a run, then reuse the merged Set returned
//                below for subsequent calls)
// windowFilter: optional fn(hit, index) => boolean, restricting which
//                indices are even considered as candidates this call (e.g.
//                "within 80ms of this bar's expected hits"); hits outside
//                the filter are left untouched for a later call to claim.
//
// Returns { results, extras, consumedIndices } where consumedIndices is a
// NEW Set = the union of the input consumedIndices and everything matched
// this call (does not mutate the input Set).
export function scoreAgainstConsumed(expectedHits, allActualHits, consumedIndices, windowFilter) {
  const candidateIndices = [];
  const candidates = [];
  allActualHits.forEach((hit, idx) => {
    if (consumedIndices.has(idx)) return;
    if (typeof windowFilter === "function" && !windowFilter(hit, idx)) return;
    candidateIndices.push(idx);
    candidates.push(hit);
  });

  const { results, extras } = scoreHits(expectedHits, candidates);

  // Recover which candidate(s) were consumed by diffing matched actual
  // times/voices against the candidate list (scoreHits doesn't expose
  // indices directly, so we match by reference-equivalent identity: the
  // candidate object itself, since `actual` in scoreHits is only ever
  // shallow-copied from `candidates` in the same order).
  const newlyConsumed = new Set();
  for (const r of results) {
    if (!r.actual) continue;
    const pos = candidates.findIndex(
      (c, i) => !newlyConsumed.has(candidateIndices[i]) && c.voice === r.actual.voice && c.time === r.actual.time
    );
    if (pos !== -1) newlyConsumed.add(candidateIndices[pos]);
  }

  const nextConsumed = new Set(consumedIndices);
  for (const idx of newlyConsumed) nextConsumed.add(idx);

  return { results, extras, consumedIndices: nextConsumed };
}

// ---- Summary ----
//
// Given the `results` array from scoreHits(), produce counts, accuracy %,
// and average signed offset (ms) across matched (non-miss) hits.
// accuracy % is defined as on-target / expected (per spec), i.e. the
// denominator is the total number of expected hits, not just matched ones.
export function summarize(results, extras = []) {
  const counts = { "on-target": 0, early: 0, late: 0, miss: 0, extra: extras.length };
  let offsetSum = 0;
  let offsetCount = 0;

  for (const r of results) {
    counts[r.classification]++;
    if (r.classification !== "miss" && r.offsetMs !== null) {
      offsetSum += r.offsetMs;
      offsetCount++;
    }
  }

  const expectedTotal = results.length;
  const accuracyPct = expectedTotal > 0 ? (counts["on-target"] / expectedTotal) * 100 : 0;
  const avgOffsetMs = offsetCount > 0 ? offsetSum / offsetCount : null;

  return {
    counts,
    expectedTotal,
    accuracyPct,
    avgOffsetMs, // positive = late/dragging, negative = early/rushing, null if no matched hits
  };
}
