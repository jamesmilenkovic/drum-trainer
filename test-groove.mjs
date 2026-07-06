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
  MIN_SECTION_REPEATS,
  MAX_SECTION_REPEATS,
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
  addSection,
  updateSection,
  removeSection,
  expandArrangement,
  expandSection,
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
  assert.deepEqual(g.sections, []);
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

// -----------------------------------------------------------------------------
// MAX_BARS raised for chunking (SPEC.md increment 6, section A)
// -----------------------------------------------------------------------------

test("MAX_BARS supports at least 32 bars (SPEC.md increment 6 target)", () => {
  assert.ok(MAX_BARS >= 32, `MAX_BARS is ${MAX_BARS}, expected >= 32`);
  const g = createGroove({ bars: 32 });
  assert.equal(g.bars, 32);
  assert.equal(addNote(g, "kick", stepsPerBar(g) * 31).notes.length, 1, "last bar's positions are reachable");
});

// -----------------------------------------------------------------------------
// Sections: create / edit / delete + validation (SPEC.md increment 6, AC1)
// -----------------------------------------------------------------------------

test("addSection: adds a valid section", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "Intro", startBar: 0, endBar: 1, repeats: 1 });
  assert.equal(g.sections.length, 1);
  assert.deepEqual(g.sections[0], { name: "Intro", startBar: 0, endBar: 1, repeats: 1 });
});

test("addSection: rejects endBar < startBar (no-op)", () => {
  const g = createGroove({ bars: 8 });
  const same = addSection(g, { name: "Bad", startBar: 3, endBar: 1, repeats: 1 });
  assert.equal(same.sections.length, 0);
});

test("addSection: rejects an out-of-bounds range (no-op)", () => {
  const g = createGroove({ bars: 4 }); // valid bars are 0..3
  assert.equal(addSection(g, { name: "OOB", startBar: 0, endBar: 4, repeats: 1 }).sections.length, 0);
  assert.equal(addSection(g, { name: "OOB", startBar: -1, endBar: 2, repeats: 1 }).sections.length, 0);
});

test("addSection: rejects a repeats value outside [1, 99] (no-op)", () => {
  const g = createGroove({ bars: 4 });
  assert.equal(addSection(g, { name: "X", startBar: 0, endBar: 1, repeats: 0 }).sections.length, 0);
  assert.equal(addSection(g, { name: "X", startBar: 0, endBar: 1, repeats: 100 }).sections.length, 0);
  assert.equal(addSection(g, { name: "X", startBar: 0, endBar: 1, repeats: 1.5 }).sections.length, 0);
  assert.equal(
    addSection(g, { name: "X", startBar: 0, endBar: 1, repeats: MIN_SECTION_REPEATS }).sections.length,
    1
  );
  assert.equal(
    addSection(g, { name: "X", startBar: 0, endBar: 1, repeats: MAX_SECTION_REPEATS }).sections.length,
    1
  );
});

test("addSection: rejects a blank/whitespace-only name (no-op)", () => {
  const g = createGroove({ bars: 4 });
  assert.equal(addSection(g, { name: "", startBar: 0, endBar: 1, repeats: 1 }).sections.length, 0);
  assert.equal(addSection(g, { name: "   ", startBar: 0, endBar: 1, repeats: 1 }).sections.length, 0);
});

test("addSection: rejects a range that overlaps an existing section (no-op)", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "A", startBar: 0, endBar: 3, repeats: 1 });
  const overlapping = addSection(g, { name: "B", startBar: 3, endBar: 5, repeats: 1 }); // shares bar 3
  assert.equal(overlapping.sections.length, 1, "overlapping section rejected");
  const adjacent = addSection(g, { name: "B", startBar: 4, endBar: 5, repeats: 1 }); // touches but doesn't overlap
  assert.equal(adjacent.sections.length, 2, "adjacent (non-overlapping) section accepted");
});

test("addSection: sections may cover only part of the chart (uncovered bars allowed)", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "Fill", startBar: 6, endBar: 7, repeats: 1 });
  assert.equal(g.sections.length, 1, "a section need not start at bar 0 or cover every bar");
});

