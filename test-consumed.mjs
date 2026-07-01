"use strict";

// =============================================================================
// test-consumed.mjs
//
// Node ESM test for scoring.js's scoreAgainstConsumed() (pure module, zero
// DOM/Web MIDI). This guards the cross-bar double-counting fix: above
// ~187.5 BPM the 8th-note interval is shorter than the +/-80ms judging
// window, so a single physical hit near a bar boundary could previously be
// matched into BOTH the trailing edge of bar N and the leading edge of bar
// N+1 by scoreHits() called independently per bar. scoreAgainstConsumed()
// threads a shared "consumed" Set of indices into the FULL, stable actual-hit
// array across successive per-bar calls so a hit can only ever be consumed
// once for the whole run.
//
// Time convention matches scoring.js: all hit times are in SECONDS on the
// audio-clock domain. Helper `sec(ms)` converts a millisecond offset to
// seconds for readability.
//
// Run: node --test test-consumed.mjs
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scoreHits, scoreAgainstConsumed } from "./scoring.js";

const sec = (ms) => ms / 1000;

// -----------------------------------------------------------------------------
// The headline regression: BPM 200 cross-bar case with real numbers.
//
// At 200 BPM, an 8th note = 60/200/2 = 0.15s = 150ms, well under the 80ms*2
// window span that made overlapping per-bar scoring unsafe. We reproduce the
// exact scenario from the bug report:
//   - bar N expects a hihatClosed at time T
//   - bar N+1 expects a hihatClosed at T + 150ms (the very next 8th note)
//   - ONE physical hit lands at T + 70ms: within 80ms of bar N's expectation
//     (late by 70ms) AND within 80ms of bar N+1's expectation (early by 80ms,
//     since (T+150) - (T+70) = 80ms... use a value that's unambiguously
//     within both windows without landing exactly on a boundary for bar N+1,
//     to keep the test about consumption, not classification boundaries).
// -----------------------------------------------------------------------------

test("scoreAgainstConsumed: BPM-200 cross-bar hit is matched to bar N only, bar N+1 gets a miss, hit counted exactly once", () => {
  const T = 10; // arbitrary anchor, seconds
  const barNExpected = [{ voice: "hihatClosed", time: T }];
  const barN1Expected = [{ voice: "hihatClosed", time: T + sec(150) }];

  // The single physical hit: T + 70ms.
  //   vs bar N's expectation (T):      offset = +70ms -> within 80ms window (late)
  //   vs bar N+1's expectation (T+150ms): offset = 70 - 150 = -80ms -> ALSO within 80ms window (early boundary)
  const allActualHits = [{ voice: "hihatClosed", time: T + sec(70) }];

  let consumed = new Set();

  // Score bar N first.
  const barNResult = scoreAgainstConsumed(barNExpected, allActualHits, consumed);
  consumed = barNResult.consumedIndices;

  assert.equal(barNResult.results.length, 1);
  assert.equal(barNResult.results[0].classification, "late");
  assert.equal(barNResult.results[0].offsetMs, 70);
  assert.notEqual(barNResult.results[0].actual, null, "bar N should have matched the physical hit");
  assert.equal(consumed.size, 1, "the physical hit must be marked consumed after bar N");
  assert.ok(consumed.has(0), "index 0 (the only actual hit) must be in the consumed set");

  // Score bar N+1 next, threading the consumed set forward.
  const barN1Result = scoreAgainstConsumed(barN1Expected, allActualHits, consumed);
  consumed = barN1Result.consumedIndices;

  assert.equal(barN1Result.results.length, 1);
  assert.equal(
    barN1Result.results[0].classification,
    "miss",
    "bar N+1 must NOT re-match the hit already consumed by bar N -- it should see no candidates and report a miss"
  );
  assert.equal(barN1Result.results[0].actual, null);
  assert.equal(barN1Result.results[0].offsetMs, null);

  // The physical hit must never surface as an "extra" in either call either --
  // it was legitimately matched by bar N, not merely withheld.
  assert.deepEqual(barNResult.extras, []);
  assert.deepEqual(barN1Result.extras, []);

  // Final invariant: across both calls, exactly one match total occurred for
  // the single physical hit -- never zero, never two.
  const totalMatches =
    (barNResult.results[0].actual ? 1 : 0) + (barN1Result.results[0].actual ? 1 : 0);
  assert.equal(totalMatches, 1, "the single physical hit must be counted in EXACTLY one bar, never both, never neither");
});

