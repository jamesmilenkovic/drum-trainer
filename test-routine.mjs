"use strict";

// =============================================================================
// test-routine.mjs
//
// Node ESM tests for routine.js — the routine data model + the extended
// pure timeline expansion (SPEC.md increment 7, section B / AC2 + AC5).
// Covers: item CRUD/reorder (fail-closed validation), serialize/deserialize
// round-trip, and expandRoutine() for single item, xN repeats, multi-item,
// tempo changes, and a groove that itself has sections.
//
// Pure module, zero DOM/IndexedDB/AudioContext — run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoutine,
  addItem,
  removeItem,
  updateItem,
  moveItemUp,
  moveItemDown,
  setName,
  serialize,
  deserialize,
  expandRoutine,
  MIN_ITEM_REPEATS,
  MAX_ITEM_REPEATS,
  MIN_ITEM_BPM,
  MAX_ITEM_BPM,
} from "./routine.js";
import { createGroove, addNote, addSection } from "./groove.js";

// A simple 1-bar groove, no sections.
function simpleGroove() {
  let g = createGroove({ timeSignature: { beatsPerBar: 4, beatValue: 4 }, bars: 1, subdivision: "eighth" });
  g = addNote(g, "kick", 0);
  g = addNote(g, "snare", 2);
  return g;
}

// A 2-bar groove with one section covering both bars, repeated x2 —
// proves expandRoutine correctly nests a groove's OWN section repeats
// inside the routine item's repeats (AC5's "grooves with sections" case).
function sectionedGroove() {
  let g = createGroove({ timeSignature: { beatsPerBar: 4, beatValue: 4 }, bars: 2, subdivision: "eighth" });
  g = addNote(g, "kick", 0);
  g = addSection(g, { name: "Verse", startBar: 0, endBar: 1, repeats: 2 });
  return g;
}

// -----------------------------------------------------------------------------
// Item CRUD / reorder (fail-closed validation)
// -----------------------------------------------------------------------------

test("addItem: valid item is appended; invalid (bad repeats/bpm/grooveId) is a no-op", () => {
  let r = createRoutine({ name: "Kick practice" });
  r = addItem(r, { grooveId: "g1", repeats: 4, bpm: 80 });
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0], { grooveId: "g1", repeats: 4, bpm: 80 });

  const rejected1 = addItem(r, { grooveId: "g2", repeats: 0, bpm: 80 }); // repeats out of range
  const rejected2 = addItem(r, { grooveId: "g2", repeats: 1, bpm: 20 }); // bpm out of range
  const rejected3 = addItem(r, { grooveId: "", repeats: 1, bpm: 80 }); // blank grooveId
  assert.equal(rejected1, r);
  assert.equal(rejected2, r);
  assert.equal(rejected3, r);
});

test("addItem: repeats/bpm bounds are inclusive at MIN/MAX, rejected just outside", () => {
  let r = createRoutine();
  r = addItem(r, { grooveId: "g1", repeats: MIN_ITEM_REPEATS, bpm: MIN_ITEM_BPM });
  r = addItem(r, { grooveId: "g1", repeats: MAX_ITEM_REPEATS, bpm: MAX_ITEM_BPM });
  assert.equal(r.items.length, 2);
  assert.equal(addItem(r, { grooveId: "g1", repeats: MAX_ITEM_REPEATS + 1, bpm: 100 }), r);
  assert.equal(addItem(r, { grooveId: "g1", repeats: 1, bpm: MAX_ITEM_BPM + 1 }), r);
});

test("removeItem: removes by index; out-of-range index is a no-op", () => {
  let r = createRoutine();
  r = addItem(r, { grooveId: "g1", repeats: 1, bpm: 80 });
  r = addItem(r, { grooveId: "g2", repeats: 1, bpm: 90 });
  const removed = removeItem(r, 0);
  assert.equal(removed.items.length, 1);
  assert.equal(removed.items[0].grooveId, "g2");
  assert.equal(removeItem(r, 99), r);
});

