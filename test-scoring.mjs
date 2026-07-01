"use strict";

// =============================================================================
// test-scoring.mjs
//
// Node ESM test for scoring.js (pure module, zero DOM/Web MIDI).
// Covers SPEC.md AC6: on-target/early/late/miss/extra classification using
// +/-30ms / +/-80ms bands, plus the summary (counts, accuracy %, avg signed
// offset). Explicit boundary coverage per spec: exactly 30ms, exactly 80ms,
// double hits, unmapped notes, early/late sign convention.
//
// Time convention matches scoring.js: all hit times are in SECONDS on the
// audio-clock domain. Helper `sec(ms)` converts a millisecond offset to
// seconds for readability.
//
// Run: node test-scoring.mjs
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import { ON_TARGET_MS, WINDOW_MS, classifyOffset, scoreHits, summarize } from "./scoring.js";

const sec = (ms) => ms / 1000;
const EXPECTED_TIME = 10; // arbitrary anchor, audio-clock seconds

test("sanity: spec constants are 30ms / 80ms", () => {
  assert.equal(ON_TARGET_MS, 30);
  assert.equal(WINDOW_MS, 80);
});

// -----------------------------------------------------------------------------
// classifyOffset — direct boundary tests on the classification function
// -----------------------------------------------------------------------------

test("classifyOffset: 0ms is on-target", () => {
  assert.equal(classifyOffset(0), "on-target");
});

test("classifyOffset: exactly +30ms is on-target (inclusive boundary, late side)", () => {
  assert.equal(classifyOffset(30), "on-target");
});

test("classifyOffset: exactly -30ms is on-target (inclusive boundary, early side)", () => {
  assert.equal(classifyOffset(-30), "on-target");
});

test("classifyOffset: just past +30ms (30.5ms) is late, not on-target", () => {
  assert.equal(classifyOffset(30.5), "late");
});

test("classifyOffset: just past -30ms (-30.5ms) is early, not on-target", () => {
  assert.equal(classifyOffset(-30.5), "early");
});

test("classifyOffset: exactly +80ms is late, not miss", () => {
  assert.equal(classifyOffset(80), "late");
});

test("classifyOffset: exactly -80ms is early, not miss", () => {
  assert.equal(classifyOffset(-80), "early");
});

test("classifyOffset: just past +80ms (80.5ms) is a miss", () => {
  assert.equal(classifyOffset(80.5), "miss");
});

test("classifyOffset: just past -80ms (-80.5ms) is a miss", () => {
  assert.equal(classifyOffset(-80.5), "miss");
});

test("classifyOffset: sign convention — positive offset (actual after expected) is late", () => {
  assert.equal(classifyOffset(50), "late");
});

test("classifyOffset: sign convention — negative offset (actual before expected) is early", () => {
  assert.equal(classifyOffset(-50), "early");
});

// -----------------------------------------------------------------------------
// scoreHits — boundary cases expressed as realistic expected/actual hit lists,
// using second-domain timestamps (as the module is actually called).
// -----------------------------------------------------------------------------

test("scoreHits: hit exactly +30ms late (seconds domain) classifies on-target", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: "kick", time: EXPECTED_TIME + sec(30) }];
  const { results } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "on-target");
  assert.equal(results[0].offsetMs, 30);
});

test("scoreHits: hit exactly -30ms early (seconds domain) classifies on-target", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: "kick", time: EXPECTED_TIME - sec(30) }];
  const { results } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "on-target");
  assert.equal(results[0].offsetMs, -30);
});

test("scoreHits: hit exactly +80ms late classifies late, not miss", () => {
  const expected = [{ voice: "snare", time: EXPECTED_TIME }];
  const actual = [{ voice: "snare", time: EXPECTED_TIME + sec(80) }];
  const { results } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "late");
  assert.equal(results[0].offsetMs, 80);
});

test("scoreHits: hit exactly -80ms early classifies early, not miss", () => {
  const expected = [{ voice: "snare", time: EXPECTED_TIME }];
  const actual = [{ voice: "snare", time: EXPECTED_TIME - sec(80) }];
  const { results } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "early");
  assert.equal(results[0].offsetMs, -80);
});

test("scoreHits: hit just past +80ms (80.1ms) is a miss, no actual match reported", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: "kick", time: EXPECTED_TIME + sec(80.1) }];
  const { results, extras } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "miss");
  assert.equal(results[0].actual, null);
  assert.equal(results[0].offsetMs, null);
  // the out-of-window hit is not consumed as a match, so it should surface as an extra
  assert.equal(extras.length, 1);
  assert.equal(extras[0].voice, "kick");
});