// -----------------------------------------------------------------------------
// A normal on-time hit consumed by bar N must not be re-offered to bar N+1.
// -----------------------------------------------------------------------------

test("scoreAgainstConsumed: an on-time hit fully consumed by bar N is not re-matched by bar N+1's unrelated expectation", () => {
  const T = 20;
  const barNExpected = [{ voice: "kick", time: T }];
  const barN1Expected = [{ voice: "kick", time: T + sec(500) }]; // far away, no overlap possible
  const allActualHits = [{ voice: "kick", time: T }]; // exact on-time hit

  let consumed = new Set();
  const barNResult = scoreAgainstConsumed(barNExpected, allActualHits, consumed);
  consumed = barNResult.consumedIndices;
  assert.equal(barNResult.results[0].classification, "on-target");
  assert.ok(consumed.has(0));

  const barN1Result = scoreAgainstConsumed(barN1Expected, allActualHits, consumed);
  assert.equal(barN1Result.results[0].classification, "miss", "already-consumed hit must not be offered again");
  assert.equal(barN1Result.results[0].actual, null);
});

// -----------------------------------------------------------------------------
// Threading across >= 3 successive calls: consumed set is additive/correct.
// -----------------------------------------------------------------------------

test("scoreAgainstConsumed: consumed set accumulates correctly across three successive calls", () => {
  const allActualHits = [
    { voice: "kick", time: 0 },
    { voice: "snare", time: 1 },
    { voice: "hihatClosed", time: 2 },
  ];

  let consumed = new Set();

  // Call 1: matches index 0.
  const r1 = scoreAgainstConsumed([{ voice: "kick", time: 0 }], allActualHits, consumed);
  consumed = r1.consumedIndices;
  assert.deepEqual([...consumed].sort(), [0]);
  assert.equal(r1.results[0].classification, "on-target");

  // Call 2: matches index 1. Index 0 must remain consumed and not be a candidate,
  // though it's irrelevant here since voices differ -- the point is the Set grows.
  const r2 = scoreAgainstConsumed([{ voice: "snare", time: 1 }], allActualHits, consumed);
  consumed = r2.consumedIndices;
  assert.deepEqual([...consumed].sort(), [0, 1]);
  assert.equal(r2.results[0].classification, "on-target");

  // Call 3: matches index 2. Both prior indices remain consumed.
  const r3 = scoreAgainstConsumed([{ voice: "hihatClosed", time: 2 }], allActualHits, consumed);
  consumed = r3.consumedIndices;
  assert.deepEqual([...consumed].sort(), [0, 1, 2]);
  assert.equal(r3.results[0].classification, "on-target");

  // Re-scoring against the fully-consumed set now yields only misses, no re-matches.
  const r4 = scoreAgainstConsumed(
    [
      { voice: "kick", time: 0 },
      { voice: "snare", time: 1 },
      { voice: "hihatClosed", time: 2 },
    ],
    allActualHits,
    consumed
  );
  for (const res of r4.results) {
    assert.equal(res.classification, "miss");
    assert.equal(res.actual, null);
  }
  // consumedIndices returned from a call with nothing new to consume must equal the input set.
  assert.deepEqual([...r4.consumedIndices].sort(), [0, 1, 2]);
});

test("scoreAgainstConsumed: does not mutate the input consumedIndices Set (returns a new Set)", () => {
  const allActualHits = [{ voice: "kick", time: 0 }];
  const original = new Set();
  const result = scoreAgainstConsumed([{ voice: "kick", time: 0 }], allActualHits, original);
  assert.equal(original.size, 0, "the Set passed in must not be mutated by the call");
  assert.equal(result.consumedIndices.size, 1);
  assert.notEqual(result.consumedIndices, original, "must return a distinct Set instance");
});

