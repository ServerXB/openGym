import { describe, expect, it } from 'vitest'
import { confirmedRepRangeSession, nextPrescription } from './progression.js'
import { confirmedLoadProgressionKey, confirmedRepRangeLoadControl } from './confirmedRepRangeLoad.js'
import { buildScopedWorkoutEntry, completedWorkoutEntries } from './workout-scope.js'
import { applyWorkoutWeights } from './workout-records.js'
import { invalidateEntryReview } from './workout-set-status.js'
import { threeWayMerge } from './sync-merge.js'
import { parsePlan } from './plan-share.js'
import { targetForPrescription } from './workout-prescription.js'

const cfg = {
  id: 'stall-lift', progressionId: 'progression:stall', routineExerciseId: 'slot:stall',
  mode: 'reps', prog: 'confirmed_rep_range', sets: 4, minReps: 8, maxReps: 10,
  reps: 8, weight: 70, inc: 2, restSeconds: 120, maxRestSeconds: 180,
  restReductionStrategy: 'auto_after_successes'
}
const routine = { id: 'monday', name: 'Monday', ex: [cfg], prog: 'confirmed_rep_range' }
const state = () => ({
  unit: 'kg', restSec: 90, workouts: [], routines: [structuredClone(routine)],
  progressionControls: {}, progressionWeights: { [cfg.progressionId]: { w: 70 } },
  exWeights: { [cfg.id]: { w: 90 } }
})
const target = (extra = {}) => ({ ...cfg, targetReps: 10, reps: 10, rangeStep: 1,
  restBaseSeconds: 120, stallDetectionVersion: 1, ...extra })
const entry = (extra = {}) => ({ id: cfg.id, progressionId: cfg.progressionId,
  routineExerciseId: cfg.routineExerciseId, target: target(),
  sets: Array.from({ length: 4 }, () => ({ w: 70, r: 9, done: true })), ...extra })
function log(S, e) {
  const workout = { id: `w${S.workouts.length}`, d: '2026-09-30', routineId: routine.id,
    entries: completedWorkoutEntries([e]) }
  applyWorkoutWeights(S, workout.entries, workout.d)
  S.workouts.push(workout)
  return workout
}
function reset(S, overrides = {}) {
  S.progressionControls[cfg.progressionId] = {
    ...S.progressionControls[cfg.progressionId],
    confirmedRepRangeLoad: {
      epochId: 'load-1', baselineWeight: 64, resetAt: 1000, reason: 'stall',
      sourceWorkoutIds: S.workouts.map(w => w.id), progressionKey: confirmedLoadProgressionKey(cfg),
      loadMode: 'external', plannedSets: 4, ...overrides
    }
  }
}
function finishNew(S, { reps = 8, weights = 64, done = true, review } = {}) {
  const e = buildScopedWorkoutEntry(S, cfg, routine)
  e.sets = e.sets.map((set, i) => ({ ...set,
    w: Array.isArray(weights) ? weights[i] : weights,
    r: Array.isArray(reps) ? reps[i] : reps,
    done: Array.isArray(done) ? done[i] : done }))
  if (review) e.review = review
  log(S, e)
  return e
}

