import { describe, expect, it } from 'vitest'
import {
  entryMatchesProgression,
  createRoutineExerciseId,
  findWorkoutProgressionEntry,
  normalizeProgressionScopes,
  progressionConfigSignature,
  progressionIdOf,
  progressionScopePreview,
  progressionScopeSnapshot
} from './progression-scope.js'

const lift = (overrides = {}) => ({
  id: 'bench', sets: 4, weight: 70, prog: 'confirmed_rep_range',
  minReps: 8, maxReps: 10, restSeconds: 120, maxRestSeconds: 240,
  ...overrides
})

describe('progression scope normalization', () => {
  it('shares equivalent configurations across routines and remains stable on refresh', () => {
    const state = {
      restSec: 90,
      routines: [
        { id: 'a', prog: 'confirmed_rep_range', ex: [lift({ prog: undefined })] },
        { id: 'b', prog: 'confirmed_rep_range', ex: [lift({ prog: undefined })] }
      ]
    }

    normalizeProgressionScopes(state)
    const [a, b] = state.routines.map(r => r.ex[0])
    expect(a.routineExerciseId).not.toBe(b.routineExerciseId)
    expect(a.progressionId).toBe(b.progressionId)

    const serialized = JSON.stringify(state)
    normalizeProgressionScopes(state)
    expect(JSON.stringify(state)).toBe(serialized)
  })

  it('survives JSON round-trips, routine rename, reorder and deletion without changing ids', () => {
    const state = {
      restSec: 90,
      routines: [
        { id: 'a', name: 'Day A', ex: [lift(), lift({ id: 'row' })] },
        { id: 'b', name: 'Day B', ex: [lift()] }
      ]
    }
    normalizeProgressionScopes(state)
    const benchSlot = state.routines[0].ex[0].routineExerciseId
    const sharedProgression = state.routines[0].ex[0].progressionId

    const restored = JSON.parse(JSON.stringify(state))
    restored.routines[0].name = 'Renamed day'
    restored.routines[0].ex.reverse()
    normalizeProgressionScopes(restored)
    const movedBench = restored.routines[0].ex.find(config => config.id === 'bench')
    expect(movedBench.routineExerciseId).toBe(benchSlot)
    expect(movedBench.progressionId).toBe(sharedProgression)

    restored.routines.splice(1, 1)
    normalizeProgressionScopes(restored)
    expect(restored.routines[0].ex.find(config => config.id === 'bench').progressionId)
      .toBe(sharedProgression)
  })

  it('isolates different configurations of the same exercise', () => {
    const state = {
      routines: [
        { id: 'hypertrophy', ex: [lift()] },
        { id: 'strength', ex: [lift({ minReps: 3, maxReps: 5, weight: 100 })] }
      ]
    }
    normalizeProgressionScopes(state)
    expect(state.routines[0].ex[0].progressionId)
      .not.toBe(state.routines[1].ex[0].progressionId)
  })

  it('applies equivalent sharing consistently across every supported progression policy', () => {
    const configs = [
      lift({ prog: 'linear', reps: 8 }),
      lift({ prog: 'greyskull', reps: 5 }),
      lift({ prog: 'double', reps: 12, repsMin: 8, repsMax: 12 }),
      lift({ prog: 'confirmed_rep_range' }),
      lift({ mode: 'time', prog: 'time', sec: 45, inc: 5 })
    ]
    configs.forEach(config => {
      const state = {
        routines: [
          { id: `a-${config.prog}`, ex: [{ ...config }] },
          { id: `b-${config.prog}`, ex: [{ ...config }] }
        ]
      }
      normalizeProgressionScopes(state)
      expect(state.routines[0].ex[0].progressionId)
        .toBe(state.routines[1].ex[0].progressionId)
    })
  })

  it('keeps duplicate slots in one routine independent', () => {
    const state = { routines: [{ id: 'same-day', ex: [lift(), lift()] }] }
    normalizeProgressionScopes(state)
    const [first, second] = state.routines[0].ex
    expect(first.routineExerciseId).not.toBe(second.routineExerciseId)
    expect(first.progressionId).not.toBe(second.progressionId)
  })

  it('forks a shared group when one effective configuration changes', () => {
    const state = { routines: [{ id: 'a', ex: [lift()] }, { id: 'b', ex: [lift()] }] }
    normalizeProgressionScopes(state)
    const shared = state.routines[0].ex[0].progressionId

    state.routines[1].ex[0].maxReps = 12
    normalizeProgressionScopes(state)

    expect(state.routines[0].ex[0].progressionId).toBe(shared)
    expect(state.routines[1].ex[0].progressionId).not.toBe(shared)
  })

  it('repairs duplicated slot identifiers from malformed JSON', () => {
    const state = {
      routines: [
        { id: 'a', ex: [lift({ routineExerciseId: 'duplicate' })] },
        { id: 'b', ex: [lift({ routineExerciseId: 'duplicate' })] }
      ]
    }
    normalizeProgressionScopes(state)
    expect(state.routines[0].ex[0].routineExerciseId).toBe('duplicate')
    expect(state.routines[1].ex[0].routineExerciseId).toBe('duplicate:2')
  })

  it('does not let an earlier missing id steal a later explicit slot id', () => {
    const state = {
      routines: [{
        id: 'a',
        ex: [
          lift(),
          lift({ routineExerciseId: 'routine-exercise:a:0' })
        ]
      }]
    }
    normalizeProgressionScopes(state)
    expect(state.routines[0].ex[0].routineExerciseId).toBe('routine-exercise:a:0:2')
    expect(state.routines[0].ex[1].routineExerciseId).toBe('routine-exercise:a:0')
  })

  it('seeds scoped working loads from legacy exWeights without changing the global PR', () => {
    const state = {
      exWeights: { bench: { w: 82.5, d: '2026-08-01' } },
      routines: [{ id: 'a', ex: [lift()] }]
    }
    normalizeProgressionScopes(state)
    const pid = state.routines[0].ex[0].progressionId
    expect(state.progressionWeights[pid]).toEqual({ w: 82.5, d: '2026-08-01' })
    expect(state.exWeights.bench).toEqual({ w: 82.5, d: '2026-08-01' })
  })

  it('does not reuse a progression id still referenced by an active workout', () => {
    const state = {
      routines: [{ id: 'a', ex: [lift()] }],
      active: {
        entries: [{
          id: 'bench',
          progressionId: 'progression:routine-exercise:a:0',
          sets: [{ w: 70, r: 8, done: true }]
        }]
      }
    }
    normalizeProgressionScopes(state)
    expect(state.routines[0].ex[0].progressionId)
      .toBe('progression:routine-exercise:a:0:2')
  })

  it('reconnects a routine missing its group id to a matching active or completed slot snapshot', () => {
    const slot = 'routine-exercise:a:stable'
    const progressionId = 'progression:stable'
    for (const source of ['active', 'workouts']) {
      const workout = {
        routineId: 'a',
        entries: [{
          id: 'bench', routineExerciseId: slot, progressionId,
          sets: [{ w: 70, r: 8, done: true }]
        }]
      }
      const state = {
        routines: [{ id: 'a', ex: [lift({ routineExerciseId: slot })] }],
        ...(source === 'active' ? { active: workout } : { workouts: [workout] })
      }
      normalizeProgressionScopes(state)
      expect(state.routines[0].ex[0].progressionId).toBe(progressionId)
    }
  })

  it('recovers both ids by position when a server legacy routine meets a modern local active workout', () => {
    const state = {
      routines: [{ id: 'a', ex: [lift()] }],
      active: {
        routineId: 'a',
        entries: [{
          id: 'bench',
          routineExerciseId: 'routine-exercise:local-active-slot',
          progressionId: 'progression:local-active-group',
          sets: [{ w: 70, r: 8, done: false }]
        }]
      }
    }
    normalizeProgressionScopes(state)
    expect(state.routines[0].ex[0]).toMatchObject({
      routineExerciseId: 'routine-exercise:local-active-slot',
      progressionId: 'progression:local-active-group'
    })
  })

  it('does not seed divergent groups from an ambiguous global PR', () => {
    const state = {
      exWeights: { bench: { w: 120, d: '2026-08-01' } },
      routines: [
        { id: 'light', ex: [lift({ weight: 40 })] },
        { id: 'heavy', ex: [lift({ weight: 100, minReps: 3, maxReps: 5 })] }
      ]
    }
    normalizeProgressionScopes(state)
    const [light, heavy] = state.routines.map(routine => routine.ex[0])
    expect(state.progressionWeights[light.progressionId]).toBeUndefined()
    expect(state.progressionWeights[heavy.progressionId]).toBeUndefined()
    expect(state.exWeights.bench.w).toBe(120)
  })
})

