import { describe, expect, it } from 'vitest'
import { exerciseEntriesOf, exerciseMetricPoint, latestExerciseEntry } from './exercise-stats.js'

describe('exerciseEntriesOf', () => {
  it('returns every occurrence of the global exercise id in original order', () => {
    const workout = { entries: [
      { id: 'bench', progressionId: 'heavy' },
      { id: 'squat' },
      { id: 'bench', progressionId: 'backoff' }
    ] }
    expect(exerciseEntriesOf(workout, 'bench').map(e => e.progressionId)).toEqual(['heavy', 'backoff'])
  })

  it('is safe with old or incomplete workout data', () => {
    expect(exerciseEntriesOf(null, 'bench')).toEqual([])
    expect(exerciseEntriesOf({}, 'bench')).toEqual([])
  })
})

describe('latestExerciseEntry', () => {
  it('uses the last occurrence in the latest workout', () => {
    const workouts = [
      { entries: [{ id: 'bench', target: { mode: 'time' } }] },
      { entries: [
        { id: 'bench', progressionId: 'heavy' },
        { id: 'bench', progressionId: 'backoff' }
      ] }
    ]
    expect(latestExerciseEntry(workouts, 'bench').progressionId).toBe('backoff')
  })

  it('returns null when the exercise was never logged', () => {
    expect(latestExerciseEntry([{ entries: [{ id: 'squat' }] }], 'bench')).toBeNull()
  })
})

describe('exerciseMetricPoint', () => {
  const metric = set => set.w || 0

  it('aggregates all duplicate entries into one workout point', () => {
    const workout = {
      d: '2026-08-20', start: 123, entries: [
        {
          id: 'bench', target: { reps: 5 },
          sets: [{ w: 100, r: 5, done: true }, { w: 200, r: 1, done: false }]
        },
        { id: 'squat', sets: [{ w: 180, r: 3, done: true }] },
        {
          id: 'bench', target: { reps: 10 },
          sets: [{ w: 80, r: 10, done: true }], topW: 105
        }
      ]
    }
    const point = exerciseMetricPoint(workout, 'bench', metric)

    expect(point.y).toBe(105)
    expect(point.sets.map(set => set.r)).toEqual([5, 10])
    expect(point.loggedSets.map(item => item.target.reps)).toEqual([5, 10])
    expect(point).toMatchObject({ d: '2026-08-20', t: 123 })
  })

  it('does not let top weight contaminate cardio or timed metrics', () => {
    const workout = { d: '2026-08-20', start: 123, entries: [
      { id: 'run', topW: 200, sets: [{ speed: 12, done: true }] },
      { id: 'run', sets: [{ speed: 14, done: true }] }
    ] }
    expect(exerciseMetricPoint(workout, 'run', set => set.speed || 0, { includeTopWeight: false }).y).toBe(14)
  })

  it('can exclude another logging mode while aggregating duplicate progression slots', () => {
    const workout = { entries: [
      { id: 'bench', target: { mode: 'reps' }, sets: [{ w: 80, r: 10, done: true }] },
      { id: 'bench', target: { mode: 'time' }, sets: [{ w: 120, sec: 45, done: true }] },
      { id: 'bench', target: { mode: 'reps' }, sets: [{ w: 90, r: 6, done: true }] }
    ] }
    const point = exerciseMetricPoint(workout, 'bench', metric, {
      entryFilter: entry => entry.target?.mode !== 'time'
    })
    expect(point.y).toBe(90)
    expect(point.loggedSets).toHaveLength(2)
  })

  it('ignores unrelated and unfinished sets and returns null without a positive metric', () => {
    const workout = { entries: [
      { id: 'bench', sets: [{ w: 100, done: false }] },
      { id: 'squat', sets: [{ w: 180, done: true }] }
    ] }
    expect(exerciseMetricPoint(workout, 'bench', metric)).toBeNull()
    expect(exerciseMetricPoint(workout, 'row', metric)).toBeNull()
  })
})
