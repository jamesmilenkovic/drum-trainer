"use strict";

// =============================================================================
// test-groove.mjs
//
// Node ESM tests for groove.js — the shared groove data model (SPEC.md
// increment 4, section A). Covers the [auto] parts of AC1 (build → serialise
// → deserialise identical round-trip; add/remove/toggle idempotency;
// malformed-input validation), AC3 (setters keep the model valid across
// time-sig/bars/subdivision changes), and AC8 (a MusicXML-style drum part
// maps cleanly onto the model via fromDrumPart — the inc-9 import shape).
//
// Pure module, zero DOM/Web MIDI/AudioContext — run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TIME_SIGNATURE,
  MIN_BARS,
  MAX_BARS,
  createGroove,
  stepsPerBar,
  totalSteps,
  notesAtPosition,
  addNote,
  removeNote,
  toggleNote,
  setTimeSignature,
  setBars,
  setSubdivision,
  serialize,
  deserialize,
  fromDrumPart,
} from "./groove.js";
import { VOICES } from "./mapping.js";
import { SUBDIVISIONS } from "./testarea.js";

// -----------------------------------------------------------------------------
// Factory + grid maths
// -----------------------------------------------------------------------------

test("createGroove: defaults are a 1-bar 4/4 eighth-note empty groove", () => {
  const g = createGroove();
  assert.deepEqual(g.timeSignature, { beatsPerBar: 4, beatValue: 4 });
  assert.equal(g.bars, 1);
  assert.equal(g.subdivision, "eighth");
  assert.deepEqual(g.notes, []);
});

test("createGroove: reuses testarea.js SUBDIVISIONS for steps-per-bar (no forked grid maths)", () => {
  // eighth = 2 steps/beat * 4 beats = 8 steps/bar; matches SUBDIVISIONS.
  assert.equal(SUBDIVISIONS.eighth, 2);
  assert.equal(stepsPerBar(createGroove()), 8);
  assert.equal(stepsPerBar(createGroove({ subdivision: "sixteenth" })), 16);
  assert.equal(stepsPerBar(createGroove({ subdivision: "quarter" })), 4);
});

test("totalSteps: scales with bar count", () => {
  assert.equal(totalSteps(createGroove({ bars: 1 })), 8);
  assert.equal(totalSteps(createGroove({ bars: 2 })), 16);
});

test("createGroove: invalid time sig / subdivision fall back to defaults; bars clamps to [MIN,MAX]", () => {
  const g = createGroove({ timeSignature: { beatsPerBar: 0, beatValue: 4 }, subdivision: "triplet", bars: 99 });
  assert.deepEqual(g.timeSignature, DEFAULT_TIME_SIGNATURE);
  assert.equal(g.subdivision, "eighth");
  assert.equal(g.bars, MAX_BARS);
  assert.equal(createGroove({ bars: -5 }).bars, MIN_BARS);
});

// -----------------------------------------------------------------------------
// add / remove / toggle (immutable + idempotent, AC1)
// -----------------------------------------------------------------------------

test("addNote: returns a NEW groove and does not mutate the input", () => {
  const g = createGroove();
  const g2 = addNote(g, "kick", 0);
  assert.equal(g.notes.length, 0, "original untouched");
  assert.equal(g2.notes.length, 1);
  assert.deepEqual(g2.notes[0], { voice: "kick", position: 0 });
});

test("addNote: idempotent — adding the same voice+position twice is a no-op (no duplicate)", () => {
  let g = createGroove();
  g = addNote(g, "snare", 2);
  const before = g.notes.length;
  g = addNote(g, "snare", 2);
  assert.equal(g.notes.length, before);
});

test("addNote: two different voices can share one position (stacked hits)", () => {
  let g = createGroove();
  g = addNote(g, "kick", 0);
  g = addNote(g, "hihatClosed", 0);
  assert.equal(notesAtPosition(g, 0).length, 2);
});

