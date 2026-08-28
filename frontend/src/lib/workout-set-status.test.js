import { describe, expect, it } from 'vitest'
import { normalizeProgressionScopes, progressionScopeSnapshot } from './progression-scope.js'
import {
  applySetCountFromNextWorkout,
  entrySetStatus,
  futureSetCountPresentation,
  invalidateEntryReview,
  isOptionalSet,
  prescribedSetCount,
  unitPrescribedComplete,
  workoutSetStatus
} from './workout-set-status.js'

const entry = (sets, targetSets = 4) => ({
  target: { sets: targetSets, prog: 'confirmed_rep_range' }, sets
})
const done = { done: true }
const pending = { done: false }

describe('workout prescribed and optional set status', () => {
  it('classifies only rows beyond the frozen target as optional', () => {
    const exercise = entry([done, done, done, done, pending])

    expect(prescribedSetCount(exercise)).toBe(4)
    expect(isOptionalSet(exercise, 3)).toBe(false)
    expect(isOptionalSet(exercise, 4)).toBe(true)
    expect(entrySetStatus(exercise)).toMatchObject({
      prescribedTotal: 4,
      prescribedDone: 4,
      prescribedMissing: 0,
      optionalTotal: 1,
      optionalDone: 0,
      prescribedComplete: true
    })
  })

  it('keeps a removed prescribed row missing instead of shrinking the prescription', () => {
    expect(entrySetStatus(entry([done, done, done]))).toMatchObject({
      prescribedTotal: 4,
      prescribedPresent: 3,
      prescribedDone: 3,
      prescribedMissing: 1,
      prescribedUnchecked: 1,
      prescribedComplete: false
    })
  })

  it('ignores optional rows in workout progress and completion', () => {
    const active = {
      entries: [
        entry([done, done, done, done, pending]),
        entry([done, done], 2)
      ]
    }

    expect(workoutSetStatus(active)).toMatchObject({
      prescribedDone: 6,
      prescribedTotal: 6,
      optionalDone: 0,
      optionalTotal: 1,
      exercisesComplete: 2,
      allPrescribedComplete: true,
      anyLogged: true
    })
    expect(unitPrescribedComplete(active.entries, [0, 1])).toBe(true)
  })

  it('does not let a checked optional row hide an incomplete prescription', () => {
    const active = { entries: [entry([done, pending, done, done, done])] }

    expect(workoutSetStatus(active)).toMatchObject({
      prescribedDone: 3,
      prescribedTotal: 4,
      prescribedUnchecked: 1,
      optionalDone: 1,
      allPrescribedComplete: false
    })
  })

  it('treats existing rows as prescribed for legacy active entries without target.sets', () => {
    const legacy = { target: { reps: 8 }, sets: [done, pending] }

    expect(prescribedSetCount(legacy)).toBe(2)
    expect(entrySetStatus(legacy)).toMatchObject({
      prescribedTotal: 2,
      prescribedDone: 1,
      optionalTotal: 0,
      prescribedComplete: false
    })
  })

  it.each(['linear', 'double', 'greyskull', 'time'])('keeps every added row prescribed for %s', prog => {
    const exercise = { target: { prog, sets: 3 }, sets: [done, done, done, pending] }

    expect(prescribedSetCount(exercise)).toBe(4)
    expect(isOptionalSet(exercise, 3)).toBe(false)
    expect(entrySetStatus(exercise)).toMatchObject({
      prescribedTotal: 4, prescribedDone: 3, optionalTotal: 0, prescribedComplete: false
    })
  })

  it('invalidates stale weight confirmation metadata after an edit', () => {
    const exercise = { asked: true, topW: 82, plan: { kind: 'hold' } }

    invalidateEntryReview(exercise)

    expect(exercise).not.toHaveProperty('asked')
    expect(exercise).not.toHaveProperty('topW')
    expect(exercise.plan).toEqual({ kind: 'hold' })
  })

  it('preserves the complete confirmed review for changes limited to optional rows', () => {
    const exercise = {
      asked: true, topW: 82, target: { prog: 'confirmed_rep_range' }, plan: { kind: 'hold' }
    }

    invalidateEntryReview(exercise, { optionalOnly: true })

    expect(exercise.asked).toBe(true)
    expect(exercise.topW).toBe(82)
    expect(exercise.plan).toEqual({ kind: 'hold' })
  })

  it('cannot preserve stale review metadata outside Confirmed optional work', () => {
    const exercise = {
      asked: true, topW: 82, target: { prog: 'linear' }, plan: { kind: 'hold' }
    }

    invalidateEntryReview(exercise, { optionalOnly: true })

    expect(exercise).not.toHaveProperty('asked')
    expect(exercise).not.toHaveProperty('topW')
  })

  it('keeps an applied future count visible and lets the user replace it after reverting rows', () => {
    const activeEntry = {
      target: {
        prog: 'confirmed_rep_range', sets: 4, setBaselineId: 'active-boundary'
      },
      sets: [done, done, done, done, pending]
    }
    const futureConfig = { sets: 5, setBaselineId: 'future-boundary' }

    expect(futureSetCountPresentation(activeEntry, futureConfig)).toMatchObject({
      currentCount: 5,
      prescribedCount: 4,
      futureCount: 5,
      canApply: false,
      showFuture: true
    })

    // Removing the optional row restores the active snapshot, but it must not hide the already
    // persisted future choice: the user can explicitly replace five with four.
    activeEntry.sets.pop()
    expect(futureSetCountPresentation(activeEntry, futureConfig)).toMatchObject({
      currentCount: 4,
      prescribedCount: 4,
      futureCount: 5,
      changedInSession: false,
      futureBoundaryChanged: true,
      canApply: true,
      showFuture: true
    })

    // Applying the replacement removes the no-op CTA while retaining an explicit summary.
    futureConfig.sets = 4
    futureConfig.setBaselineId = 'replacement-boundary'
    expect(futureSetCountPresentation(activeEntry, futureConfig)).toMatchObject({
      currentCount: 4,
      futureCount: 4,
      futureBoundaryChanged: true,
      canApply: false,
      showFuture: true
    })
  })

  it('does not offer a set-count action for automatic bodyweight volume progression', () => {
    const activeEntry = {
      target: { prog: 'confirmed_rep_range', sets: 5 },
      sets: [done, done, done, done, pending]
    }

    expect(futureSetCountPresentation(activeEntry, { sets: 4 })).toMatchObject({
      currentCount: 5,
      prescribedCount: 5,
      changedInSession: false,
      canApply: false,
      showFuture: false
    })
  })

  it('applies a set-count change only to the exact routine slot and future workouts', () => {
    const activeEntry = {
      id: 'bench', routineExerciseId: 'slot-backoff',
      target: { sets: 4, prog: 'confirmed_rep_range' }, sets: [done, done, done, done, pending]
    }
    const state = {
      active: { routineId: 'day-a', entries: [activeEntry] },
      routines: [{ id: 'day-a', ex: [
        { id: 'bench', routineExerciseId: 'slot-heavy', sets: 3 },
        { id: 'bench', routineExerciseId: 'slot-backoff', sets: 4 }
      ] }]
    }

    expect(applySetCountFromNextWorkout(state, activeEntry, 5, 'sets-boundary-1')).toBe(true)
    expect(state.routines[0].ex.map(config => config.sets)).toEqual([3, 5])
    expect(state.routines[0].ex[1].setBaselineId).toBe('sets-boundary-1')
    expect(activeEntry.target.sets).toBe(4)
    expect(activeEntry.sets).toHaveLength(5)
  })

  it('refuses an ambiguous freestyle or legacy slot update', () => {
    expect(applySetCountFromNextWorkout({ active: { routineId: null } }, {
      id: 'bench', sets: [done, done]
    }, 2, 'sets-boundary-1')).toBe(false)
  })

  it('keeps the active snapshot immutable and forks only the future routine configuration', () => {
    const lift = () => ({
      id: 'bench', sets: 4, reps: 8, weight: 70, inc: 2,
      minReps: 8, maxReps: 10, prog: 'confirmed_rep_range'
    })
    const state = {
      routines: [{ id: 'a', ex: [lift()] }, { id: 'b', ex: [lift()] }],
      workouts: [], progressionWeights: {}, progressionControls: {}
    }
    normalizeProgressionScopes(state)
    const a = state.routines[0].ex[0]
    const b = state.routines[1].ex[0]
    expect(a.progressionId).toBe(b.progressionId)
    const oldProgressionId = a.progressionId
    state.active = {
      routineId: 'a',
      entries: [{
        id: 'bench', ...progressionScopeSnapshot(a),
        target: { ...a, sets: 4 },
        sets: Array.from({ length: 5 }, () => ({ w: 70, r: 8, done: false }))
      }]
    }

    expect(applySetCountFromNextWorkout(
      state, state.active.entries[0], 5, 'sets-boundary-2'
    )).toBe(true)
    normalizeProgressionScopes(state)

    expect(state.active.entries[0].target.sets).toBe(4)
    expect(state.active.entries[0].progressionId).toBe(oldProgressionId)
    expect(state.routines[0].ex[0].sets).toBe(5)
    expect(state.routines[0].ex[0].progressionId).not.toBe(oldProgressionId)
    expect(state.routines[1].ex[0].progressionId).toBe(oldProgressionId)
  })
})
