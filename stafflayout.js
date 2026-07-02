"use strict";

// =============================================================================
// stafflayout.js
//
// The staff-layout (notation display) map (SPEC.md increment 4, section A2;
// extended increment 5, sections A-C). Maps each voice in mapping.js's
// VOICES to where it sits on a percussion-clef staff: a VexFlow key string
// (line/space position) and a notehead type. This is the SINGLE SOURCE OF
// TRUTH for voice -> staff position AND for notehead glyph codes — the
// groove view, the staff editor, and the Test staff all read from the same
// map/resolver instead of each keeping their own copy.
//
// Inc 1 gave the INPUT map (MIDI note -> voice, mapping.js). This is the
// missing DISPLAY map (voice -> staff position + notehead) — james reported
// (2026-07-01) that without it, the inc-3 Test staff had no defined place
// for toms/crash/floor tom/ride to render, so they landed in the wrong spot.
//
// Increment 5 (2026-07-02, James's inc-4 feedback) extends the notehead
// model beyond normal/x to normal/x/open/diamond (+circled-x as a cheap
// optional extra), and adds two more voices (crash2, rideBell). See
// NOTEHEAD_GLYPHS below for the single glyph table.
//
// Pure module: zero DOM, zero Web MIDI, zero AudioContext references, so it
// can be unit-tested headless with `node --test`, exactly like mapping.js /
// scoring.js / testarea.js / teststaff.js. The settings-panel UI and
// IndexedDB persistence wiring for an EDITED layout live in index.html; this
// module only owns the default map + the pure lookup/validation helpers.
// =============================================================================

import { VOICES } from "./mapping.js";

// ---- Percussion-clef key-string convention ----
//
// Same 5-line percussion clef VexFlow renders elsewhere in this app
// (addClef("percussion")). Line/space naming follows standard treble-clef-
// staff key strings (VexFlow doesn't have distinct percussion-clef key
// names — it reuses the treble staff's line positions under the percussion
// clef glyph), lines bottom-to-top: F4, A4, C5, E5, G5; spaces bottom-to-top:
// G4, B4, D5, F5.
//
// Default = standard drum notation (coder's call per SPEC.md A2, documented
// here). EVERY voice gets its own distinct (key, notehead) ROW — no two
// voices share an exact key — because section B's staff editor places notes
// by CLICKING a row (AC2), and two voices sharing one row would make one of
// them permanently unreachable by click (whichever the hit-test tie-break
// doesn't prefer). SPEC.md's "distinguished sensibly (coder's readable
// call)" is applied here as "give each voice room of its own":
//   kick        -> "f/4"     bottom line — matches the EXISTING kick
//                             position from increment 2/3, kept unchanged
//                             per SPEC.md AC7.
//   snare       -> "c/5"     middle (3rd) line — matches the EXISTING snare
//                             position from increment 2/3, kept unchanged.
//   hihatClosed -> "g/5/x2"  x notehead, top space — matches the EXISTING
//                             hihatClosed position, kept unchanged.
//   hihatOpen   -> "a/5/x2"  x notehead, one step above closed hi-hat —
//                             open vs closed is traditionally an "o"/"+"
//                             articulation above the SAME notehead, but
//                             this app has no articulation-glyph layer, so
//                             open gets its own row directly above closed
//                             (keeps the two hi-hat voices visually
//                             adjacent while still each being clickable).
//   hihatPedal  -> "d/4/x2"  x notehead, bottom space — standard convention
//                             for hi-hat pedal (foot chick), one space below
//                             the kick's line.
//   tom1        -> "e/5"     high tom, line above snare — highest-pitched
//                             tom sits highest on the staff.
//   tom2        -> "a/4"     mid tom, space below snare — the standard
//                             2-tom convention (high tom above snare, mid
//                             tom below).
//   floorTom    -> "f/3"     ledger line below the staff — floor tom is the
//                             lowest-pitched drum voice, so "floor tom low"
//                             per SPEC.md puts it below the staff entirely,
//                             clearly separate from the kick/hihatPedal
//                             rows just above it.
//   crash       -> "b/5/x2"  x notehead, above the top line.
//   ride        -> "c/6/x2"  x notehead, one step above crash — the two
//                             cymbals sit next to each other above the
//                             staff (conventional "cymbals live above the
//                             staff" territory) but each keeps its own row.
//
// Increment 5 additions (SPEC.md section C — new voices; reference
// "researched 2026-07-02, standard drum key" in SPEC.md's intro):
//   crash2      -> "d/6"     x notehead, one step above ride — a second
//                             crash cymbal conventionally sits with the
//                             other cymbals above the staff; its own row
//                             keeps it click-reachable (see the "one row per
//                             voice" note below).
//   rideBell    -> "e/6"     diamond notehead, one step above crash2 — per
//                             SPEC.md, ride bell is conventionally notated
//                             on the SAME line as ride (bell vs bow
//                             distinguished only by the diamond notehead).
//                             This increment keeps one-row-per-voice (see
//                             the note below), so rideBell gets the nearest
//                             free adjacent row above the other cymbals
//                             instead of literally sharing ride's "c/6" —
//                             still grouped with ride, still a diamond, just
//                             click-reachable on its own row.
//
// ---- One row per voice vs shared positions (SPEC.md's flagged PO call) ----
// SPEC.md floats sharing exact staff positions (open/closed hi-hat on one
// line, ride/ride-bell on one line) via a voice-picker so the editor places
// notes for whichever voice is currently selected, rather than inferring
// voice from the row clicked. This increment keeps the INC-4 APPROACH
// instead (one row per voice, coder's call per SPEC.md's explicit fallback
// option): editorhit.js's hitTest()/its round-trip tests, and this file's
// "no two voices share a key" invariant, are both built around distinct
// rows, and reworking them into a voice-picker + shared-row hit-test is a
// bigger change than this increment's noteheads-and-new-voices scope —
// flagged for the PO as a candidate for a later increment if James wants
// literal shared lines rather than adjacent rows.
//
// All of this is EDITABLE via the settings panel (SPEC.md A2) and persisted
// to IndexedDB — these are only the shipped defaults.
export const DEFAULT_STAFF_LAYOUT = Object.freeze({
  kick: Object.freeze({ key: "f/4", notehead: "normal" }),
  snare: Object.freeze({ key: "c/5", notehead: "normal" }),
  hihatClosed: Object.freeze({ key: "g/5", notehead: "x" }),
  hihatOpen: Object.freeze({ key: "a/5", notehead: "open" }),
  hihatPedal: Object.freeze({ key: "d/4", notehead: "x" }),
  tom1: Object.freeze({ key: "e/5", notehead: "normal" }),
  tom2: Object.freeze({ key: "a/4", notehead: "normal" }),
  floorTom: Object.freeze({ key: "f/3", notehead: "normal" }),
  crash: Object.freeze({ key: "b/5", notehead: "x" }),
  crash2: Object.freeze({ key: "d/6", notehead: "x" }),
  ride: Object.freeze({ key: "c/6", notehead: "x" }),
  rideBell: Object.freeze({ key: "e/6", notehead: "diamond" }),
});

