"use strict";

// =============================================================================
// test-persistence.mjs
//
// Covers SPEC.md AC7: "Selected input, map, and tempo survive a reload
// (persisted in IndexedDB and restored)."
//
// IMPORTANT SCOPE NOTE: the actual IndexedDB read/write wrapper (openDb/
// dbGet/dbSet) lives inline in index.html and calls the real `indexedDB`
// global, which only exists in a browser (or a browser-like test env, e.g.
// jsdom + fake-indexeddb — neither of which is available here: no
// package.json, no new dependencies per the QA brief). That means a literal
// "open a DB, write, close, reopen, read" round trip cannot be executed
// headless in plain Node.
//
// What IS verified here, headlessly and honestly:
//   1. The serialization CONTRACT: the exact keys index.html writes to the
//      "settings" object store ("noteMap", "selectedInputId", "bpm") --
//      confirmed by reading index.html's boot()/dbSet() call sites (see
//      QA report). This test file hardcodes those same three keys so it
//      breaks loudly if the contract ever drifts out of sync with this
//      test (grep index.html for `dbSet(` / `dbGet(` to re-confirm).
//   2. Losslessness of that data across a put/get cycle using a mock object
//      store that reproduces IndexedDB's actual storage semantics --
//      structured clone (via Node's built-in structuredClone), NOT
//      JSON.stringify/parse. This matters because IndexedDB can store
//      values JSON cannot round-trip losslessly (e.g. it preserves
//      `undefined` map values as `undefined`, not JSON's "drop the key"
//      behaviour) -- so a JSON-based mock would be a weaker, less faithful
//      stand-in than what's used here.
//   3. That mapping.js's real default-map object (the exact value the app
//      persists on first boot / reset) survives the round trip unchanged,
//      using the real getDefaultMap() export, not a hand-copied literal.
//
// NOT verified here (needs a real browser -- flagged to James):
//   - That index.html's own openDb()/dbGet()/dbSet() functions, as written,
//     actually work against a real IndexedDB implementation.
//   - That boot() actually restores state into the live `noteMap`/
//     `selectedInputId`/`currentBpm` app variables and reflects it in the
//     DOM on reload.
//   - Cross-session persistence (closing and reopening the actual browser
//     tab/profile).
//
// Run: node test-persistence.mjs
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import { getDefaultMap } from "./mapping.js";

// -----------------------------------------------------------------------------
// Mock object store: reproduces IndexedDB's structured-clone put(value, key)
// / get(key) semantics without needing a real indexedDB global. This is a
// faithful stand-in for the storage step only -- it is not a mock of
// index.html's openDb/dbGet/dbSet wrapper itself (that code is untested by
// this file; see scope note above).
// -----------------------------------------------------------------------------
function makeMockStore() {
  const backing = new Map();
  return {
    put(value, key) {
      // IndexedDB stores a structured clone of the value, not the same
      // object reference, and not a JSON round-trip.
      backing.set(key, structuredClone(value));
    },
    get(key) {
      // Reads also return a fresh structured clone, matching IndexedDB
      // (mutating the returned value must not corrupt the stored copy).
      const v = backing.get(key);
      return v === undefined ? undefined : structuredClone(v);
    },
  };
}

// The exact keys index.html's dbSet/dbGet calls use (see boot(), and the
// dbSet call sites for the map/input/bpm setters). Re-grep index.html for
// `dbSet(` / `dbGet(` if this ever needs re-confirming.
const KEY_MAP = "noteMap";
const KEY_INPUT = "selectedInputId";
const KEY_BPM = "bpm";

test("AC7 contract: the three persisted keys are noteMap / selectedInputId / bpm", () => {
  // This is a documentation-style assertion pinning the contract this file
  // tests against; it will not catch a drift in index.html by itself, but
  // every other test below exercises exactly these three key names.
  assert.deepEqual([KEY_MAP, KEY_INPUT, KEY_BPM], ["noteMap", "selectedInputId", "bpm"]);
});

test("AC7: note map round-trips losslessly through the store", () => {
  const store = makeMockStore();
  const original = getDefaultMap();
  original.kick = 35; // simulate a user edit before persisting
  store.put(original, KEY_MAP);

  const restored = store.get(KEY_MAP);
  assert.deepEqual(restored, original);
  assert.notEqual(restored, original, "restored value must be an independent copy, not the same reference");
});

test("AC7: mutating the restored map does not affect the stored copy (no aliasing)", () => {
  const store = makeMockStore();
  const original = getDefaultMap();
  store.put(original, KEY_MAP);

  const restored = store.get(KEY_MAP);
  restored.kick = 999;

  const restoredAgain = store.get(KEY_MAP);
  assert.equal(restoredAgain.kick, 36, "a second read must not see the mutation made to the first read's copy");
});

test("AC7: selected input id (string) round-trips exactly", () => {
  const store = makeMockStore();
  const inputId = "usb-midi-efnote5-0001";
  store.put(inputId, KEY_INPUT);
  assert.equal(store.get(KEY_INPUT), inputId);
});

test("AC7: selected input id of null (no prior selection) round-trips as null", () => {
  const store = makeMockStore();
  store.put(null, KEY_INPUT);
  assert.equal(store.get(KEY_INPUT), null);
});

test("AC7: tempo (bpm, number) round-trips exactly, including non-default values", () => {
  const store = makeMockStore();
  store.put(174, KEY_BPM);
  assert.equal(store.get(KEY_BPM), 174);
  assert.equal(typeof store.get(KEY_BPM), "number");
});

test("AC7: tempo at clamp boundaries (30 and 300 per spec) round-trips exactly", () => {
  const store = makeMockStore();
  store.put(30, KEY_BPM);
  assert.equal(store.get(KEY_BPM), 30);
  store.put(300, KEY_BPM);
  assert.equal(store.get(KEY_BPM), 300);
});

test("AC7: full settings triple (map + input + bpm) all survive a combined round trip", () => {
  const store = makeMockStore();
  const map = getDefaultMap();
  map.snare = 40; // edited
  const inputId = "some-device-id";
  const bpm = 88;

  store.put(map, KEY_MAP);
  store.put(inputId, KEY_INPUT);
  store.put(bpm, KEY_BPM);

  assert.deepEqual(store.get(KEY_MAP), map);
  assert.equal(store.get(KEY_INPUT), inputId);
  assert.equal(store.get(KEY_BPM), bpm);
});

test("AC7: reading a key that was never written returns undefined (falls back to in-app default per boot() logic)", () => {
  const store = makeMockStore();
  assert.equal(store.get(KEY_MAP), undefined);
  assert.equal(store.get(KEY_BPM), undefined);
  // index.html's boot() only overwrites noteMap/selectedInputId/currentBpm
  // `if (saved...)` is truthy, so `undefined` here correctly means "keep
  // the in-memory default" -- documented, not independently verified
  // headlessly since that branch lives in boot() in index.html.
});

console.log("All persistence contract tests defined; see node:test runner output above for results.");
