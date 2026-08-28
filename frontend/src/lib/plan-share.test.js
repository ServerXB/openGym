import { describe, expect, it } from 'vitest'
import { buildPlanBundle, mergePlan, parsePlan, planPrintHTML } from './plan-share.js'
import { EXDB } from './exercises.js'

describe('plan sharing with Confirmed Rep-Range', () => {
  it('round-trips configuration but excludes recovery history and runtime controls', () => {
    const config = {
      id: 'custom-confirmed-lift',
      sets: 3,
      reps: 8,
      weight: 70,
      prog: 'confirmed_rep_range',
      inc: 2,
      minReps: 8,
      maxReps: 12,
      targetReps: 9,
      restSeconds: 120,
      maxRestSeconds: 240,
      restReductionStrategy: 'auto_after_successes',
      setBaselineId: 'private-set-boundary',
      topRangeStreak: 1,
      restEpochId: 'private-epoch',
      restSuccessStreak: 3
    }
    const S = {
      routines: [{ id: 'routine-1', name: 'Test', prog: 'confirmed_rep_range', ex: [config] }],
      customEx: [{ id: config.id, n: 'Test lift', bp: 'chest' }],
      week: { 1: 'routine-1' },
      progressionControls: {
        [config.id]: { confirmedRepRangeRest: { epochId: 'private-epoch', resetSeconds: 120 } }
      }
    }

    const bundle = buildPlanBundle(S, 'Recovery plan')
    const exported = bundle.routines[0].ex[0]
    expect(exported).toMatchObject({
      inc: 2,
      minReps: 8,
      maxReps: 12,
      restSeconds: 120,
      maxRestSeconds: 240,
      restReductionStrategy: 'auto_after_successes'
    })
    expect(exported).not.toHaveProperty('topRangeStreak')
    expect(exported).not.toHaveProperty('restEpochId')
    expect(exported).not.toHaveProperty('restSuccessStreak')
    expect(exported).not.toHaveProperty('targetReps')
    expect(exported).not.toHaveProperty('setBaselineId')
    expect(bundle).not.toHaveProperty('progressionControls')

    const parsed = parsePlan(JSON.stringify(bundle))
    expect(parsed.routines[0].ex[0]).toEqual(exported)
  })

  it('never exports foreign slot identities and assigns fresh stable identities on merge', () => {
    const config = {
      id: 'scoped-lift', sets: 4, reps: 8, weight: 70,
      routineExerciseId: 'sender-slot', progressionId: 'sender-group',
      progressionSignature: 'sender-signature'
    }
    const source = {
      routines: [{ id: 'sender-routine', name: 'Scoped', ex: [config] }],
      customEx: [{ id: config.id, n: 'Scoped lift', bp: 'chest' }],
      week: {}
    }
    const bundle = buildPlanBundle(source)
    expect(bundle.routines[0].ex[0]).not.toHaveProperty('routineExerciseId')
    expect(bundle.routines[0].ex[0]).not.toHaveProperty('progressionId')
    expect(bundle.routines[0].ex[0].progressionGroup).toMatch(/^g\d+$/)

    // A hand-edited bundle cannot smuggle runtime ids through the tolerant parser either.
    bundle.routines[0].ex[0].routineExerciseId = 'foreign-slot'
    bundle.routines[0].ex[0].progressionId = 'foreign-group'
    bundle.routines[0].ex[0].progressionSignature = 'foreign-signature'
    const parsed = parsePlan(bundle)
    expect(parsed.routines[0].ex[0]).not.toHaveProperty('routineExerciseId')
    expect(parsed.routines[0].ex[0]).not.toHaveProperty('progressionId')

    const state = { routines: [], customEx: [], week: {}, exWeights: {} }
    mergePlan(state, parsed)
    const imported = state.routines[0].ex[0]
    expect(imported.routineExerciseId).toMatch(/^routine-exercise:/)
    expect(imported.progressionId).toMatch(/^progression:/)
    expect(imported.routineExerciseId).not.toBe('foreign-slot')
    expect(imported.progressionId).not.toBe('foreign-group')
  })

  it('preserves plan-local shared and independent groups without joining local history', () => {
    const exercise = id => ({
      id: 'scoped-lift', sets: 4, reps: 8, weight: 70,
      routineExerciseId: `sender-slot-${id}`,
      progressionId: id
    })
    const source = {
      routines: [
        { id: 'sender-a', name: 'A', ex: [exercise('sender-shared')] },
        { id: 'sender-b', name: 'B', ex: [exercise('sender-shared')] },
        { id: 'sender-c', name: 'C', ex: [exercise('sender-independent')] }
      ],
      customEx: [{ id: 'scoped-lift', n: 'Scoped lift', bp: 'chest' }],
      week: {}
    }
    const parsed = parsePlan(buildPlanBundle(source))
    expect(parsed.routines[0].ex[0].progressionGroup)
      .toBe(parsed.routines[1].ex[0].progressionGroup)
    expect(parsed.routines[2].ex[0].progressionGroup)
      .not.toBe(parsed.routines[0].ex[0].progressionGroup)

    const state = {
      routines: [{
        id: 'local', name: 'Local',
        ex: [{
          id: 'scoped-lift', sets: 4, reps: 8, weight: 70,
          routineExerciseId: 'local-slot', progressionId: 'local-progression'
        }]
      }],
      customEx: [{ id: 'scoped-lift', n: 'Scoped lift', bp: 'chest' }],
      week: {}, exWeights: {}, progressionWeights: {}
    }
    mergePlan(state, parsed)
    const firstImport = state.routines.slice(1, 4).map(routine => routine.ex[0].progressionId)
    expect(firstImport[0]).toBe(firstImport[1])
    expect(firstImport[2]).not.toBe(firstImport[0])
    expect(firstImport).not.toContain('local-progression')

    mergePlan(state, parsed)
    const secondImport = state.routines.slice(4, 7).map(routine => routine.ex[0].progressionId)
    expect(secondImport[0]).toBe(secondImport[1])
    expect(secondImport[2]).not.toBe(secondImport[0])
    expect(secondImport).not.toContain(firstImport[0])
    expect(secondImport).not.toContain(firstImport[2])
  })

  it('still imports an old plan carrying the configurable initial target', () => {
    const parsed = parsePlan({
      opengym_plan: 1,
      name: 'Legacy target',
      week: {},
      customEx: [{ id: 'legacy-lift', n: 'Legacy lift', bp: 'chest' }],
      routines: [{
        id: 'legacy-routine', name: 'Legacy', prog: 'confirmed_rep_range',
        ex: [{ id: 'legacy-lift', sets: 3, minReps: 8, maxReps: 12, targetReps: 10 }]
      }]
    })

    expect(parsed.routines[0].ex[0]).toMatchObject({
      minReps: 8, maxReps: 12, targetReps: 10
    })
  })

  it('promotes a legacy weightIncrement to canonical inc on a new export', () => {
    const config = {
      id: 'legacy-increment-lift', sets: 3, reps: 8, weight: 65,
      prog: 'confirmed_rep_range', minReps: 8, maxReps: 12,
      weightIncrement: 2
    }
    const bundle = buildPlanBundle({
      routines: [{ id: 'legacy', name: 'Legacy', ex: [config] }],
      customEx: [{ id: config.id, n: 'Legacy lift', bp: 'chest' }],
      week: {}
    })
    const exported = bundle.routines[0].ex[0]

    expect(exported.inc).toBe(2)
    expect(exported).not.toHaveProperty('weightIncrement')
    expect(parsePlan(JSON.stringify(bundle)).routines[0].ex[0]).toEqual(exported)
  })

  it('does not revive a stale legacy increment when canonical inc is explicitly invalid', () => {
    const config = {
      id: 'invalid-canonical-lift', sets: 3, reps: 8,
      inc: 0, weightIncrement: 5
    }
    const exported = buildPlanBundle({
      routines: [{ id: 'invalid', name: 'Invalid', ex: [config] }],
      customEx: [{ id: config.id, n: 'Invalid lift', bp: 'chest' }],
      week: {}
    }).routines[0].ex[0]

    expect(exported).not.toHaveProperty('inc')
    expect(exported).not.toHaveProperty('weightIncrement')
  })

  it('prints the Confirmed range when the strategy is inherited from the routine', () => {
    const id = EXDB.find(ex => ex.bp !== 'cardio' && ex.eq !== 'body weight').id
    const html = planPrintHTML({
      unit: 'kg', week: {},
      routines: [{
        id: 'confirmed', name: 'Confirmed', prog: 'confirmed_rep_range',
        ex: [{ id, sets: 3, reps: 8, minReps: 8, maxReps: 12, weight: 70 }]
      }]
    }, 'Tester')

    expect(html).toContain('3 × 8–12 · 70 kg')
    expect(html).not.toContain('3 × 8 · 70 kg')
  })
})