test("updateSection: edits an existing section's fields", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "Groove", startBar: 0, endBar: 1, repeats: 1 });
  g = updateSection(g, 0, { repeats: 8 });
  assert.equal(g.sections[0].repeats, 8);
  assert.equal(g.sections[0].name, "Groove", "untouched fields keep their value");
  g = updateSection(g, 0, { name: "Fill", startBar: 2, endBar: 3 });
  assert.deepEqual(g.sections[0], { name: "Fill", startBar: 2, endBar: 3, repeats: 8 });
});

test("updateSection: rejects an edit that would overlap ANOTHER section (no-op), but allows editing in place", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "A", startBar: 0, endBar: 1, repeats: 1 });
  g = addSection(g, { name: "B", startBar: 2, endBar: 3, repeats: 1 });
  const clash = updateSection(g, 1, { startBar: 1, endBar: 2 }); // would overlap A's bar 1
  assert.deepEqual(clash.sections[1], { name: "B", startBar: 2, endBar: 3, repeats: 1 }, "rejected, unchanged");
  // Editing A's own range slightly (not touching B) should succeed — the
  // section being edited must not be compared against itself.
  const resized = updateSection(g, 0, { endBar: 1 });
  assert.equal(resized.sections[0].endBar, 1);
});

test("updateSection: invalid index or invalid resulting shape is a no-op", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "A", startBar: 0, endBar: 1, repeats: 1 });
  assert.deepEqual(updateSection(g, 5, { repeats: 2 }), g, "out-of-range index");
  assert.deepEqual(updateSection(g, 0, { endBar: -1 }), g, "invalid endBar rejected");
});

test("removeSection: deletes by index; out-of-range index is a no-op", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "A", startBar: 0, endBar: 1, repeats: 1 });
  g = addSection(g, { name: "B", startBar: 2, endBar: 3, repeats: 1 });
  const removed = removeSection(g, 0);
  assert.equal(removed.sections.length, 1);
  assert.equal(removed.sections[0].name, "B");
  assert.deepEqual(removeSection(g, 99), g);
});

test("setBars: shrinking bars drops a section whose range no longer fits", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "Keeps", startBar: 0, endBar: 1, repeats: 1 });
  g = addSection(g, { name: "Dropped", startBar: 5, endBar: 7, repeats: 1 });
  const shrunk = setBars(g, 4); // valid bars now 0..3
  assert.equal(shrunk.sections.length, 1);
  assert.equal(shrunk.sections[0].name, "Keeps");
});

// -----------------------------------------------------------------------------
// Sections round-trip with the groove JSON (SPEC.md AC2)
// -----------------------------------------------------------------------------

test("serialize -> JSON -> deserialize round-trips sections identically (AC2)", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "Intro", startBar: 0, endBar: 1, repeats: 1 });
  g = addSection(g, { name: "Fill", startBar: 6, endBar: 7, repeats: 8 });
  g = addNote(g, "kick", 0);
  const round = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  assert.deepEqual(round, g);
});

test("deserialize: drops malformed sections (bad shape, out of bounds) rather than corrupting", () => {
  const g = deserialize({
    bars: 4,
    sections: [
      { name: "Good", startBar: 0, endBar: 1, repeats: 1 },
      { name: "Bad shape", startBar: 2, endBar: 1, repeats: 1 }, // endBar < startBar
      { name: "OOB", startBar: 0, endBar: 4, repeats: 1 }, // out of bounds for 4 bars
      { name: "Bad repeats", startBar: 2, endBar: 3, repeats: 0 },
      { name: "", startBar: 2, endBar: 3, repeats: 1 }, // blank name
    ],
  });
  assert.equal(g.sections.length, 1);
  assert.equal(g.sections[0].name, "Good");
});

test("deserialize: drops a later section that overlaps an earlier-kept one (deterministic, first wins)", () => {
  const g = deserialize({
    bars: 8,
    sections: [
      { name: "First", startBar: 0, endBar: 3, repeats: 1 },
      { name: "Overlaps", startBar: 2, endBar: 5, repeats: 1 }, // overlaps First's bars 2-3
      { name: "Second", startBar: 4, endBar: 5, repeats: 1 }, // does not overlap First
    ],
  });
  assert.equal(g.sections.length, 2);
  assert.deepEqual(g.sections.map((s) => s.name), ["First", "Second"]);
});

