import { describe, expect, it } from 'vitest'
import { buildPlanBundle, parsePlan } from './plan-share.js'

describe('plan sharing with Confirmed Rep-Range', () => {
  it('round-trips configuration but excludes recovery history and runtime controls', () => {
    const config = {
      id: 'custom-confirmed-lift',
      sets: 3,
      reps: 8,
      weight: 70,
      prog: 'confirmed_rep_range',
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
      minReps: 8,
      maxReps: 12,
      targetReps: 9,
      restSeconds: 120,
      maxRestSeconds: 240,
      restReductionStrategy: 'auto_after_successes'
    })
    expect(exported).not.toHaveProperty('topRangeStreak')
    expect(exported).not.toHaveProperty('restEpochId')
    expect(exported).not.toHaveProperty('restSuccessStreak')
    expect(bundle).not.toHaveProperty('progressionControls')

    const parsed = parsePlan(JSON.stringify(bundle))
    expect(parsed.routines[0].ex[0]).toEqual(exported)
  })
})