test("addNote: rejects an unknown voice (no-op)", () => {
  const g = createGroove();
  assert.equal(addNote(g, "cowbell", 0).notes.length, 0);
});

test("addNote: rejects an out-of-range or non-integer position (no-op)", () => {
  const g = createGroove(); // 8 steps
  assert.equal(addNote(g, "kick", 8).notes.length, 0, "position == totalSteps is out of range");
  assert.equal(addNote(g, "kick", -1).notes.length, 0);
  assert.equal(addNote(g, "kick", 1.5).notes.length, 0);
});

test("addNote: accent flag only stored when true", () => {
  let g = createGroove();
  g = addNote(g, "snare", 2, true);
  assert.deepEqual(g.notes[0], { voice: "snare", position: 2, accent: true });
  g = addNote(g, "kick", 0, false);
  assert.deepEqual(notesAtPosition(g, 0)[0], { voice: "kick", position: 0 }, "no accent key when false");
});

test("removeNote: removes an existing note; removing a missing one is a no-op", () => {
  let g = addNote(createGroove(), "kick", 0);
  g = removeNote(g, "kick", 0);
  assert.equal(g.notes.length, 0);
  const same = removeNote(g, "kick", 0);
  assert.equal(same.notes.length, 0);
});

test("toggleNote: adds when absent, removes when present (the editor click)", () => {
  let g = createGroove();
  g = toggleNote(g, "hihatClosed", 4);
  assert.equal(g.notes.length, 1);
  g = toggleNote(g, "hihatClosed", 4);
  assert.equal(g.notes.length, 0);
});

// -----------------------------------------------------------------------------
// Setters keep the model valid (AC3)
// -----------------------------------------------------------------------------

test("setBars: shrinking bars drops notes that fall outside the smaller grid", () => {
  let g = createGroove({ bars: 2 }); // 16 steps
  g = addNote(g, "kick", 0);
  g = addNote(g, "snare", 12); // only valid with 2 bars
  g = setBars(g, 1); // now 8 steps
  assert.ok(g.notes.some((n) => n.position === 0), "in-range note kept");
  assert.ok(!g.notes.some((n) => n.position === 12), "out-of-range note dropped");
});

test("setSubdivision: coarser grid drops now-out-of-range notes; finer grid keeps them", () => {
  let g = createGroove({ subdivision: "sixteenth" }); // 16 steps
  g = addNote(g, "kick", 15);
  const coarser = setSubdivision(g, "quarter"); // 4 steps
  assert.ok(!coarser.notes.some((n) => n.position === 15), "dropped on coarser grid");
  const finer = setSubdivision(createGroove(), "sixteenth");
  assert.equal(totalSteps(finer), 16);
});

test("setTimeSignature: fewer beats drops out-of-range notes, keeps in-range ones", () => {
  let g = createGroove(); // 4/4 eighth, 8 steps
  g = addNote(g, "kick", 0);
  g = addNote(g, "snare", 7);
  const threeFour = setTimeSignature(g, { beatsPerBar: 3, beatValue: 4 }); // 6 steps
  assert.equal(stepsPerBar(threeFour), 6);
  assert.ok(threeFour.notes.some((n) => n.position === 0));
  assert.ok(!threeFour.notes.some((n) => n.position === 7), "position 7 out of the 6-step bar");
});

test("setTimeSignature: an invalid time sig is a no-op", () => {
  const g = addNote(createGroove(), "kick", 0);
  const same = setTimeSignature(g, { beatsPerBar: 0, beatValue: 4 });
  assert.deepEqual(same.timeSignature, g.timeSignature);
});

// -----------------------------------------------------------------------------
// serialize / deserialize round-trip + validation (AC1)
// -----------------------------------------------------------------------------

test("serialize -> JSON -> deserialize is identical to the original (AC1 round-trip)", () => {
  let g = createGroove({ timeSignature: { beatsPerBar: 3, beatValue: 4 }, bars: 2, subdivision: "sixteenth" });
  g = addNote(g, "kick", 0);
  g = addNote(g, "snare", 8, true);
  g = addNote(g, "hihatClosed", 0);
  const round = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  assert.deepEqual(round, g);
});

