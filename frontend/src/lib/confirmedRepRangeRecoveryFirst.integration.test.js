import { describe, expect, it } from 'vitest'
import { nextPrescription, applyPrescription } from './progression.js'
import { buildSets } from './history.js'
import { targetForPrescription } from './workout-prescription.js'
import { resetConfirmedRepRangeRest } from './confirmedRepRangeRest.js'
import { normalizeProgressionScopes, progressionScopeSnapshot } from './progression-scope.js'

const cfg = {
  id: 'recovery-first-lift', mode: 'reps', sets: 5, reps: 3,
  minReps: 3, maxReps: 5, weight: 93.75, inc: 2,
  restSeconds: 240, maxRestSeconds: 300,
  restReductionStrategy: 'auto_after_successes', prog: 'confirmed_rep_range'
}
const state = () => ({ unit: 'kg', restSec: 90, workouts: [], exWeights: {} })
function logged(config = cfg, { rest = 270, base = config.restSeconds, epoch, reps,
  target = config.maxReps, weight = config.weight, snapshot = {} } = {}) {
  return {
    d: '2026-09-28',
    entries: [{
      id: config.id,
      ...progressionScopeSnapshot(config),
      target: {
        ...config, reps: target, targetReps: target, rangeStep: 1,
        restSeconds: rest, restBaseSeconds: base,
        ...(epoch ? { restEpochId: epoch } : {}), ...snapshot
      },
      sets: (reps || Array(config.sets).fill(config.maxReps))
        .map(r => ({ w: weight, r: r ?? 0, done: r != null }))
    }]
  }
}
function finishNext(S, config = cfg, reps = config.maxReps) {
  const plan = nextPrescription(S, config)
  const target = targetForPrescription(config, plan)
  S.workouts.push({
    d: `2026-10-${String(S.workouts.length + 1).padStart(2, '0')}`,
    entries: [{
      id: config.id, ...progressionScopeSnapshot(config), target,
      sets: applyPrescription(buildSets(S, config), plan)
        .map((set, i) => ({ ...set, r: Array.isArray(reps) ? (reps[i] ?? 0) : reps,
          done: !Array.isArray(reps) || reps[i] != null }))
    }]
  })
  return nextPrescription(S, config)
}

