"use strict";

// =============================================================================
// test-stafflayout.mjs
//
// Node ESM tests for stafflayout.js — the staff-layout (notation display) map
// (SPEC.md increment 4, section A2; extended increment 5, sections A-C).
// Covers the [auto] parts of AC1b: a standard drum-notation default exists
// for ALL voices, the pure lookups (resolveNotehead / getEntry /
// getNoteheadGlyph) work against an explicit layout, and
// normaliseStaffLayout rejects/normalises a stale/partial/corrupt saved
// layout rather than corrupting rendering. The Test-staff placement fix is
// proven here at the data level: every voice — including the toms/crash/floor
// tom/ride that were mis-placed in inc 3 — now resolves to a staff row.
// Increment 5 extends this to: the richer notehead set (normal/x/open/
// diamond/circled-x) and the two new voices (crash2, rideBell).
//
// Pure module — run: node --test
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_STAFF_LAYOUT,
  NOTEHEAD_GLYPHS,
  NOTEHEAD_TYPES,
  getDefaultStaffLayout,
  resolveNotehead,
  getEntry,
  getNoteheadGlyph,
  normaliseStaffLayout,
} from "./stafflayout.js";
import { VOICES } from "./mapping.js";

// -----------------------------------------------------------------------------
// Default map covers every voice (the inc-3 Test-bug fix at the data level)
// -----------------------------------------------------------------------------

test("DEFAULT_STAFF_LAYOUT: has an entry for ALL 12 voices (no missing rows)", () => {
  for (const voice of VOICES) {
    assert.ok(DEFAULT_STAFF_LAYOUT[voice], `missing default for ${voice}`);
    assert.match(DEFAULT_STAFF_LAYOUT[voice].key, /^[a-g]\/\d+$/);
    assert.ok(NOTEHEAD_TYPES.includes(DEFAULT_STAFF_LAYOUT[voice].notehead));
  }
});

test("resolveNotehead: every voice resolves to a VexFlow key string — toms/crash/floorTom/ride/crash2/rideBell included", () => {
  const layout = getDefaultStaffLayout();
  for (const voice of VOICES) {
    assert.ok(resolveNotehead(layout, voice), `${voice} did not resolve to a staff key`);
  }
  // The four voices James reported as mis-placed in inc 3 now have rows,
  // plus the two increment-5 additions.
  for (const voice of ["tom1", "tom2", "floorTom", "crash", "ride", "crash2", "rideBell"]) {
    assert.ok(resolveNotehead(layout, voice));
  }
});

test("increment 5: crash2 and rideBell have sensible default notation (crash2 = x, rideBell = diamond)", () => {
  assert.equal(DEFAULT_STAFF_LAYOUT.crash2.notehead, "x");
  assert.equal(DEFAULT_STAFF_LAYOUT.rideBell.notehead, "diamond");
});

test("resolveNotehead: kick/snare/hihatClosed keep their EXISTING inc-2/3 positions (AC7 no regression)", () => {
  const layout = getDefaultStaffLayout();
  assert.equal(resolveNotehead(layout, "kick"), "f/4");
  assert.equal(resolveNotehead(layout, "snare"), "c/5");
  assert.equal(resolveNotehead(layout, "hihatClosed"), "g/5/x2");
});

test("resolveNotehead: x and open noteheads both get the /x2 suffix (open = x notehead + circle above); normal voices do not", () => {
  const layout = getDefaultStaffLayout();
  // hats (closed is x, open is open-with-circle-above) + cymbals are x-based noteheads.
  for (const voice of ["hihatClosed", "hihatOpen", "hihatPedal", "crash", "crash2"]) {
    assert.match(resolveNotehead(layout, voice), /\/x2$/, `${voice} should be an x-based notehead`);
  }
  // kick/snare/toms are normal noteheads (no suffix).
  for (const voice of ["kick", "snare", "tom1", "tom2", "floorTom"]) {
    assert.doesNotMatch(resolveNotehead(layout, voice), /\/x2$/, `${voice} should be a normal notehead`);
  }
});

