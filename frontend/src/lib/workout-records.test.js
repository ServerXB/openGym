import { describe, expect, it } from 'vitest'
import { applyWorkoutWeights, recordsForWorkout } from './workout-records.js'

const history = (sets = [{ w: 100, r: 5, done: true }]) => ({
  workouts: [{
    d: '2026-08-01', start: 1,
    entries: [{ id: 'bench', sets }]
  }]
})

describe('recordsForWorkout', () => {
  it('reports one load PR for duplicate occurrences of the exercise', () => {
    const result = recordsForWorkout(history(), [
      { id: 'bench', progressionId: 'heavy', sets: [{ w: 105, r: 3, done: true }] },
      { id: 'bench', progressionId: 'backoff', sets: [{ w: 110, r: 2, done: true }] }
    ])
    expect(result.prs).toEqual(['bench'])
    expect(result.e1prs).toEqual([])
  })

  it('finds one e1RM PR from the best of duplicate entries when load is unchanged', () => {
    const result = recordsForWorkout(history(), [
      { id: 'bench', progressionId: 'heavy', sets: [{ w: 100, r: 5, done: true }] },
      { id: 'bench', progressionId: 'backoff', sets: [{ w: 100, r: 6, done: true }] }
    ])
    expect(result.prs).toEqual([])
    expect(result.e1prs).toEqual([
      { id: 'bench', est: 120, w: 100, r: 6, prev: 116.7 }
    ])
  })

  it('does not duplicate an achievement as both a load PR and an e1RM PR', () => {
    const result = recordsForWorkout(history(), [
      { id: 'bench', sets: [{ w: 105, r: 6, done: true }] },
      { id: 'bench', sets: [{ w: 90, r: 10, done: true }] }
    ])
    expect(result.prs).toEqual(['bench'])
    expect(result.e1prs).toEqual([])
  })

  it('keeps achievements for different exercises distinct and ignores unfinished sets', () => {
    const S = {
      workouts: [{ d: '2026-08-01', start: 1, entries: [
        { id: 'bench', sets: [{ w: 100, r: 5, done: true }] },
        { id: 'squat', sets: [{ w: 120, r: 5, done: true }] }
      ] }]
    }
    const result = recordsForWorkout(S, [
      { id: 'bench', sets: [{ w: 105, r: 3, done: true }] },
      { id: 'squat', sets: [{ w: 130, r: 3, done: true }] },
      { id: 'row', sets: [{ w: 200, r: 5, done: false }] }
    ])
    expect(result.prs).toEqual(['bench', 'squat'])
    expect(result.e1prs).toEqual([])
  })
})

describe('global PR and scoped operational weights', () => {
  it('keeps the global record while allowing each progression load to move independently', () => {
    const state = {
      exWeights: { bench: { w: 120, d: '2026-01-01' } },
      progressionWeights: {
        'pg-light': { w: 70, d: '2026-01-01' },
        'pg-heavy': { w: 120, d: '2026-01-01' }
      }
    }
    applyWorkoutWeights(state, [{
      id: 'bench', progressionId: 'pg-light',
      sets: [{ w: 60, r: 8, done: true }]
    }], '2026-08-27')

    expect(state.exWeights.bench).toEqual({ w: 120, d: '2026-01-01' })
    expect(state.progressionWeights['pg-light']).toEqual({ w: 60, d: '2026-08-27' })
    expect(state.progressionWeights['pg-heavy']).toEqual({ w: 120, d: '2026-01-01' })
  })
})