describe('Confirmed recovery-first progression', () => {
  it('reproduces the screenshot: 93.75 kg, 5x5 at 270 s earns rest 1/4 but no maximum confirmation', () => {
    const S = { ...state(), workouts: [logged()] }
    const before = JSON.stringify(S)
    const plan = nextPrescription(S, cfg)
    expect(plan).toMatchObject({
      kind: 'hold', weight: 93.75, reps: 5, restSeconds: 270,
      restSuccessStreak: 1, topRangeStreak: 0
    })
    expect(plan.why[0]).toContain('progression is paused')
    expect(plan.restWhy).toEqual([
      'Recovery stays at {0}s — automatic reduction progress: {1} / {2} successful sessions.', 270, 1, 4
    ])
    expect(JSON.stringify(S)).toBe(before)
  })

  it.each([2, 3])('holds load after %i maximum sessions above base', n => {
    const S = { ...state(), workouts: Array.from({ length: n }, () => logged()) }
    expect(nextPrescription(S, cfg)).toMatchObject({
      weight: 93.75, reps: 5, restSeconds: 270, restSuccessStreak: n, topRangeStreak: 0
    })
  })

  it('reduces after four, then requires two actual base prescriptions before adding exactly 2 kg', () => {
    const S = { ...state(), workouts: [logged()] }
    for (let n = 2; n <= 4; n++) {
      expect(finishNext(S)).toMatchObject({
        weight: 93.75, reps: 5, restSeconds: n === 4 ? 240 : 270, topRangeStreak: 0,
        restSuccessStreak: n === 4 ? 0 : n
      })
    }
    expect(nextPrescription(S, cfg).why[0]).toContain('two new maximum-rep sessions')
    expect(finishNext(S)).toMatchObject({ weight: 93.75, restSeconds: 240, topRangeStreak: 1 })
    expect(finishNext(S)).toMatchObject({ weight: 95.75, reps: 3, restSeconds: 240, topRangeStreak: 0 })
    // The already-earned increment is not applied again after logging the new working weight.
    expect(finishNext(S, cfg, 3)).toMatchObject({ weight: 95.75, reps: 4, restSeconds: 240 })
    expect(S.workouts.slice(0, 4).every(w => w.entries[0].target.restSeconds === 270)).toBe(true)
    expect(S.workouts.slice(4, 6).every(w => w.entries[0].target.restSeconds === 240)).toBe(true)
  })

  it.each([120, 230, 0])('returns in 30 s steps without crossing base %i or increasing load early', base => {
    const config = { ...cfg, restSeconds: base }
    const S = { ...state(), workouts: [logged(config)] }
    const successesToBase = Math.ceil((270 - base) / 30) * 4
    for (let n = 1; n <= successesToBase; n++) {
      const plan = n === 1 ? nextPrescription(S, config) : finishNext(S, config)
      expect(plan).toMatchObject({
        weight: 93.75, topRangeStreak: 0,
        restSeconds: Math.max(base, 270 - Math.floor(n / 4) * 30)
      })
    }
    expect(finishNext(S, config).topRangeStreak).toBe(1)
    expect(finishNext(S, config)).toMatchObject({ weight: 95.75, reps: 3, restSeconds: base })
  })

  it('continues rep progression and counts target successes, not only maximums, during recovery', () => {
    const config = { ...cfg, sets: 4, minReps: 8, maxReps: 12 }
    const S = { ...state(), workouts: [logged(config, { target: 8, reps: [8, 8, 8, 8] })] }
    expect(nextPrescription(S, config)).toMatchObject({ reps: 9, restSuccessStreak: 1, topRangeStreak: 0 })
    expect(finishNext(S, config, 9)).toMatchObject({ reps: 10, restSuccessStreak: 2 })
    expect(finishNext(S, config, 10)).toMatchObject({ reps: 11, restSuccessStreak: 3 })
    expect(finishNext(S, config, 11)).toMatchObject({ reps: 12, restSeconds: 240, topRangeStreak: 0 })
  })

  it('blocks in manual mode and explains how to unlock with a manual reset', () => {
    const config = { ...cfg, restReductionStrategy: 'manual' }
    const S = { ...state(), workouts: Array.from({ length: 6 }, () => logged(config)) }
    expect(nextPrescription(S, config)).toMatchObject({ weight: 93.75, restSeconds: 270, topRangeStreak: 0 })
    expect(nextPrescription(S, config).restWhy[0]).toContain('manual reset')
    resetConfirmedRepRangeRest(S, config, { epochId: 'new', resetSeconds: 240, resetAt: 1 })
    expect(nextPrescription(S, config)).toMatchObject({ weight: 93.75, reps: 5, restSeconds: 240, topRangeStreak: 0 })
    expect(finishNext(S, config).topRangeStreak).toBe(1)
    expect(finishNext(S, config).weight).toBe(95.75)
  })

  it('invalidates even an at-base confirmation when a manual reset opens a new epoch', () => {
    const S = { ...state(), workouts: [logged(cfg, { rest: 240 })] }
    expect(nextPrescription(S, cfg).topRangeStreak).toBe(1)
    const before = JSON.stringify(S.workouts)
    resetConfirmedRepRangeRest(S, cfg, { epochId: 'new', resetSeconds: 240, resetAt: 1 })
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 93.75, reps: 5, topRangeStreak: 0 })
    expect(JSON.stringify(S.workouts)).toBe(before)
    expect(finishNext(S).topRangeStreak).toBe(1)
  })

  it.each([
    [4, 5, 5, 5, 5], // first-set failure: recovery stays at base
    [5, 4, 5, 5, 5], // later-set failure: recovery rises, confirmations suspend
    [5, 5, null, 5, 5] // incomplete: no invented adaptive increase
  ].map(reps => [reps]))('breaks confirmations on an unsuccessful prescription %j', reps => {
    const S = { ...state(), workouts: [logged(cfg, { rest: 240 })] }
    const next = finishNext(S, cfg, reps)
    expect(next).toMatchObject({ weight: 93.75, topRangeStreak: 0 })
    expect(next.restSeconds).toBe(reps[1] === 4 ? 270 : 240)
    const afterSuccess = finishNext(S)
    expect(afterSuccess.weight).toBe(93.75)
    expect(afterSuccess.topRangeStreak).toBe(reps[1] === 4 ? 0 : 1)
  })

  it('does not reuse above-base confirmations after editing the base to that duration', () => {
    const S = { ...state(), workouts: [logged(), logged()] }
    const higherBase = { ...cfg, restSeconds: 270 }
    expect(nextPrescription(S, higherBase)).toMatchObject({ weight: 93.75, restSeconds: 270, topRangeStreak: 0 })
    expect(finishNext(S, higherBase).topRangeStreak).toBe(1)
    expect(finishNext(S, higherBase).weight).toBe(95.75)
  })

  it('raises future recovery to a raised base and requires fresh confirmations there', () => {
    const S = { ...state(), workouts: [logged(cfg, { rest: 240 })] }
    const higherBase = { ...cfg, restSeconds: 300 }
    const before = JSON.stringify(S.workouts)
    expect(nextPrescription(S, higherBase)).toMatchObject({
      weight: 93.75, restSeconds: 300, restSource: 'base_floor', topRangeStreak: 0
    })
    expect(JSON.stringify(S.workouts)).toBe(before)
    expect(finishNext(S, higherBase).topRangeStreak).toBe(1)
  })

  it('treats a lowered base as a new recovery phase without reinterpreting old successes', () => {
    const S = { ...state(), workouts: [logged(cfg, { rest: 240 }), logged(cfg, { rest: 240 })] }
    const lowerBase = { ...cfg, restSeconds: 210 }
    expect(nextPrescription(S, lowerBase)).toMatchObject({
      weight: 93.75, restSeconds: 240, restSuccessStreak: 0, topRangeStreak: 0
    })
  })

  it.each([
    { restSeconds: undefined }, { restBaseSeconds: undefined },
    { restSeconds: null }, { restBaseSeconds: null },
    { restSeconds: '' }, { restBaseSeconds: false }
  ])('keeps incomplete legacy recovery snapshots readable without awarding maximum credit: %j', snapshot => {
    const S = { ...state(), workouts: [logged(cfg, { rest: 240, snapshot }), logged(cfg, { rest: 240, snapshot })] }
    const before = JSON.stringify(S)
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 93.75, reps: 5, topRangeStreak: 0 })
    expect(JSON.stringify(S)).toBe(before)
    expect(finishNext(S).topRangeStreak).toBe(1)
    expect(finishNext(S).weight).toBe(95.75)
  })

  it('keeps an already increased historical load and the active workout snapshot unchanged', () => {
    const S = { ...state(), workouts: [logged(cfg, { weight: 95.75 })] }
    S.active = { entries: [{ target: { weight: 97.75, restSeconds: 270 }, plan: { topRangeStreak: 1 } }] }
    const before = JSON.stringify(S)
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 95.75, restSeconds: 270, topRangeStreak: 0 })
    expect(JSON.stringify(S)).toBe(before)
    expect(nextPrescription(JSON.parse(before), cfg)).toEqual(nextPrescription(S, cfg))
  })

  it.each([[8, 8], [8, 10]])('unlocks narrow range %i–%i only after recovery and two fresh maximums', (minReps, maxReps) => {
    const config = { ...cfg, sets: 4, minReps, maxReps }
    const S = { ...state(), workouts: [logged(config, { target: minReps }), logged(config, { target: minReps })] }
    expect(nextPrescription(S, config)).toMatchObject({ weight: 93.75, reps: maxReps, topRangeStreak: 0 })
    finishNext(S, config)
    expect(finishNext(S, config).restSeconds).toBe(240)
    expect(finishNext(S, config).topRangeStreak).toBe(1)
    expect(finishNext(S, config)).toMatchObject({ weight: 95.75, reps: minReps })
  })

  it('applies recovery-first to bodyweight set progression without inventing load', () => {
    const config = { ...cfg, sets: 3, bodyweight: true, weight: 0 }
    const S = { ...state(), workouts: [logged(config), logged(config)] }
    const held = nextPrescription(S, config)
    expect(held).toMatchObject({ weight: 0, reps: 5, topRangeStreak: 0 })
    expect(held.sets).toBeUndefined()
    finishNext(S, config)
    finishNext(S, config)
    expect(finishNext(S, config).topRangeStreak).toBe(1)
    expect(finishNext(S, config)).toMatchObject({ weight: 0, reps: 3, sets: 4 })
  })

  it('keeps independent routines isolated while sharing the new rule in compatible scopes', () => {
    const S = { ...state(), routines: [
      { id: 'monday', ex: [{ ...cfg }] },
      { id: 'thursday', ex: [{ ...cfg, sets: 4 }] },
      { id: 'shared', ex: [{ ...cfg }] }
    ] }
    normalizeProgressionScopes(S)
    const [a, b, shared] = S.routines.map(r => r.ex[0])
    expect(a.progressionId).toBe(shared.progressionId)
    expect(a.progressionId).not.toBe(b.progressionId)
    S.workouts = [logged(a), logged(b, { rest: 240 }), logged(a)]
    expect(nextPrescription(S, a)).toMatchObject({ restSeconds: 270, topRangeStreak: 0 })
    expect(nextPrescription(S, shared)).toMatchObject({ restSeconds: 270, topRangeStreak: 0 })
    expect(nextPrescription(S, b)).toMatchObject({ restSeconds: 240, topRangeStreak: 1 })
  })

  it('applies the same gate when Confirmed is inherited from the routine', () => {
    const inherited = { ...cfg }
    delete inherited.prog
    const routine = { id: 'inherited', prog: 'confirmed_rep_range', ex: [inherited] }
    const S = { ...state(), routines: [routine], workouts: [logged(), logged()] }
    expect(nextPrescription(S, inherited, routine)).toMatchObject({
      policy: 'confirmed_rep_range', weight: 93.75, restSeconds: 270, topRangeStreak: 0
    })
    S.workouts.push(logged(cfg, { rest: 240 }), logged(cfg, { rest: 240 }))
    expect(nextPrescription(S, inherited, routine)).toMatchObject({ weight: 95.75, reps: 3 })
  })

  it('ignores surplus sets but rejects mixed loads within the prescribed sets', () => {
    const S = { ...state(), workouts: [logged(cfg, { rest: 240 }), logged(cfg, { rest: 240 })] }
    S.workouts[1].entries[0].sets.push({ w: 1, r: 0, done: true })
    expect(nextPrescription(S, cfg).weight).toBe(95.75)
    S.workouts[1].entries[0].sets[1].w = 95.75
    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 93.75, reps: 5, topRangeStreak: 0 })
  })
})
