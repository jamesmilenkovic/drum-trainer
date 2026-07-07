"use strict";

// =============================================================================
// routine.js
//
// The routine data model (SPEC.md increment 7, section B). A routine is a
// name + an ORDERED list of items, each item = { grooveId, repeats, bpm }.
// A routine references library grooves BY ID (SPEC.md's explicit "notes for
// the coder": do NOT deep-copy a groove into the routine — editing a saved
// groove should update every routine that references it, and this file's
// expandRoutine() always resolves grooveId against whatever groove the
// caller currently has in the library at expansion time).
//
// Zero DOM, zero IndexedDB, zero AudioContext — data in, result out — so
// this is unit-testable headless with `node --test`, exactly like groove.js.
// Composes groove.js's own expandArrangement() rather than forking it (SPEC.md:
// "extend the inc-6 expansion... rather than forking it") — a routine's
// timeline is simply each item's OWN groove-internal arrangement (sections +
// their repeats, already handled by groove.js), repeated `item.repeats`
// times, tagged with which item/repeat/tempo it belongs to.
// =============================================================================

import { expandArrangement } from "./groove.js";

// ---- Bounds ----
//
// Repeats: same 1-99 range as a groove's own section repeats (groove.js's
// MIN_SECTION_REPEATS/MAX_SECTION_REPEATS) — reused here as the same "1 =
// once, 99 = a generous ceiling" reasoning, applied to a routine ITEM's
// repeat count instead of a section's.
export const MIN_ITEM_REPEATS = 1;
export const MAX_ITEM_REPEATS = 99;

// BPM bounds match PracticeEngine/TestEngine's own BPM_MIN/BPM_MAX
// (index.html) — kept as plain constants here since this module must stay
// zero-DOM/zero-engine-import; index.html's engine classes are the actual
// enforcement point for playback, this is just the model-level validation.
export const MIN_ITEM_BPM = 30;
export const MAX_ITEM_BPM = 300;

// ---- Validation helpers ----

function isValidRepeats(repeats) {
  return Number.isInteger(repeats) && repeats >= MIN_ITEM_REPEATS && repeats <= MAX_ITEM_REPEATS;
}

function isValidBpm(bpm) {
  return Number.isInteger(bpm) && bpm >= MIN_ITEM_BPM && bpm <= MAX_ITEM_BPM;
}

function isValidItemShape(item) {
  return !!item && typeof item.grooveId === "string" && item.grooveId.length > 0 && isValidRepeats(item.repeats) && isValidBpm(item.bpm);
}

// ---- Factory ----

export function createRoutine({ name = "" } = {}) {
  return { name: typeof name === "string" ? name.trim() : "", items: [] };
}

// ---- Item add / remove / update / reorder (immutable — each returns a NEW routine) ----
//
// Same "fail closed" contract as groove.js's addNote/addSection: malformed
// input is a no-op (returns the routine unchanged) rather than throwing, so
// a UI action always does something sensible or nothing.

export function addItem(routine, { grooveId, repeats = 1, bpm = 100 } = {}) {
  const candidate = { grooveId, repeats, bpm };
  if (!isValidItemShape(candidate)) return routine;
  return { ...routine, items: [...routine.items, candidate] };
}

export function removeItem(routine, index) {
  if (!routine.items[index]) return routine;
  return { ...routine, items: routine.items.filter((_, i) => i !== index) };
}

// Replace the item at `index` with new field values (only the fields passed
// are changed; omitted fields keep their current value). Fails closed
// (no-op) if `index` doesn't exist or the resulting item would be invalid.
export function updateItem(routine, index, changes = {}) {
  const existing = routine.items[index];
  if (!existing) return routine;
  const candidate = {
    grooveId: changes.grooveId !== undefined ? changes.grooveId : existing.grooveId,
    repeats: changes.repeats !== undefined ? changes.repeats : existing.repeats,
    bpm: changes.bpm !== undefined ? changes.bpm : existing.bpm,
  };
  if (!isValidItemShape(candidate)) return routine;
  const items = routine.items.slice();
  items[index] = candidate;
  return { ...routine, items };
}