describe('Confirmed load epochs: future-only lifecycle and regression', () => {
  it('snapshots detection version only on newly built Confirmed entries, including inherited policy', () => {
    const S = state()
    const inherited = { ...cfg }; delete inherited.prog
    const e = buildScopedWorkoutEntry(S, inherited, routine)
    expect(e.target).toMatchObject({ prog: 'confirmed_rep_range', stallDetectionVersion: 1 })
    expect(e.target.loadEpochId).toBeUndefined()
    const linear = buildScopedWorkoutEntry(S, { ...cfg, prog: 'linear' }, routine)
    expect(linear.target.stallDetectionVersion).toBeUndefined()
  })

  it('acceptance boundary leaves active/history/PR/maps/rest untouched and starts future targets at min', () => {
    const S = state()
    log(S, entry({ target: target({ restSeconds: 180 }) }))
    S.active = { entries: [buildScopedWorkoutEntry(S, cfg, routine)] }
    const before = structuredClone(S)
    reset(S)
    expect(nextPrescription(S, cfg, routine)).toMatchObject({
      weight: 64, reps: 8, topRangeStreak: 0, loadEpochId: 'load-1',
      restSeconds: 180, loadResetPending: true
    })
    for (const key of ['active', 'workouts', 'exWeights', 'progressionWeights']) expect(S[key]).toEqual(before[key])
    expect(buildScopedWorkoutEntry(S, cfg, routine).sets.every(row => row.w === 64 && row.r === 8)).toBe(true)
  })

  it('starting and discarding repeatedly does not consume a pending baseline', () => {
    const S = state(); reset(S)
    for (let i = 0; i < 3; i++) {
      S.active = { entries: [buildScopedWorkoutEntry(S, cfg, routine)] }
      S.active = null
      expect(nextPrescription(S, cfg)).toMatchObject({ weight: 64, reps: 8, loadResetPending: true })
    }
    expect(S.progressionWeights[cfg.progressionId].w).toBe(70)
  })

  it.each([
    { done: [true, true, false, false], weights: 66 },
    { weights: [64, 64, 68, 64] },
    { done: false }
  ])('incomplete, mixed or skipped exposure does not consume reset: %j', options => {
    const S = state(); reset(S)
    finishNew(S, options)
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 64, reps: 8, loadResetPending: true })
    expect(S.progressionWeights[cfg.progressionId].w).toBe(70)
  })

  it('first complete uniform session adopts its load, then progresses within the new epoch only', () => {
    const S = state()
    log(S, entry({ sets: Array(4).fill({ w: 70, r: 10, done: true }) }))
    log(S, entry({ sets: Array(4).fill({ w: 70, r: 10, done: true }) }))
    reset(S)
    const first = finishNew(S)
    expect(first.target).toMatchObject({ weight: 64, targetReps: 8, loadEpochId: 'load-1' })
    expect(S.progressionWeights[cfg.progressionId].w).toBe(64)
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 64, reps: 9, topRangeStreak: 0 })
    expect(nextPrescription(S, cfg).loadResetPending).not.toBe(true)
    finishNew(S, { reps: 10 })
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 64, reps: 10, topRangeStreak: 1 })
    finishNew(S, { reps: 10 })
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 66, reps: 8, topRangeStreak: 0 })
    expect(S.exWeights[cfg.id].w).toBe(90)
  })

  it('a complete uniform manual load inside the epoch becomes the operational baseline', () => {
    const S = state(); reset(S)
    finishNew(S, { weights: 62 })
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 62, reps: 9 })
    expect(S.progressionWeights[cfg.progressionId].w).toBe(62)
  })

  it('old active/offline workouts arriving after acceptance cannot restore the old load or streak', () => {
    const S = state(); const old = entry()
    reset(S); finishNew(S)
    log(S, old)
    expect(S.progressionWeights[cfg.progressionId].w).toBe(64)
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 64, reps: 9, topRangeStreak: 0 })
    expect(S.workouts.at(-1).entries[0].sets[0].w).toBe(70)
  })

  it('a second reduction isolates both older epochs, including pending late completions', () => {
    const S = state(); reset(S); const first = finishNew(S)
    reset(S, { epochId: 'load-2', baselineWeight: 60 })
    log(S, first)
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 60, reps: 8, loadEpochId: 'load-2', loadResetPending: true })
    expect(S.progressionWeights[cfg.progressionId].w).toBe(64)
  })

  it('independent Monday/Thursday scopes remain separate while shared scope inherits the reset', () => {
    const S = state(); log(S, entry()); reset(S)
    const independent = { ...cfg, progressionId: 'progression:thursday', routineExerciseId: 'slot:thursday', weight: 30 }
    expect(nextPrescription(S, independent)).toMatchObject({ reps: 8 })
    expect(nextPrescription(S, independent).loadEpochId).toBeUndefined()
    const shared = { ...cfg, routineExerciseId: 'slot:shared' }
    expect(nextPrescription(S, shared)).toMatchObject({ weight: 64, loadEpochId: 'load-1' })
  })

  it('preserves the rest epoch and still gives recovery-first priority in the new load epoch', () => {
    const S = state()
    S.progressionControls[cfg.progressionId] = {
      confirmedRepRangeRest: { epochId: 'rest-1', resetSeconds: 180, resetAt: 900 }
    }
    reset(S)
    const restControl = structuredClone(S.progressionControls[cfg.progressionId].confirmedRepRangeRest)
    finishNew(S, { reps: 10 }); finishNew(S, { reps: 10 })
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 64, reps: 10, restSeconds: 180, restEpochId: 'rest-1', topRangeStreak: 0 })
    expect(S.progressionControls[cfg.progressionId].confirmedRepRangeRest).toEqual(restControl)
  })

  it.each([
    { epochId: '' }, { baselineWeight: -1 }, { baselineWeight: NaN }, { resetAt: -1 },
    { reason: 'automatic' }, { progressionKey: 'different' }, { loadMode: 'pure_bodyweight' }, { plannedSets: 5 }
  ])('rejects malformed or incompatible load controls %j', override => {
    const S = state(); reset(S, override)
    expect(confirmedRepRangeLoadControl(S, cfg)).toBeNull()
    expect(nextPrescription(S, cfg).loadEpochId).toBeUndefined()
  })

  it('a range or mode edit cannot resurrect the previous load epoch', () => {
    const S = state(); reset(S)
    expect(confirmedRepRangeLoadControl(S, { ...cfg, minReps: 6 })).toBeNull()
    expect(confirmedRepRangeLoadControl(S, { ...cfg, bodyweight: true, weight: 0 })).toBeNull()
  })

  it('survives JSON export/import without modifying workout history', () => {
    const S = state(); log(S, entry()); reset(S)
    const restored = JSON.parse(JSON.stringify(S))
    expect(nextPrescription(restored, cfg)).toEqual(nextPrescription(S, cfg))
    expect(restored.workouts).toEqual(S.workouts)
  })

  it('sync merges an accepted load epoch with unrelated settings changes', () => {
    const base = state(); const local = structuredClone(base); reset(local)
    const remote = { ...structuredClone(base), askBodyweightBeforeWorkout: false }
    const result = threeWayMerge({ base, local, remote })
    expect(result.conflicts).toEqual([])
    expect(result.state.askBodyweightBeforeWorkout).toBe(false)
    expect(nextPrescription(result.state, cfg)).toMatchObject({ weight: 64, loadEpochId: 'load-1' })
  })

  it('concurrent different reductions require an explicit sync conflict decision', () => {
    const base = state(); const local = structuredClone(base); const remote = structuredClone(base)
    reset(local, { epochId: 'phone', baselineWeight: 64 })
    reset(remote, { epochId: 'tablet', baselineWeight: 62 })
    expect(threeWayMerge({ base, local, remote }).clean).toBe(false)
  })

  it('a shared plan cannot import somebody else\'s runtime load epoch or detection activation', () => {
    const imported = parsePlan({ opengym_plan: 1, routines: [{ id: 'r', ex: [{
      ...cfg, loadEpochId: 'foreign-epoch', loadResetPending: true, stallDetectionVersion: 1
    }] }], customEx: [{ id: cfg.id, n: 'Test lift', bp: 'chest' }] })
    const config = imported.routines[0].ex[0]
    expect(config.loadEpochId).toBeUndefined()
    expect(config.loadResetPending).toBeUndefined()
    expect(config.stallDetectionVersion).toBeUndefined()
    expect(targetForPrescription({ ...cfg, loadEpochId: 'foreign', stallDetectionVersion: 1 },
      { policy: 'linear' }).loadEpochId).toBeUndefined()
  })
})