test("resolveNotehead: diamond-notehead voices (rideBell) get the /d2 suffix", () => {
  const layout = getDefaultStaffLayout();
  assert.match(resolveNotehead(layout, "rideBell"), /\/d2$/);
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
// NOTEHEAD_GLYPHS / getNoteheadGlyph — the single glyph-code source of truth
// (SPEC.md increment 5, section B)
// -----------------------------------------------------------------------------

test("NOTEHEAD_TYPES: includes at least normal, x, open, diamond (SPEC.md AC2's minimum set)", () => {
  for (const t of ["normal", "x", "open", "diamond"]) {
    assert.ok(NOTEHEAD_TYPES.includes(t), `${t} missing from NOTEHEAD_TYPES`);
  }
});

test("getNoteheadGlyph: open = x-shaped VexFlow glyph with circleAbove true (x + 'o' above, per SPEC.md section B)", () => {
  const glyph = getNoteheadGlyph("open");
  assert.equal(glyph.vexSuffix, "/x2");
  assert.equal(glyph.drawKind, "x");
  assert.equal(glyph.circleAbove, true);
});

test("getNoteheadGlyph: diamond = VexFlow's diamond glyph code, no circle", () => {
  const glyph = getNoteheadGlyph("diamond");
  assert.equal(glyph.vexSuffix, "/d2");
  assert.equal(glyph.drawKind, "diamond");
  assert.equal(glyph.circleAbove, false);
});

test("getNoteheadGlyph: normal has no suffix (VexFlow's plain filled notehead)", () => {
  const glyph = getNoteheadGlyph("normal");
  assert.equal(glyph.vexSuffix, null);
  assert.equal(glyph.drawKind, "normal");
});

test("getNoteheadGlyph: x has the /x2 suffix, no circle", () => {
  const glyph = getNoteheadGlyph("x");
  assert.equal(glyph.vexSuffix, "/x2");
  assert.equal(glyph.circleAbove, false);
});

test("getNoteheadGlyph: unknown notehead type returns null", () => {
  assert.equal(getNoteheadGlyph("triangle"), null);
  assert.equal(getNoteheadGlyph(undefined), null);
});

test("getNoteheadGlyph: returns an independent copy (mutating it doesn't corrupt the shared table)", () => {
  const glyph = getNoteheadGlyph("x");
  glyph.vexSuffix = "/mutated";
  assert.equal(getNoteheadGlyph("x").vexSuffix, "/x2", "shared NOTEHEAD_GLYPHS table untouched");
});

test("NOTEHEAD_GLYPHS: every entry the resolver can produce has a distinct, sensible shape (no accidental collisions)", () => {
  // Every notehead type used by DEFAULT_STAFF_LAYOUT resolves via the glyph table.
  for (const voice of VOICES) {
    const notehead = DEFAULT_STAFF_LAYOUT[voice].notehead;
    assert.ok(NOTEHEAD_GLYPHS[notehead], `${voice}'s notehead type "${notehead}" is not in NOTEHEAD_GLYPHS`);
  }
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

test("normaliseStaffLayout: a stale inc-4 layout saved BEFORE crash2/rideBell existed backfills both new voices with sensible defaults (real IndexedDB upgrade path)", () => {
  // Simulates exactly what a returning user's IndexedDB `staffLayout` record
  // looks like post-upgrade: the original 10 inc-4 voices present and valid,
  // crash2/rideBell simply absent (never serialized, not "invalid" — the
  // keys don't exist at all). If normaliseStaffLayout didn't backfill these,
  // every VOICES-driven renderer (groove view, editor, Test staff) would hit
  // a null layout entry for the two new voices and either throw or silently
  // fail to render them.
  const staleInc4Layout = {
    kick: { key: "f/4", notehead: "normal" },
    snare: { key: "c/5", notehead: "normal" },
    hihatClosed: { key: "g/5", notehead: "x" },
    hihatOpen: { key: "a/5", notehead: "open" },
    hihatPedal: { key: "d/4", notehead: "x" },
    tom1: { key: "e/5", notehead: "normal" },
    tom2: { key: "a/4", notehead: "normal" },
    floorTom: { key: "f/3", notehead: "normal" },
    crash: { key: "b/5", notehead: "x" },
    ride: { key: "c/6", notehead: "x" },
    // crash2, rideBell: absent — this is the pre-increment-5 shape.
  };
  assert.equal(Object.keys(staleInc4Layout).length, 10, "sanity: this fixture really is the old 10-voice shape");

  const n = normaliseStaffLayout(staleInc4Layout);

  // All 12 voices present, nothing dropped.
  assert.equal(Object.keys(n).length, VOICES.length);
  for (const voice of VOICES) assert.ok(n[voice], `${voice} missing after normalising a stale layout`);

  // The two new voices backfill to their shipped defaults, not undefined/null.
  assert.deepEqual(n.crash2, DEFAULT_STAFF_LAYOUT.crash2);
  assert.deepEqual(n.rideBell, DEFAULT_STAFF_LAYOUT.rideBell);
  assert.ok(resolveNotehead(n, "crash2"), "crash2 resolves to a real staff key after backfill");
  assert.ok(resolveNotehead(n, "rideBell"), "rideBell resolves to a real staff key after backfill");

  // The pre-existing 10 voices are preserved untouched (upgrade doesn't
  // clobber a user's existing customisations to the old voices).
  assert.deepEqual(n.kick, staleInc4Layout.kick);
  assert.deepEqual(n.ride, staleInc4Layout.ride);
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