test("updateItem: changes only the given fields; rejects an invalid resulting item", () => {
  let r = createRoutine();
  r = addItem(r, { grooveId: "g1", repeats: 1, bpm: 80 });
  const updated = updateItem(r, 0, { bpm: 120 });
  assert.deepEqual(updated.items[0], { grooveId: "g1", repeats: 1, bpm: 120 });
  // Invalid change (bpm out of range) is rejected, original untouched.
  assert.equal(updateItem(r, 0, { bpm: 999 }), r);
  assert.equal(updateItem(r, 5, { bpm: 100 }), r); // out-of-range index
});

test("moveItemUp/moveItemDown: swaps adjacent items; no-op at the ends", () => {
  let r = createRoutine();
  r = addItem(r, { grooveId: "a", repeats: 1, bpm: 80 });
  r = addItem(r, { grooveId: "b", repeats: 1, bpm: 90 });
  r = addItem(r, { grooveId: "c", repeats: 1, bpm: 100 });

  const movedUp = moveItemUp(r, 1);
  assert.deepEqual(movedUp.items.map((i) => i.grooveId), ["b", "a", "c"]);
  assert.equal(moveItemUp(r, 0), r); // already first

  const movedDown = moveItemDown(r, 1);
  assert.deepEqual(movedDown.items.map((i) => i.grooveId), ["a", "c", "b"]);
  assert.equal(moveItemDown(r, 2), r); // already last
});

test("setName: trims a string name; leaves the routine unchanged for a non-string", () => {
  const r = createRoutine();
  assert.equal(setName(r, "  Kick practice  ").name, "Kick practice");
  assert.equal(setName(r, 123).name, r.name);
});

// -----------------------------------------------------------------------------
// Serialize / deserialize round-trip
// -----------------------------------------------------------------------------

test("serialize -> deserialize round-trips a routine with items", () => {
  let r = createRoutine({ name: "Kick practice" });
  r = addItem(r, { grooveId: "g1", repeats: 8, bpm: 60 });
  r = addItem(r, { grooveId: "g2", repeats: 4, bpm: 90 });
  const roundTripped = deserialize(JSON.parse(JSON.stringify(serialize(r))));
  assert.deepEqual(roundTripped, r);
});

test("deserialize: drops malformed items rather than corrupting the routine", () => {
  const data = {
    name: "Test",
    items: [
      { grooveId: "g1", repeats: 4, bpm: 80 }, // valid
      { grooveId: "g2", repeats: 0, bpm: 80 }, // bad repeats
      { grooveId: "", repeats: 1, bpm: 80 }, // blank grooveId
      "not an object",
      { grooveId: "g3", repeats: 1, bpm: 80 }, // valid
    ],
  };
  const r = deserialize(data);
  assert.deepEqual(r.items.map((i) => i.grooveId), ["g1", "g3"]);
});

test("deserialize: missing/non-array items and non-string name fall back sensibly", () => {
  assert.deepEqual(deserialize({}), { name: "", items: [] });
  assert.deepEqual(deserialize(null), { name: "", items: [] });
});

// -----------------------------------------------------------------------------
// expandRoutine — AC5's pure/tested cases
// -----------------------------------------------------------------------------

test("expandRoutine: a single item with repeats=1 matches the groove's own expandArrangement, tagged with item context", () => {
  const groove = simpleGroove();
  let r = createRoutine({ name: "R" });
  r = addItem(r, { grooveId: "g1", repeats: 1, bpm: 70 });
  const byId = { g1: { name: "Warmup", groove } };
  const entries = expandRoutine(r, byId);

  assert.equal(entries.length, 1); // 1 bar
  assert.deepEqual(entries[0], {
    bar: 0,
    sectionIndex: null,
    sectionName: null,
    repeat: 1,
    repeats: 1,
    itemIndex: 0,
    itemRepeat: 1,
    itemRepeats: 1,
    grooveId: "g1",
    grooveName: "Warmup",
    bpm: 70,
  });
});

test("expandRoutine: an item repeated xN produces N copies of the groove's bars, itemRepeat counting 1..N", () => {
  const groove = simpleGroove(); // 1 bar
  let r = createRoutine();
  r = addItem(r, { grooveId: "g1", repeats: 3, bpm: 100 });
  const entries = expandRoutine(r, { g1: { name: "G", groove } });

  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => e.itemRepeat), [1, 2, 3]);
  assert.ok(entries.every((e) => e.itemRepeats === 3));
  assert.ok(entries.every((e) => e.bar === 0)); // the groove is only 1 bar, every repeat replays bar 0
});