// Move the item at `index` one slot earlier/later in playback order (SPEC.md
// PO call: "up/down is fine, no drag needed"). No-op at either end of the
// list or for an out-of-range index.
export function moveItemUp(routine, index) {
  if (index <= 0 || index >= routine.items.length) return routine;
  const items = routine.items.slice();
  [items[index - 1], items[index]] = [items[index], items[index - 1]];
  return { ...routine, items };
}

export function moveItemDown(routine, index) {
  if (index < 0 || index >= routine.items.length - 1) return routine;
  const items = routine.items.slice();
  [items[index], items[index + 1]] = [items[index + 1], items[index]];
  return { ...routine, items };
}

export function setName(routine, name) {
  return { ...routine, name: typeof name === "string" ? name.trim() : routine.name };
}

// ---- Serialize / deserialize ----

export function serialize(routine) {
  return {
    name: routine.name,
    items: routine.items.map((item) => ({ ...item })),
  };
}

// Malformed items are dropped (same "reject rather than corrupt" stance as
// groove.js's deserialize) rather than kept invalid.
export function deserialize(data) {
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = [];
  for (const raw of rawItems) {
    const candidate = { grooveId: raw?.grooveId, repeats: raw?.repeats, bpm: raw?.bpm };
    if (!isValidItemShape(candidate)) continue;
    items.push(candidate);
  }
  return { name, items };
}

// ---- Timeline expansion (SPEC.md increment 7, section B / AC5) ----
//
// The extended pure timeline expansion: items x repeats x their grooves ->
// a flat, timed bar sequence, now carrying (bar, tempo, item-context) per
// entry. Pure and headless-testable — inc 8's scoring consumes exactly this
// structure (SPEC.md's own note).
//
// grooveById: a plain object OR Map of { [grooveId]: { name, groove } } —
// the library's current contents at expansion time (library ENTRY shape,
// not a bare groove.js instance, so this can read the groove's saved name
// for the live indicator). NOT copied into the routine itself, so editing a
// library groove changes what a routine expands to the next time it's
// played, per SPEC.md's "reference by id, do not deep-copy" instruction.
//
// Each entry carries:
//   - Everything groove.js's own expandArrangement() already returns for
//     that bar (bar, sectionIndex, sectionName, repeat, repeats) — repeat/
//     repeats here are the GROOVE's OWN internal section-repeat count,
//     unchanged in meaning from increment 6.
//   - itemIndex: which routine item (0-based) this bar belongs to.
//   - itemRepeat / itemRepeats: 1-based "this item's Nth pass of Mtotal" —
//     the ITEM's own repeat count (SPEC.md AC2's per-item repeats field),
//     deliberately a SEPARATE field from the groove-internal repeat/repeats
//     above so neither meaning is lost when a groove-with-sections is
//     itself repeated by its routine item.
//   - grooveId / grooveName / bpm: which groove is sounding and at what
//     tempo — the "item name, repeat n/N, BPM" live indicator (AC3) reads
//     straight off these fields, no separate lookup needed by the caller.
//
// An item whose grooveId isn't found in grooveById is skipped entirely
// (fails closed — same stance as groove.js/routine.js's other fail-closed
// validators — rather than throwing or producing a hole with bad data).
export function expandRoutine(routine, grooveById) {
  const lookup = (id) => (grooveById instanceof Map ? grooveById.get(id) : grooveById?.[id]);
  const out = [];
  const items = Array.isArray(routine?.items) ? routine.items : [];

  items.forEach((item, itemIndex) => {
    const libEntry = lookup(item.grooveId);
    if (!libEntry || !libEntry.groove) return; // referenced groove no longer in the library — skip, don't throw
    const grooveArrangement = expandArrangement(libEntry.groove);
    const itemRepeats = item.repeats;
    for (let itemRepeat = 1; itemRepeat <= itemRepeats; itemRepeat++) {
      for (const entry of grooveArrangement) {
        out.push({
          ...entry,
          itemIndex,
          itemRepeat,
          itemRepeats,
          grooveId: item.grooveId,
          grooveName: libEntry.name ?? null,
          bpm: item.bpm,
        });
      }
    }
  });

  return out;
}
