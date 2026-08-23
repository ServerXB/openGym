import { describe, expect, it } from 'vitest'
import { buildSets } from './history.js'
import { applyPrescription, nextPrescription } from './progression.js'
import { restSecondsFor } from './workout-timer.js'
import { targetForPrescription } from './workout-prescription.js'
import { resetConfirmedRepRangeRest } from './confirmedRepRangeRest.js'

const ID = 'qa-confirmed-rep-range-lift'
const cfg = {
  id: ID, sets: 3, reps: 8, minReps: 8, maxReps: 12, targetReps: 8,
  weight: 70, inc: 2.5, restSeconds: 120, maxRestSeconds: 240,
  prog: 'confirmed_rep_range'
}

const state = workouts => ({
  unit: 'kg', restSec: 90, exWeights: {}, workouts,
  routines: [{ id: 'routine', prog: 'confirmed_rep_range', ex: [cfg] }]
})

function buildEntry(S, exercise = cfg) {
  const plan = nextPrescription(S, exercise, S.routines[0])
  const target = targetForPrescription(exercise, plan)
  return { id: exercise.id, target, plan, sets: applyPrescription(buildSets(S, exercise), plan) }
}

function finish(S, expectedReps, actualReps = [expectedReps, expectedReps, expectedReps]) {
  const entry = buildEntry(S)
  expect(entry.target.targetReps).toBe(expectedReps)
  expect(entry.sets.map(s => s.r)).toEqual([expectedReps, expectedReps, expectedReps])
  entry.sets.forEach((set, i) => { set.r = actualReps[i]; set.done = true })
  return { ...S, workouts: [...S.workouts, { d: `2026-08-${String(S.workouts.length + 1).padStart(2, '0')}`, entries: [entry] }] }
}

function logEntry(S, entry, actualReps) {
  entry.sets.forEach((set, i) => { set.r = actualReps[i]; set.done = actualReps[i] != null })
  return { ...S, workouts: [...S.workouts, { d: `2026-09-${String(S.workouts.length + 1).padStart(2, '0')}`, entries: [entry] }] }
}

