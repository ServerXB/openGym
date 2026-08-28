import { describe, expect, it } from 'vitest'
import { normalizeProgressionScopes, progressionScopeSnapshot } from './progression-scope.js'
import { nextPrescription } from './progression.js'
import { confirmedRepRangeRestControl, resetConfirmedRepRangeRest } from './confirmedRepRangeRest.js'
import { targetForPrescription } from './workout-prescription.js'
import { applyWorkoutWeights } from './workout-records.js'
import { completedWorkoutEntries } from './workout-scope.js'
import { applySetCountFromNextWorkout } from './workout-set-status.js'

const ID = 'scope-integration-lift'
const confirmed = (overrides = {}) => ({
  id: ID,
  sets: 3,
  reps: 8,
  weight: 70,
  inc: 2,
  prog: 'confirmed_rep_range',
  minReps: 8,
  maxReps: 10,
  restSeconds: 120,
  maxRestSeconds: 240,
  restReductionStrategy: 'manual',
  ...overrides
})

const completed = (cfg, targetReps, reps, d) => ({
  id: ID,
  ...progressionScopeSnapshot(cfg),
  target: {
    ...cfg,
    prog: 'confirmed_rep_range',
    targetReps,
    reps: targetReps,
    restSeconds: 120
  },
  sets: reps.map(r => ({ w: cfg.weight, r, done: true }))
})