// ---- Notehead glyph table (SPEC.md increment 5, section B) — the SINGLE
// SOURCE OF TRUTH for notehead glyph codes. Every caller that needs to know
// how a notehead type renders (the VexFlow key-string suffix for the Groove
// view's real StaveNotes, AND the hand-drawn-SVG "kind" the editor/Test
// staff use for their own overlay noteheads) reads it from here — nothing
// else in the app hard-codes a glyph suffix or shape.
//
// vexSuffix: appended to a plain key string (e.g. "c/5") to build the full
//   VexFlow key VexFlow's StaveNote understands. null = no suffix (VexFlow's
//   plain filled notehead). Codes are VexFlow's own notehead-code table
//   (Tables.codeNoteHead): x2 = filled X, d2 = filled diamond, x3 = filled
//   circle-X.
// drawKind: what the editor/Test staff's hand-drawn SVG overlay (index.html's
//   makeNoteheadEl) should draw for this notehead, since those two views
//   don't use VexFlow's tickable StaveNote rendering at all (see
//   editorhit.js's header comment) — "normal" (filled ellipse), "x" (crossed
//   strokes), or "diamond" (filled diamond). "open" reuses the "x" SVG shape
//   plus an extra small circle drawn above it (circleAbove: true) — there is
//   no single glyph for "open hi-hat" in VexFlow OR in the hand-drawn
//   overlay, per SPEC.md section B's explicit instruction to layer an "o"
//   above an x notehead instead.
// circleAbove: true only for "open" — tells both the VexFlow renderer (an
//   Annotation glyph above the StaveNote) and the SVG overlay (an extra
//   small ring) to draw the small "o" that distinguishes open from closed.
export const NOTEHEAD_GLYPHS = Object.freeze({
  normal: Object.freeze({ vexSuffix: null, drawKind: "normal", circleAbove: false }),
  x: Object.freeze({ vexSuffix: "/x2", drawKind: "x", circleAbove: false }),
  open: Object.freeze({ vexSuffix: "/x2", drawKind: "x", circleAbove: true }),
  diamond: Object.freeze({ vexSuffix: "/d2", drawKind: "diamond", circleAbove: false }),
  // Optional/nice-to-have per SPEC.md section B — cheap since VexFlow
  // already has a circle-X notehead code (x3) and the SVG overlay can draw
  // an x inside a ring the same way "open" draws one above.
  "circled-x": Object.freeze({ vexSuffix: "/x3", drawKind: "x", circleAbove: false, circleAround: true }),
});