describe('progression scope compatibility helpers', () => {
  it('treats missing workout scope as a shared legacy baseline', () => {
    expect(entryMatchesProgression({ id: 'bench' }, 'bench', 'pg-a')).toBe(true)
    expect(entryMatchesProgression({ id: 'bench', progressionId: 'pg-a' }, 'bench', 'pg-a')).toBe(true)
    expect(entryMatchesProgression({ id: 'bench', progressionId: 'pg-b' }, 'bench', 'pg-a')).toBe(false)
  })

  it('prefers an exact scoped entry and attributes unscoped history by surviving routine', () => {
    const state = {
      routines: [
        { id: 'a', ex: [lift({ progressionId: 'pg-a', routineExerciseId: 'slot-a' })] },
        { id: 'b', ex: [lift({ progressionId: 'pg-b', routineExerciseId: 'slot-b', weight: 100 })] }
      ]
    }
    const mixed = {
      routineId: 'a',
      entries: [
        { id: 'bench', sets: [{ w: 50, r: 8, done: true }] },
        { id: 'bench', progressionId: 'pg-a', sets: [{ w: 70, r: 8, done: true }] }
      ]
    }
    expect(findWorkoutProgressionEntry(state, mixed, 'bench', 'pg-a').sets[0].w).toBe(70)

    const legacyA = {
      routineId: 'a',
      entries: [{ id: 'bench', sets: [{ w: 72, r: 8, done: true }] }]
    }
    expect(findWorkoutProgressionEntry(state, legacyA, 'bench', 'pg-a')).not.toBeNull()
    expect(findWorkoutProgressionEntry(state, legacyA, 'bench', 'pg-b')).toBeNull()
  })

  it('snapshots explicit scope and gives freestyle/legacy configs a readable fallback', () => {
    expect(progressionScopeSnapshot({ id: 'bench', routineExerciseId: 'slot-a', progressionId: 'pg-a' }))
      .toEqual({ routineExerciseId: 'slot-a', progressionId: 'pg-a' })
    expect(progressionScopeSnapshot({ id: 'bench' })).toEqual({ progressionId: 'exercise:bench' })
    expect(progressionIdOf('bench')).toBe('exercise:bench')
  })

  it('can keep a pre-upgrade active entry unscoped when it is completed', () => {
    expect(progressionScopeSnapshot({ id: 'bench' }, { legacyFallback: false })).toEqual({})
    expect(progressionScopeSnapshot({
      id: 'bench', routineExerciseId: 'slot-a', progressionId: 'pg-a'
    }, { legacyFallback: false })).toEqual({ routineExerciseId: 'slot-a', progressionId: 'pg-a' })
  })

  it('normalizes equivalent inherited and explicit policies to the same signature', () => {
    const inherited = progressionConfigSignature(lift({ prog: undefined }), { prog: 'confirmed_rep_range' }, { restSec: 90 })
    const explicit = progressionConfigSignature(lift(), {}, { restSec: 90 })
    expect(inherited).toBe(explicit)
  })

  it('explains the automatic shared/independent result without merging old groups', () => {
    const a = lift({ routineExerciseId: 'slot-a', progressionId: 'pg-shared' })
    const b = lift({ routineExerciseId: 'slot-b', progressionId: 'pg-shared' })
    const c = lift({ routineExerciseId: 'slot-c', progressionId: 'pg-independent' })
    const state = {
      routines: [
        { id: 'a', name: 'A', ex: [a] },
        { id: 'b', name: 'B', ex: [b] },
        { id: 'c', name: 'C', ex: [c] }
      ]
    }
    expect(progressionScopePreview(state, a, state.routines[0], a))
      .toEqual({ shared: true, separating: false, compatibleRoutines: ['B'] })
    expect(progressionScopePreview(state, { ...a, maxReps: 15 }, state.routines[0], a))
      .toMatchObject({ shared: false, separating: true })
    expect(progressionScopePreview(state, c, state.routines[2], c))
      .toMatchObject({ shared: false, separating: false })
    expect(progressionScopePreview(state, lift(), { id: 'new', name: 'New', ex: [] }))
      .toMatchObject({ shared: true, separating: false })
  })

  it('ignores the obsolete ordinary reps field in a Confirmed configuration', () => {
    expect(progressionConfigSignature(lift({ reps: 8 })))
      .toBe(progressionConfigSignature(lift({ reps: 10 })))
  })

  it('matches runtime semantics for missing sets, null recovery and canonical increment presence', () => {
    expect(progressionConfigSignature(lift({ sets: undefined })))
      .not.toBe(progressionConfigSignature(lift({ sets: 3 })))
    expect(progressionConfigSignature(lift({ restSeconds: null }), {}, { restSec: 120 }))
      .toBe(progressionConfigSignature(lift({ restSeconds: 120 }), {}, { restSec: 90 }))
    expect(progressionConfigSignature(lift({ inc: null, weightIncrement: 5 })))
      .not.toBe(progressionConfigSignature(lift({ inc: 5 })))
  })

  it('separates every material behavior field and ignores runtime-only snapshot state', () => {
    const base = lift({ inc: 2, restReductionStrategy: 'manual' })
    const variants = [
      { sets: 5 },
      { minReps: 6 },
      { maxReps: 12 },
      { weight: 72 },
      { inc: 2.5 },
      { bodyweight: true },
      { side: true },
      { restSeconds: 150 },
      { maxRestSeconds: 300 },
      { restReductionStrategy: 'auto_after_successes' },
      { prog: 'linear' },
      { mode: 'time', sec: 45 }
    ]
    const signature = progressionConfigSignature(base, {}, { restSec: 90 })
    variants.forEach(variant => {
      expect(progressionConfigSignature({ ...base, ...variant }, {}, { restSec: 90 }))
        .not.toBe(signature)
    })

    expect(progressionConfigSignature({
      ...base,
      targetReps: 10,
      topRangeStreak: 1,
      restEpochId: 'runtime',
      restSuccessStreak: 3,
      restResetPending: true
    }, {}, { restSec: 90 })).toBe(signature)
  })

  it('gives a re-added UI slot a new identity that cannot reconnect to the deleted occurrence', () => {
    const oldSlot = createRoutineExerciseId('old')
    const newSlot = createRoutineExerciseId('new')
    const state = {
      routines: [{ id: 'a', ex: [lift({ routineExerciseId: newSlot })] }],
      workouts: [{
        routineId: 'a', entries: [{
          id: 'bench', routineExerciseId: oldSlot, progressionId: 'old-group',
          sets: [{ w: 70, r: 8, done: true }]
        }]
      }]
    }
    normalizeProgressionScopes(state)
    expect(state.routines[0].ex[0].routineExerciseId).toBe(newSlot)
    expect(state.routines[0].ex[0].progressionId).not.toBe('old-group')
  })
})
