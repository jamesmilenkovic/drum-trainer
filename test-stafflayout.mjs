"use strict";

// =============================================================================
// test-stafflayout.mjs
//
// Node ESM tests for stafflayout.js — the staff-layout (notation display) map
// (SPEC.md increment 4, section A2). Covers the [auto] parts of AC1b: a
// standard drum-notation default exists for ALL 10 voices, the pure lookups
// (resolveNotehead / getEntry) work against an explicit layout, and
// normaliseStaffLayout rejects/normalises a stale/partial/corrupt saved
// layout rather than corrupting rendering. The Test-staff placement fix is
// proven here at the data level: every voice — including the toms/crash/floor
// tom/ride that were mis-placed in inc 3 — now resolves to a staff row.
//
// Pure module — run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_STAFF_LAYOUT,
  getDefaultStaffLayout,
  resolveNotehead,
  getEntry,
  normaliseStaffLayout,
} from "./stafflayout.js";
import { VOICES } from "./mapping.js";

// -----------------------------------------------------------------------------
// Default map covers every voice (the inc-3 Test-bug fix at the data level)
// -----------------------------------------------------------------------------

test("DEFAULT_STAFF_LAYOUT: has an entry for ALL 10 voices (no missing rows)", () => {
  for (const voice of VOICES) {
    assert.ok(DEFAULT_STAFF_LAYOUT[voice], `missing default for ${voice}`);
    assert.match(DEFAULT_STAFF_LAYOUT[voice].key, /^[a-g]\/\d+$/);
    assert.ok(["normal", "x"].includes(DEFAULT_STAFF_LAYOUT[voice].notehead));
  }
});

test("resolveNotehead: every voice resolves to a VexFlow key string — toms/crash/floorTom/ride included (inc-3 bug fixed)", () => {
  const layout = getDefaultStaffLayout();
  for (const voice of VOICES) {
    assert.ok(resolveNotehead(layout, voice), `${voice} did not resolve to a staff key`);
  }
  // The four voices James reported as mis-placed in inc 3 now have rows.
  for (const voice of ["tom1", "tom2", "floorTom", "crash", "ride"]) {
    assert.ok(resolveNotehead(layout, voice));
  }
});

test("resolveNotehead: kick/snare/hihatClosed keep their EXISTING inc-2/3 positions (AC7 no regression)", () => {
  const layout = getDefaultStaffLayout();
  assert.equal(resolveNotehead(layout, "kick"), "f/4");
  assert.equal(resolveNotehead(layout, "snare"), "c/5");
  assert.equal(resolveNotehead(layout, "hihatClosed"), "g/5/x2");
});

test("resolveNotehead: x-notehead voices get the /x2 suffix; normal voices do not", () => {
  const layout = getDefaultStaffLayout();
  // hats + cymbals are x-noteheads.
  for (const voice of ["hihatClosed", "hihatOpen", "hihatPedal", "crash", "ride"]) {
    assert.match(resolveNotehead(layout, voice), /\/x2$/, `${voice} should be an x notehead`);
  }
  // kick/snare/toms are normal noteheads (no /x2).
  for (const voice of ["kick", "snare", "tom1", "tom2", "floorTom"]) {
    assert.doesNotMatch(resolveNotehead(layout, voice), /\/x2$/, `${voice} should be a normal notehead`);
  }
});

test("resolveNotehead: no two voices share the exact same key (every voice is click-reachable)", () => {
  const layout = getDefaultStaffLayout();
  const keys = VOICES.map((v) => resolveNotehead(layout, v));
  assert.equal(new Set(keys).size, keys.length, "duplicate rows would make a voice unclickable");
});

test("resolveNotehead: unknown voice / missing entry returns null (no guess)", () => {
  assert.equal(resolveNotehead(getDefaultStaffLayout(), "cowbell"), null);
  assert.equal(resolveNotehead({}, "kick"), null);
  assert.equal(resolveNotehead(null, "kick"), null);
});

// -----------------------------------------------------------------------------
// getDefaultStaffLayout returns an independent, mutable copy
// -----------------------------------------------------------------------------

test("getDefaultStaffLayout: is a fresh deep-ish copy — mutating it doesn't touch the frozen default", () => {
  const a = getDefaultStaffLayout();
  a.kick.key = "z/9";
  assert.equal(DEFAULT_STAFF_LAYOUT.kick.key, "f/4", "frozen default untouched");
  const b = getDefaultStaffLayout();
  assert.equal(b.kick.key, "f/4", "a fresh copy is unaffected by mutating a previous one");
});

// -----------------------------------------------------------------------------
// getEntry — raw {key, notehead} for the settings panel
// -----------------------------------------------------------------------------

test("getEntry: returns the raw {key, notehead} entry (not the combined vex key), or null", () => {
  const layout = getDefaultStaffLayout();
  assert.deepEqual(getEntry(layout, "hihatClosed"), { key: "g/5", notehead: "x" });
  assert.equal(getEntry(layout, "cowbell"), null);
});

// -----------------------------------------------------------------------------
// normaliseStaffLayout — reject/normalise a corrupt/partial saved layout
// -----------------------------------------------------------------------------

test("normaliseStaffLayout: fills a missing voice with its shipped default", () => {
  const partial = { kick: { key: "a/3", notehead: "normal" } }; // only kick present
  const n = normaliseStaffLayout(partial);
  for (const voice of VOICES) assert.ok(n[voice], `${voice} filled in`);
  assert.equal(n.kick.key, "a/3", "valid custom entry preserved");
  assert.equal(n.snare.key, DEFAULT_STAFF_LAYOUT.snare.key, "missing voice defaulted");
});

test("normaliseStaffLayout: replaces an invalid entry (bad key / bad notehead) with the default", () => {
  const corrupt = {
    kick: { key: "not-a-key", notehead: "normal" },
    snare: { key: "c/5", notehead: "triangle" },
  };
  const n = normaliseStaffLayout(corrupt);
  assert.equal(n.kick.key, DEFAULT_STAFF_LAYOUT.kick.key);
  assert.equal(n.snare.notehead, DEFAULT_STAFF_LAYOUT.snare.notehead);
});

test("normaliseStaffLayout: drops unknown extra keys not in VOICES", () => {
  const n = normaliseStaffLayout({ cowbell: { key: "c/5", notehead: "x" } });
  assert.equal(n.cowbell, undefined);
  assert.equal(Object.keys(n).length, VOICES.length);
});

test("normaliseStaffLayout: null/garbage input yields the full default layout", () => {
  const n = normaliseStaffLayout(null);
  for (const voice of VOICES) assert.deepEqual(n[voice], DEFAULT_STAFF_LAYOUT[voice]);
});

// -----------------------------------------------------------------------------
// Purity check — no DOM/window/navigator API usage in the source text.
// -----------------------------------------------------------------------------

test("purity: stafflayout.js source has no DOM/window/navigator/AudioContext usage (comments excluded)", async () => {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(new URL("./stafflayout.js", import.meta.url), "utf8");
  const src = raw.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  assert.doesNotMatch(src, /\bdocument\./);
  assert.doesNotMatch(src, /\bwindow\./);
  assert.doesNotMatch(src, /\bnavigator\./);
  assert.doesNotMatch(src, /new AudioContext/);
});
