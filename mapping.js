"use strict";

// =============================================================================
// mapping.js
//
// Pure note-map logic. Zero DOM, zero Web MIDI references. Given a map of
// voice -> MIDI note number, this module can:
//   - supply the GM/EFNOTE 5 default map
//   - validate a map (duplicate notes mapped to two voices)
//   - classify an incoming MIDI note as mapped (to a voice) or unmapped
//
// Loadable both as a browser ES module (<script type="module">) and from a
// Node .mjs test via `import`.
// =============================================================================

// The 12 voices in this increment, in display order. SPEC.md increment 5
// adds crash2 + rideBell to the original inc-1 set of 10 (see stafflayout.js
// for their default staff positions/noteheads).
export const VOICES = [
  "kick",
  "snare",
  "hihatClosed",
  "hihatOpen",
  "hihatPedal",
  "tom1",
  "tom2",
  "floorTom",
  "crash",
  "crash2",
  "ride",
  "rideBell",
];

// Human-readable labels for the UI.
export const VOICE_LABELS = {
  kick: "Kick",
  snare: "Snare",
  hihatClosed: "Hi-Hat (Closed)",
  hihatOpen: "Hi-Hat (Open)",
  hihatPedal: "Hi-Hat Pedal",
  tom1: "Tom 1",
  tom2: "Tom 2",
  floorTom: "Floor Tom",
  crash: "Crash",
  crash2: "Crash 2",
  ride: "Ride",
  rideBell: "Ride Bell",
};

// GM / EFNOTE 5 default note numbers, per the spec. crash2 = 57, rideBell =
// 53 (SPEC.md increment 5, "standard GM percussion" — editable in the
// mapping panel either way).
export const GM_DEFAULT_MAP = Object.freeze({
  kick: 36,
  snare: 38,
  hihatClosed: 42,
  hihatOpen: 46,
  hihatPedal: 44,
  tom1: 48,
  tom2: 45,
  floorTom: 43,
  crash: 49,
  crash2: 57,
  ride: 51,
  rideBell: 53,
});

// Returns a fresh, independent copy of the GM default map.
export function getDefaultMap() {
  return { ...GM_DEFAULT_MAP };
}

// Given a map (voice -> note number), find voices that share the same note.
// Returns an array of groups: [{ note, voices: [voiceA, voiceB, ...] }, ...]
// Only notes mapped to 2+ voices are included. Voices with no note assigned
// (null/undefined) are ignored – they are not "duplicates".
export function findDuplicates(map) {
  const byNote = new Map();
  for (const voice of VOICES) {
    const note = map?.[voice];
    if (note === null || note === undefined) continue;
    if (!byNote.has(note)) byNote.set(note, []);
    byNote.get(note).push(voice);
  }
  const dupes = [];
  for (const [note, voices] of byNote) {
    if (voices.length > 1) dupes.push({ note, voices });
  }
  return dupes;
}

// Given a map and an incoming MIDI note number, return the voice it's
// assigned to, or null if the note is unmapped.
export function resolveVoice(map, noteNumber) {
  for (const voice of VOICES) {
    if (map?.[voice] === noteNumber) return voice;
  }
  return null;
}

// Classify an incoming Note-On against the map. Pure function – no DOM/MIDI.
// Returns { voice, unmapped } where unmapped === true iff voice === null.
export function classifyHit(map, noteNumber) {
  const voice = resolveVoice(map, noteNumber);
  return { voice, unmapped: voice === null };
}
