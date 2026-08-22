import { describe, expect, it } from 'vitest'
import { buildSets } from './history.js'
import { applyPrescription, nextPrescription } from './progression.js'
import { restSecondsFor } from './workout-timer.js'

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
  const target = {
    ...exercise,
    ...(plan.policy === 'confirmed_rep_range' ? { prog: plan.policy } : {}),
    ...(plan.reps != null ? { reps: plan.reps, targetReps: plan.reps } : {}),
    ...(plan.restSeconds != null ? { restSeconds: plan.restSeconds } : {}),
    ...(plan.topRangeStreak != null ? { topRangeStreak: plan.topRangeStreak } : {})
  }
  return { id: exercise.id, target, plan, sets: applyPrescription(buildSets(S, exercise), plan) }
}

function finish(S, expectedReps, actualReps = [expectedReps, expectedReps, expectedReps]) {
  const entry = buildEntry(S)
  expect(entry.target.targetReps).toBe(expectedReps)
  expect(entry.sets.map(s => s.r)).toEqual([expectedReps, expectedReps, expectedReps])
  entry.sets.forEach((set, i) => { set.r = actualReps[i]; set.done = true })
  return { ...S, workouts: [...S.workouts, { d: `2026-08-${String(S.workouts.length + 1).padStart(2, '0')}`, entries: [entry] }] }
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
})