test("expandRoutine: multiple items concatenate in order, each tagged with its own itemIndex", () => {
  const grooveA = simpleGroove();
  const grooveB = simpleGroove();
  let r = createRoutine();
  r = addItem(r, { grooveId: "a", repeats: 2, bpm: 60 });
  r = addItem(r, { grooveId: "b", repeats: 1, bpm: 90 });
  const entries = expandRoutine(r, {
    a: { name: "Exercise A", groove: grooveA },
    b: { name: "Exercise B", groove: grooveB },
  });

  assert.equal(entries.length, 3); // 2 (item A) + 1 (item B)
  assert.deepEqual(entries.map((e) => e.itemIndex), [0, 0, 1]);
  assert.deepEqual(entries.map((e) => e.grooveName), ["Exercise A", "Exercise A", "Exercise B"]);
});

test("expandRoutine: tempo changes at item boundaries — each entry carries ITS OWN item's bpm", () => {
  const groove = simpleGroove();
  let r = createRoutine();
  r = addItem(r, { grooveId: "g", repeats: 2, bpm: 60 });
  r = addItem(r, { grooveId: "g", repeats: 2, bpm: 140 });
  const entries = expandRoutine(r, { g: { name: "G", groove } });

  assert.deepEqual(entries.map((e) => e.bpm), [60, 60, 140, 140]);
});

test("expandRoutine: a groove with its own sections nests correctly inside the item's repeats", () => {
  const groove = sectionedGroove(); // 2 bars, one section repeats x2 internally -> 4 bars per pass
  let r = createRoutine();
  r = addItem(r, { grooveId: "g", repeats: 2, bpm: 100 }); // item itself repeated x2
  const entries = expandRoutine(r, { g: { name: "Sectioned", groove } });

  // 4 bars per groove-internal pass (2 bars x 2 section-repeats) x 2 item-repeats = 8 entries.
  assert.equal(entries.length, 8);
  // Section-level repeat/repeats (groove-internal) cycles 1,2,1,2 across each item-repeat's 4 bars...
  assert.deepEqual(entries.slice(0, 4).map((e) => ({ bar: e.bar, repeat: e.repeat })), [
    { bar: 0, repeat: 1 },
    { bar: 1, repeat: 1 },
    { bar: 0, repeat: 2 },
    { bar: 1, repeat: 2 },
  ]);
  // ...and the SAME groove-internal sequence repeats again for itemRepeat 2, with itemRepeat now 2.
  assert.deepEqual(entries.slice(4, 8).map((e) => ({ bar: e.bar, repeat: e.repeat })), entries.slice(0, 4).map((e) => ({ bar: e.bar, repeat: e.repeat })));
  assert.deepEqual(entries.slice(0, 4).map((e) => e.itemRepeat), [1, 1, 1, 1]);
  assert.deepEqual(entries.slice(4, 8).map((e) => e.itemRepeat), [2, 2, 2, 2]);
  assert.ok(entries.every((e) => e.sectionName === "Verse"));
});

test("expandRoutine: an item whose grooveId isn't in the library is skipped, not thrown", () => {
  const groove = simpleGroove();
  let r = createRoutine();
  r = addItem(r, { grooveId: "missing", repeats: 1, bpm: 100 });
  r = addItem(r, { grooveId: "present", repeats: 1, bpm: 100 });
  const entries = expandRoutine(r, { present: { name: "P", groove } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].grooveId, "present");
});

test("expandRoutine: an empty routine (or one with no valid items) expands to an empty array", () => {
  assert.deepEqual(expandRoutine(createRoutine(), {}), []);
});

test("expandRoutine: grooveById may be a Map instead of a plain object", () => {
  const groove = simpleGroove();
  let r = createRoutine();
  r = addItem(r, { grooveId: "g1", repeats: 1, bpm: 100 });
  const map = new Map([["g1", { name: "Via Map", groove }]]);
  const entries = expandRoutine(r, map);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].grooveName, "Via Map");
});
