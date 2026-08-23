import { describe, expect, it } from 'vitest'
import { buildPlanBundle, parsePlan, planPrintHTML } from './plan-share.js'
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
    expect(bundle).not.toHaveProperty('progressionControls')

    const parsed = parsePlan(JSON.stringify(bundle))
    expect(parsed.routines[0].ex[0]).toEqual(exported)
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
