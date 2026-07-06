"use strict";

// =============================================================================
// test-presets.mjs
//
// Node ESM tests for presets.js — the built-in groove presets (SPEC.md
// increment 4, section C; extended increment 6 with lessonSectionedPhrase).
// GAP CLOSED (QA, increment 6): presets.js has never had its own test file
// across increments 4-5. That was low-risk while presets were plain 1-bar
// note lists, but increment 6 added a preset built with addSection() calls
// that fail CLOSED (silently no-op) on any shape/bounds/overlap mistake —
// exactly the kind of bug that would make SPEC.md AC8's "presets still
// load" claim false without ever throwing or failing loudly. These tests
// prove every preset is a well-formed, round-trip-stable groove, and that
// lessonSectionedPhrase specifically kept all 3 of its sections (none
// silently dropped by a bounds/overlap mistake in presets.js itself).
//
// Pure module, zero DOM/Web MIDI/AudioContext — run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import { PRESETS } from "./presets.js";
import { VOICES } from "./mapping.js";
import { serialize, deserialize, stepsPerBar, totalSteps, expandArrangement } from "./groove.js";

// -----------------------------------------------------------------------------
// Shape sanity: every preset is a well-formed { id, label, groove } entry
// -----------------------------------------------------------------------------

test("PRESETS: every entry has a non-empty id/label and a groove object", () => {
  for (const p of PRESETS) {
    assert.equal(typeof p.id, "string");
    assert.ok(p.id.length > 0);
    assert.equal(typeof p.label, "string");
    assert.ok(p.label.length > 0);
    assert.ok(p.groove && typeof p.groove === "object");
  }
});

test("PRESETS: ids are unique (no accidental duplicate preset)", () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

// -----------------------------------------------------------------------------
// Every preset groove is internally valid — every note's voice is a real
// VOICES member and every position is in range for that groove's own grid.
// (addNote() fails closed on bad input, so this also guards against a typo'd
// voice name or off-by-one position silently vanishing from a preset.)
// -----------------------------------------------------------------------------

test("PRESETS: every note in every preset uses a valid voice and an in-range position", () => {
  for (const { id, groove } of PRESETS) {
    const limit = totalSteps(groove);
    for (const note of groove.notes) {
      assert.ok(VOICES.includes(note.voice), `${id}: unknown voice ${note.voice}`);
      assert.ok(
        Number.isInteger(note.position) && note.position >= 0 && note.position < limit,
        `${id}: note position ${note.position} out of range [0,${limit})`
      );
    }
  }
});

// -----------------------------------------------------------------------------
// Round-trip stability (AC8 "presets still load" headless proxy): a preset
// that serialises/deserialises to something DIFFERENT would mean the shared
// model is silently reshaping it on load — exactly what a drummer would see
// as "my preset changed" or "some hits are missing" in the real app.
// -----------------------------------------------------------------------------

test("PRESETS: every preset round-trips through serialize -> JSON -> deserialize unchanged", () => {
  for (const { id, groove } of PRESETS) {
    const round = deserialize(JSON.parse(JSON.stringify(serialize(groove))));
    assert.deepEqual(round, groove, `${id}: round-trip mismatch`);
  }
});

// -----------------------------------------------------------------------------
// lessonSectionedPhrase (SPEC.md increment 6): the one preset built with
// addSection(), proving sections load through the SAME preset mechanism.
// -----------------------------------------------------------------------------

test("lessonSectionedPhrase: is a 4-bar groove with exactly the 3 documented sections, none silently dropped", () => {
  const { groove } = PRESETS.find((p) => p.id === "lessonSectionedPhrase");
  assert.ok(groove, "lessonSectionedPhrase preset must exist");
  assert.equal(groove.bars, 4);
  assert.equal(groove.sections.length, 3, "all 3 sections (Intro/Groove/Fill) must have been accepted, not no-op'd");
  assert.deepEqual(groove.sections, [
    { name: "Intro", startBar: 0, endBar: 0, repeats: 1 },
    { name: "Groove", startBar: 1, endBar: 2, repeats: 2 },
    { name: "Fill", startBar: 3, endBar: 3, repeats: 1 },
  ]);
});

test("lessonSectionedPhrase: has notes in every one of its 4 bars (nothing silently dropped by addNote)", () => {
  const { groove } = PRESETS.find((p) => p.id === "lessonSectionedPhrase");
  const perBar = stepsPerBar(groove);
  const barsWithNotes = new Set(groove.notes.map((n) => Math.floor(n.position / perBar)));
  assert.deepEqual([...barsWithNotes].sort(), [0, 1, 2, 3]);
});

test("lessonSectionedPhrase: expandArrangement covers Intro x1 + Groove x2 (2 bars) + Fill x1, in chart order", () => {
  const { groove } = PRESETS.find((p) => p.id === "lessonSectionedPhrase");
  const arrangement = expandArrangement(groove);
  // Intro (bar 0, x1) -> Groove (bars 1-2, x2 each = 4 entries) -> Fill (bar 3, x1) = 6 entries total.
  assert.equal(arrangement.length, 6);
  assert.deepEqual(arrangement.map((e) => e.bar), [0, 1, 2, 1, 2, 3]);
  assert.deepEqual(arrangement.map((e) => e.sectionName), [
    "Intro", "Groove", "Groove", "Groove", "Groove", "Fill",
  ]);
  assert.deepEqual(arrangement.map((e) => e.repeat), [1, 1, 1, 2, 2, 1]);
});

// -----------------------------------------------------------------------------
// AC8 zero-regression: presets that DON'T use sections still expand to a
// single, un-sectioned pass over their bars (today's whole-groove-loops
// behaviour), proving the increment-6 timeline expansion didn't change
// pre-existing no-section preset playback.
// -----------------------------------------------------------------------------

test("PRESETS: presets with no sections expand to one plain pass over every bar (AC8 no-section playback unchanged)", () => {
  for (const { id, groove } of PRESETS) {
    if (groove.sections.length > 0) continue; // lessonSectionedPhrase is covered separately above
    const arrangement = expandArrangement(groove);
    assert.deepEqual(
      arrangement.map((e) => e.bar),
      Array.from({ length: groove.bars }, (_, i) => i),
      `${id}: expected one pass over bars 0..${groove.bars - 1}`
    );
    assert.ok(arrangement.every((e) => e.sectionIndex === null && e.sectionName === null));
  }
});
