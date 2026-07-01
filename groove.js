"use strict";

// =============================================================================
// groove.js
//
// The shared groove data model (SPEC.md increment 4, section A). A single
// JSON-serialisable representation of a groove: time signature, bar count,
// subdivision resolution, and a set of notes (voice + position + optional
// accent). This is the SINGLE SOURCE for the staff editor, presets, and
// (from increment 6 on) scoring. Zero DOM, zero Web MIDI, zero AudioContext
// references — data in, result out — so it can be unit-tested headless with
// `node --test`, exactly like scoring.js / mapping.js / testarea.js.
//
// Import-friendly (increment 9): positions are expressed as an absolute
// integer subdivision-grid-step index over the WHOLE groove (bar 0 step 0 is
// position 0, bar 0's last step is stepsPerBar-1, bar 1 step 0 is
// stepsPerBar, etc). This is deliberately the same "grid step index" shape
// nearestGridLine()/resolveStaffPosition() already use elsewhere in the app,
// so a future PDF/MusicXML importer can take a drum part's notes — each
// roughly `{ voice, onset, duration }` in MusicXML terms — and quantise
// `onset` onto this same grid-step index to produce `{ voice, position,
// accent }` directly. See `fromDrumPart()` near the bottom of this file for
// the documented adapter shape (SPEC.md AC8's sanity check).
//
// Reuses (does NOT fork) SUBDIVISIONS from testarea.js for the
// subdivision -> steps-per-beat grid maths.
// =============================================================================

import { VOICES } from "./mapping.js";
import { SUBDIVISIONS } from "./testarea.js";

// ---- Defaults ----

export const DEFAULT_TIME_SIGNATURE = Object.freeze({ beatsPerBar: 4, beatValue: 4 });
export const DEFAULT_SUBDIVISION = "eighth";
export const DEFAULT_BARS = 1;

export const MIN_BARS = 1;
export const MAX_BARS = 2; // SPEC.md PO call: 1-2 bars this increment, multi-bar/sections deferred.

// ---- Grid maths (steps-per-bar / total steps) ----
//
// Deliberately thin wrappers around testarea.js's SUBDIVISIONS — this module
// must not fork or redefine the subdivision -> steps-per-beat grid maths
// that already lives there.

// Steps per beat for a given subdivision key ("quarter"/"eighth"/"sixteenth").
function stepsPerBeatFor(subdivision) {
  const stepsPerBeat = SUBDIVISIONS[subdivision];
  if (!Number.isFinite(stepsPerBeat) || stepsPerBeat <= 0) {
    throw new Error(`groove: unknown subdivision ${JSON.stringify(subdivision)}`);
  }
  return stepsPerBeat;
}

// Grid steps per bar for a groove's time signature + subdivision.
export function stepsPerBar(groove) {
  return stepsPerBeatFor(groove.subdivision) * groove.timeSignature.beatsPerBar;
}

// Total grid steps across every bar of the groove.
export function totalSteps(groove) {
  return stepsPerBar(groove) * groove.bars;
}

// ---- Validation helpers ----

function isValidVoice(voice) {
  return VOICES.includes(voice);
}

function isValidTimeSignature(ts) {
  return (
    ts &&
    Number.isInteger(ts.beatsPerBar) &&
    ts.beatsPerBar > 0 &&
    Number.isInteger(ts.beatValue) &&
    ts.beatValue > 0
  );
}

function isValidBars(bars) {
  return Number.isInteger(bars) && bars >= MIN_BARS && bars <= MAX_BARS;
}

function isValidSubdivision(subdivision) {
  return Object.prototype.hasOwnProperty.call(SUBDIVISIONS, subdivision);
}

// Clamp bars into the valid [MIN_BARS, MAX_BARS] range, defaulting to
// DEFAULT_BARS if not even a finite number.
function normaliseBars(bars) {
  if (!Number.isFinite(bars)) return DEFAULT_BARS;
  const rounded = Math.round(bars);
  return Math.min(MAX_BARS, Math.max(MIN_BARS, rounded));
}