describe('progression scopes across the workout lifecycle', () => {
  it('shares equivalent routine configurations', () => {
    const S = {
      unit: 'kg', restSec: 90, workouts: [], progressionControls: {}, exWeights: {},
      routines: [{ id: 'a', ex: [confirmed()] }, { id: 'b', ex: [confirmed()] }]
    }
    normalizeProgressionScopes(S)
    const [a, b] = S.routines.map(r => r.ex[0])
    expect(a.progressionId).toBe(b.progressionId)

    S.workouts.push({ d: '2026-08-01', entries: [completed(a, 8, [8, 8, 8], '2026-08-01')] })
    expect(nextPrescription(S, b, S.routines[1])).toMatchObject({ weight: 70, reps: 9 })
  })

  it('carries the active working load into an explicit future set-count branch', () => {
    const S = {
      unit: 'kg', restSec: 90, workouts: [], progressionControls: {}, exWeights: {},
      progressionWeights: {},
      routines: [{ id: 'a', ex: [confirmed({ sets: 4 })] }, { id: 'b', ex: [confirmed({ sets: 4 })] }]
    }
    normalizeProgressionScopes(S)
    const [a, b] = S.routines.map(routine => routine.ex[0])
    const sharedProgressionId = a.progressionId
    expect(b.progressionId).toBe(sharedProgressionId)
    S.progressionWeights[sharedProgressionId] = { w: 70, d: '2026-08-01' }

    const plan = nextPrescription(S, a, S.routines[0])
    const activeEntry = {
      id: ID,
      ...progressionScopeSnapshot(a),
      target: targetForPrescription(a, plan),
      plan,
      sets: [
        ...Array.from({ length: 4 }, () => ({ w: 72, r: 10, done: true })),
        // Optional work may establish a global PR, but must not become either scoped baseline.
        { w: 90, r: 5, done: true }
      ]
    }
    S.active = { routineId: 'a', entries: [activeEntry] }

    expect(applySetCountFromNextWorkout(S, activeEntry, 5, 'sets:future-five')).toBe(true)
    normalizeProgressionScopes(S)
    const futureA = S.routines[0].ex[0]
    const unchangedB = S.routines[1].ex[0]
    expect(activeEntry.progressionId).toBe(sharedProgressionId)
    expect(activeEntry.target).not.toHaveProperty('setBaselineId')
    expect(futureA.progressionId).not.toBe(sharedProgressionId)
    expect(unchangedB.progressionId).toBe(sharedProgressionId)
    expect(S.progressionWeights[futureA.progressionId].w).toBe(70)

    const finishedEntries = completedWorkoutEntries([activeEntry])
    applyWorkoutWeights(S, finishedEntries, '2026-08-27')
    S.workouts.push({ routineId: 'a', d: '2026-08-27', entries: finishedEntries })
    S.active = null

    // The workout remains historical evidence for the old shared group. Its proven 72 kg
    // working load is also handed to A's explicit successor, without promoting the 90 kg
    // optional set or assigning the new branch to B.
    expect(S.progressionWeights[sharedProgressionId]).toEqual({ w: 72, d: '2026-08-27' })
    expect(S.progressionWeights[futureA.progressionId]).toEqual({ w: 72, d: '2026-08-27' })
    expect(nextPrescription(S, futureA, S.routines[0])).toMatchObject({
      kind: 'first', weight: 72, reps: 8
    })
    expect(nextPrescription(S, unchangedB, S.routines[1])).toMatchObject({ weight: 72 })
  })

  it('shares top-range streak and adaptive recovery only while configurations share a group', () => {
    const S = {
      unit: 'kg', restSec: 90, workouts: [], progressionControls: {}, exWeights: {},
      routines: [{ id: 'a', ex: [confirmed()] }, { id: 'b', ex: [confirmed()] }]
    }
    normalizeProgressionScopes(S)
    const [a, b] = S.routines.map(routine => routine.ex[0])

    S.workouts.push({
      routineId: 'a', d: '2026-08-01',
      entries: [completed(a, 8, [8, 7, 7])]
    })
    expect(nextPrescription(S, b, S.routines[1]).restSeconds).toBe(150)

    // Materially changing B forks future history. The sheet previews this separation and the
    // new branch starts from its edited configuration/current load, while A keeps its recovery.
    b.maxReps = 12
    normalizeProgressionScopes(S)
    expect(a.progressionId).not.toBe(b.progressionId)
    expect(nextPrescription(S, a, S.routines[0]).restSeconds).toBe(150)
    expect(nextPrescription(S, b, S.routines[1]).restSeconds).toBe(120)
    S.workouts.push({
      routineId: 'a', d: '2026-08-08',
      entries: [completed(a, 8, [8, 8, 8])]
    })
    expect(nextPrescription(S, b, S.routines[1])).toMatchObject({ kind: 'first', reps: 8 })
  })

  it('credits early top-range confirmations across compatible routines', () => {
    const S = {
      unit: 'kg', restSec: 90, workouts: [], progressionControls: {}, exWeights: {},
      routines: [{ id: 'a', ex: [confirmed()] }, { id: 'b', ex: [confirmed()] }]
    }
    normalizeProgressionScopes(S)
    const [a, b] = S.routines.map(routine => routine.ex[0])
    S.workouts.push(
      { routineId: 'a', d: '2026-08-01', entries: [completed(a, 8, [10, 10, 10])] },
      { routineId: 'b', d: '2026-08-08', entries: [completed(b, 9, [10, 10, 10])] }
    )
    expect(nextPrescription(S, a, S.routines[0])).toMatchObject({
      weight: 72, reps: 8, topRangeStreak: 0
    })
  })

  it('isolates target and recovery after configurations diverge', () => {
    const S = {
      unit: 'kg', restSec: 90, workouts: [], progressionControls: {}, exWeights: {},
      routines: [
        { id: 'a', ex: [confirmed()] },
        { id: 'b', ex: [confirmed({ minReps: 3, maxReps: 5, weight: 100 })] }
      ]
    }
    normalizeProgressionScopes(S)
    const [a, b] = S.routines.map(r => r.ex[0])
    expect(a.progressionId).not.toBe(b.progressionId)

    S.workouts.push({ d: '2026-08-01', entries: [completed(a, 8, [8, 8, 8], '2026-08-01')] })
    expect(nextPrescription(S, a, S.routines[0])).toMatchObject({ weight: 70, reps: 9 })
    expect(nextPrescription(S, b, S.routines[1])).toMatchObject({ kind: 'first', reps: 3 })

    resetConfirmedRepRangeRest(S, a, { epochId: 'a-only', resetSeconds: 90, resetAt: 1 })
    expect(confirmedRepRangeRestControl(S, a)).toMatchObject({ epochId: 'a-only' })
    expect(confirmedRepRangeRestControl(S, b)).toBeNull()
  })

  it('snapshots identities without changing them when the routine is edited later', () => {
    const S = { routines: [{ id: 'a', ex: [confirmed()] }], exWeights: {} }
    normalizeProgressionScopes(S)
    const cfg = S.routines[0].ex[0]
    const plan = { policy: 'confirmed_rep_range', reps: 8, weight: 70 }
    const entry = {
      id: cfg.id,
      ...progressionScopeSnapshot(cfg),
      target: targetForPrescription(cfg, plan)
    }
    const before = JSON.parse(JSON.stringify(entry))

    const progressionId = cfg.progressionId
    cfg.maxReps = 12
    normalizeProgressionScopes(S)
    // An isolated slot keeps its progression history across an ordinary config edit. Only a
    // slot that diverges from another shared slot needs to fork.
    expect(S.routines[0].ex[0].progressionId).toBe(progressionId)
    expect(entry).toEqual(before)
  })

  it('attributes duplicate entries in one workout to their own slots', () => {
    const S = {
      unit: 'kg', restSec: 90, workouts: [], progressionControls: {}, exWeights: {},
      routines: [{ id: 'a', ex: [confirmed(), confirmed({ weight: 40, minReps: 12, maxReps: 15 })] }]
    }
    normalizeProgressionScopes(S)
    const [a, b] = S.routines[0].ex
    S.workouts.push({
      d: '2026-08-01',
      entries: [
        completed(a, 8, [8, 8, 8], '2026-08-01'),
        completed(b, 12, [12, 12, 12], '2026-08-01')
      ]
    })
    expect(nextPrescription(S, a, S.routines[0]).reps).toBe(9)
    expect(nextPrescription(S, b, S.routines[0]).reps).toBe(13)
  })

  it('uses the exact scoped Confirmed entry when a legacy occurrence appears first', () => {
    const S = {
      unit: 'kg', restSec: 90, progressionControls: {}, exWeights: {},
      routines: [{ id: 'a', ex: [confirmed()] }],
      workouts: []
    }
    normalizeProgressionScopes(S)
    const cfg = S.routines[0].ex[0]
    S.workouts.push({
      routineId: 'a', d: '2026-08-01', entries: [
        {
          ...completed({ ...cfg, progressionId: undefined, weight: 40 }, 8, [7, 7, 7]),
          routineExerciseId: undefined,
          progressionId: undefined
        },
        completed(cfg, 8, [8, 8, 8])
      ]
    })
    // If the first legacy occurrence won this would hold at 40/8; the exact occurrence advances.
    expect(nextPrescription(S, cfg, S.routines[0])).toMatchObject({ weight: 70, reps: 9 })
  })
})
