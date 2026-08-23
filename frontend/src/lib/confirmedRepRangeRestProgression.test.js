import { describe, expect, it } from 'vitest'
import { confirmedRepRangeProgression } from './progression.js'

const ID = 'epoch-lift'
const cfg = {
  id: ID, sets: 3, reps: 8, minReps: 8, maxReps: 12, targetReps: 8,
  weight: 70, inc: 2.5, restSeconds: 120, maxRestSeconds: 240,
  prog: 'confirmed_rep_range'
}

function workout({ target = 8, reps = [target, target, target], rest = 120, epoch, weight = 70 }) {
  return {
    d: '2026-08-01',
    entries: [{
      id: ID,
      target: {
        ...cfg, reps: target, targetReps: target, restSeconds: rest,
        ...(epoch ? { restEpochId: epoch } : {})
      },
      sets: reps.map(r => ({ w: weight, r: r ?? 0, done: r != null }))
    }]
  }
}

const control = (epochId, resetSeconds = 120) => ({
  [ID]: { confirmedRepRangeRest: { epochId, resetSeconds, resetAt: 1000 } }
})

describe('Confirmed Rep-Range recovery epochs', () => {
  it('keeps weight, reps and top-range streak on full history while resetting only recovery', () => {
    const S = {
      unit: 'kg', restSec: 90,
      workouts: [workout({ target: 12, reps: [12, 12, 12], rest: 180 })],
      progressionControls: control('new-epoch')
    }
    expect(confirmedRepRangeProgression(S, cfg)).toMatchObject({
      weight: 70, reps: 12, topRangeStreak: 1,
      restSeconds: 120, restEpochId: 'new-epoch', restSource: 'manual_reset'
    })
  })

  it('does not allow a session from another epoch to influence recovery', () => {
    const S = {
      unit: 'kg', restSec: 90,
      workouts: [
        workout({ target: 8, reps: [8, 7, 7], rest: 180, epoch: 'old-epoch' }),
        workout({ target: 8, reps: [8, 8, 8], rest: 150, epoch: 'new-epoch' }),
        workout({ target: 9, reps: [9, 8, 8], rest: 210, epoch: 'stale-workout' })
      ],
      progressionControls: control('new-epoch')
    }
    expect(confirmedRepRangeProgression(S, cfg)).toMatchObject({
      reps: 9, restSeconds: 150, restEpochId: 'new-epoch', restSource: 'carried'
    })
  })

  it('supports zero as an explicit base instead of falling back to the profile timer', () => {
    const zeroCfg = { ...cfg, restSeconds: 0 }
    const S = {
      unit: 'kg', restSec: 90,
      workouts: [workout({ target: 8, reps: [7, null, null], rest: 0, epoch: 'zero-epoch' })],
      progressionControls: control('zero-epoch', 0)
    }
    expect(confirmedRepRangeProgression(S, zeroCfg)).toMatchObject({
      restSeconds: 0, restEpochId: 'zero-epoch', restSource: 'carried'
    })
  })

  it('lets the newest reset epoch supersede a previously applied epoch', () => {
    const S = {
      unit: 'kg', restSec: 90,
      workouts: [workout({ target: 8, reps: [8, 7, 7], rest: 150, epoch: 'first-reset' })],
      progressionControls: control('second-reset')
    }
    expect(confirmedRepRangeProgression(S, cfg)).toMatchObject({
      restSeconds: 120, restEpochId: 'second-reset', restSource: 'manual_reset', restResetPending: true
    })
  })

  it('does not turn a later-set failure into a decrease when maximum is below effective recovery', () => {
    const lowerMaximum = { ...cfg, maxRestSeconds: 150 }
    const S = {
      unit: 'kg', restSec: 90,
      workouts: [workout({ target: 8, reps: [8, 7, 7], rest: 180 })]
    }
    expect(confirmedRepRangeProgression(S, lowerMaximum)).toMatchObject({
      restSeconds: 180,
      restSource: 'above_max',
      restWhy: [
        'Later sets missed the target — recovery stays at {0}s despite the configured maximum of {1}s; a failure never decreases recovery.',
        180,
        150
      ]
    })
  })
})
