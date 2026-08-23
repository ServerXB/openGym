import { describe, expect, it } from 'vitest'
import { nextPrescription } from './progression.js'
import {
  CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES
} from './confirmedRepRangeAutoRest.js'
import { targetForPrescription } from './workout-prescription.js'

const ID = 'auto-recovery-lift'
const AUTO = CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES
const cfg = {
  id: ID,
  sets: 3,
  reps: 8,
  minReps: 8,
  maxReps: 12,
  targetReps: 8,
  weight: 70,
  inc: 2.5,
  restSeconds: 120,
  maxRestSeconds: 240,
  restReductionStrategy: AUTO,
  prog: 'confirmed_rep_range'
}

function state(rows, control) {
  return {
    unit: 'kg',
    restSec: 90,
    ...(control ? {
      progressionControls: {
        [ID]: { confirmedRepRangeRest: control }
      }
    } : {}),
    workouts: rows.map((row, i) => ({
      d: `2026-08-${String(i + 1).padStart(2, '0')}`,
      entries: [{
        id: ID,
        target: {
          ...cfg,
          reps: row.target ?? 10,
          targetReps: row.target ?? 10,
          restSeconds: row.rest ?? 180,
          restBaseSeconds: row.base ?? 120,
          restReductionStrategy: row.strategy ?? AUTO,
          ...(row.epoch ? { restEpochId: row.epoch } : {})
        },
        sets: (row.reps ?? [row.target ?? 10, row.target ?? 10, row.target ?? 10]).map(rep => ({
          w: row.weight ?? 70,
          r: rep ?? 0,
          done: rep != null
        }))
      }]
    }))
  }
}

const clean = (target, extra = {}) => ({ target, ...extra })

