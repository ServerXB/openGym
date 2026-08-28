import { isBodyweightEq } from './exercises.js'

// Exercise load is deliberately a derived domain value rather than another persisted field.
// Existing routine JSON already contains everything needed to distinguish the three cases:
// the bodyweight flag (explicit or inherited from the catalogue) and a positive starting load.
// Keeping the resolver here prevents UI, progression and history readers from each inventing
// subtly different rules for a weighted dip or an unloaded push-up.
export const LOAD_MODE = Object.freeze({
  EXTERNAL: 'external',
  PURE_BODYWEIGHT: 'pure_bodyweight',
  ADDED_BODYWEIGHT: 'added_bodyweight'
})

const positiveLoad = value => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

export const isBodyweightConfig = config =>
  config?.bodyweight != null ? !!config.bodyweight : isBodyweightEq(config?.id)

export function exerciseLoadMode(config = {}) {
  if (!isBodyweightConfig(config)) return LOAD_MODE.EXTERNAL
  return positiveLoad(config.weight)
    ? LOAD_MODE.ADDED_BODYWEIGHT
    : LOAD_MODE.PURE_BODYWEIGHT
}

export const isPureBodyweight = config =>
  exerciseLoadMode(config) === LOAD_MODE.PURE_BODYWEIGHT

export const hasAddedBodyweightLoad = config =>
  exerciseLoadMode(config) === LOAD_MODE.ADDED_BODYWEIGHT

/**
 * Resolve the load mode frozen into a workout entry.
 *
 * Modern entries own a target snapshot with an explicit weight (including zero); it is
 * authoritative even when a malformed set contains another load. Early snapshots without that
 * field, and pre-snapshot entries, may use a positive completed set as conservative evidence of
 * added load. Later catalogue/config edits therefore never reinterpret complete modern data.
 */
export function workoutEntryLoadMode(entry = {}) {
  if (entry?.target && typeof entry.target === 'object') {
    const target = { ...entry.target, id: entry.id }
    if (!isBodyweightConfig(target)) return LOAD_MODE.EXTERNAL
    // New snapshots always materialize `weight`, including zero, and therefore own the mode.
    // Early target snapshots did not always carry it: only there may completed rows supply the
    // missing evidence, preserving a real legacy belt load without reclassifying modern data.
    if (Object.prototype.hasOwnProperty.call(entry.target, 'weight')) {
      return positiveLoad(entry.target.weight)
        ? LOAD_MODE.ADDED_BODYWEIGHT
        : LOAD_MODE.PURE_BODYWEIGHT
    }
    const legacyTargetLoad = (entry.sets || []).some(set => !!set?.done && positiveLoad(set.w))
    return legacyTargetLoad
      ? LOAD_MODE.ADDED_BODYWEIGHT
      : LOAD_MODE.PURE_BODYWEIGHT
  }

  const legacy = { ...entry, id: entry?.id }
  if (!isBodyweightConfig(legacy)) return LOAD_MODE.EXTERNAL
  const loggedAddedLoad = positiveLoad(legacy.weight) || (entry?.sets || []).some(set =>
    !!set?.done && positiveLoad(set.w)
  )
  return loggedAddedLoad
    ? LOAD_MODE.ADDED_BODYWEIGHT
    : LOAD_MODE.PURE_BODYWEIGHT
}

export const entryMatchesExerciseLoadMode = (entry, config) =>
  workoutEntryLoadMode(entry) === exerciseLoadMode(config)

// Short domain alias used by progression/history readers.
export const entryMatchesLoadMode = entryMatchesExerciseLoadMode
