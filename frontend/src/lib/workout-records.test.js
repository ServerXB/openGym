import { describe, expect, it } from 'vitest'
import {
  applyActiveTopWeight,
  applyWorkoutWeights,
  progressionWorkingWeight,
  recordsForWorkout
} from './workout-records.js'

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

  it('keeps optional completed sets eligible for the global load PR', () => {
    const result = recordsForWorkout(history(), [{
      id: 'bench',
      progressionId: 'pg-bench',
      target: { prog: 'confirmed_rep_range', sets: 3 },
      sets: [
        { w: 90, r: 10, done: true },
        { w: 90, r: 10, done: true },
        { w: 90, r: 10, done: true },
        { w: 105, r: 5, done: true }
      ]
    }])

    expect(result.prs).toEqual(['bench'])
  })
})

describe('global PR and scoped operational weights', () => {
  it('defers every Confirmed map update until the final edited workout is applied', () => {
    const previousGlobal = { w: 75, d: '2026-08-01' }
    const previousScoped = { w: 70, d: '2026-08-01' }
    const state = {
      exWeights: { bench: previousGlobal },
      progressionWeights: { 'pg-confirmed': previousScoped }
    }
    const entry = {
      id: 'bench', progressionId: 'pg-confirmed',
      target: { prog: 'confirmed_rep_range', sets: 3 },
      sets: [
        { w: 72, r: 10, done: true },
        { w: 72, r: 10, done: true },
        { w: 72, r: 10, done: true }
      ]
    }

    expect(applyActiveTopWeight(state, entry, 80, '2026-08-27')).toBe(true)
    expect(entry.topW).toBe(80)
    expect(state.exWeights.bench).toBe(previousGlobal)
    expect(state.progressionWeights['pg-confirmed']).toBe(previousScoped)

    // A post-confirmation edit makes the final block mixed and removes the stale topW. Finishing
    // cannot promote either the temporary 80 or the isolated 74 to the scoped baseline.
    entry.sets[1].w = 74
    delete entry.topW
    applyWorkoutWeights(state, [entry], '2026-08-27')
    expect(state.progressionWeights['pg-confirmed']).toBe(previousScoped)
    expect(state.exWeights.bench).toBe(previousGlobal)
  })

  it('preserves immediate top-weight tracking for non-Confirmed policies', () => {
    const state = {}
    const entry = {
      id: 'bench', progressionId: 'pg-linear', target: { prog: 'linear', sets: 1 },
      sets: [{ w: 80, r: 5, done: true }]
    }

    expect(applyActiveTopWeight(state, entry, 85, '2026-08-27')).toBe(true)
    expect(state.exWeights.bench).toEqual({ w: 85, d: '2026-08-27' })
    expect(state.progressionWeights['pg-linear']).toEqual({ w: 85, d: '2026-08-27' })
  })

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

  it('uses only the uniform prescribed Confirmed Rep-Range block as scoped baseline', () => {
    const state = {}
    const entry = {
      id: 'bench', progressionId: 'pg-confirmed', topW: 110,
      target: { prog: 'confirmed_rep_range', sets: 3 },
      sets: [
        { w: 80, r: 10, done: true },
        { w: 80, r: 10, done: true },
        { w: 80, r: 10, done: true },
        { w: 100, r: 5, done: true }
      ]
    }

    expect(progressionWorkingWeight(entry)).toBe(80)
    applyWorkoutWeights(state, [entry], '2026-08-27')

    expect(state.exWeights.bench).toEqual({ w: 110, d: '2026-08-27' })
    expect(state.progressionWeights['pg-confirmed']).toEqual({ w: 80, d: '2026-08-27' })
  })

  it.each([
    ['mixed prescribed loads', [
      { w: 80, r: 10, done: true },
      { w: 82, r: 10, done: true },
      { w: 80, r: 10, done: true }
    ]],
    ['a missing prescribed row', [
      { w: 80, r: 10, done: true },
      { w: 80, r: 10, done: true }
    ]],
    ['an unfinished prescribed row', [
      { w: 80, r: 10, done: true },
      { w: 80, r: 10, done: false },
      { w: 80, r: 10, done: true }
    ]]
  ])('does not update the Confirmed baseline for %s', (_label, sets) => {
    const previous = { w: 75, d: '2026-08-01' }
    const state = {
      progressionWeights: { 'pg-confirmed': previous }
    }
    const entry = {
      id: 'bench', progressionId: 'pg-confirmed', topW: 100,
      target: { prog: 'confirmed_rep_range', sets: 3 },
      sets
    }

    expect(progressionWorkingWeight(entry)).toBeNull()
    applyWorkoutWeights(state, [entry], '2026-08-27')

    expect(state.exWeights.bench).toEqual({ w: 100, d: '2026-08-27' })
    expect(state.progressionWeights['pg-confirmed']).toBe(previous)
  })

  it('does not infer a Confirmed baseline without a frozen prescribed set count', () => {
    const entry = {
      id: 'bench', progressionId: 'pg-confirmed',
      target: { prog: 'confirmed_rep_range' },
      sets: [{ w: 80, r: 10, done: true }]
    }

    expect(progressionWorkingWeight(entry)).toBeNull()
  })

  it('preserves highest-done-set or topW tracking for non-Confirmed policies', () => {
    const state = {}
    const entry = {
      id: 'bench', progressionId: 'pg-linear', topW: 95,
      target: { prog: 'linear', sets: 3 },
      sets: [
        { w: 80, r: 8, done: true },
        { w: 85, r: 8, done: true },
        { w: 100, r: 1, done: false }
      ]
    }

    expect(progressionWorkingWeight(entry)).toBe(95)
    applyWorkoutWeights(state, [entry], '2026-08-27')

    expect(state.exWeights.bench).toEqual({ w: 95, d: '2026-08-27' })
    expect(state.progressionWeights['pg-linear']).toEqual({ w: 95, d: '2026-08-27' })
  })
})