test("scoreHits: hit just past -80ms (-80.1ms) is a miss", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: "kick", time: EXPECTED_TIME - sec(80.1) }];
  const { results, extras } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "miss");
  assert.equal(results[0].actual, null);
  assert.equal(extras.length, 1);
});

test("scoreHits: hit just past +30ms (30.1ms) is late, not on-target", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: "kick", time: EXPECTED_TIME + sec(30.1) }];
  const { results } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "late");
});

test("scoreHits: hit just past -30ms (-30.1ms) is early, not on-target", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: "kick", time: EXPECTED_TIME - sec(30.1) }];
  const { results } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "early");
});

test("scoreHits: no actual hit at all within window is a miss with null actual/offset", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const { results, extras } = scoreHits(expected, []);
  assert.equal(results[0].classification, "miss");
  assert.equal(results[0].actual, null);
  assert.equal(results[0].offsetMs, null);
  assert.deepEqual(extras, []);
});

test("scoreHits: double hits on one expected note — closest matches, other is extra", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [
    { voice: "kick", time: EXPECTED_TIME + sec(60) }, // farther
    { voice: "kick", time: EXPECTED_TIME + sec(10) }, // closer -> should match
  ];
  const { results, extras } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "on-target");
  assert.equal(results[0].offsetMs, 10);
  assert.equal(extras.length, 1);
  assert.equal(extras[0].voice, "kick");
  assert.equal(extras[0].time, EXPECTED_TIME + sec(60));
  assert.equal(extras[0].unmapped, false);
});

test("scoreHits: double hits, tie on |offset| — earliest actual time wins the match", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [
    { voice: "kick", time: EXPECTED_TIME + sec(20) }, // +20ms, later in time
    { voice: "kick", time: EXPECTED_TIME - sec(20) }, // -20ms, earlier in time, same |offset|
  ];
  const { results, extras } = scoreHits(expected, actual);
  assert.equal(results[0].offsetMs, -20, "earliest actual time should win the tie");
  assert.equal(extras.length, 1);
  assert.equal(extras[0].time, EXPECTED_TIME + sec(20));
});

test("scoreHits: unmapped note (voice null) never matches and is reported as extra with unmapped:true", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: null, time: EXPECTED_TIME }]; // same instant, but unmapped
  const { results, extras } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "miss", "unmapped hit must not satisfy the expected kick hit");
  assert.equal(extras.length, 1);
  assert.equal(extras[0].unmapped, true);
  assert.equal(extras[0].voice, null);
});

test("scoreHits: hit with no expected note nearby (wrong voice) is extra, not miss-matched", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: "snare", time: EXPECTED_TIME }]; // right time, wrong voice
  const { results, extras } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "miss");
  assert.equal(extras.length, 1);
  assert.equal(extras[0].voice, "snare");
  assert.equal(extras[0].unmapped, false);
});

test("scoreHits: early vs late sign — actual before expected is negative (early)", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: "kick", time: EXPECTED_TIME - sec(15) }];
  const { results } = scoreHits(expected, actual);
  assert.equal(results[0].offsetMs, -15);
  assert.equal(results[0].classification, "on-target");
});

test("scoreHits: early vs late sign — actual after expected is positive (late)", () => {
  const expected = [{ voice: "kick", time: EXPECTED_TIME }];
  const actual = [{ voice: "kick", time: EXPECTED_TIME + sec(15) }];
  const { results } = scoreHits(expected, actual);
  assert.equal(results[0].offsetMs, 15);
  assert.equal(results[0].classification, "on-target");
});

test("scoreHits: multiple voices scored independently in one pass", () => {
  const expected = [
    { voice: "kick", time: EXPECTED_TIME },
    { voice: "snare", time: EXPECTED_TIME + 0.5 },
  ];
  const actual = [
    { voice: "kick", time: EXPECTED_TIME + sec(5) },
    { voice: "snare", time: EXPECTED_TIME + 0.5 + sec(90) }, // miss: past 80ms
  ];
  const { results, extras } = scoreHits(expected, actual);
  assert.equal(results[0].classification, "on-target");
  assert.equal(results[1].classification, "miss");
  assert.equal(extras.length, 1);
  assert.equal(extras[0].voice, "snare");
});

test("scoreHits: results array preserves input order and length, one entry per expected hit", () => {
  const expected = [
    { voice: "kick", time: EXPECTED_TIME },
    { voice: "hihatClosed", time: EXPECTED_TIME + 0.1 },
    { voice: "snare", time: EXPECTED_TIME + 0.2 },
  ];
  const { results } = scoreHits(expected, []);
  assert.equal(results.length, 3);
  assert.equal(results[0].expected.voice, "kick");
  assert.equal(results[1].expected.voice, "hihatClosed");
  assert.equal(results[2].expected.voice, "snare");
});

