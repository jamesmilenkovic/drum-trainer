"use strict";

// =============================================================================
// test-mapping.mjs
//
// Node ESM test for mapping.js (pure module, zero DOM/Web MIDI).
// Covers SPEC.md AC2 (GM defaults + map shape) and AC4 (unmapped detection).
// Run: node test-mapping.mjs
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VOICES,
  VOICE_LABELS,
  GM_DEFAULT_MAP,
  getDefaultMap,
  findDuplicates,
  resolveVoice,
  classifyHit,
} from "./mapping.js";

// -----------------------------------------------------------------------------
// AC2 — mapping defaults
// -----------------------------------------------------------------------------

test("AC2: VOICES lists exactly the 12 spec'd voices in order (increment 5 adds crash2 + rideBell)", () => {
  assert.deepEqual(VOICES, [
    "kick",
    "snare",
    "hihatClosed",
    "hihatOpen",
    "hihatPedal",
    "tom1",
    "tom2",
    "floorTom",
    "crash",
    "crash2",
    "ride",
    "rideBell",
  ]);
});

test("AC2: every voice has a human-readable label", () => {
  for (const v of VOICES) {
    assert.equal(typeof VOICE_LABELS[v], "string");
    assert.ok(VOICE_LABELS[v].length > 0, `label for ${v} should be non-empty`);
  }
});

test("AC2: GM_DEFAULT_MAP matches the exact spec'd note numbers", () => {
  assert.deepEqual(GM_DEFAULT_MAP, {
    kick: 36,
    snare: 38,
    hihatClosed: 42,
    hihatOpen: 46,
    hihatPedal: 44,
    tom1: 48,
    tom2: 45,
    floorTom: 43,
    crash: 49,
    crash2: 57,
    ride: 51,
    rideBell: 53,
  });
});

test("AC2: GM_DEFAULT_MAP covers every voice in VOICES, nothing extra", () => {
  assert.deepEqual(Object.keys(GM_DEFAULT_MAP).sort(), [...VOICES].sort());
});

test("AC2: getDefaultMap() returns a value-equal copy of GM_DEFAULT_MAP", () => {
  const m = getDefaultMap();
  assert.deepEqual(m, GM_DEFAULT_MAP);
});

test("AC2: getDefaultMap() returns a fresh object each call (independent copies)", () => {
  const a = getDefaultMap();
  const b = getDefaultMap();
  assert.notEqual(a, b, "should not be the same object reference");
  a.kick = 999;
  assert.equal(b.kick, 36, "mutating one copy must not affect another");
  assert.equal(GM_DEFAULT_MAP.kick, 36, "mutating a copy must not affect the frozen source");
});

test("AC2: GM_DEFAULT_MAP is frozen (defensive: cannot be mutated in place)", () => {
  assert.throws(() => {
    "use strict";
    GM_DEFAULT_MAP.kick = 1;
  });
  assert.equal(GM_DEFAULT_MAP.kick, 36);
});

test("AC2: default map has no duplicate note assignments", () => {
  const dupes = findDuplicates(getDefaultMap());
  assert.deepEqual(dupes, []);
});

// -----------------------------------------------------------------------------
// findDuplicates — supporting logic for the "warn if two voices share a note" edge case
// -----------------------------------------------------------------------------

test("findDuplicates: detects two voices mapped to the same note", () => {
  const map = getDefaultMap();
  map.snare = map.kick; // force a collision: snare now also = 36
  const dupes = findDuplicates(map);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].note, 36);
  assert.deepEqual(dupes[0].voices.sort(), ["kick", "snare"]);
});

test("findDuplicates: null/undefined note assignments are not treated as duplicates", () => {
  const map = getDefaultMap();
  map.kick = null;
  map.snare = undefined;
  const dupes = findDuplicates(map);
  assert.deepEqual(dupes, []);
});

test("findDuplicates: three-way collision reported as one group", () => {
  const map = getDefaultMap();
  map.tom1 = 36;
  map.tom2 = 36;
  map.kick = 36;
  const dupes = findDuplicates(map);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].note, 36);
  assert.deepEqual(dupes[0].voices.sort(), ["kick", "tom1", "tom2"]);
});

// -----------------------------------------------------------------------------
// AC4 — unmapped detection
// -----------------------------------------------------------------------------

test("AC4: a mapped note resolves to the correct voice", () => {
  const map = getDefaultMap();
  assert.equal(resolveVoice(map, 36), "kick");
  assert.equal(resolveVoice(map, 38), "snare");
  assert.equal(resolveVoice(map, 42), "hihatClosed");
  assert.equal(resolveVoice(map, 46), "hihatOpen");
  assert.equal(resolveVoice(map, 44), "hihatPedal");
  assert.equal(resolveVoice(map, 48), "tom1");
  assert.equal(resolveVoice(map, 45), "tom2");
  assert.equal(resolveVoice(map, 43), "floorTom");
  assert.equal(resolveVoice(map, 49), "crash");
  assert.equal(resolveVoice(map, 57), "crash2");
  assert.equal(resolveVoice(map, 51), "ride");
  assert.equal(resolveVoice(map, 53), "rideBell");
});

test("AC4: an unmapped note number resolves to null", () => {
  const map = getDefaultMap();
  assert.equal(resolveVoice(map, 127), null); // not in GM default map
  assert.equal(resolveVoice(map, 0), null);
});

test("AC4: classifyHit flags a mapped note as not-unmapped with correct voice", () => {
  const map = getDefaultMap();
  const result = classifyHit(map, 36);
  assert.deepEqual(result, { voice: "kick", unmapped: false });
});

test("AC4: classifyHit flags an unmapped note number as unmapped", () => {
  const map = getDefaultMap();
  const result = classifyHit(map, 127);
  assert.deepEqual(result, { voice: null, unmapped: true });
});

test("AC4: classifyHit on a custom (edited) map resolves per the override", () => {
  const map = getDefaultMap();
  map.kick = 35; // user remapped kick from 36 -> 35
  assert.deepEqual(classifyHit(map, 35), { voice: "kick", unmapped: false });
  // old default note is no longer mapped to kick, and nothing else claims 36
  assert.deepEqual(classifyHit(map, 36), { voice: null, unmapped: true });
});

test("AC4: an empty map classifies every note as unmapped", () => {
  const result = classifyHit({}, 36);
  assert.deepEqual(result, { voice: null, unmapped: true });
});