// Ordered list of valid notehead type keys — drives the glyph dropdown in
// the settings panel (SPEC.md AC1's "glyph dropdown showing the actual
// shapes") and the validation guard below, so the UI never has to hard-code
// a second copy of "which noteheads exist".
export const NOTEHEAD_TYPES = Object.freeze(Object.keys(NOTEHEAD_GLYPHS));

// Build the full VexFlow key string (including any glyph suffix) for a
// voice's entry in a layout map.
function vexKeyFor(entry) {
  if (!entry) return null;
  const glyph = NOTEHEAD_GLYPHS[entry.notehead];
  if (!glyph) return null;
  return glyph.vexSuffix ? `${entry.key}${glyph.vexSuffix}` : entry.key;
}

// Returns a fresh, independent copy of the default staff layout (mirrors
// mapping.js's getDefaultMap() convention) so callers can freely mutate
// their own copy without touching the frozen default.
export function getDefaultStaffLayout() {
  const copy = {};
  for (const voice of VOICES) copy[voice] = { ...DEFAULT_STAFF_LAYOUT[voice] };
  return copy;
}

// Is `key` a plausible VexFlow line/space key string, e.g. "c/5", "f/4"?
// Deliberately permissive (letter a-g, slash, integer octave) rather than
// an exhaustive VexFlow-internals check — this is a UI-input sanity guard,
// not a VexFlow validator.
function isPlausibleKey(key) {
  return typeof key === "string" && /^[a-g]\/\d+$/.test(key);
}

function isValidNotehead(notehead) {
  return Object.prototype.hasOwnProperty.call(NOTEHEAD_GLYPHS, notehead);
}

// Given a notehead type, return its glyph metadata ({ vexSuffix, drawKind,
// circleAbove }), or null for an unknown type. The single lookup point for
// any caller (UI glyph dropdown, SVG overlay drawing) that needs to know how
// a notehead renders without duplicating the table above.
export function getNoteheadGlyph(notehead) {
  return NOTEHEAD_GLYPHS[notehead] ? { ...NOTEHEAD_GLYPHS[notehead] } : null;
}

// Validate a single voice's layout entry.
function isValidEntry(entry) {
  return !!entry && isPlausibleKey(entry.key) && isValidNotehead(entry.notehead);
}

// Given a layout map and a voice, return that voice's VexFlow key string
// (with its notehead's glyph suffix, if any, already applied — see
// NOTEHEAD_GLYPHS above) or null if the voice has no entry. Mirrors
// teststaff.js's original resolveNotehead(voice) call shape, but now takes
// the layout explicitly so an EDITED (not just default) layout can be
// resolved against — pass DEFAULT_STAFF_LAYOUT (or getDefaultStaffLayout())
// for the shipped defaults.
export function resolveNotehead(layout, voice) {
  return vexKeyFor(layout?.[voice]);
}

// Given a layout map and a voice, return its raw { key, notehead } entry
// (not the combined VexFlow key string) or null. Useful for the settings
// panel, which needs to edit key/notehead independently.
export function getEntry(layout, voice) {
  const entry = layout?.[voice];
  return entry ? { ...entry } : null;
}

// Validate/normalise a layout object (e.g. loaded from IndexedDB, which may
// be stale/partial/corrupt from a future format change). Any voice missing
// or with an invalid entry falls back to that voice's shipped default,
// exactly mirroring mapping.js's "reject/normalise rather than silently
// corrupt" stance for the note map. Unknown extra keys (not in VOICES) are
// dropped.
export function normaliseStaffLayout(layout) {
  const next = {};
  for (const voice of VOICES) {
    const candidate = layout?.[voice];
    next[voice] = isValidEntry(candidate) ? { ...candidate } : { ...DEFAULT_STAFF_LAYOUT[voice] };
  }
  return next;
}