// ---- Factory ----
//
// Build an empty groove: no notes, given (or default) time signature, bar
// count, and subdivision. Bar count is clamped into [MIN_BARS, MAX_BARS];
// an invalid time signature or subdivision falls back to the default rather
// than producing an unusable groove.
export function createGroove({
  timeSignature = DEFAULT_TIME_SIGNATURE,
  bars = DEFAULT_BARS,
  subdivision = DEFAULT_SUBDIVISION,
} = {}) {
  return {
    timeSignature: isValidTimeSignature(timeSignature) ? { ...timeSignature } : { ...DEFAULT_TIME_SIGNATURE },
    bars: normaliseBars(bars),
    subdivision: isValidSubdivision(subdivision) ? subdivision : DEFAULT_SUBDIVISION,
    notes: [],
  };
}

// ---- Note queries ----

// All notes at a given absolute grid-step position (0 or more matches — a
// position can hold several voices at once, e.g. kick+hihat together).
export function notesAtPosition(groove, position) {
  return groove.notes.filter((n) => n.position === position);
}

// Does a note already exist at this exact voice + position?
function hasNote(groove, voice, position) {
  return groove.notes.some((n) => n.voice === voice && n.position === position);
}

// ---- Add / remove / toggle (immutable — each returns a NEW groove) ----
//
// Idempotent per SPEC.md AC1: adding a note that already exists at that
// voice+position is a no-op (returns an equivalent groove, not a duplicate
// entry); removing one that isn't there is a no-op.
//
// Position must be a valid in-range integer grid step and voice must be one
// of mapping.js's VOICES, or the groove is returned unchanged — callers that
// need to know WHY a write was rejected should validate first; these
// transforms fail closed (no-op) rather than throwing, matching the
// "editor click always does something sensible" requirement.

export function addNote(groove, voice, position, accent = false) {
  if (!isValidVoice(voice)) return groove;
  if (!Number.isInteger(position) || position < 0 || position >= totalSteps(groove)) return groove;
  if (hasNote(groove, voice, position)) return groove;
  return {
    ...groove,
    notes: [...groove.notes, accent ? { voice, position, accent: true } : { voice, position }],
  };
}

export function removeNote(groove, voice, position) {
  if (!hasNote(groove, voice, position)) return groove;
  return {
    ...groove,
    notes: groove.notes.filter((n) => !(n.voice === voice && n.position === position)),
  };
}

// Toggle: add if absent, remove if present. This is what the editor's click
// handler calls directly.
export function toggleNote(groove, voice, position) {
  return hasNote(groove, voice, position) ? removeNote(groove, voice, position) : addNote(groove, voice, position);
}

// ---- Time signature / bars / subdivision setters ----
//
// SPEC.md AC3: changing any of these re-renders the stave and "the model
// stays valid across changes" — reducing bars or subdivision may make
// previously-valid note positions fall outside the new (smaller) grid.
// Those notes are dropped deterministically (kept if still in range,
// dropped if not) rather than left dangling or silently corrupting state.

export function setTimeSignature(groove, timeSignature) {
  if (!isValidTimeSignature(timeSignature)) return groove;
  const next = { ...groove, timeSignature: { ...timeSignature } };
  return { ...next, notes: next.notes.filter((n) => n.position < totalSteps(next)) };
}

export function setBars(groove, bars) {
  const next = { ...groove, bars: normaliseBars(bars) };
  return { ...next, notes: next.notes.filter((n) => n.position < totalSteps(next)) };
}

export function setSubdivision(groove, subdivision) {
  if (!isValidSubdivision(subdivision)) return groove;
  const next = { ...groove, subdivision };
  return { ...next, notes: next.notes.filter((n) => n.position < totalSteps(next)) };
}