describe('technique review and immutable history', () => {
  it.each(['clean', 'unknown', undefined])('%s retains normal numerical progression', technique => {
    const S = state(); log(S, entry({ review: technique ? { technique } : undefined,
      sets: Array(4).fill({ w: 70, r: 10, done: true }) }))
    expect(nextPrescription(S, cfg)).toMatchObject({ topRangeStreak: 1 })
  })

  it.each([{ technique: 'degraded' }, { technique: 'clean', failureReason: 'technique' }])('compromised technique cannot validate reps or increase recovery: %j', review => {
    const S = state()
    const e = entry({ review, sets: Array(4).fill({ w: 70, r: 10, done: true }) })
    log(S, e); log(S, e)
    expect(confirmedRepRangeSession(e, cfg)).toMatchObject({ outcome: 'technique_failed', ok: false, topRangeSuccess: false })
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 70, reps: 10, topRangeStreak: 0, restSeconds: 120, restSuccessStreak: 0 })
  })

  it.each(['pain', 'illness', 'equipment', 'time'])('%s is an interruption, not an adaptive recovery miss', failureReason => {
    const S = state(); const e = entry({ review: { technique: 'unknown', failureReason },
      sets: [10, 8, 8, 8].map(r => ({ w: 70, r, done: true })) })
    log(S, e)
    expect(confirmedRepRangeSession(e, cfg)).toMatchObject({ outcome: 'interrupted', ok: false })
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 70, reps: 10, restSeconds: 120, topRangeStreak: 0 })
  })

  it('completion persists a separate review copy; set edits invalidate only the active review', () => {
    const active = entry({ review: { technique: 'clean', failureReason: null } })
    const [completed] = completedWorkoutEntries([active])
    expect(completed.review).toEqual(active.review)
    expect(completed.review).not.toBe(active.review)
    invalidateEntryReview(active, { optionalOnly: true })
    expect(active.review.technique).toBe('clean')
    invalidateEntryReview(active)
    expect(active.review).toBeUndefined()
    expect(completed.review.technique).toBe('clean')
  })
})
