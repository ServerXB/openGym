import { bestWeightFor } from './history.js'
import { LOAD_MODE, workoutEntryLoadMode } from './exercise-load-mode.js'
import { is1RMRecordForEntries } from './onerm.js'
import { progressionIdOf, routineExerciseIdOf } from './progression-scope.js'

const nonEmptyId = value =>
  typeof value === 'string' && value.trim() ? value.trim() : null

// A set-count choice made during a workout opens a new progression group for that routine
// slot, while the active prescription deliberately keeps the group it started with. When the
// workout finishes, its uniform prescribed load is therefore evidence for two baselines:
//   - the original group, which owns the immutable active snapshot;
//   - the exact future branch that will prescribe the newly chosen set count.
//
// Do not generalize this to every mid-workout routine edit. `setBaselineId` is the explicit
// user command boundary, and the stable routine/slot pair makes the successor unambiguous even
// when the same exercise appears in several routines or twice in one routine.
function futureSetCountProgressionId(S, entry) {
  if (entry?.target?.prog !== 'confirmed_rep_range') return null
  const routineId = nonEmptyId(S?.active?.routineId)
  const slotId = routineExerciseIdOf(entry)
  if (!routineId || !slotId) return null

  const activeEntry = (S.active?.entries || []).find(candidate =>
    candidate?.id === entry.id
    && routineExerciseIdOf(candidate) === slotId
    && progressionIdOf(candidate) === progressionIdOf(entry)
  )
  if (!activeEntry) return null

  const routine = (S.routines || []).find(candidate => candidate?.id === routineId)
  const future = (routine?.ex || []).find(config =>
    config?.id === entry.id && routineExerciseIdOf(config) === slotId
  )
  if (!future) return null

  const activeBoundary = nonEmptyId(entry.target?.setBaselineId)
  const futureBoundary = nonEmptyId(future.setBaselineId)
  if (!futureBoundary || futureBoundary === activeBoundary) return null

  const activeProgressionId = progressionIdOf(entry)
  const futureProgressionId = progressionIdOf(future)
  return futureProgressionId && futureProgressionId !== activeProgressionId
    ? futureProgressionId
    : null
}

// Records are global exercise achievements. Independent progression slots with the same
// exercise id therefore contribute together and can produce at most one load PR (or one e1RM
// PR) in the workout summary.
export function recordsForWorkout(S, entries) {
  const byExercise = new Map()
  ;(entries || []).forEach(entry => {
    if (!entry?.id) return
    // A modern pure-bodyweight snapshot owns its zero-load semantics even if malformed rows
    // contain a stale positive `w`. Such a hidden value is neither a load PR nor e1RM evidence.
    if (workoutEntryLoadMode(entry) === LOAD_MODE.PURE_BODYWEIGHT) return
    const group = byExercise.get(entry.id) || []
    group.push(entry)
    byExercise.set(entry.id, group)
  })

  const prs = []
  const e1prs = []
  byExercise.forEach((exerciseEntries, id) => {
    const maxWeight = Math.max(0, ...exerciseEntries.flatMap(entry => (entry.sets || [])
      .filter(set => set.done)
      .map(set => Number(set.w) || 0)))
    const loadRecord = maxWeight > 0 && maxWeight > bestWeightFor(S, id)
    if (loadRecord) prs.push(id)

    // A load record takes precedence in the summary. The e1RM record still exists
    // mathematically, but showing both for the same exercise would describe one achievement
    // twice. This preserves the existing UX while making it deterministic for duplicates.
    const estimateRecord = is1RMRecordForEntries(S, id, exerciseEntries)
    if (estimateRecord && !loadRecord) e1prs.push({ id, ...estimateRecord })
  })

  return { prs, e1prs }
}

/**
 * Return the load that may become the next operational baseline for one workout entry.
 *
 * Confirmed Rep-Range is intentionally stricter than the global PR: only a complete,
 * uniform prescribed block proves a working load. Optional sets and the post-exercise
 * `topW` confirmation remain valid global achievements, but must not silently change the
 * load used by this progression group. Other policies retain the historical "highest done
 * set or confirmed top weight" behaviour.
 *
 * `null` means that the entry cannot update its scoped progression baseline.
 */
export function progressionWorkingWeight(entry) {
  if (workoutEntryLoadMode(entry) === LOAD_MODE.PURE_BODYWEIGHT) return null
  if (entry?.target?.prog !== 'confirmed_rep_range') {
    const working = Math.max(
      0,
      ...(entry?.sets || []).filter(set => set.done).map(set => Number(set.w) || 0),
      Number(entry?.topW) || 0
    )
    return working > 0 ? working : null
  }

  const planned = Number(entry.target.sets)
  if (!Number.isInteger(planned) || planned < 1) return null

  const prescribed = (entry.sets || []).slice(0, planned)
  if (prescribed.length !== planned || prescribed.some(set => !set?.done)) return null

  const weights = prescribed.map(set => Number(set.w))
  if (weights.some(weight => !Number.isFinite(weight) || weight < 0)) return null
  if (weights.some(weight => weight !== weights[0])) return null

  return weights[0] > 0 ? weights[0] : null
}

// The completion sheet may run before a workout is actually finished. Confirmed therefore
// stores only `topW` on the active snapshot and defers every persistent map update to
// applyWorkoutWeights(), where the final edited rows are available. Other policies keep their
// historical immediate tracking behavior.
export function applyActiveTopWeight(S, entry, weight, date) {
  const n = Number(weight)
  if (!entry || !Number.isFinite(n) || n < 0) return false
  if (workoutEntryLoadMode(entry) === LOAD_MODE.PURE_BODYWEIGHT) return false
  entry.topW = n
  if (entry.target?.prog === 'confirmed_rep_range') return true

  S.exWeights = S.exWeights || {}
  const current = S.exWeights[entry.id]
  S.exWeights[entry.id] = { w: Math.max(n, current?.w || 0), d: date }
  const progressionId = progressionIdOf(entry)
  const working = progressionWorkingWeight(entry)
  if (progressionId && working > 0) {
    S.progressionWeights = S.progressionWeights || {}
    S.progressionWeights[progressionId] = { w: working, d: date }
  }
  return true
}

// Global best and operational load have different meanings. The PR never decreases; the scoped
// value is the latest confirmed working load and may legitimately go down after a deload/manual
// correction. This prevents one routine's record from becoming another's prescription.
export function applyWorkoutWeights(S, entries, date) {
  S.exWeights = S.exWeights || {}
  S.progressionWeights = S.progressionWeights || {}
  ;(entries || []).forEach(entry => {
    if (workoutEntryLoadMode(entry) === LOAD_MODE.PURE_BODYWEIGHT) return
    // Global achievements include every completed set and the explicit top-weight confirmation,
    // including optional work after the prescription.
    const globalWorking = Math.max(
      0,
      ...(entry.sets || []).filter(set => set.done).map(set => Number(set.w) || 0),
      Number(entry.topW) || 0
    )
    if (globalWorking > 0) {
      const global = S.exWeights[entry.id]
      if (!global || globalWorking > global.w) S.exWeights[entry.id] = { w: globalWorking, d: date }
    }

    const working = progressionWorkingWeight(entry)
    if (!(working > 0)) return
    const progressionId = progressionIdOf(entry)
    if (progressionId) S.progressionWeights[progressionId] = { w: working, d: date }
    const futureProgressionId = futureSetCountProgressionId(S, entry)
    if (futureProgressionId) {
      S.progressionWeights[futureProgressionId] = { w: working, d: date }
    }
  })
}
