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
})