describe('Confirmed Rep-Range workout integration', () => {
  it('overrides rows carried from a previous policy and snapshots the same target', () => {
    const previous = {
      d: '2026-07-31', entries: [{ id: ID, target: { sets: 3, reps: 5, prog: 'linear' },
        sets: [1, 2, 3].map(() => ({ w: 60, r: 5, done: true })) }]
    }
    const entry = buildEntry(state([previous]))
    expect(entry.plan).toMatchObject({ policy: 'confirmed_rep_range', kind: 'first', reps: 8 })
    expect(entry.target).toMatchObject({ prog: 'confirmed_rep_range', reps: 8, targetReps: 8, restSeconds: 120 })
    expect(entry.sets).toEqual([1, 2, 3].map(() => ({ w: 60, r: 8, done: false })))
  })

  it('keeps rows, snapshots and domain state aligned through the full seven-session cycle', () => {
    let S = state([])
    for (const reps of [8, 9, 10, 11, 12, 12]) S = finish(S, reps)
    const next = buildEntry(S)
    expect(next.plan).toMatchObject({ weight: 72.5, reps: 8, topRangeStreak: 0 })
    expect(next.target).toMatchObject({ reps: 8, targetReps: 8, topRangeStreak: 0 })
    expect(next.sets).toEqual([1, 2, 3].map(() => ({ w: 72.5, r: 8, done: false })))
  })

  it('survives a JSON persistence round-trip without changing the next prescription', () => {
    let S = finish(state([]), 8)
    S = finish(S, 9)
    const before = buildEntry(S)
    const restored = JSON.parse(JSON.stringify(S))
    const after = buildEntry(restored)
    expect(after).toEqual(before)
    expect(after.target).toMatchObject({ targetReps: 10, restSeconds: 120, topRangeStreak: 0 })
  })

  it('carries adaptive recovery into the snapshot and timer, including the cap', () => {
    let S = finish(state([]), 8, [8, 7, 7])
    let entry = buildEntry(S)
    expect(entry.plan.restSeconds).toBe(150)
    expect(entry.target.restSeconds).toBe(150)
    expect(restSecondsFor(entry, 90)).toBe(150)

    const nearCap = { ...cfg, restSeconds: 230 }
    S = state([{ d: '2026-08-01', entries: [{
      id: ID, target: { ...nearCap, targetReps: 8, reps: 8, prog: 'confirmed_rep_range' },
      sets: [8, 7, 7].map(r => ({ w: 70, r, done: true }))
    }] }])
    entry = buildEntry(S, nearCap)
    expect(restSecondsFor(entry, 90)).toBe(240)
  })

  it('uses target recovery before the profile fallback when a legacy plan lacks it', () => {
    expect(restSecondsFor({ plan: {}, target: { restSeconds: 180 } }, 90)).toBe(180)
    expect(restSecondsFor({ plan: {}, target: {} }, 90)).toBe(90)
  })

  it('resets only recovery and snapshots a new epoch for the next workout', () => {
    let S = finish(state([]), 8, [8, 7, 7])
    S = finish(S, 8, [8, 7, 7])
    const before = buildEntry(S).plan
    expect(before).toMatchObject({ weight: 70, reps: 8, restSeconds: 180, topRangeStreak: 0 })

    resetConfirmedRepRangeRest(S, ID, { epochId: 'manual-reset-1', resetSeconds: 120, resetAt: 1000 })
    const after = buildEntry(S)
    expect(after.plan).toMatchObject({
      weight: before.weight, reps: before.reps, topRangeStreak: before.topRangeStreak,
      restSeconds: 120, restEpochId: 'manual-reset-1', restSource: 'manual_reset',
      restResetPending: true
    })
    expect(after.target).toMatchObject({ restSeconds: 120, restEpochId: 'manual-reset-1' })
    expect(restSecondsFor(after, 90)).toBe(120)
  })

  it('ignores old-epoch recovery, then adapts normally inside the new epoch', () => {
    let S = finish(state([]), 8, [8, 7, 7])
    S = finish(S, 8, [8, 7, 7])
    resetConfirmedRepRangeRest(S, ID, { epochId: 'manual-reset-1', resetSeconds: 120, resetAt: 1000 })

    const resetEntry = buildEntry(S)
    S = logEntry(S, resetEntry, [8, 7, 7])
    const next = buildEntry(S)
    expect(next.plan).toMatchObject({
      restSeconds: 150, restEpochId: 'manual-reset-1', restSource: 'adaptive_increase',
      restResetPending: false
    })
    expect(next.target).toMatchObject({ restSeconds: 150, restEpochId: 'manual-reset-1' })
  })

  it('keeps a reset pending across discard, JSON round-trip and deletion of post-reset workouts', () => {
    let S = finish(state([]), 8, [8, 7, 7])
    resetConfirmedRepRangeRest(S, ID, { epochId: 'manual-reset-1', resetSeconds: 120, resetAt: 1000 })

    buildEntry(S) // starting and discarding a workout never writes a completed session
    S = JSON.parse(JSON.stringify(S))
    expect(buildEntry(S).plan).toMatchObject({ restSeconds: 120, restResetPending: true })

    S = logEntry(S, buildEntry(S), [8, 8, 8])
    expect(buildEntry(S).plan.restResetPending).toBe(false)
    S = { ...S, workouts: S.workouts.filter(w => !w.entries[0].target?.restEpochId) }
    expect(buildEntry(S).plan).toMatchObject({ restSeconds: 120, restResetPending: true })
  })

  it('does not let a workout already started in the old epoch consume the reset', () => {
    let S = finish(state([]), 8, [8, 7, 7])
    const alreadyStarted = buildEntry(S)
    expect(alreadyStarted.target.restEpochId).toBeUndefined()
    resetConfirmedRepRangeRest(S, ID, { epochId: 'manual-reset-1', resetSeconds: 120, resetAt: 1000 })
    S = logEntry(S, alreadyStarted, [8, 8, 8])

    expect(buildEntry(S).plan).toMatchObject({
      reps: 9, restSeconds: 120, restEpochId: 'manual-reset-1', restResetPending: true
    })
  })

  it('applies one exercise-level reset through routine inheritance in every routine', () => {
    const inheritedCfg = { ...cfg }
    delete inheritedCfg.prog
    const S = state([])
    S.routines = [
      { id: 'a', prog: 'confirmed_rep_range', ex: [inheritedCfg] },
      { id: 'b', prog: 'confirmed_rep_range', ex: [inheritedCfg] }
    ]
    resetConfirmedRepRangeRest(S, ID, { epochId: 'global-reset', resetSeconds: 120, resetAt: 1000 })

    expect(nextPrescription(S, inheritedCfg, S.routines[0])).toMatchObject({ restEpochId: 'global-reset', restSeconds: 120 })
    expect(nextPrescription(S, inheritedCfg, S.routines[1])).toMatchObject({ restEpochId: 'global-reset', restSeconds: 120 })
  })
})