// -----------------------------------------------------------------------------
// Parity check: empty consumed set + no windowFilter behaves identically to
// scoreHits() for a single, non-overlapping bar.
// -----------------------------------------------------------------------------

test("scoreAgainstConsumed: empty consumed set produces identical results/extras to scoreHits() for a non-overlapping single-bar case", () => {
  const expected = [
    { voice: "kick", time: 0 },
    { voice: "hihatClosed", time: 0.5 },
    { voice: "snare", time: 1 },
  ];
  const actual = [
    { voice: "kick", time: 0 + sec(10) },
    { voice: "hihatClosed", time: 0.5 - sec(20) },
    // snare missed
    { voice: "crash", time: 1.2 }, // extra, wrong voice
    { voice: null, time: 1.3 }, // extra, unmapped
  ];

  const direct = scoreHits(expected, actual);
  const viaConsumed = scoreAgainstConsumed(expected, actual, new Set());

  assert.deepEqual(viaConsumed.results, direct.results);
  assert.deepEqual(viaConsumed.extras, direct.extras);
  assert.equal(viaConsumed.consumedIndices.size, 2, "two actual hits (kick, hihatClosed) should be consumed");
  assert.ok(viaConsumed.consumedIndices.has(0));
  assert.ok(viaConsumed.consumedIndices.has(1));
});

// -----------------------------------------------------------------------------
// Same-window double-hits within ONE call: unchanged behaviour -- closest
// wins, the other is left as an extra (and NOT marked consumed).
// -----------------------------------------------------------------------------

test("scoreAgainstConsumed: same-window double-hit within one call still picks the closest match, leaves the other as extra and unconsumed", () => {
  const T = 5;
  const expected = [{ voice: "kick", time: T }];
  const allActualHits = [
    { voice: "kick", time: T + sec(60) }, // farther, index 0
    { voice: "kick", time: T + sec(10) }, // closer, index 1 -> should match
  ];

  const result = scoreAgainstConsumed(expected, allActualHits, new Set());

  assert.equal(result.results[0].classification, "on-target");
  assert.equal(result.results[0].offsetMs, 10);
  assert.equal(result.extras.length, 1);
  assert.equal(result.extras[0].time, T + sec(60));

  // Only the winning hit (index 1) should be consumed; the loser (index 0)
  // must remain available for a later call (e.g. if it actually belonged to
  // an adjacent bar's expectation).
  assert.equal(result.consumedIndices.size, 1);
  assert.ok(result.consumedIndices.has(1), "the closer, matched hit (index 1) must be consumed");
  assert.ok(!result.consumedIndices.has(0), "the farther, unmatched hit (index 0) must NOT be consumed");
});

// -----------------------------------------------------------------------------
// windowFilter: restricts which indices are even offered as candidates this
// call, leaving out-of-window hits untouched for a later call to claim.
// -----------------------------------------------------------------------------

test("scoreAgainstConsumed: windowFilter excludes hits outside it from being matched or consumed this call", () => {
  const allActualHits = [
    { voice: "kick", time: 0 },
    { voice: "kick", time: 100 }, // far outside any reasonable bar window
  ];
  const expected = [{ voice: "kick", time: 0 }];

  // Only allow index 0 as a candidate this call.
  const windowFilter = (hit, idx) => idx === 0;

  const result = scoreAgainstConsumed(expected, allActualHits, new Set(), windowFilter);
  assert.equal(result.results[0].classification, "on-target");
  assert.equal(result.consumedIndices.size, 1);
  assert.ok(result.consumedIndices.has(0));
  assert.ok(!result.consumedIndices.has(1), "index 1 was excluded by windowFilter and must remain unconsumed");
});

// -----------------------------------------------------------------------------
// Purity: scoreAgainstConsumed must not touch DOM/window/navigator globals.
// -----------------------------------------------------------------------------