test("serialize: output is plain JSON-safe data (no shared references to the groove's notes)", () => {
  const g = addNote(createGroove(), "kick", 0);
  const s = serialize(g);
  s.notes[0].position = 99; // mutate the serialised copy
  assert.equal(g.notes[0].position, 0, "original groove note untouched");
});

test("deserialize: drops malformed notes (unknown voice, bad/out-of-range position) rather than corrupting", () => {
  const g = deserialize({
    timeSignature: { beatsPerBar: 4, beatValue: 4 },
    bars: 1,
    subdivision: "eighth",
    notes: [
      { voice: "kick", position: 0 },
      { voice: "cowbell", position: 1 }, // unknown voice
      { voice: "snare", position: 99 }, // out of range
      { voice: "snare", position: 1.5 }, // non-integer
    ],
  });
  assert.equal(g.notes.length, 1);
  assert.deepEqual(g.notes[0], { voice: "kick", position: 0 });
});

test("deserialize: missing/garbage top-level fields fall back to valid defaults", () => {
  const g = deserialize({});
  assert.deepEqual(g.timeSignature, DEFAULT_TIME_SIGNATURE);
  assert.equal(g.bars, MIN_BARS);
  assert.equal(g.subdivision, "eighth");
  assert.deepEqual(g.notes, []);
  // Completely bad input (null / non-object) still yields a usable empty groove.
  assert.equal(deserialize(null).notes.length, 0);
});

test("deserialize: duplicate (voice, position) pairs collapse to one entry", () => {
  const g = deserialize({
    notes: [
      { voice: "kick", position: 0 },
      { voice: "kick", position: 0 },
    ],
  });
  assert.equal(g.notes.length, 1);
});

// -----------------------------------------------------------------------------
// MusicXML-style import adapter (AC8 sanity check)
// -----------------------------------------------------------------------------

test("fromDrumPart: a synthetic drum part maps cleanly onto {voice, position, accent}", () => {
  const part = [
    { voice: "kick", onset: 0, duration: 2 },
    { voice: "snare", onset: 2, duration: 2 },
    { voice: "hihatClosed", onset: 1, duration: 1 },
    { voice: "crash", onset: 0, duration: 4, accent: true },
  ];
  const g = fromDrumPart(part, { timeSignature: { beatsPerBar: 4, beatValue: 4 }, bars: 1, subdivision: "eighth" });
  assert.ok(g.notes.some((n) => n.voice === "kick" && n.position === 0));
  assert.ok(g.notes.some((n) => n.voice === "snare" && n.position === 2));
  assert.ok(g.notes.some((n) => n.voice === "hihatClosed" && n.position === 1));
  assert.ok(g.notes.some((n) => n.voice === "crash" && n.position === 0 && n.accent === true));
});

test("fromDrumPart: quantises onsets via stepsPerOnsetUnit and skips unknown voices / bad onsets", () => {
  const part = [
    { voice: "kick", onset: 0 },
    { voice: "snare", onset: 4 }, // 4 onset-units / 2 per step = step 2
    { voice: "cowbell", onset: 1 }, // unknown voice -> skipped
    { voice: "kick", onset: "x" }, // non-finite onset -> skipped
  ];
  const g = fromDrumPart(part, { subdivision: "eighth", stepsPerOnsetUnit: 2 });
  assert.ok(g.notes.some((n) => n.voice === "snare" && n.position === 2));
  assert.ok(!g.notes.some((n) => n.voice === "cowbell"));
  assert.equal(g.notes.filter((n) => n.voice === "kick").length, 1);
});

test("fromDrumPart: every voice it maps is a valid VOICES member (import-ready shape)", () => {
  const part = VOICES.map((voice, i) => ({ voice, onset: i % 8 }));
  const g = fromDrumPart(part, { subdivision: "eighth" });
  for (const n of g.notes) assert.ok(VOICES.includes(n.voice));
});
