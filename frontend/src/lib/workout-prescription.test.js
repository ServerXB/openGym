import { describe, expect, it } from 'vitest'
import { loadIncrementForPrescription, targetForPrescription } from './workout-prescription.js'

describe('workout prescription target snapshot', () => {
  it('copies all Confirmed Rep-Range state required after the live plan is discarded', () => {
    expect(targetForPrescription(
      { id: 'squat', sets: 3, reps: 8 },
      {
        policy: 'confirmed_rep_range', sets: 4, weight: 72, reps: 10, inc: 2,
        minReps: 8, maxReps: 12, rangeStep: 1, setBaselineId: 'sets-boundary-1',
        restSeconds: 120, restBaseSeconds: 90,
        restEpochId: 'epoch-2', restSource: 'manual_reset',
        restReductionStrategy: 'auto_after_successes', restSuccessStreak: 0,
        topRangeStreak: 1
      }
    )).toEqual({
      id: 'squat', sets: 4, weight: 72, inc: 2, minReps: 8, maxReps: 12, rangeStep: 1,
      setBaselineId: 'sets-boundary-1',
      prog: 'confirmed_rep_range', reps: 10, targetReps: 10,
      restSeconds: 120, restBaseSeconds: 90, restEpochId: 'epoch-2', restSource: 'manual_reset',
      restReductionStrategy: 'auto_after_successes', restSuccessStreak: 0, topRangeStreak: 1
    })
  })

  it('does not invent Confirmed Rep-Range fields for another policy', () => {
    expect(targetForPrescription({ id: 'squat', reps: 5 }, { policy: 'linear', weight: 72.5, inc: 2 }))
      .toEqual({ id: 'squat', reps: 5, weight: 72.5, inc: 2 })
  })

  it('snapshots timed prescription fields without mistaking the duration step for a load rule', () => {
    expect(targetForPrescription(
      { id: 'plank', mode: 'time', sets: 3, sec: 45, weight: 10 },
      { policy: 'time', sets: 4, sec: 50, inc: 5 }
    )).toEqual({ id: 'plank', mode: 'time', sets: 4, sec: 50, weight: 10, inc: 5 })
  })

  it('forces a pure bodyweight snapshot to zero even if a stale plan proposes load', () => {
    expect(targetForPrescription(
      { id: 'push-up', bodyweight: true, mode: 'reps', sets: 3, reps: 10, weight: 0 },
      { policy: 'linear', weight: 20, inc: 2 }
    )).toEqual({
      id: 'push-up', bodyweight: true, mode: 'reps', sets: 3, reps: 10, weight: 0
    })

    expect(targetForPrescription(
      { id: 'plank', bodyweight: true, mode: 'time', sets: 3, sec: 45, weight: -10 },
      { policy: 'time', weight: 15, sec: 50, inc: 5 }
    )).toMatchObject({ bodyweight: true, weight: 0, sec: 50, inc: 5 })
  })
})

describe('active workout load increment', () => {
  it('uses the immutable target snapshot before the live explanatory plan', () => {
    const entry = { target: { inc: 2 }, plan: { inc: 5 } }
    expect(loadIncrementForPrescription(entry)).toBe(2)

    // Mutating a routine elsewhere cannot affect an already-created entry.
    const routineConfig = { inc: 10 }
    routineConfig.inc = 20
    expect(loadIncrementForPrescription(entry)).toBe(2)
  })

  it('keeps active legacy workouts usable through compatible fallbacks', () => {
    expect(loadIncrementForPrescription({ target: {}, plan: { inc: 1.25 } })).toBe(1.25)
    expect(loadIncrementForPrescription({ target: { weightIncrement: 2 } })).toBe(2)
    expect(loadIncrementForPrescription({ target: { inc: 0, weightIncrement: -3 } })).toBe(2.5)
    expect(loadIncrementForPrescription({ target: { inc: 0, weightIncrement: 5 } })).toBe(2.5)
    expect(loadIncrementForPrescription({ target: { inc: 0, weightIncrement: 5 }, plan: { inc: 2 } })).toBe(2)
    expect(loadIncrementForPrescription({ target: {} }, 5)).toBe(5)
    expect(loadIncrementForPrescription({ target: {} }, 10)).toBe(10)
    // Before increment snapshots existed, every workout weight stepper used 2.5 regardless
    // of exercise category or profile unit. Preserve that exact active-session behaviour.
    expect(loadIncrementForPrescription({ id: 'legacy-heavy-lb', target: {} })).toBe(2.5)
    expect(loadIncrementForPrescription({})).toBe(2.5)
  })
})