test("scoreAgainstConsumed: purity -- scoring.js source has no DOM/window/navigator API usage", () => {
  // Note: Node itself ships a built-in `navigator` global (web-compat API,
  // Node >= 21), so `typeof navigator === "object"` is true in plain Node
  // regardless of what scoring.js does -- asserting typeof on the ambient
  // global would be a false purity signal either way. The real question is
  // whether scoring.js's own source actually USES window/document/navigator
  // as a global API surface (e.g. `window.foo`, `document.querySelector`),
  // not whether the plain English word "window" appears in a comment (it
  // does, legitimately, e.g. "judging window" / "time window"). Check for
  // actual property-access usage of these identifiers, stripped of comments.
  const src = readFileSync(fileURLToPath(new URL("./scoring.js", import.meta.url)), "utf8");
  const withoutComments = src
    .replace(/\/\/.*$/gm, "") // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // strip block comments
  assert.doesNotMatch(withoutComments, /\bwindow\s*\./, "scoring.js must not use the `window` global API");
  assert.doesNotMatch(withoutComments, /\bdocument\s*\./, "scoring.js must not use the `document` global API");
  assert.doesNotMatch(withoutComments, /\bnavigator\s*\./, "scoring.js must not use the `navigator` global API");

  // Also confirm it's just callable, self-contained logic with no side effects.
  const result = scoreAgainstConsumed([{ voice: "kick", time: 0 }], [{ voice: "kick", time: 0 }], new Set());
  assert.equal(result.results[0].classification, "on-target");
});

// -----------------------------------------------------------------------------
// Regression: the "extras" double-count bug (fixed in index.html's scoreBar()
// by partitioning actual hits at the midpoint between adjacent bars' boundary
// steps, instead of padding each bar with an independent +/-80ms window).
//
// scoreAgainstConsumed()'s consumed-Set only ever absorbed MATCHED indices.
// An actual hit that fell inside a bar's +/-80ms pad but did NOT match
// anything (wrong voice, unmapped, or just a stray hit) was reported as an
// "extra" WITHOUT being marked consumed -- so if the neighbouring bar's own
// +/-80ms pad also covered that same hit (which happens whenever the 8th-note
// interval is under 160ms, i.e. BPM > ~187.5), the SAME physical hit would be
// reported as an extra by BOTH bars.
//
// The fix lives in index.html's scoreBar(): instead of an independent
// +/-80ms pad per bar, each bar's windowFilter is now the midpoint between
// its own boundary step and its neighbours' boundary steps, so windows are
// contiguous and non-overlapping -- every actual hit is a candidate for
// exactly one bar. This test reproduces that windowing scheme directly
// (rather than reaching into index.html) to prove the invariant holds at
// the scoring-module level: a stray hit landing in what USED to be the
// bar-N/bar-N+1 overlap zone is offered to, and can be reported as an extra
// by, exactly one of the two bars -- never both, never neither.
// -----------------------------------------------------------------------------

