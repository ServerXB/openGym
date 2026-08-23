import { describe, expect, it } from 'vitest'
import { targetForPrescription } from './workout-prescription.js'

describe('workout prescription target snapshot', () => {
  it('copies all Confirmed Rep-Range state required after the live plan is discarded', () => {
    expect(targetForPrescription(
      { id: 'squat', sets: 3, reps: 8 },
      {
        policy: 'confirmed_rep_range', reps: 10, restSeconds: 120, restBaseSeconds: 90,
        restEpochId: 'epoch-2', restSource: 'manual_reset',
        restReductionStrategy: 'auto_after_successes', restSuccessStreak: 0,
        topRangeStreak: 1
      }
    )).toEqual({
      id: 'squat', sets: 3, prog: 'confirmed_rep_range', reps: 10, targetReps: 10,
      restSeconds: 120, restBaseSeconds: 90, restEpochId: 'epoch-2', restSource: 'manual_reset',
      restReductionStrategy: 'auto_after_successes', restSuccessStreak: 0, topRangeStreak: 1
    })
  })

  it('does not invent Confirmed Rep-Range fields for another policy', () => {
    expect(targetForPrescription({ id: 'squat', reps: 5 }, { policy: 'linear', weight: 72.5 }))
      .toEqual({ id: 'squat', reps: 5 })
  })
})