describe('Confirmed Rep-Range automatic recovery integration', () => {
  it('reports streak progress for the first three successes without reducing recovery', () => {
    const plan = nextPrescription(state([clean(8), clean(9), clean(10)]), cfg)
    expect(plan).toMatchObject({
      restSeconds: 180,
      restReductionStrategy: AUTO,
      restSuccessStreak: 3,
      restSource: 'carried'
    })
    expect(plan.restWhy).toEqual([
      'Recovery stays at {0}s — automatic reduction progress: {1} / {2} successful sessions.',
      180, 3, 4
    ])
  })

  it('reduces recovery by 30 seconds after four successes at the same prescribed recovery', () => {
    const plan = nextPrescription(state([clean(8), clean(9), clean(10), clean(11)]), cfg)
    expect(plan).toMatchObject({
      reps: 12,
      weight: 70,
      restSeconds: 150,
      restReductionStrategy: AUTO,
      restSuccessStreak: 0,
      restSource: 'automatic_decrease'
    })
    expect(plan.restWhy).toEqual([
      '{0} consecutive successful sessions with the same prescribed recovery — recovery decreased from {1}s to {2}s.',
      4, 180, 150
    ])
  })

  it('snapshots the strategy and automatic streak needed by future derivation', () => {
    const plan = nextPrescription(state([clean(8), clean(9)]), cfg)
    expect(targetForPrescription(cfg, plan)).toMatchObject({
      restSeconds: 180,
      restReductionStrategy: AUTO,
      restSuccessStreak: 2
    })
  })

  it('still applies the earned reduction when the same prescription increases weight', () => {
    const plan = nextPrescription(state([
      clean(10), clean(11), clean(12), clean(12)
    ]), cfg)
    expect(plan).toMatchObject({
      weight: 72.5,
      reps: 8,
      restSeconds: 150,
      restSuccessStreak: 0,
      restSource: 'automatic_decrease'
    })
    expect(plan.restWhy[0]).toContain('prescribed recovery')
  })

  it('remains reachable in a narrow 8–10 range', () => {
    const narrow = { ...cfg, maxReps: 10 }
    const plan = nextPrescription(state([
      clean(8), clean(9), clean(10), clean(10)
    ]), narrow)
    expect(plan).toMatchObject({
      weight: 72.5,
      reps: 8,
      restSeconds: 150,
      restSuccessStreak: 0,
      restSource: 'automatic_decrease'
    })
  })

  it('resets the automatic streak on a miss and still applies the adaptive increase', () => {
    const plan = nextPrescription(state([
      clean(8), clean(9), { target: 10, reps: [10, 9, 8] }
    ]), cfg)
    expect(plan).toMatchObject({
      restSeconds: 210,
      restSuccessStreak: 0,
      restSource: 'adaptive_increase'
    })
  })

  it('counts only successes in the current manual-reset epoch', () => {
    const control = { epochId: 'new-epoch', resetSeconds: 180, resetAt: 1234 }
    const plan = nextPrescription(state([
      clean(8, { epoch: 'old-epoch' }),
      clean(9, { epoch: 'old-epoch' }),
      clean(10, { epoch: 'old-epoch' }),
      clean(11, { epoch: 'new-epoch' })
    ], control), cfg)
    expect(plan).toMatchObject({
      restEpochId: 'new-epoch',
      restSeconds: 180,
      restSuccessStreak: 1
    })
  })

  it('keeps a pending manual reset ahead of an earned streak in the old epoch', () => {
    const control = { epochId: 'new-epoch', resetSeconds: 120, resetAt: 1234 }
    const plan = nextPrescription(state([
      clean(8, { epoch: 'old-epoch' }),
      clean(9, { epoch: 'old-epoch' }),
      clean(10, { epoch: 'old-epoch' }),
      clean(11, { epoch: 'old-epoch' })
    ], control), cfg)
    expect(plan).toMatchObject({
      restEpochId: 'new-epoch',
      restSeconds: 120,
      restSuccessStreak: 0,
      restSource: 'manual_reset',
      restResetPending: true
    })
  })

  it('never goes below base and does not accumulate a useless streak at base', () => {
    const plan = nextPrescription(state([
      clean(8, { rest: 120 }),
      clean(9, { rest: 120 }),
      clean(10, { rest: 120 }),
      clean(11, { rest: 120 })
    ]), cfg)
    expect(plan).toMatchObject({ restSeconds: 120, restSuccessStreak: 0 })
    expect(plan.restWhy[0]).toContain('configured base')
  })

  it('keeps the legacy/manual mode stable even after four successful sessions', () => {
    const manualCfg = { ...cfg, restReductionStrategy: 'manual' }
    const plan = nextPrescription(state([
      clean(8, { strategy: 'manual' }),
      clean(9, { strategy: 'manual' }),
      clean(10, { strategy: 'manual' }),
      clean(11, { strategy: 'manual' })
    ]), manualCfg)
    expect(plan).toMatchObject({
      restSeconds: 180,
      restReductionStrategy: 'manual',
      restSuccessStreak: 0,
      restSource: 'carried'
    })
  })

  it('starts a fresh streak at the lower recovery after an automatic step', () => {
    const plan = nextPrescription(state([
      clean(8), clean(9), clean(10), clean(11),
      clean(12, { rest: 150 })
    ]), cfg)
    expect(plan).toMatchObject({ restSeconds: 150, restSuccessStreak: 1 })
  })

  it('starts a new observation window when the configured base changes', () => {
    const lowerBase = { ...cfg, restSeconds: 90 }
    const rowsAtOldBase = [
      clean(8, { rest: 120, base: 120 }),
      clean(9, { rest: 120, base: 120 }),
      clean(10, { rest: 120, base: 120 }),
      clean(11, { rest: 120, base: 120 })
    ]
    expect(nextPrescription(state(rowsAtOldBase), lowerBase)).toMatchObject({
      restSeconds: 120,
      restBaseSeconds: 90,
      restSuccessStreak: 0,
      restSource: 'carried'
    })
  })
})