// -----------------------------------------------------------------------------
// Timeline expansion: sections + repeats -> flat bar sequence (SPEC.md AC5)
// -----------------------------------------------------------------------------

test("expandArrangement: no sections defined -> one pass over every bar of the groove (AC8 fallback)", () => {
  const g = createGroove({ bars: 3 });
  const arrangement = expandArrangement(g);
  assert.deepEqual(arrangement.map((e) => e.bar), [0, 1, 2]);
  for (const entry of arrangement) {
    assert.equal(entry.sectionIndex, null);
    assert.equal(entry.sectionName, null);
    assert.equal(entry.repeat, 1);
    assert.equal(entry.repeats, 1);
  }
});

test("expandArrangement: a single section with repeats=1 (x1) expands to its bar range once", () => {
  let g = createGroove({ bars: 4 });
  g = addSection(g, { name: "Groove", startBar: 1, endBar: 2, repeats: 1 });
  const arrangement = expandArrangement(g);
  assert.deepEqual(arrangement.map((e) => e.bar), [1, 2]);
  assert.deepEqual(arrangement.map((e) => e.repeat), [1, 1]);
});

test("expandArrangement: a section with repeats=N (xN) expands to its bar range N times back to back", () => {
  let g = createGroove({ bars: 4 });
  g = addSection(g, { name: "Fill", startBar: 2, endBar: 3, repeats: 3 });
  const arrangement = expandArrangement(g);
  assert.deepEqual(arrangement.map((e) => e.bar), [2, 3, 2, 3, 2, 3]);
  assert.deepEqual(arrangement.map((e) => e.repeat), [1, 1, 2, 2, 3, 3]);
  assert.ok(arrangement.every((e) => e.repeats === 3));
  assert.ok(arrangement.every((e) => e.sectionName === "Fill"));
});

test("expandArrangement: partial coverage — uncovered bars are absent from the output", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "Verse", startBar: 0, endBar: 1, repeats: 1 });
  g = addSection(g, { name: "Fill", startBar: 6, endBar: 6, repeats: 2 });
  // Bars 2-5, 7 aren't in any section and shouldn't appear at all.
  const arrangement = expandArrangement(g);
  assert.deepEqual(arrangement.map((e) => e.bar), [0, 1, 6, 6]);
  assert.ok(![2, 3, 4, 5, 7].some((bar) => arrangement.some((e) => e.bar === bar)));
});

test("expandArrangement: multiple sections play in chart order (by startBar) regardless of add order", () => {
  let g = createGroove({ bars: 6 });
  g = addSection(g, { name: "Fill", startBar: 4, endBar: 5, repeats: 1 }); // added first, plays LAST
  g = addSection(g, { name: "Intro", startBar: 0, endBar: 1, repeats: 1 });
  g = addSection(g, { name: "Groove", startBar: 2, endBar: 3, repeats: 1 });
  const arrangement = expandArrangement(g);
  assert.deepEqual(arrangement.map((e) => e.sectionName), ["Intro", "Intro", "Groove", "Groove", "Fill", "Fill"]);
});

test("expandSection: drill mode expands ONE section's bar range, ignoring its stored repeats", () => {
  let g = createGroove({ bars: 8 });
  g = addSection(g, { name: "Fill", startBar: 6, endBar: 7, repeats: 8 }); // stored repeats = 8
  const drilled = expandSection(g, 0, 3); // user chose x3 for this drill session
  assert.deepEqual(drilled.map((e) => e.bar), [6, 7, 6, 7, 6, 7]);
  assert.ok(drilled.every((e) => e.sectionName === "Fill" && e.repeats === 3));
});

test("expandSection: unknown section index returns an empty array", () => {
  const g = createGroove({ bars: 4 });
  assert.deepEqual(expandSection(g, 0, 4), []);
});