test("scoreAgainstConsumed + midpoint partition: a stray hit in the old bar-N/bar-N+1 overlap zone is counted as an extra exactly once, not twice", () => {
  // BPM 200 -> 8th-note interval = 150ms, same scenario as the headline test above.
  const T = 10;
  const barNBoundary = T;               // bar N's last expected step (e.g. step 7)
  const barN1Boundary = T + sec(150);   // bar N+1's first expected step (e.g. step 0)
  const midpoint = (barNBoundary + barN1Boundary) / 2; // T + 75ms

  const barNExpected = [{ voice: "kick", time: barNBoundary }]; // different voice: this hit can never match
  const barN1Expected = [{ voice: "kick", time: barN1Boundary }];

  // A stray hihatClosed hit at T + 70ms: wrong voice for both expected notes
  // (both expect "kick"), so it can never be MATCHED -- it can only ever
  // surface as an "extra". Under the OLD +/-80ms independent-pad scheme it
  // would fall in both bars' windows (70ms after barN's boundary, 80ms
  // before barN1's boundary) and get reported as an extra twice. Under the
  // midpoint partition it's before the midpoint (T+75ms), so it belongs to
  // bar N only.
  const strayTime = T + sec(70);
  assert.ok(strayTime < midpoint, "sanity: the stray hit must fall before the midpoint for this test to be meaningful");
  const allActualHits = [{ voice: "hihatClosed", time: strayTime }];

  let consumed = new Set();

  // Bar N's midpoint-partitioned window: [barNBoundary - 80ms pad-fallback, midpoint)
  // (no bar before N in this test, so its start edge uses the fallback pad;
  // only the END edge -- shared with bar N+1 -- matters for this test).
  const barNFilter = (hit) => hit.time >= barNBoundary - 0.08 && hit.time < midpoint;
  const barNResult = scoreAgainstConsumed(barNExpected, allActualHits, consumed, barNFilter);
  consumed = barNResult.consumedIndices;

  assert.equal(barNResult.results[0].classification, "miss", "wrong-voice stray hit must not match the kick expectation");
  assert.equal(barNResult.extras.length, 1, "the stray hit must be offered to bar N (it's before the midpoint)");
  assert.equal(barNResult.extras[0].voice, "hihatClosed");

  // Bar N+1's midpoint-partitioned window: [midpoint, barN1Boundary + 80ms pad-fallback)
  const barN1Filter = (hit) => hit.time >= midpoint && hit.time < barN1Boundary + 0.08;
  const barN1Result = scoreAgainstConsumed(barN1Expected, allActualHits, consumed, barN1Filter);
  consumed = barN1Result.consumedIndices;

  assert.equal(barN1Result.results[0].classification, "miss");
  assert.equal(barN1Result.extras.length, 0, "the stray hit must NOT be offered to bar N+1 -- it's before the midpoint, owned by bar N only");

  // Final invariant: across both bars, the stray hit was reported as an
  // extra in EXACTLY ONE bar's tally, never both, never neither.
  const totalExtraReports = barNResult.extras.length + barN1Result.extras.length;
  assert.equal(totalExtraReports, 1, "a single physical hit must be counted as an extra in exactly one bar's tally");
});

test("scoreAgainstConsumed + midpoint partition: an unmapped stray hit exactly ON the midpoint belongs to the LATER bar (half-open interval), counted once", () => {
  const T = 20;
  const barNBoundary = T;
  const barN1Boundary = T + sec(150);
  const midpoint = (barNBoundary + barN1Boundary) / 2; // T + 75ms, exactly

  const barNExpected = [{ voice: "snare", time: barNBoundary }];
  const barN1Expected = [{ voice: "snare", time: barN1Boundary }];

  // Unmapped hit (voice: null) landing exactly at the midpoint.
  const allActualHits = [{ voice: null, time: midpoint }];
  let consumed = new Set();

  // index.html uses a half-open interval per bar: [winStart, winEnd). A hit
  // exactly at winEnd is excluded from the earlier bar and included in the
  // later bar (whose winStart is the same midpoint, inclusive).
  const barNFilter = (hit) => hit.time >= barNBoundary - 0.08 && hit.time < midpoint;
  const barNResult = scoreAgainstConsumed(barNExpected, allActualHits, consumed, barNFilter);
  consumed = barNResult.consumedIndices;
  assert.equal(barNResult.extras.length, 0, "a hit exactly at the midpoint must NOT belong to the earlier bar (half-open interval excludes the end)");

  const barN1Filter = (hit) => hit.time >= midpoint && hit.time < barN1Boundary + 0.08;
  const barN1Result = scoreAgainstConsumed(barN1Expected, allActualHits, consumed, barN1Filter);
  assert.equal(barN1Result.extras.length, 1, "a hit exactly at the midpoint must belong to the later bar");
  assert.equal(barN1Result.extras[0].unmapped, true);

  assert.equal(barNResult.extras.length + barN1Result.extras.length, 1, "counted exactly once total");
});

console.log("All scoreAgainstConsumed tests defined; see node:test runner output above for results.");
