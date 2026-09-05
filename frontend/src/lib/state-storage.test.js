import { describe, expect, it } from 'vitest'
import { loadStoredState } from './state-storage.js'
import { registerCustom } from './exercises.js'
import { progressionConfigSignature } from './progression-scope.js'

const defaults = { routines: [], workouts: [], exWeights: {}, progressionWeights: {} }

describe('state storage compatibility', () => {
  it('returns a valid normalized profile even when persisting its backfill fails', () => {
    const raw = JSON.stringify({
      routines: [{ id: 'day-a', ex: [{ id: 'bench', sets: 3, reps: 8, weight: 70 }] }],
      workouts: [{ d: '2026-08-20', entries: [{ id: 'bench', sets: [{ w: 70, r: 8, done: true }] }] }]
    })
    const storage = {
      getItem: () => raw,
      setItem: () => { throw new Error('QuotaExceededError') }
    }

    const state = loadStoredState(storage, 'state', defaults)
    expect(state.routines).toHaveLength(1)
    expect(state.workouts).toHaveLength(1)
    expect(state.routines[0].ex[0]).toMatchObject({
      routineExerciseId: 'routine-exercise:day-a:0'
    })
  })

  it('falls back only when storage cannot be read or JSON is invalid', () => {
    expect(loadStoredState({ getItem: () => { throw new Error('denied') } }, 'state', defaults))
      .toMatchObject(defaults)
    expect(loadStoredState({ getItem: () => '{bad json' }, 'state', defaults))
      .toMatchObject(defaults)
  })

  it('prepares custom exercise metadata before progression groups are normalized', () => {
    const id = 'state-storage-custom-cardio'
    const storage = {
      getItem: () => JSON.stringify({
        customEx: [{ id, n: 'Custom cardio', bp: 'cardio' }],
        routines: [{ id: 'cardio-day', ex: [{ id, sets: 1, min: 20, speed: 8 }] }]
      }),
      setItem: () => {}
    }
    const state = loadStoredState(storage, 'state', { ...defaults, customEx: [] }, {
      prepare: value => registerCustom(value.customEx)
    })
    const config = state.routines[0].ex[0]
    expect(JSON.parse(progressionConfigSignature(config, state.routines[0], state)).mode)
      .toBe('cardio')
  })

  it('preserves active and completed workout chronology metadata on a storage round trip', () => {
    const start = 1788019500000
    const chronology = {
      d: '2026-08-29', start, startTimeZone: 'Europe/Rome',
      timeSource: 'native', timePrecision: 'millisecond'
    }
    const raw = JSON.stringify({
      active: { id: 'active-1', ...chronology, entries: [] },
      workouts: [{
        id: 'done-1', ...chronology, end: start + 3600000,
        endTimeZone: 'Europe/Rome', entries: []
      }]
    })
    let persisted = null
    const state = loadStoredState({
      getItem: () => raw,
      setItem: (_key, value) => { persisted = value }
    }, 'state', { ...defaults, active: null })

    expect(state.active).toMatchObject({ id: 'active-1', ...chronology })
    expect(state.workouts[0]).toMatchObject({
      id: 'done-1', ...chronology, end: start + 3600000, endTimeZone: 'Europe/Rome'
    })
    expect(JSON.parse(persisted).workouts[0].timePrecision).toBe('millisecond')
  })
})