// ---- Serialize / deserialize ----
//
// serialize() returns a plain JSON-ready object (safe for JSON.stringify).
// deserialize() is the reverse and the model's validation gate: malformed
// input (unknown voice, out-of-range position, bad time sig, bad
// bars/subdivision) is rejected/normalised deterministically rather than
// silently corrupting state — see the per-field checks below. Round-trip
// (serialize -> JSON.stringify -> JSON.parse -> deserialize) must be
// identical to the original groove per SPEC.md AC1.

export function serialize(groove) {
  return {
    timeSignature: { ...groove.timeSignature },
    bars: groove.bars,
    subdivision: groove.subdivision,
    notes: groove.notes.map((n) => ({ ...n })),
  };
}

// Deserialize a plain object (e.g. parsed JSON) into a valid groove.
// - Bad/missing timeSignature falls back to DEFAULT_TIME_SIGNATURE.
// - Bad/missing bars is clamped/defaulted via normaliseBars.
// - Bad/missing subdivision falls back to DEFAULT_SUBDIVISION.
// - notes is filtered: entries with an unknown voice, a non-integer or
//   out-of-range position, or a non-boolean-ish accent flag are dropped
//   rather than kept malformed. Duplicate (voice, position) pairs collapse
//   to one entry (same idempotency guarantee as addNote).
export function deserialize(data) {
  const timeSignature = isValidTimeSignature(data?.timeSignature)
    ? { beatsPerBar: data.timeSignature.beatsPerBar, beatValue: data.timeSignature.beatValue }
    : { ...DEFAULT_TIME_SIGNATURE };
  const bars = normaliseBars(data?.bars);
  const subdivision = isValidSubdivision(data?.subdivision) ? data.subdivision : DEFAULT_SUBDIVISION;

  let groove = { timeSignature, bars, subdivision, notes: [] };
  const limit = totalSteps(groove);

  const rawNotes = Array.isArray(data?.notes) ? data.notes : [];
  for (const raw of rawNotes) {
    if (!raw || !isValidVoice(raw.voice)) continue;
    if (!Number.isInteger(raw.position) || raw.position < 0 || raw.position >= limit) continue;
    if (hasNote(groove, raw.voice, raw.position)) continue;
    const note = { voice: raw.voice, position: raw.position };
    if (raw.accent === true) note.accent = true;
    groove = { ...groove, notes: [...groove.notes, note] };
  }

  return groove;
}

// ---- MusicXML-style import adapter (SPEC.md AC8 sanity check) ----
//
// Documents and proves the shape a future increment-9 importer will use.
// A drum MusicXML part's notes each carry roughly { voice, onset, duration }
// (onset/duration in some musical time unit e.g. divisions-per-quarter).
// This adapter takes such a synthetic "part" plus the caller's already-
// chosen groove settings (time sig / bars / subdivision) and quantises each
// note's onset onto this groove's grid-step index, producing
// { voice, position, accent }. Duration is intentionally NOT part of the
// groove model yet (out of scope this increment) — only onset survives the
// mapping, per SPEC.md's "map cleanly onto { voice, position, accent }".
//
// stepsPerOnsetUnit: how many "onset units" make up one grid step for this
// part (e.g. if onset is in MusicXML divisions and there are 2 divisions
// per grid step, pass 2). Onsets are rounded to the nearest whole step.
export function fromDrumPart(part, { timeSignature, bars, subdivision, stepsPerOnsetUnit = 1 } = {}) {
  let groove = createGroove({ timeSignature, bars, subdivision });
  for (const entry of Array.isArray(part) ? part : []) {
    if (!entry || !isValidVoice(entry.voice)) continue;
    const onset = Number(entry.onset);
    if (!Number.isFinite(onset)) continue;
    const position = Math.round(onset / stepsPerOnsetUnit);
    groove = addNote(groove, entry.voice, position, entry.accent === true);
  }
  return groove;
}
