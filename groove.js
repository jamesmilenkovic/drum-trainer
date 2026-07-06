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
//
// Sections (increment 6): an ordered list of named, contiguous, non-
// overlapping bar ranges (`{ name, startBar, endBar, repeats }`) — see
// "Sections" further down. They're part of THIS model (not a parallel
// structure) so they serialise/round-trip with the rest of the groove and a
// future MusicXML import (rehearsal marks + repeats) can map onto them the
// same way fromDrumPart() maps notes. expandArrangement()/expandSection()
// (also below) turn sections + repeats into the flat bar sequence the
// transport (and, from increment 7, scoring) actually plays through.
// =============================================================================

import { VOICES } from "./mapping.js";
import { SUBDIVISIONS } from "./testarea.js";

// ---- Defaults ----

export const DEFAULT_TIME_SIGNATURE = Object.freeze({ beatsPerBar: 4, beatValue: 4 });
export const DEFAULT_SUBDIVISION = "eighth";
export const DEFAULT_BARS = 1;

export const MIN_BARS = 1;
// SPEC.md increment 6, section A: "chunking implies longer charts" — raised
// from the increment-4 cap of 2 bars to 32, so a chart can be split into
// named sections (intro/groove/fill/...) with room to spare. 32 was picked
// as SPEC.md's explicit target ("at least 16, target 32").
export const MAX_BARS = 32;

// A section's repeat count is bounded 1-99 (SPEC.md increment 6, section A):
// 1 = play it once, up to 99 = a generous ceiling for "drill this ×N" without
// allowing a nonsensical/runaway value in from a corrupt save file.
export const MIN_SECTION_REPEATS = 1;
export const MAX_SECTION_REPEATS = 99;

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
    sections: [], // SPEC.md increment 6, section A — see "Sections" below.
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

// ---- Sections (SPEC.md increment 6, section A) ----
//
// An ordered list of named, CONTIGUOUS, NON-OVERLAPPING bar ranges over the
// groove: { name, startBar, endBar, repeats }. startBar/endBar are 0-based,
// inclusive, in-bounds ([0, groove.bars - 1]), and endBar >= startBar.
// repeats is an integer in [MIN_SECTION_REPEATS, MAX_SECTION_REPEATS].
// Sections may cover all, some, or none of the chart — bars not covered by
// any section simply aren't part of the arrangement (see
// expandArrangement() below). This is a PO call (SPEC.md): sections are
// ranges over ONE chart, not separate grooves stitched together.
//
// Order in the array does not itself imply playback order — sections are
// sorted by startBar wherever playback order matters (expandArrangement()),
// so the strip UI can list them in whatever order the user added them
// without silently reordering playback underneath them.

function isValidSectionShape(section) {
  return (
    !!section &&
    typeof section.name === "string" &&
    Number.isInteger(section.startBar) &&
    Number.isInteger(section.endBar) &&
    section.endBar >= section.startBar &&
    Number.isInteger(section.repeats) &&
    section.repeats >= MIN_SECTION_REPEATS &&
    section.repeats <= MAX_SECTION_REPEATS
  );
}

function isInBounds(section, bars) {
  return section.startBar >= 0 && section.endBar < bars;
}

// Do two bar ranges [aStart,aEnd] / [bStart,bEnd] overlap (inclusive)?
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function overlapsAny(section, sections, ignoreIndex = -1) {
  return sections.some(
    (other, i) => i !== ignoreIndex && rangesOverlap(section.startBar, section.endBar, other.startBar, other.endBar)
  );
}

// Full validity check for a candidate section against a groove: valid shape,
// in-bounds for the groove's current bar count, and non-overlapping with the
// groove's OTHER existing sections (ignoreIndex excludes the section being
// edited, if any, from the overlap check against itself).
function isValidSection(groove, section, ignoreIndex = -1) {
  return (
    isValidSectionShape(section) &&
    isInBounds(section, groove.bars) &&
    !overlapsAny(section, groove.sections, ignoreIndex)
  );
}

// Add a new section. Fails closed (returns the groove unchanged) if the
// section is malformed, out of bounds, or overlaps an existing section —
// mirroring addNote()'s "editor action always does something sensible, or
// nothing" contract. Name is trimmed; an empty/whitespace-only name is
// rejected (a section strip row needs SOME label).
export function addSection(groove, { name, startBar, endBar, repeats = 1 } = {}) {
  const candidate = { name: typeof name === "string" ? name.trim() : "", startBar, endBar, repeats };
  if (!candidate.name) return groove;
  if (!isValidSection(groove, candidate)) return groove;
  return { ...groove, sections: [...groove.sections, candidate] };
}

// Replace the section at `index` with new field values (only the fields
// passed are changed; omitted fields keep their current value). Fails
// closed (no-op) if `index` doesn't exist or the resulting section would be
// invalid (bad shape, out of bounds, or overlapping ANOTHER section — the
// section being edited is excluded from its own overlap check).
export function updateSection(groove, index, changes = {}) {
  const existing = groove.sections[index];
  if (!existing) return groove;
  const name = changes.name !== undefined ? (typeof changes.name === "string" ? changes.name.trim() : "") : existing.name;
  const candidate = {
    name,
    startBar: changes.startBar !== undefined ? changes.startBar : existing.startBar,
    endBar: changes.endBar !== undefined ? changes.endBar : existing.endBar,
    repeats: changes.repeats !== undefined ? changes.repeats : existing.repeats,
  };
  if (!candidate.name) return groove;
  if (!isValidSection(groove, candidate, index)) return groove;
  const sections = groove.sections.slice();
  sections[index] = candidate;
  return { ...groove, sections };
}

