import { describe, expect, it } from 'vitest'
import { normalizeProgressionScopes } from './progression-scope.js'
import { buildScopedWorkoutEntry, completedWorkoutEntries } from './workout-scope.js'

describe('workout progression scope lifecycle', () => {
  it('snapshots both ids at start and keeps them unchanged through refresh and finish', () => {
    const state = {
      unit: 'kg', restSec: 90, exWeights: {}, progressionWeights: {}, workouts: [],
      progressionControls: {},
      routines: [{ id: 'day-a', ex: [{ id: 'lift', sets: 3, reps: 8, weight: 70, prog: 'linear' }] }]
    }
    normalizeProgressionScopes(state)
    const config = state.routines[0].ex[0]
    const activeEntry = buildScopedWorkoutEntry(state, config, state.routines[0])
    expect(activeEntry).toMatchObject({
      routineExerciseId: config.routineExerciseId,
      progressionId: config.progressionId
    })

    const refreshed = JSON.parse(JSON.stringify(activeEntry))
    refreshed.sets[0].done = true
    config.reps = 12
    normalizeProgressionScopes(state)
    const [completed] = completedWorkoutEntries([refreshed])
    expect(completed.routineExerciseId).toBe(activeEntry.routineExerciseId)
    expect(completed.progressionId).toBe(activeEntry.progressionId)
    expect(completed.target.reps).toBe(activeEntry.target.reps)
  })

  it('finishes a pre-upgrade active entry as unscoped immutable legacy history', () => {
    const [completed] = completedWorkoutEntries([{
      id: 'lift',
      sets: [{ w: 70, r: 8, done: true }],
      target: { sets: 1, reps: 8 }
    }])
    expect(completed).not.toHaveProperty('routineExerciseId')
    expect(completed).not.toHaveProperty('progressionId')
  })

  it('retains a fully skipped Confirmed prescription but still omits unlogged other policies', () => {
    const confirmed = {
      id: 'confirmed', target: { prog: 'confirmed_rep_range', sets: 2, targetReps: 8 },
      sets: [{ w: 70, r: 8, done: false }, { w: 70, r: 8, done: false }]
    }
    const linear = {
      id: 'linear', target: { prog: 'linear', sets: 2, reps: 5 },
      sets: [{ w: 70, r: 5, done: false }, { w: 70, r: 5, done: false }]
    }

    expect(completedWorkoutEntries([confirmed, linear])).toEqual([
      expect.objectContaining({ id: 'confirmed', target: confirmed.target, sets: confirmed.sets })
    ])
  })
})