// -----------------------------------------------------------------------------
// summarize — counts, accuracy %, average signed offset
// -----------------------------------------------------------------------------

test("summarize: counts each classification correctly", () => {
  const expected = [
    { voice: "kick", time: 0 },
    { voice: "kick", time: 1 },
    { voice: "kick", time: 2 },
    { voice: "kick", time: 3 },
  ];
  const actual = [
    { voice: "kick", time: 0 + sec(0) },    // on-target
    { voice: "kick", time: 1 - sec(50) },   // early
    { voice: "kick", time: 2 + sec(50) },   // late
    // time 3 -> miss (no actual hit)
    { voice: "snare", time: 5 },            // extra (no expected snare hit)
  ];
  const { results, extras } = scoreHits(expected, actual);
  const summary = summarize(results, extras);
  assert.equal(summary.counts["on-target"], 1);
  assert.equal(summary.counts.early, 1);
  assert.equal(summary.counts.late, 1);
  assert.equal(summary.counts.miss, 1);
  assert.equal(summary.counts.extra, 1);
  assert.equal(summary.expectedTotal, 4);
});

test("summarize: accuracy % = on-target / total expected hits", () => {
  const expected = [
    { voice: "kick", time: 0 },
    { voice: "kick", time: 1 },
    { voice: "kick", time: 2 },
    { voice: "kick", time: 3 },
  ];
  const actual = [
    { voice: "kick", time: 0 },       // on-target
    { voice: "kick", time: 1 },       // on-target
    { voice: "kick", time: 2 + sec(50) }, // late
    // time 3 -> miss
  ];
  const { results, extras } = scoreHits(expected, actual);
  const summary = summarize(results, extras);
  assert.equal(summary.accuracyPct, 50); // 2 of 4 on-target
});

test("summarize: accuracy % is 0 with zero expected hits (no divide-by-zero throw)", () => {
  const { results, extras } = scoreHits([], []);
  const summary = summarize(results, extras);
  assert.equal(summary.expectedTotal, 0);
  assert.equal(summary.accuracyPct, 0);
});

test("summarize: average signed offset — positive average signals dragging (late)", () => {
  const expected = [
    { voice: "kick", time: 0 },
    { voice: "kick", time: 1 },
  ];
  const actual = [
    { voice: "kick", time: 0 + sec(20) },
    { voice: "kick", time: 1 + sec(40) },
  ];
  const { results, extras } = scoreHits(expected, actual);
  const summary = summarize(results, extras);
  assert.equal(summary.avgOffsetMs, 30); // (20 + 40) / 2
});

test("summarize: average signed offset — negative average signals rushing (early)", () => {
  const expected = [
    { voice: "kick", time: 0 },
    { voice: "kick", time: 1 },
  ];
  const actual = [
    { voice: "kick", time: 0 - sec(10) },
    { voice: "kick", time: 1 - sec(30) },
  ];
  const { results, extras } = scoreHits(expected, actual);
  const summary = summarize(results, extras);
  assert.equal(summary.avgOffsetMs, -20); // (-10 + -30) / 2
});

test("summarize: misses are excluded from the average offset calculation", () => {
  const expected = [
    { voice: "kick", time: 0 },
    { voice: "kick", time: 1 },
  ];
  const actual = [
    { voice: "kick", time: 0 + sec(20) },
    // time 1 -> miss, must not contribute a 0 or null into the average
  ];
  const { results, extras } = scoreHits(expected, actual);
  const summary = summarize(results, extras);
  assert.equal(summary.avgOffsetMs, 20, "average should be computed only over the single matched hit");
});

test("summarize: avgOffsetMs is null when every expected hit is a miss (no matched hits)", () => {
  const expected = [{ voice: "kick", time: 0 }];
  const { results, extras } = scoreHits(expected, []);
  const summary = summarize(results, extras);
  assert.equal(summary.avgOffsetMs, null);
});

test("summarize: extra count reflects unmatched actual hits including unmapped ones", () => {
  const expected = [{ voice: "kick", time: 0 }];
  const actual = [
    { voice: "kick", time: 0 },     // matches
    { voice: null, time: 0.5 },     // unmapped extra
    { voice: "crash", time: 0.7 },  // wrong-voice extra
  ];
  const { results, extras } = scoreHits(expected, actual);
  const summary = summarize(results, extras);
  assert.equal(summary.counts.extra, 2);
  assert.equal(extras.filter((e) => e.unmapped).length, 1);
});

console.log("All scoring.js tests defined; see node:test runner output above for results.");