// Remove the section at `index`. Out-of-range index is a no-op.
export function removeSection(groove, index) {
  if (!groove.sections[index]) return groove;
  return { ...groove, sections: groove.sections.filter((_, i) => i !== index) };
}

// ---- Timeline expansion (SPEC.md increment 6, section D / AC5) ----
//
// Pure, headless-testable: sections + repeats -> a flat sequence of bar
// entries, in PLAYBACK order (sections sorted by startBar; each section's
// bar range repeated `repeats` times, back to back). This is exactly what
// inc 7's scoring will walk bar-by-bar against, and what this increment's
// drill/sequence transport controls consume for "which bar/section/repeat
// are we on right now" bookkeeping — see index.html's transport wiring.
//
// No sections defined: SPEC.md AC8 "no-section playback is identical to
// today (whole groove loops)" — the pure expansion itself returns ONE pass
// over every bar of the groove (sectionIndex/sectionName null, repeat 1 of
// 1); it's the CALLER's job to loop that single-pass array indefinitely,
// exactly as the transport already loops its one hard-coded bar today. This
// keeps the pure function itself finite/testable regardless of mode.
//
// Partial coverage: bars not inside any section are simply absent from the
// output — SPEC.md's "uncovered bars just aren't in the arrangement".
function repeatRange(startBar, endBar, times, entry) {
  const out = [];
  for (let repeat = 1; repeat <= times; repeat++) {
    for (let bar = startBar; bar <= endBar; bar++) {
      out.push({ ...entry, bar, repeat, repeats: times });
    }
  }
  return out;
}

export function expandArrangement(groove) {
  const sections = Array.isArray(groove.sections) ? groove.sections : [];
  if (sections.length === 0) {
    return repeatRange(0, groove.bars - 1, 1, { sectionIndex: null, sectionName: null });
  }
  // Sort by startBar so playback follows the chart left-to-right regardless
  // of the order sections were added/edited in.
  const ordered = sections
    .map((section, sectionIndex) => ({ section, sectionIndex }))
    .sort((a, b) => a.section.startBar - b.section.startBar);

  let out = [];
  for (const { section, sectionIndex } of ordered) {
    out = out.concat(
      repeatRange(section.startBar, section.endBar, section.repeats, {
        sectionIndex,
        sectionName: section.name,
      })
    );
  }
  return out;
}

// Drill-mode expansion (SPEC.md increment 6, section C / PO call): drill's
// x N / infinity repeat count is a PLAYBACK CONTROL chosen fresh each drill
// session, independent of the section's own stored `repeats` (which is used
// by expandArrangement()/sequence mode instead). Expands ONE section's bar
// range, repeated `times` times (caller handles "infinite" by re-requesting
// this — or just looping the returned array — since this function is pure
// and always returns a finite array).
export function expandSection(groove, sectionIndex, times = 1) {
  const section = groove.sections?.[sectionIndex];
  if (!section) return [];
  const repeatCount = Math.max(MIN_SECTION_REPEATS, Math.round(Number(times)) || MIN_SECTION_REPEATS);
  return repeatRange(section.startBar, section.endBar, repeatCount, {
    sectionIndex,
    sectionName: section.name,
  });
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
  return {
    ...next,
    notes: next.notes.filter((n) => n.position < totalSteps(next)),
    // A shrunk bar count can strand a section whose range no longer fits
    // (SPEC.md increment 6) — dropped deterministically rather than left
    // pointing past the end of the chart, same "drop, don't corrupt" stance
    // as the notes filter above.
    sections: next.sections.filter((s) => isInBounds(s, next.bars)),
  };
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
    sections: groove.sections.map((s) => ({ ...s })),
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
// - sections is filtered the same way (SPEC.md increment 6): a malformed
//   entry (bad shape, out of bounds for the now-resolved bar count) is
//   dropped. Entries are walked IN ARRAY ORDER and each is validated against
//   the sections already kept so far — an entry that overlaps an
//   earlier-kept one is dropped too, so the result is always a valid,
//   non-overlapping set. This is deterministic (first-in-array wins any
//   overlap) rather than arbitrary, matching the "reject/normalise rather
//   than silently corrupt" stance used everywhere else in this function.
export function deserialize(data) {
  const timeSignature = isValidTimeSignature(data?.timeSignature)
    ? { beatsPerBar: data.timeSignature.beatsPerBar, beatValue: data.timeSignature.beatValue }
    : { ...DEFAULT_TIME_SIGNATURE };
  const bars = normaliseBars(data?.bars);
  const subdivision = isValidSubdivision(data?.subdivision) ? data.subdivision : DEFAULT_SUBDIVISION;

  let groove = { timeSignature, bars, subdivision, notes: [], sections: [] };
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

  const rawSections = Array.isArray(data?.sections) ? data.sections : [];
  for (const raw of rawSections) {
    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
    const candidate = { name: raw.name.trim(), startBar: raw.startBar, endBar: raw.endBar, repeats: raw.repeats };
    if (!isValidSection(groove, candidate)) continue;
    groove = { ...groove, sections: [...groove.sections, candidate] };
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
