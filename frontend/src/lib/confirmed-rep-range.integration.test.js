import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildSets } from './history.js'
import { applyPrescription, nextPrescription, policyFor } from './progression.js'
import { restSecondsFor } from './workout-timer.js'
import { targetForPrescription } from './workout-prescription.js'
import { resetConfirmedRepRangeRest } from './confirmedRepRangeRest.js'
import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'
import { applyConfirmedRepRangeSelection } from './confirmedRepRangeConfig.js'

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

const fixture = name => JSON.parse(readFileSync(
  new URL(`../test/fixtures/${name}`, import.meta.url),
  'utf8'
))

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

describe('Confirmed selection defaults', () => {
  it('snapshots automatic reduction for a new selection while legacy missing data stays manual', () => {
    const selected = {
      ...applyConfirmedRepRangeSelection({ ...cfg, prog: undefined }, {
        previousPolicy: 'linear',
        nextPolicy: 'confirmed_rep_range',
        profileRestSeconds: 90
      }),
      prog: 'confirmed_rep_range'
    }

    const newEntry = buildEntry(state([]), selected)
    expect(newEntry.plan.restReductionStrategy).toBe('auto_after_successes')
    expect(newEntry.target.restReductionStrategy).toBe('auto_after_successes')

    const legacyEntry = buildEntry(state([]), cfg)
    expect(legacyEntry.plan.restReductionStrategy).toBe('manual')
    expect(legacyEntry.target.restReductionStrategy).toBe('manual')
  })

  it('recognizes inherited Confirmed when mode or the local override changes', () => {
    const routine = { prog: 'confirmed_rep_range' }
    const timed = { id: 'mode-switch-lift', mode: 'time', sec: 45 }
    const reps = { ...timed, mode: 'reps' }
    const fromModeChange = applyConfirmedRepRangeSelection(reps, {
      previousPolicy: policyFor(timed, routine, 'time'),
      nextPolicy: policyFor(reps, routine, 'reps')
    })
    expect(fromModeChange.restReductionStrategy).toBe('auto_after_successes')

    const overridden = { id: 'override-lift', mode: 'reps', prog: 'double' }
    const inherited = { ...overridden, prog: undefined }
    const fromOverrideChange = applyConfirmedRepRangeSelection(inherited, {
      previousPolicy: policyFor(overridden, routine, 'reps'),
      nextPolicy: policyFor(inherited, routine, 'reps')
    })
    expect(fromOverrideChange.restReductionStrategy).toBe('auto_after_successes')
  })
})

function logEntry(S, entry, actualReps) {
  entry.sets.forEach((set, i) => { set.r = actualReps[i]; set.done = actualReps[i] != null })
  return { ...S, workouts: [...S.workouts, { d: `2026-09-${String(S.workouts.length + 1).padStart(2, '0')}`, entries: [entry] }] }
}

