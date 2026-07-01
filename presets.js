"use strict";

// =============================================================================
// presets.js
//
// Built-in groove presets (SPEC.md increment 4, section C). Each preset is
// built with groove.js's own createGroove()/addNote(), proving the point
// James raised: presets and the editor are the SAME underlying thing — a
// stored groove the app loads, in the shared model's shape. Loading a
// preset populates the editor and becomes the current practice groove; it's
// then freely editable (index.html wires that up — this module only builds
// the data).
//
// Pure module: zero DOM / zero Web MIDI / zero AudioContext, ESM, Node-
// testable exactly like groove.js itself. All positions are absolute
// grid-step indices (groove.js's convention) — every preset here is 1 bar
// of 4/4 at eighth-note resolution (8 steps/bar), matching the app's
// existing default groove's grid so they drop straight into the Groove view
// without a resolution mismatch.
// =============================================================================

import { createGroove, addNote } from "./groove.js";

const BASE = { timeSignature: { beatsPerBar: 4, beatValue: 4 }, bars: 1, subdivision: "eighth" };

// Small helper: build a 1-bar/4/4/eighth-note preset from a list of
// [position, voice] pairs, keeping each preset definition below readable as
// a plain list rather than a chain of addNote() calls.
function buildPreset(hits) {
  let g = createGroove(BASE);
  for (const [position, voice] of hits) {
    g = addNote(g, voice, position);
  }
  return g;
}

// ---- Basic rock beat ----
// Kick on 1 & 3, snare on 2 & 4, closed hi-hat on every 8th note — the same
// pattern as the app's original hard-coded GROOVE (increment 1-3), now
// expressed as a shared-model instance.
const basicRock = buildPreset([
  [0, "kick"], [0, "hihatClosed"],
  [1, "hihatClosed"],
  [2, "snare"], [2, "hihatClosed"],
  [3, "hihatClosed"],
  [4, "kick"], [4, "hihatClosed"],
  [5, "hihatClosed"],
  [6, "snare"], [6, "hihatClosed"],
  [7, "hihatClosed"],
]);

// ---- Basic funk beat ----
// Syncopated kick (1, the "and" of 2, the "and" of 3) against the same
// backbeat snare on 2 & 4, closed hi-hat on every 8th.
const basicFunk = buildPreset([
  [0, "kick"], [0, "hihatClosed"],
  [1, "hihatClosed"],
  [2, "snare"], [2, "hihatClosed"],
  [3, "kick"], [3, "hihatClosed"],
  [4, "hihatClosed"],
  [5, "kick"], [5, "hihatClosed"],
  [6, "snare"], [6, "hihatClosed"],
  [7, "hihatClosed"],
]);

// ---- Bossa nova (simplified) ----
// Classic 2-bar bossa clave condensed to fit this increment's 1-bar cap:
// kick on 1 & the "and" of 3, snare cross-stick feel approximated with the
// normal snare voice on the "and" of 2 and beat 4, ride carrying the pulse
// on every 8th note (closed hi-hat substituted for ride here since ride
// notation shares the app's existing cymbal conventions either way).
const bossaNova = buildPreset([
  [0, "kick"], [0, "ride"],
  [1, "ride"],
  [2, "ride"],
  [3, "snare"], [3, "ride"],
  [4, "ride"],
  [5, "kick"], [5, "ride"],
  [6, "snare"], [6, "ride"],
  [7, "ride"],
]);

// ---- Half-time shuffle-ish feel (kick/snare only, simple) ----
// A sparser groove: kick on 1, snare only on 3 (half-time backbeat), hi-hat
// on every 8th — useful as a slower-feeling contrast to basic rock.
const halfTime = buildPreset([
  [0, "kick"], [0, "hihatClosed"],
  [1, "hihatClosed"],
  [2, "hihatClosed"],
  [3, "hihatClosed"],
  [4, "snare"], [4, "hihatClosed"],
  [5, "hihatClosed"],
  [6, "hihatClosed"],
  [7, "hihatClosed"],
]);

// ---- Four-on-the-floor ----
// Kick on every beat (1,2,3,4), closed hi-hat on every 8th, snare/clap-style
// backbeat on 2 & 4 — common dance-music pattern, useful practice contrast
// to the rock/funk grooves above.
const fourOnTheFloor = buildPreset([
  [0, "kick"], [0, "hihatClosed"],
  [1, "hihatClosed"],
  [2, "kick"], [2, "snare"], [2, "hihatClosed"],
  [3, "hihatClosed"],
  [4, "kick"], [4, "hihatClosed"],
  [5, "hihatClosed"],
  [6, "kick"], [6, "snare"], [6, "hihatClosed"],
  [7, "hihatClosed"],
]);

// ---- Lesson pattern 1: kick/snare only (backbeat isolation) ----
// No hi-hat at all — isolates the kick-1/3, snare-2/4 backbeat so a
// beginner can lock in the two loudest voices before adding the hi-hat.
const lessonBackbeatOnly = buildPreset([
  [0, "kick"],
  [2, "snare"],
  [4, "kick"],
  [6, "snare"],
]);

// ---- Lesson pattern 2: single-voice 8th-note timing drill ----
// Closed hi-hat on every 8th note, nothing else — a pure subdivision-timing
// drill (matches what the Test area already measures, but notated as a
// groove so it can be practised in Groove mode's scored context too).
const lessonEighthNoteDrill = buildPreset([
  [0, "hihatClosed"], [1, "hihatClosed"], [2, "hihatClosed"], [3, "hihatClosed"],
  [4, "hihatClosed"], [5, "hihatClosed"], [6, "hihatClosed"], [7, "hihatClosed"],
]);

// Ordered list the presets panel renders, each { id, label, groove }.
export const PRESETS = [
  { id: "basicRock", label: "Basic Rock", groove: basicRock },
  { id: "basicFunk", label: "Basic Funk", groove: basicFunk },
  { id: "bossaNova", label: "Bossa Nova (simplified)", groove: bossaNova },
  { id: "halfTime", label: "Half-Time", groove: halfTime },
  { id: "fourOnTheFloor", label: "Four-on-the-Floor", groove: fourOnTheFloor },
  { id: "lessonBackbeatOnly", label: "Lesson: Backbeat Only", groove: lessonBackbeatOnly },
  { id: "lessonEighthNoteDrill", label: "Lesson: 8th-Note Drill", groove: lessonEighthNoteDrill },
];