describe('Confirmed Rep-Range workout integration', () => {
  it('loads a complete pre-upgrade backup and ignores its configurable first target', () => {
    const legacy = fixture('confirmed-rep-range-legacy-no-history.json')
    const routine = legacy.routines[0]
    const exercise = routine.ex[0]

    expect(nextPrescription(legacy, exercise, routine)).toMatchObject({
      kind: 'first', reps: 8, inc: 2, restSeconds: 120
    })
    expect(exercise.targetReps).toBe(10)
  })

  it('keeps an authoritative target from a complete legacy workout backup', () => {
    const legacy = fixture('confirmed-rep-range-legacy-history-target-10.json')
    const routine = legacy.routines[0]
    const exercise = routine.ex[0]
    const historicalTarget = JSON.stringify(legacy.workouts[0].entries[0].target)

    expect(nextPrescription(legacy, exercise, routine)).toMatchObject({
      kind: 'up', reps: 11, weight: 70, inc: 2
    })
    expect(JSON.stringify(legacy.workouts[0].entries[0].target)).toBe(historicalTarget)
    expect(legacy.workouts[0].entries[0].target.targetReps).toBe(10)
  })

  it('keeps an already-active pre-upgrade target immutable while future progression advances', () => {
    const legacy = fixture('confirmed-rep-range-legacy-history-target-10.json')
    const historical = legacy.workouts[0].entries[0]
    legacy.active = {
      id: 'legacy-active-workout',
      entries: [{ ...JSON.parse(JSON.stringify(historical)), sets: historical.sets.map(set => ({ ...set, done: false })) }]
    }
    const activeBefore = JSON.stringify(legacy.active)

    const future = nextPrescription(legacy, legacy.routines[0].ex[0], legacy.routines[0])
    expect(future.reps).toBe(11)
    expect(legacy.active.entries[0].target.targetReps).toBe(10)
    expect(legacy.active.entries[0].sets.every(set => set.r === 10)).toBe(true)
    expect(JSON.stringify(legacy.active)).toBe(activeBefore)
  })

  it('imports a legacy shared plan, then exports only canonical increment configuration', () => {
    const parsed = parsePlan(fixture('confirmed-rep-range-legacy-plan-target-10.json'))
    const legacyExercise = parsed.routines[0].ex[0]
    expect(legacyExercise).toMatchObject({ targetReps: 10, weightIncrement: 2 })
    expect(legacyExercise).not.toHaveProperty('topRangeStreak')
    expect(legacyExercise).not.toHaveProperty('restEpochId')
    expect(legacyExercise).not.toHaveProperty('restSuccessStreak')

    const importedState = { routines: [], week: {}, customEx: [] }
    mergePlan(importedState, parsed, { schedule: true })
    expect(importedState.routines[0].ex[0]).toMatchObject({ targetReps: 10, weightIncrement: 2 })

    const exported = buildPlanBundle(importedState)
    expect(exported.routines[0].ex[0]).toMatchObject({ inc: 2, minReps: 8, maxReps: 12 })
    expect(exported.routines[0].ex[0]).not.toHaveProperty('targetReps')
    expect(exported.routines[0].ex[0]).not.toHaveProperty('weightIncrement')
  })

  it('runs the complete Confirmed cycle when the policy is inherited from the routine', () => {
    const exercise = { ...cfg }
    delete exercise.prog
    let S = {
      unit: 'kg', restSec: 90, exWeights: {}, workouts: [],
      routines: [{ id: 'inherited', prog: 'confirmed_rep_range', ex: [exercise] }]
    }

    for (const expected of [8, 9, 10, 11, 12, 12]) {
      const plan = nextPrescription(S, exercise, S.routines[0])
      expect(plan.reps).toBe(expected)
      const target = targetForPrescription(exercise, plan)
      const sets = applyPrescription(buildSets(S, exercise), plan)
        .map(set => ({ ...set, r: expected, done: true }))
      S = {
        ...S,
        workouts: [...S.workouts, {
          d: `2026-10-${String(S.workouts.length + 1).padStart(2, '0')}`,
          entries: [{ id: exercise.id, target, sets }]
        }]
      }
    }

    expect(nextPrescription(S, exercise, S.routines[0])).toMatchObject({
      policy: 'confirmed_rep_range', kind: 'up', weight: 72.5, reps: 8
    })
  })

  it('overrides rows carried from a previous policy and snapshots the same target', () => {
    const previous = {
      d: '2026-07-31', entries: [{ id: ID, target: { sets: 3, reps: 5, prog: 'linear' },
        sets: [1, 2, 3].map(() => ({ w: 60, r: 5, done: true })) }]
    }
    const entry = buildEntry(state([previous]))
    expect(entry.plan).toMatchObject({ policy: 'confirmed_rep_range', kind: 'first', reps: 8 })
    expect(entry.target).toMatchObject({
      prog: 'confirmed_rep_range', weight: 60, reps: 8, targetReps: 8, restSeconds: 120
    })
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

  it('re-evaluates two frozen 4x8–10 results at 10 as two confirmations without rewriting them', () => {
    const accelerated = { ...cfg, sets: 4, minReps: 8, maxReps: 10, inc: 2 }
    const historicalEntry = target => ({
      id: ID,
      target: {
        ...accelerated,
        prog: 'confirmed_rep_range', reps: target, targetReps: target,
        rangeStep: 1
      },
      sets: Array.from({ length: 4 }, () => ({ w: 70, r: 10, done: true }))
    })
    const S = state([
      { d: '2026-08-01', entries: [historicalEntry(8)] },
      { d: '2026-08-02', entries: [historicalEntry(9)] }
    ])
    S.routines[0].ex[0] = accelerated
    const before = JSON.stringify(S.workouts)

    const next = buildEntry(S, accelerated)
    expect(next.plan).toMatchObject({
      policy: 'confirmed_rep_range', kind: 'up', weight: 72, reps: 8,
      minReps: 8, maxReps: 10, rangeStep: 1, topRangeStreak: 0
    })
    expect(next.target).toMatchObject({
      weight: 72, targetReps: 8, sets: 4,
      minReps: 8, maxReps: 10, rangeStep: 1
    })
    expect(next.sets).toEqual(Array.from({ length: 4 }, () => ({ w: 72, r: 8, done: false })))
    expect(JSON.stringify(S.workouts)).toBe(before)
  })

  it('keeps an added bodyweight set in every following workout snapshot', () => {
    const bodyweight = { ...cfg, weight: 0, bodyweight: true, inc: 2 }
    let S = state([1, 2].map((n) => ({
      d: `2026-08-0${n}`,
      entries: [{
        id: ID,
        target: { ...bodyweight, sets: 3, reps: 12, targetReps: 12, prog: 'confirmed_rep_range' },
        sets: [1, 2, 3].map(() => ({ w: 0, r: 12, done: true }))
      }]
    })))

    const fourSetEntry = buildEntry(S, bodyweight)
    expect(fourSetEntry.plan).toMatchObject({ weight: 0, reps: 8, sets: 4 })
    expect(fourSetEntry.target).toMatchObject({ targetReps: 8, sets: 4 })
    expect(fourSetEntry.sets).toHaveLength(4)
    fourSetEntry.sets.forEach(set => { set.r = 8; set.done = true })
    S = { ...S, workouts: [...S.workouts, { d: '2026-08-03', entries: [fourSetEntry] }] }

    const following = buildEntry(S, bodyweight)
    expect(following.plan).toMatchObject({ weight: 0, reps: 9, sets: 4 })
    expect(following.target).toMatchObject({ targetReps: 9, sets: 4 })
    expect(following.sets).toEqual([1, 2, 3, 4].map(() => ({ w: 0, r: 9, done: false })))
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

  it('snapshots a resolved default increment and keeps it stable after routine edits', () => {
    const exercise = { ...cfg }
    delete exercise.inc
    const entry = buildEntry(state([]), exercise)

    expect(entry.plan.inc).toBe(2.5)
    expect(entry.target.inc).toBe(2.5)

    exercise.inc = 5
    const restoredEntry = JSON.parse(JSON.stringify(entry))
    expect(restoredEntry.target.inc).toBe(2.5)
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
