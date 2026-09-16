import { describe, it, expect } from 'vitest'
import {
  readSession, sessionsFor, stallCount, nextPrescription, applyPrescription,
  policyFor, defaultIncrement, POLICIES_FOR, DELOAD_AFTER, MAX_BW_SETS,
  confirmedRepRangeProgression, confirmedRepRangeSession, loadIncrementFor,
  loadIncrementRawValidation, loadIncrementValidation, roundLoad
} from './progression.js'
import { buildSets } from './history.js'
import { EXDB, isBodyweightEq } from './exercises.js'

// Generic load-policy fixtures must use externally loaded exercises. Using the first catalogue
// item happened to pick a sit-up, which made a missing `bodyweight` flag semantically ambiguous
// once pure and added bodyweight became distinct modes.
const LIFT = EXDB.find(e => e.bp !== 'cardio'
  && !isBodyweightEq(e.id)
  && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp)).id
const HEAVY = EXDB.find(e => e.bp === 'upper legs' && !isBodyweightEq(e.id)).id
const CARDIO = EXDB.find(e => e.bp === 'cardio').id

// Build a state whose history is a list of sessions given as [weight, ...repsPerSet].
// A rep count of null means "the set was never checked off".
const hist = (id, rows, target) => ({
  unit: 'kg',
  workouts: rows.map((row, i) => ({
    d: '2026-01-0' + (i + 1),
    entries: [{
      id,
      target: target || { sets: 3, reps: 5, weight: row[0] },
      sets: row.slice(1).map(r => (r === null ? { w: row[0], r: 0, done: false } : { w: row[0], r, done: true }))
    }]
  }))
})

describe('readSession', () => {
  const T = { sets: 3, reps: 5 }
  it('counts a session where every set made its reps as a hit', () => {
    const s = readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 6, done: true }] })
    expect(s.ok).toBe(true)
    expect(s.weight).toBe(60)
    expect(s.amrap).toBe(6)
    expect(s.low).toBe(5)
  })

  it('counts short reps as a miss even when the set was checked off', () => {
    expect(readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 3, done: true }] }).ok).toBe(false)
  })

  it('counts an unchecked set as a miss — it was not performed', () => {
    const s = readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 0, done: false }] })
    expect(s.ok).toBe(false)
    expect(s.weight).toBe(60)       // the working weight is still known from the sets that counted
  })

  it('counts fewer sets than prescribed as a miss', () => {
    expect(readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }).ok).toBe(false)
  })

  it('refuses to call a session a hit when nothing was prescribed', () => {
    expect(readSession({ id: LIFT, target: {}, sets: [{ w: 60, r: 5, done: true }] }).ok).toBe(false)
  })

  it('reads a timed session by the hold, not by reps', () => {
    const s = readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [{ sec: 45, w: 0, done: true }, { sec: 50, w: 0, done: true }] })
    expect(s.mode).toBe('time')
    expect(s.ok).toBe(true)
    expect(s.best).toBe(50)
    expect(readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [{ sec: 45, done: true }, { sec: 30, done: true }] }).ok).toBe(false)
  })
})

describe('stallCount', () => {
  it('counts consecutive misses back from the most recent session', () => {
    expect(stallCount([{ ok: true }, { ok: true }])).toBe(0)
    expect(stallCount([{ ok: true }, { ok: false }])).toBe(1)
    expect(stallCount([{ ok: false }, { ok: false }, { ok: false }])).toBe(3)
    expect(stallCount([{ ok: false }, { ok: true }, { ok: false }])).toBe(1)
    expect(stallCount([])).toBe(0)
  })
})

describe('policyFor', () => {
  it('keeps the app\'s long-standing behaviour as the default for reps work', () => {
    expect(policyFor({ id: LIFT }, null, 'reps')).toBe('linear')
  })
  it('leaves timed and cardio work alone unless asked', () => {
    expect(policyFor({ id: LIFT, mode: 'time' }, null, 'time')).toBe('off')
    expect(policyFor({ id: CARDIO }, null, 'cardio')).toBe('off')
  })
  it('lets the exercise override the routine, and the routine override the default', () => {
    expect(policyFor({ id: LIFT }, { prog: 'greyskull' }, 'reps')).toBe('greyskull')
    expect(policyFor({ id: LIFT, prog: 'double' }, { prog: 'greyskull' }, 'reps')).toBe('double')
  })
  it('refuses a policy that makes no sense for the mode', () => {
    expect(policyFor({ id: LIFT, mode: 'time', prog: 'greyskull' }, null, 'time')).toBe('off')
    expect(policyFor({ id: CARDIO, prog: 'linear' }, null, 'cardio')).toBe('off')
    expect(POLICIES_FOR.cardio).toEqual(['off'])
  })
})

describe('defaultIncrement', () => {
  it('gives lower-body lifts the bigger jump', () => {
    expect(defaultIncrement(LIFT, 'kg')).toBe(2.5)
    expect(defaultIncrement(HEAVY, 'kg')).toBe(5)
  })
  it('scales to pounds', () => {
    expect(defaultIncrement(LIFT, 'lb')).toBe(5)
    expect(defaultIncrement(HEAVY, 'lb')).toBe(10)
  })
  it('falls back for an unknown exercise', () => {
    expect(defaultIncrement('nope', 'kg')).toBe(2.5)
  })
})

describe('configured load increment', () => {
  it('rounds working loads at the centesimal domain boundary', () => {
    expect(roundLoad(63.75)).toBe(63.75)
    expect(roundLoad(63.74999999999999)).toBe(63.75)
    expect(roundLoad(64)).toBe(64)
  })

  it.each([
    [0, 'minimum'], [-1, 'minimum'], [0.001, 'minimum'],
    [Number.NaN, 'minimum'], [Number.POSITIVE_INFINITY, 'minimum'],
    [1.234, 'precision'], [0.01, null], [1.25, null], [2, null]
  ])('validates new increment input %s explicitly', (value, expected) => {
    expect(loadIncrementValidation(value)).toBe(expected)
  })

  it.each([
    ['0,25', null], ['1.25', null], ['0.', null],
    ['-0,25', 'format'], ['2kg', 'format'], ['1..25', 'format'], ['Infinity', 'format']
  ])('rejects invalid raw increment input %s before sanitizing it', (value, expected) => {
    expect(loadIncrementRawValidation(value)).toBe(expected)
  })

  it.each([
    [65, 2, 67],
    [72.5, 2, 74.5],
    [62.5, 1.25, 63.75],
    [63.75, 0.25, 64]
  ])('adds %s + %s as an exact delta, producing %s', (weight, inc, expected) => {
    const cfg = { id: LIFT, sets: 3, reps: 5, weight, inc, prog: 'linear' }
    const p = nextPrescription(hist(LIFT, [[weight, 5, 5, 5]]), cfg)
    expect(p).toMatchObject({ kind: 'up', weight: expected, inc })
  })

  it('keeps repeated 2 kg increases as exact deltas across the full sequence', () => {
    const cfg = { id: LIFT, sets: 3, reps: 5, inc: 2, prog: 'linear' }
    const S = { unit: 'kg', workouts: [] }
    let weight = 65
    for (const expected of [67, 69, 71]) {
      S.workouts.push({
        d: `2026-02-${String(S.workouts.length + 1).padStart(2, '0')}`,
        entries: [{
          id: LIFT,
          target: { sets: 3, reps: 5, weight, inc: 2, prog: 'linear' },
          sets: [1, 2, 3].map(() => ({ w: weight, r: 5, done: true }))
        }]
      })
      const plan = nextPrescription(S, cfg)
      expect(plan).toMatchObject({ kind: 'up', weight: expected, inc: 2 })
      weight = plan.weight
    }
  })

  it('uses canonical inc before the legacy weightIncrement field', () => {
    const cfg = { id: LIFT, sets: 3, reps: 5, inc: 2, weightIncrement: 5, prog: 'linear' }
    expect(loadIncrementFor(cfg)).toBe(2)
    expect(nextPrescription(hist(LIFT, [[65, 5, 5, 5]]), cfg)).toMatchObject({ weight: 67, inc: 2 })
  })

  it('uses the default rather than a stale legacy value when canonical inc is present but invalid', () => {
    const cfg = { id: LIFT, sets: 3, reps: 5, inc: 0, weightIncrement: 5, prog: 'linear' }
    expect(loadIncrementFor(cfg)).toBe(2.5)
    expect(nextPrescription(hist(LIFT, [[65, 5, 5, 5]]), cfg)).toMatchObject({ weight: 67.5, inc: 2.5 })
  })

  it('reads weightIncrement only as a legacy fallback', () => {
    const cfg = { id: LIFT, sets: 3, reps: 5, weightIncrement: 2, prog: 'linear' }
    expect(loadIncrementFor(cfg)).toBe(2)
    expect(nextPrescription(hist(LIFT, [[65, 5, 5, 5]]), cfg)).toMatchObject({ weight: 67, inc: 2 })
  })

  it('normalizes legacy precision to hundredths for future prescriptions', () => {
    const cfg = { id: LIFT, sets: 3, reps: 5, inc: 1.234, prog: 'linear' }
    expect(loadIncrementFor(cfg)).toBe(1.23)
    expect(nextPrescription(hist(LIFT, [[65, 5, 5, 5]]), cfg)).toMatchObject({ weight: 66.23, inc: 1.23 })
  })

  it('normalizes a future increment without rewriting a legacy workout snapshot', () => {
    const cfg = { id: LIFT, sets: 3, reps: 5, inc: 1.234, prog: 'linear' }
    const S = hist(LIFT, [[65, 5, 5, 5]], {
      sets: 3, reps: 5, weight: 65, inc: 1.234, prog: 'linear'
    })
    const before = JSON.stringify(S.workouts)

    expect(nextPrescription(S, cfg)).toMatchObject({ weight: 66.23, inc: 1.23 })
    expect(JSON.stringify(S.workouts)).toBe(before)
    expect(S.workouts[0].entries[0].target.inc).toBe(1.234)
  })

  it('falls back to the established exercise default for invalid increments', () => {
    expect(loadIncrementFor({ id: LIFT, inc: 0, weightIncrement: -2 }, 'kg')).toBe(2.5)
    expect(loadIncrementFor({ id: LIFT, inc: Number.POSITIVE_INFINITY }, 'kg')).toBe(2.5)
  })

  it('exposes the resolved default in a first prescription for snapshotting', () => {
    expect(nextPrescription({ unit: 'kg', workouts: [] }, { id: LIFT, prog: 'linear' })).toMatchObject({
      kind: 'first',
      inc: 2.5
    })
  })
})

describe('linear progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }

  it('says nothing useful before there is any history', () => {
    const p = nextPrescription({ unit: 'kg', workouts: [] }, cfg)
    expect(p.kind).toBe('first')
    expect(p.weight).toBeUndefined()
  })

  it('adds the increment after a clean session', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('repeats the weight after a miss instead of advancing', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(60)
  })

  it('does not advance when the last set was left unchecked', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, null]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(60)
  })

  it('deloads after three misses in a row, onto a loadable weight', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [60, 5, 4, 4], [60, 5, 5, 4]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(55)             // 60 × 0.9 = 54 → nearest loadable 2.5 step
    expect(DELOAD_AFTER.linear).toBe(3)
  })

  it('a good session in between clears the stall', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [60, 5, 5, 5], [60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('hold')
  })

  it('never deloads below one increment, however light the lift already is', () => {
    const p = nextPrescription(hist(LIFT, [[2.5, 1, 1, 1], [2.5, 1, 1, 1], [2.5, 1, 1, 1]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(2.5)
  })

  it('always makes a deload actually lighter, even when rounding would not', () => {
    // 20 × 0.9 = 18 → nearest 2.5 step is 17.5, fine. 5 × 0.9 = 4.5 → nearest step is 5,
    // which is no deload at all, so it has to step down instead.
    const p = nextPrescription(hist(LIFT, [[5, 1, 1, 1], [5, 1, 1, 1], [5, 1, 1, 1]]), cfg)
    expect(p.weight).toBeLessThan(5)
  })

  it('uses the heavier step for a lower-body lift', () => {
    const p = nextPrescription(hist(HEAVY, [[100, 5, 5, 5]]), { id: HEAVY, sets: 3, reps: 5, prog: 'linear' })
    expect(p.weight).toBe(105)
  })

  it('honours a per-exercise increment override', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), { ...cfg, inc: 1 })
    expect(p.weight).toBe(61)
  })

  it('works in pounds', () => {
    const S = { ...hist(LIFT, [[135, 5, 5, 5]]), unit: 'lb' }
    expect(nextPrescription(S, cfg).weight).toBe(140)
  })
})

describe('bodyweight exercises', () => {
  const cfg = { id: LIFT, sets: 3, reps: 10, weight: 0, bodyweight: true, prog: 'linear' }
  const bw = rows => hist(LIFT, rows, { sets: 3, reps: 10, weight: 0, bodyweight: true })

  it('never invents a weight to deload to — there is nothing to take off a push-up', () => {
    const p = nextPrescription(bw([[0, 10, 10, 8], [0, 10, 10, 9], [0, 10, 10, 8]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(0)
    expect(p.reps).toBe(10)
  })

  it('progresses in reps instead of load after a clean session', () => {
    const p = nextPrescription(bw([[0, 10, 10, 10]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(0)
    expect(p.reps).toBe(11)
  })

  /* A ceiling turns "+1 rep forever" into a plan — issue #33. */
  it('climbs to the ceiling one rep at a time', () => {
    const p = nextPrescription(bw([[0, 10, 10, 10]]), { ...cfg, repsMax: 15 })
    expect(p.kind).toBe('up')
    expect(p.reps).toBe(11)
    expect(p.sets).toBeUndefined()
  })

  it('adds a set and restarts the range once the ceiling is reached', () => {
    const at15 = hist(LIFT, [[0, 15, 15, 15]], { sets: 3, reps: 15, weight: 0, bodyweight: true })
    const p = nextPrescription(at15, { ...cfg, reps: 10, repsMax: 15 })
    expect(p.kind).toBe('up')
    expect(p.sets).toBe(4)
    expect(p.reps).toBe(10)
    expect(p.weight).toBe(0)
  })

  it('carries an added bodyweight set into later rep prescriptions', () => {
    const S = hist(LIFT, [[0, 10, 10, 10, 10]], { sets: 4, reps: 10, weight: 0, bodyweight: true })
    const p = nextPrescription(S, { ...cfg, sets: 3, reps: 10, repsMax: 15 })
    expect(p).toMatchObject({ kind: 'up', weight: 0, reps: 11, sets: 4 })
  })

  it('does not turn an optional extra bodyweight set into a permanent prescription', () => {
    const S = hist(LIFT, [[0, 10, 10, 10, 10]], { sets: 3, reps: 10, weight: 0, bodyweight: true })
    const p = nextPrescription(S, { ...cfg, sets: 3, reps: 10, repsMax: 15 })
    expect(p).toMatchObject({ kind: 'up', weight: 0, reps: 11 })
    expect(p.sets).toBeUndefined()
  })

  it('carries the prescribed bodyweight set count even when one row is missing', () => {
    const S = hist(LIFT, [[0, 10, 10, 10]], { sets: 4, reps: 10, weight: 0, bodyweight: true })
    const p = nextPrescription(S, { ...cfg, sets: 3, reps: 10, repsMax: 15 })
    expect(p).toMatchObject({ kind: 'hold', weight: 0, reps: 10, sets: 4 })
  })

  it('uses row count for set carry in a pre-snapshot bodyweight workout', () => {
    const S = {
      unit: 'kg',
      workouts: [{
        d: '2025-12-01',
        entries: [{
          id: LIFT,
          bodyweight: true,
          sets: [1, 2, 3, 4].map(() => ({ w: 0, r: 10, done: true }))
        }]
      }]
    }
    const p = nextPrescription(S, { ...cfg, sets: 3, reps: 10, repsMax: 15 })
    expect(p).toMatchObject({ kind: 'up', weight: 0, reps: 11, sets: 4 })
  })

  it('stops adding sets at the cap and says what to do instead', () => {
    const at15 = hist(LIFT, [[0, 15, 15, 15]], { sets: 3, reps: 15, weight: 0, bodyweight: true })
    const p = nextPrescription(at15, { ...cfg, sets: MAX_BW_SETS, reps: 10, repsMax: 15 })
    expect(p.kind).toBe('hold')
    expect(p.sets).toBeUndefined()
    expect(p.why[0]).toMatch(/harder variation/)
  })

  it('leaves a belted set to the normal policies — there is a load to add now', () => {
    const belted = hist(LIFT, [[10, 10, 10, 10]], { sets: 3, reps: 10, weight: 10, bodyweight: true })
    const p = nextPrescription(belted, { ...cfg, weight: 10, repsMax: 15 })
    expect(p.kind).toBe('up')
    expect(p.weight).toBeGreaterThan(10)
    expect(p.sets).toBeUndefined()
  })

  it('steps a unilateral total by two, so it lands on 16, 18, 20 (issue #31)', () => {
    const at16 = hist(LIFT, [[0, 16, 16, 16]], { sets: 3, reps: 16, weight: 0, bodyweight: true })
    expect(nextPrescription(at16, { ...cfg, reps: 16, side: true }).reps).toBe(18)
    // and by one when it is not
    expect(nextPrescription(at16, { ...cfg, reps: 16 }).reps).toBe(17)
  })

  it('keeps climbing reps forever when no ceiling was set — the old behaviour', () => {
    const at30 = hist(LIFT, [[0, 30, 30, 30]], { sets: 3, reps: 30, weight: 0, bodyweight: true })
    const p = nextPrescription(at30, cfg)
    expect(p.kind).toBe('up')
    expect(p.reps).toBe(31)
    expect(p.sets).toBeUndefined()
  })

  it('applies to every policy, not just linear', () => {
    for (const prog of ['linear', 'greyskull', 'double']) {
      const p = nextPrescription(bw([[0, 10, 10, 4], [0, 10, 10, 4], [0, 10, 10, 4]]), { ...cfg, prog })
      expect(p.weight, prog).toBe(0)
      expect(p.kind, prog).toBe('hold')
    }
  })

  it('still adds load the moment the exercise is actually weighted', () => {
    const weighted = { ...cfg, weight: 10 }
    const p = nextPrescription(hist(LIFT, [[10, 10, 10, 10]], {
      sets: 3, reps: 10, weight: 10, bodyweight: true
    }), weighted)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(12.5)
  })

  it('starts a pure future block at zero instead of reviving added-weight history or tracked load', () => {
    const pure = { ...cfg, progressionId: 'pg-bodyweight' }
    const S = hist(LIFT, [[10, 10, 10, 10]], {
      sets: 3, reps: 10, weight: 10, bodyweight: true, prog: 'linear'
    })
    S.workouts[0].entries[0].progressionId = 'pg-bodyweight'
    S.exWeights = { [LIFT]: { w: 25, d: '2026-01-01' } }
    S.progressionWeights = { 'pg-bodyweight': { w: 20, d: '2026-01-01' } }
    const historyBefore = JSON.stringify(S.workouts)

    const prescription = nextPrescription(S, pure)
    const sets = applyPrescription(buildSets(S, pure), prescription)

    expect(prescription).toMatchObject({ kind: 'first', weight: 0 })
    expect(sets).toEqual(Array.from({ length: 3 }, () => ({ w: 0, r: 10, done: false })))
    expect(JSON.stringify(S.workouts)).toBe(historyBefore)
  })

  it('keeps pure and added-weight progressions separate while preserving both histories', () => {
    const S = {
      unit: 'kg',
      workouts: [
        hist(LIFT, [[10, 10, 10, 10]], {
          sets: 3, reps: 10, weight: 10, bodyweight: true, prog: 'linear'
        }).workouts[0],
        hist(LIFT, [[0, 10, 10, 10]], {
          sets: 3, reps: 10, weight: 0, bodyweight: true, prog: 'linear'
        }).workouts[0]
      ]
    }
    const added = { ...cfg, weight: 10 }

    expect(sessionsFor(S, LIFT, cfg)).toHaveLength(1)
    expect(nextPrescription(S, cfg)).toMatchObject({ kind: 'up', weight: 0, reps: 11 })
    expect(sessionsFor(S, LIFT, added)).toHaveLength(1)
    expect(nextPrescription(S, added)).toMatchObject({ kind: 'up', weight: 12.5 })
  })

  it('starts explicit added weight from configuration instead of an external scoped map', () => {
    const current = {
      ...cfg, weight: 10, progressionId: 'pg-transition'
    }
    const S = hist(LIFT, [[70, 10, 10, 10]], {
      sets: 3, reps: 10, weight: 70, bodyweight: false, prog: 'linear'
    })
    S.workouts[0].entries[0].progressionId = 'pg-transition'
    S.progressionWeights = { 'pg-transition': { w: 70, d: '2026-01-01' } }

    const prescription = nextPrescription(S, current)
    expect(prescription).toMatchObject({ kind: 'first' })
    expect(prescription.weight).toBeUndefined()
    expect(applyPrescription(buildSets(S, current), prescription))
      .toEqual(Array.from({ length: 3 }, () => ({ w: 10, r: 10, done: false })))
  })
})

describe('Greyskull LP', () => {
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }

  it('uses exact normal and double deltas from an off-grid load', () => {
    const exact = { ...cfg, inc: 2 }
    expect(nextPrescription(hist(LIFT, [[65, 5, 5, 5]]), exact)).toMatchObject({ weight: 67, inc: 2 })
    expect(nextPrescription(hist(LIFT, [[65, 5, 5, 10]]), exact)).toMatchObject({ weight: 69, inc: 2 })
  })

  it('advances when the final set makes the target', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('takes a double jump when the last set doubles the target reps', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 10]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(65)
    expect(p.why[0]).toContain('double')
  })

  it('resets 10 % on the very first failure, unlike plain linear', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(55)
    expect(DELOAD_AFTER.greyskull).toBe(1)
  })

  it('keeps resetting from the reduced weight, not the original', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [55, 5, 5, 2]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(50)            // 55 × 0.9 = 49.5 → nearest loadable 2.5 step
  })
})

describe('double progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 40, prog: 'double' }

  it('adds the configured increment as an exact delta from an off-grid load', () => {
    const exact = { ...cfg, inc: 2 }
    expect(nextPrescription(hist(LIFT, [[65, 12, 12, 12]], { sets: 3, reps: 12 }), exact)).toMatchObject({
      weight: 67,
      reps: 8,
      inc: 2
    })
  })

  it('adds weight and drops back to the bottom of the range at the top of it', () => {
    const p = nextPrescription(hist(LIFT, [[40, 12, 12, 12]], { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(42.5)
    expect(p.reps).toBe(8)
  })

  it('keeps the weight and asks for one more rep while inside the range', () => {
    const p = nextPrescription(hist(LIFT, [[40, 10, 9, 9]], { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(40)
    expect(p.reps).toBe(10)             // worst set was 9 → aim for 10
  })

  it('never asks for more than the top of the range', () => {
    const p = nextPrescription(hist(LIFT, [[40, 12, 12, 11]], { sets: 3, reps: 12 }), cfg)
    expect(p.reps).toBeLessThanOrEqual(12)
  })

  it('deloads after a run of stalls and restarts at the bottom of the range', () => {
    const rows = [[40, 9, 9, 9], [40, 9, 9, 9], [40, 9, 9, 9]]
    const p = nextPrescription(hist(LIFT, rows, { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('deload')
    expect(p.reps).toBe(8)
    expect(p.weight).toBe(35)           // 40 × 0.9 = 36 → nearest loadable 2.5 step
  })
})

describe('Confirmed Rep-Range progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 8, minReps: 8, maxReps: 12, targetReps: 8, weight: 70, inc: 2.5, restSeconds: 120, maxRestSeconds: 240, prog: 'confirmed_rep_range' }
  const state = rows => ({
    unit: 'kg', restSec: 90,
    workouts: rows.map((x, i) => ({
      d: `2026-02-${String(i + 1).padStart(2, '0')}`,
      entries: [{
        id: LIFT,
        target: {
          ...cfg, ...(x.snapshot || {}),
          sets: x.planned ?? x.snapshot?.sets ?? cfg.sets,
          reps: x.target, targetReps: x.target,
          restSeconds: x.rest ?? 120, topRangeStreak: x.streak ?? 0
        },
        sets: x.reps.map((r, setIndex) => r == null
          ? { w: x.weights?.[setIndex] ?? x.weight ?? 70, r: 0, done: false }
          : { w: x.weights?.[setIndex] ?? x.weight ?? 70, r, done: true })
      }]
    }))
  })

  it('always starts at the minimum and ignores a legacy configured starting target', () => {
    const first = confirmedRepRangeProgression({ unit: 'kg', restSec: 90, workouts: [] }, { ...cfg, targetReps: 10, inc: 2 })
    expect(first).toMatchObject({ kind: 'first', reps: 8, inc: 2 })
    expect(first.weight).toBeUndefined()
  })

  it('uses the configured weight when the exercise has no workout history', () => {
    const S = { unit: 'kg', restSec: 90, exWeights: {}, workouts: [] }
    const prescription = nextPrescription(S, cfg)
    const sets = applyPrescription(buildSets(S, cfg), prescription)

    expect(prescription.weight).toBeUndefined()
    expect(sets).toEqual(Array.from({ length: 3 }, () => ({ w: 70, r: 8, done: false })))
  })

  it.each([[8, 9], [9, 10], [10, 11], [11, 12]])('advances a successful target from %i to %i', (from, to) => {
    expect(confirmedRepRangeProgression(state([{ target: from, reps: [from, from, from] }]), cfg).reps).toBe(to)
  })

  it('holds weight and records the first top-range confirmation', () => {
    const p = confirmedRepRangeProgression(state([{ target: 12, reps: [12, 12, 12] }]), cfg)
    expect(p).toMatchObject({
      weight: 70,
      reps: 12,
      topRangeStreak: 1,
      why: ['Maximum reached last workout: confirmation 1 of 2 recorded. Repeat it once more at the same load to increase weight.']
    })
  })

  it('increases weight and resets target and streak after the second consecutive confirmation', () => {
    const p = confirmedRepRangeProgression(state([
      { target: 12, reps: [12, 12, 12], streak: 0 },
      { target: 12, reps: [12, 12, 12], streak: 1 }
    ]), cfg)
    expect(p).toMatchObject({ weight: 72.5, reps: 8, topRangeStreak: 0 })
  })

  it.each([
    [65, 2, 67],
    [72.5, 2, 74.5],
    [62.5, 1.25, 63.75]
  ])('applies the exact load delta after the second top confirmation (%s + %s = %s)', (weight, inc, expected) => {
    const p = confirmedRepRangeProgression(state([
      { target: 12, reps: [12, 12, 12], weight },
      { target: 12, reps: [12, 12, 12], weight }
    ]), { ...cfg, inc })
    expect(p).toMatchObject({ weight: expected, reps: 8, inc, topRangeStreak: 0 })
  })

  it('prefers canonical inc to legacy weightIncrement', () => {
    const p = confirmedRepRangeProgression(state([
      { target: 12, reps: [12, 12, 12], weight: 65 },
      { target: 12, reps: [12, 12, 12], weight: 65 }
    ]), { ...cfg, inc: 2, weightIncrement: 5 })
    expect(p).toMatchObject({ weight: 67, inc: 2 })
  })

  it('resets a top-range streak when the next session misses', () => {
    const p = confirmedRepRangeProgression(state([
      { target: 12, reps: [12, 12, 12] },
      { target: 12, reps: [12, 11, 10], streak: 1 }
    ]), cfg)
    expect(p).toMatchObject({ weight: 70, reps: 12, topRangeStreak: 0 })
  })

  it('does not increase rest when the first set misses', () => {
    expect(confirmedRepRangeProgression(state([{ target: 10, reps: [9, null, null] }]), cfg)).toMatchObject({ reps: 10, restSeconds: 120 })
  })

  it('adds 30 seconds when the first set succeeds but a later set misses', () => {
    expect(confirmedRepRangeProgression(state([{ target: 10, reps: [10, 9, 8] }]), cfg)).toMatchObject({ reps: 10, weight: 70, restSeconds: 150 })
  })

  it('caps rest exactly at the configured maximum and holds it there', () => {
    expect(confirmedRepRangeProgression(state([{ target: 10, reps: [10, 9, 8], rest: 230 }]), cfg).restSeconds).toBe(240)
    expect(confirmedRepRangeProgression(state([{ target: 10, reps: [10, 9, 8], rest: 240 }]), cfg).restSeconds).toBe(240)
  })

  it('accepts reps above target and requires every prescribed set to be complete', () => {
    expect(confirmedRepRangeSession(state([{ target: 10, reps: [12, 11, 10] }]).workouts[0].entries[0], cfg).ok).toBe(true)
    expect(confirmedRepRangeSession(state([{ target: 10, reps: [10, 10, null] }]).workouts[0].entries[0], cfg).ok).toBe(false)
  })

  it('credits the highest level demonstrated by every prescribed set', () => {
    expect(confirmedRepRangeProgression(state([{ target: 8, reps: [12, 12, 12] }]), cfg)).toMatchObject({
      kind: 'hold', reps: 12, topRangeStreak: 1
    })
  })

  describe('validated demonstrated level (RF-11.1)', () => {
    const shortCfg = { ...cfg, sets: 4, minReps: 8, maxReps: 10, inc: 2 }
    const shortState = rows => state(rows.map(row => ({
      planned: 4,
      snapshot: { minReps: 8, maxReps: 10, rangeStep: 1, sets: 4 },
      ...row
    })))

    it.each([
      [[7, 8, 8, 8], 'failed', null, 8],
      [[8, 8, 8, 8], 'success', 8, 9],
      [[9, 9, 9, 9], 'success', 9, 10],
      [[10, 10, 9, 10], 'success', 9, 10],
      [[10, 9, 8, 10], 'success', 8, 9],
      [[10, 10, 10, 10], 'top_range_success', 10, 10],
      [[11, 12, 10, 15], 'top_range_success', 10, 10]
    ])('classifies target 8 with reps %j as %s at level %s', (reps, outcome, validatedReps, nextReps) => {
      const S = shortState([{ target: 8, reps }])
      expect(confirmedRepRangeSession(S.workouts[0].entries[0], shortCfg)).toMatchObject({
        outcome, validatedReps
      })
      expect(confirmedRepRangeProgression(S, shortCfg).reps).toBe(nextReps)
    })

    it.each([
      [8, [9, 9, 9, 9], 10],
      [8, [10, 10, 9, 10], 10],
      [8, [10, 9, 8, 10], 9],
      [9, [9, 9, 9, 9], 10],
      [9, [10, 10, 10, 10], 10]
    ])('advances target %i from the minimum result across prescribed sets', (target, reps, next) => {
      expect(confirmedRepRangeProgression(shortState([{ target, reps }]), shortCfg).reps).toBe(next)
    })

    it('treats historical target 8 and 9 sessions performed at 10 as two confirmations', () => {
      const S = shortState([
        { target: 8, reps: [10, 10, 10, 10] },
        { target: 9, reps: [10, 10, 10, 10] }
      ])
      const snapshots = JSON.stringify(S.workouts)

      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'up', weight: 72, reps: 8, topRangeStreak: 0
      })
      expect(JSON.stringify(S.workouts)).toBe(snapshots)
    })

    it('counts one above-range workout as exactly one top confirmation', () => {
      expect(confirmedRepRangeProgression(shortState([
        { target: 8, reps: [14, 14, 14, 14] }
      ]), shortCfg)).toMatchObject({
        kind: 'hold', weight: 70, reps: 10, topRangeStreak: 1
      })
    })

    it.each([
      [[10, 10, 10], 'incomplete'],
      [[10, 10, null, 10], 'incomplete']
    ])('does not turn a missing prescribed row %j into an adaptive failure', (reps, outcome) => {
      const S = shortState([{ target: 8, reps }])
      expect(confirmedRepRangeSession(S.workouts[0].entries[0], shortCfg).outcome).toBe(outcome)
      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'hold', reps: 8, restSeconds: 120
      })
    })

    it('adds recovery only for a real later-set miss', () => {
      expect(confirmedRepRangeProgression(shortState([
        { target: 8, reps: [8, 7, 8, 8] }
      ]), shortCfg)).toMatchObject({ kind: 'hold', reps: 8, restSeconds: 150 })
    })

    it.each([
      [10, true],
      [1, true],
      [null, false]
    ])('keeps an optional fifth set (%s, done=%s) neutral', (extraReps, _done) => {
      const S = shortState([{ target: 8, reps: [9, 9, 9, 9, extraReps] }])
      const session = confirmedRepRangeSession(S.workouts[0].entries[0], shortCfg)
      expect(session).toMatchObject({ outcome: 'success', validatedReps: 9, planned: 4 })
      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({ reps: 10, restSeconds: 120 })
    })

    it('accepts a uniform manual load as the new baseline', () => {
      expect(confirmedRepRangeProgression(shortState([
        { target: 8, reps: [9, 9, 9, 9], weight: 72 }
      ]), shortCfg)).toMatchObject({ weight: 72, reps: 10 })
    })

    it('holds the frozen load and target when prescribed loads are mixed', () => {
      const S = shortState([{
        target: 8, reps: [10, 10, 10, 10], weights: [70, 70, 72, 70]
      }])
      expect(confirmedRepRangeSession(S.workouts[0].entries[0], shortCfg)).toMatchObject({
        outcome: 'mixed_load', loadUniform: false, workingWeight: null, weight: 70
      })
      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'hold', weight: 70, reps: 8, topRangeStreak: 0, restSeconds: 120
      })
    })

    it('starts a fresh top confirmation when the uniform working load changes', () => {
      expect(confirmedRepRangeProgression(shortState([
        { target: 8, reps: [10, 10, 10, 10], weight: 70 },
        { target: 10, reps: [10, 10, 10, 10], weight: 72 }
      ]), shortCfg)).toMatchObject({
        kind: 'hold', weight: 72, reps: 10, topRangeStreak: 1
      })
    })

    it.each([
      [{ target: 8, reps: [8, 7, 8, 8] }, 'failed'],
      [{ target: 8, reps: [8, 8, null, 8] }, 'incomplete'],
      [{ target: 8, reps: [9, 9, 9, 9] }, 'success']
    ])('breaks a previous top streak on a following %s session', (boundary, outcome) => {
      const S = shortState([
        { target: 8, reps: [10, 10, 10, 10] },
        boundary,
        { target: 8, reps: [10, 10, 10, 10] }
      ])
      expect(confirmedRepRangeSession(S.workouts[1].entries[0], shortCfg).outcome).toBe(outcome)
      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'hold', reps: 10, topRangeStreak: 1
      })
    })

    it('lets a fully skipped finished prescription break two top confirmations', () => {
      const S = shortState([
        { target: 8, reps: [10, 10, 10, 10] },
        { target: 10, reps: [null, null, null, null] },
        { target: 10, reps: [10, 10, 10, 10] }
      ])

      expect(confirmedRepRangeSession(S.workouts[1].entries[0], shortCfg).outcome).toBe('incomplete')
      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'hold', weight: 70, reps: 10, topRangeStreak: 1
      })
    })

    it('keeps a real later-set failure and adaptive recovery even when loads are mixed', () => {
      const S = shortState([{
        target: 8, reps: [8, 7, 8, 8], weights: [70, 72, 70, 70]
      }])
      expect(confirmedRepRangeSession(S.workouts[0].entries[0], shortCfg)).toMatchObject({
        outcome: 'failed', loadUniform: false, workingWeight: null
      })
      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'hold', weight: 70, reps: 8, restSeconds: 150
      })
    })

    it('falls back to the scoped operational load when an old mixed snapshot has no weight', () => {
      const scoped = { ...shortCfg, progressionId: 'pg-short' }
      const S = shortState([{
        target: 8, reps: [10, 10, 10, 10], weights: [70, 72, 70, 70]
      }])
      S.workouts[0].entries[0].progressionId = 'pg-short'
      delete S.workouts[0].entries[0].target.weight
      S.progressionWeights = { 'pg-short': { w: 70, d: '2026-08-01' } }

      expect(confirmedRepRangeProgression(S, scoped)).toMatchObject({
        kind: 'hold', weight: 70, reps: 8
      })
    })

    it.each([
      ['incomplete', [8, null, null, null], [100, 100, 100, 100]],
      ['mixed', [8, 8, 8, 8], [100, 102, 100, 100]]
    ])('never promotes an isolated %s Confirmed load when its snapshot weight is missing', (_case, reps, weights) => {
      const S = shortState([{ target: 8, reps, weights }])
      delete S.workouts[0].entries[0].target.weight

      expect(S.progressionWeights).toBeUndefined()
      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'hold', weight: 70, reps: 8
      })
    })

    it('uses the last complete uniform Confirmed load behind an unsafe current workout', () => {
      const S = shortState([
        { target: 8, reps: [9, 9, 9, 9], weight: 72 },
        { target: 9, reps: [9, null, null, null], weights: [100, 100, 100, 100] }
      ])
      delete S.workouts[1].entries[0].target.weight

      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'hold', weight: 72, reps: 9
      })
    })

    it('does not invent the minimum when a malformed historical result is below the range', () => {
      const S = shortState([{ target: 7, reps: [7, 7, 7, 7] }])
      expect(confirmedRepRangeSession(S.workouts[0].entries[0], shortCfg)).toMatchObject({
        outcome: 'below_range_success', validatedReps: null
      })
      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'hold', reps: 8, topRangeStreak: 0
      })
    })

    it('starts a changed range instead of reinterpreting an out-of-range legacy target', () => {
      const S = shortState([{ target: 8, reps: [10, 10, 10, 10] }])
      delete S.workouts[0].entries[0].target.minReps
      delete S.workouts[0].entries[0].target.maxReps
      delete S.workouts[0].entries[0].target.rangeStep

      expect(confirmedRepRangeProgression(S, { ...shortCfg, minReps: 10, maxReps: 15 })).toMatchObject({
        kind: 'first', weight: 70, reps: 10, topRangeStreak: 0
      })
    })

    it('does not accelerate a legacy snapshot whose rep range is missing', () => {
      const S = shortState([{ target: 8, reps: [10, 10, 10, 10] }])
      delete S.workouts[0].entries[0].target.minReps
      delete S.workouts[0].entries[0].target.maxReps
      delete S.workouts[0].entries[0].target.rangeStep

      expect(confirmedRepRangeSession(S.workouts[0].entries[0], shortCfg)).toMatchObject({
        outcome: 'legacy_success', rangeKnown: false, validatedReps: null
      })
      expect(confirmedRepRangeProgression(S, shortCfg)).toMatchObject({
        kind: 'up', reps: 9, topRangeStreak: 0
      })
    })
  })

  it('uses the historical snapshot target even when routine targetReps disagrees', () => {
    const S = state([{ target: 10, reps: [10, 10, 10] }])
    const session = confirmedRepRangeSession(S.workouts[0].entries[0], { ...cfg, targetReps: 8 })
    expect(session).toMatchObject({ goal: 10, ok: true })
    expect(confirmedRepRangeProgression(S, { ...cfg, targetReps: 8 }).reps).toBe(11)
  })

  it('starts the edited range without reinterpreting an older snapshot', () => {
    const S = state([{ target: 8, reps: [8, 8, 8] }])
    const historyBefore = JSON.stringify(S.workouts)
    const controlsBefore = JSON.stringify(S.progressionControls)

    // The previous workout keeps its own 8–12 range. A new 10–15 range starts from its minimum
    // and preserves only the operational load; no marker or historical rewrite is needed.
    expect(confirmedRepRangeProgression(S, { ...cfg, minReps: 10, maxReps: 15 })).toMatchObject({
      kind: 'first', reps: 10, weight: 70
    })
    expect(JSON.stringify(S.workouts)).toBe(historyBefore)
    expect(JSON.stringify(S.progressionControls)).toBe(controlsBefore)
  })

  it('does not create a rep baseline when only increment or recovery configuration changes', () => {
    const S = state([{ target: 10, reps: [10, 10, 10], rest: 120 }])
    const historyBefore = JSON.stringify(S.workouts)
    const changed = { ...cfg, inc: 2, restSeconds: 90, maxRestSeconds: 180 }

    expect(confirmedRepRangeProgression(S, changed)).toMatchObject({
      kind: 'up', reps: 11, weight: 70, inc: 2, restSeconds: 120
    })
    expect(JSON.stringify(S.workouts)).toBe(historyBefore)
  })

  it('holds the historical snapshot target after a failure', () => {
    const p = confirmedRepRangeProgression(state([{ target: 10, reps: [10, 9, 9] }]), { ...cfg, targetReps: 8 })
    expect(p).toMatchObject({ kind: 'hold', reps: 10, weight: 70 })
  })

  it('advances total-per-side targets by two through the range', () => {
    const sideCfg = { ...cfg, side: true, minReps: 16, maxReps: 20, targetReps: 19 }
    const snapshot = { side: true, minReps: 16, maxReps: 20, rangeStep: 2 }
    expect(confirmedRepRangeProgression(state([{ target: 16, reps: [16, 16, 16], snapshot }]), sideCfg).reps).toBe(18)
    expect(confirmedRepRangeProgression(state([{ target: 18, reps: [18, 18, 18], snapshot }]), sideCfg).reps).toBe(20)
  })

  it('supports a fixed range with two confirmations before increasing load', () => {
    const fixed = { ...cfg, minReps: 8, maxReps: 8, targetReps: 12, inc: 2 }
    const snapshot = { minReps: 8, maxReps: 8 }
    expect(confirmedRepRangeProgression(state([{ target: 8, reps: [8, 8, 8], snapshot }]), fixed)).toMatchObject({
      kind: 'hold', weight: 70, reps: 8, topRangeStreak: 1
    })
    expect(confirmedRepRangeProgression(state([
      { target: 8, reps: [8, 8, 8], snapshot },
      { target: 8, reps: [8, 8, 8], snapshot }
    ]), fixed)).toMatchObject({ kind: 'up', weight: 72, reps: 8, topRangeStreak: 0 })
  })

  it('adds a set instead of inventing load after two bodyweight top confirmations', () => {
    const bodyweight = { ...cfg, bodyweight: true, weight: 0, inc: 2 }
    const p = confirmedRepRangeProgression(state([
      { target: 12, reps: [12, 12, 12], weight: 0, snapshot: { bodyweight: true, weight: 0 } },
      { target: 12, reps: [12, 12, 12], weight: 0, snapshot: { bodyweight: true, weight: 0 } }
    ]), bodyweight)

    expect(p).toMatchObject({ kind: 'up', weight: 0, reps: 8, sets: 4, topRangeStreak: 0 })
    expect(p.why[0]).toMatch(/add a set/)
  })

  it('honours an explicit future set-count boundary after bodyweight volume had grown', () => {
    const bodyweight = {
      ...cfg, sets: 3, bodyweight: true, weight: 0, inc: 2,
      setBaselineId: 'sets-reset-to-three'
    }
    const S = state([
      { target: 12, reps: [12, 12, 12], weight: 0 },
      { target: 12, reps: [12, 12, 12], weight: 0 },
      { target: 8, reps: [8, 8, 8, 8], weight: 0, planned: 4 }
    ])
    S.workouts[2].entries[0].target.sets = 4
    S.exWeights = {}

    const plan = confirmedRepRangeProgression(S, bodyweight)
    expect(plan).toMatchObject({ kind: 'first', weight: 0, reps: 8, setBaselineId: 'sets-reset-to-three' })
    expect(plan.sets).toBeUndefined()
    expect(applyPrescription(buildSets(S, bodyweight), plan)).toHaveLength(3)
  })

  it('keeps the added Confirmed bodyweight set throughout the following range', () => {
    const bodyweight = { ...cfg, bodyweight: true, weight: 0, inc: 2 }
    const S = state([
      { target: 12, reps: [12, 12, 12], weight: 0, snapshot: { bodyweight: true, weight: 0 } },
      { target: 12, reps: [12, 12, 12], weight: 0, snapshot: { bodyweight: true, weight: 0 } },
      { target: 8, reps: [8, 8, 8, 8], weight: 0, snapshot: { bodyweight: true, weight: 0 } }
    ])
    S.workouts[2].entries[0].target.sets = 4

    expect(confirmedRepRangeProgression(S, bodyweight)).toMatchObject({
      kind: 'up', weight: 0, reps: 9, sets: 4
    })
  })

  it('holds bodyweight work at six sets and recommends load or a harder variation', () => {
    const bodyweight = { ...cfg, sets: MAX_BW_SETS, bodyweight: true, weight: 0, inc: 2 }
    const S = state([
      { target: 12, reps: Array(MAX_BW_SETS).fill(12), weight: 0, snapshot: { bodyweight: true, weight: 0 } },
      { target: 12, reps: Array(MAX_BW_SETS).fill(12), weight: 0, snapshot: { bodyweight: true, weight: 0 } }
    ])
    S.workouts.forEach(workout => { workout.entries[0].target.sets = MAX_BW_SETS })

    const p = confirmedRepRangeProgression(S, bodyweight)
    expect(p).toMatchObject({ kind: 'hold', weight: 0, reps: 12, topRangeStreak: 0 })
    expect(p.sets).toBeUndefined()
    expect(p.why[0]).toMatch(/harder variation/)
  })

  it('does not combine added-weight and pure top confirmations', () => {
    const bodyweight = { ...cfg, bodyweight: true, weight: 0, inc: 2 }
    const S = state([
      {
        target: 12,
        reps: [12, 12, 12],
        weight: 10,
        snapshot: { bodyweight: true, weight: 10 }
      },
      {
        target: 12,
        reps: [12, 12, 12],
        weight: 0,
        snapshot: { bodyweight: true, weight: 0 }
      }
    ])
    const historyBefore = JSON.stringify(S.workouts)

    expect(confirmedRepRangeProgression(S, bodyweight)).toMatchObject({
      kind: 'hold',
      weight: 0,
      reps: 12,
      topRangeStreak: 1,
      why: ['Maximum reached last workout: confirmation 1 of 2 recorded. Repeat it once more to complete the progression step.']
    })
    expect(JSON.stringify(S.workouts)).toBe(historyBefore)
  })

  it('does not carry adaptive recovery from added weight into a new pure block', () => {
    const bodyweight = { ...cfg, bodyweight: true, weight: 0, inc: 2 }
    const S = state([{
      target: 10,
      reps: [10, 9, 8],
      weight: 10,
      rest: 150,
      snapshot: { bodyweight: true, weight: 10 }
    }])

    expect(confirmedRepRangeProgression(S, bodyweight)).toMatchObject({
      kind: 'first', weight: 0, reps: 8, restSeconds: 120, topRangeStreak: 0
    })
  })

  it('starts Confirmed added weight from configuration instead of an incompatible scoped map', () => {
    const added = {
      ...cfg, bodyweight: true, weight: 10, progressionId: 'pg-confirmed-transition'
    }
    const S = hist(LIFT, [[70, 8, 8, 8]], {
      sets: 3, reps: 8, weight: 70, bodyweight: false, prog: 'linear'
    })
    S.restSec = 90
    S.workouts[0].entries[0].progressionId = 'pg-confirmed-transition'
    S.progressionWeights = { 'pg-confirmed-transition': { w: 70, d: '2026-01-01' } }

    const prescription = confirmedRepRangeProgression(S, added)
    expect(prescription).toMatchObject({ kind: 'first', reps: 8 })
    expect(prescription.weight).toBeUndefined()
    expect(applyPrescription(buildSets(S, added), prescription))
      .toEqual(Array.from({ length: 3 }, () => ({ w: 10, r: 8, done: false })))
  })

  it('treats a frozen pure target as zero load even if legacy rows contain an invisible weight', () => {
    const bodyweight = { ...cfg, bodyweight: true, weight: 0, inc: 2 }
    const S = state([{
      target: 8,
      reps: [9, 9, 9],
      weights: [70, 70, 70],
      snapshot: { bodyweight: true, weight: 0 }
    }])
    const entry = S.workouts[0].entries[0]
    const historyBefore = JSON.stringify(S.workouts)

    expect(confirmedRepRangeSession(entry, bodyweight)).toMatchObject({
      loadMode: 'pure_bodyweight', workingWeight: 0, prescribedWeight: 0
    })
    expect(confirmedRepRangeProgression(S, bodyweight)).toMatchObject({
      kind: 'up', weight: 0, reps: 10
    })
    expect(JSON.stringify(S.workouts)).toBe(historyBefore)
  })

  it('keeps an odd legacy per-side target after failure and moves to the next even target after success', () => {
    const sideCfg = { ...cfg, side: true, minReps: 16, maxReps: 20 }
    const snapshot = { side: true, minReps: 16, maxReps: 20, rangeStep: 2 }
    expect(confirmedRepRangeProgression(state([{ target: 17, reps: [17, 16, 17], snapshot }]), sideCfg)).toMatchObject({
      kind: 'hold', reps: 17
    })
    expect(confirmedRepRangeProgression(state([{ target: 17, reps: [17, 17, 17], snapshot }]), sideCfg)).toMatchObject({
      kind: 'up', reps: 18
    })
  })

  it('ignores extra sets but never lets them rescue a missed prescribed set', () => {
    expect(confirmedRepRangeSession(state([{ target: 10, reps: [10, 10, 10, 1] }]).workouts[0].entries[0], cfg).ok).toBe(true)
    expect(confirmedRepRangeSession(state([{ target: 10, reps: [10, 9, 10, 20] }]).workouts[0].entries[0], cfg).ok).toBe(false)
  })

  it('loads legacy exercise configs without any of the new fields', () => {
    const legacy = { id: LIFT, sets: 3, reps: 8, weight: 70, prog: 'confirmed_rep_range' }
    expect(() => nextPrescription({ unit: 'kg', restSec: 90, workouts: [] }, legacy)).not.toThrow()
    expect(nextPrescription({ unit: 'kg', restSec: 90, workouts: [] }, legacy)).toMatchObject({ reps: 8, restSeconds: 90, topRangeStreak: 0 })
  })

  it('uses canonical 8–12 defaults instead of turning ordinary reps into a 10–10 range', () => {
    const legacy = { id: LIFT, sets: 3, reps: 10, weight: 70, prog: 'confirmed_rep_range' }
    const first = nextPrescription({ unit: 'kg', restSec: 90, workouts: [] }, legacy)
    expect(first).toMatchObject({ reps: 8, restSeconds: 90, topRangeStreak: 0 })
  })

  it('does not reuse sessions logged under another progression policy', () => {
    const S = state([{ target: 12, reps: [12, 12, 12] }])
    S.workouts[0].entries[0].target.prog = 'double'
    expect(nextPrescription(S, cfg)).toMatchObject({ kind: 'first', reps: 8, topRangeStreak: 0 })
  })

  it.each(['linear', 'double', 'greyskull'])('replaces rows carried from %s when constructing the first confirmed rep-range workout', previousPolicy => {
    const S = {
      unit: 'kg', restSec: 90, exWeights: {},
      workouts: [{
        d: '2026-08-01',
        entries: [{
          id: LIFT,
          target: { id: LIFT, sets: 3, reps: 5, weight: 60, prog: previousPolicy },
          sets: Array.from({ length: 3 }, () => ({ w: 60, r: 5, done: true }))
        }]
      }]
    }

    const prescription = nextPrescription(S, cfg)
    const sets = applyPrescription(buildSets(S, cfg), prescription)

    expect(prescription).toMatchObject({ policy: 'confirmed_rep_range', kind: 'first', weight: 60, reps: 8 })
    expect(sets).toEqual(Array.from({ length: 3 }, () => ({ w: 60, r: 8, done: false })))
  })

  it('does not treat a previous timed load as the working weight for first Confirmed reps', () => {
    const S = {
      unit: 'kg', restSec: 90, exWeights: {},
      workouts: [{
        d: '2026-08-01',
        entries: [{
          id: LIFT,
          target: { id: LIFT, sets: 3, mode: 'time', sec: 45, weight: 25, prog: 'time' },
          sets: Array.from({ length: 3 }, () => ({ w: 25, sec: 45, done: true }))
        }]
      }]
    }

    const prescription = nextPrescription(S, cfg)
    const sets = applyPrescription(buildSets(S, cfg), prescription)
    expect(prescription.weight).toBeUndefined()
    expect(sets).toEqual(Array.from({ length: 3 }, () => ({ w: 70, r: 8, done: false })))
  })
})

describe('timed progression', () => {
  const cfg = { id: LIFT, mode: 'time', sets: 2, sec: 45, prog: 'time' }
  const T = { sets: 2, sec: 45, mode: 'time' }
  const timeHist = rows => ({
    unit: 'kg',
    workouts: rows.map((row, i) => ({
      d: '2026-02-0' + (i + 1),
      entries: [{ id: LIFT, target: T, sets: row.map(sec => ({ sec, w: 0, done: true })) }]
    }))
  })

  it('adds time when every set went the full duration', () => {
    const p = nextPrescription(timeHist([[45, 45]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.sec).toBe(50)
    expect(p.weight).toBeUndefined()
  })

  it('honours a custom time increment', () => {
    const p = nextPrescription(timeHist([[45, 45]]), { ...cfg, inc: 15 })
    expect(p).toMatchObject({ kind: 'up', sec: 60 })
  })

  it('repeats the target when a hold came up short', () => {
    const p = nextPrescription(timeHist([[45, 38]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.sec).toBe(45)
  })

  it('backs the target off after a run of short sessions', () => {
    const p = nextPrescription(timeHist([[45, 30], [45, 32], [45, 31]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.sec).toBe(40)              // 45 × 0.9 = 40.5 → nearest 5 s step
  })

  it('ignores reps history when the exercise switched to time', () => {
    const S = hist(LIFT, [[60, 5, 5, 5]])
    const p = nextPrescription({ ...S, unit: 'kg' }, cfg)
    expect(p.kind).toBe('first')        // no timed session yet, so no opinion
  })
})

describe('policy "off"', () => {
  it('has no automatic target but exposes the manual load step', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), { id: LIFT, sets: 3, reps: 5, inc: 2, prog: 'off' })
    expect(p.kind).toBe('off')
    expect(p.weight).toBeUndefined()
    expect(p.inc).toBe(2)
  })
  it('is what cardio always gets', () => {
    expect(nextPrescription({ unit: 'kg', workouts: [] }, { id: CARDIO, sets: 1, min: 20 }).kind).toBe('off')
  })
})

describe('sessionsFor', () => {
  it('skips workouts where the exercise was never actually logged', () => {
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2026-01-01', entries: [{ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: true }] }] },
        { d: '2026-01-02', entries: [{ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 60, r: 0, done: false }] }] },
        { d: '2026-01-03', entries: [{ id: 'other', target: {}, sets: [{ w: 20, r: 5, done: true }] }] }
      ]
    }
    expect(sessionsFor(S, LIFT).map(s => s.d)).toEqual(['2026-01-01'])
  })

  it('reads a legacy entry that has no target without crashing', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 5, done: true }] }] }] }
    expect(sessionsFor(S, LIFT)).toHaveLength(1)
  })

  it('selects the exact progression when duplicate exercise entries share a workout', () => {
    const S = {
      unit: 'kg',
      workouts: [{
        d: '2026-01-01',
        entries: [
          { id: LIFT, progressionId: 'pg-a', target: { sets: 1, reps: 8 }, sets: [{ w: 60, r: 8, done: true }] },
          { id: LIFT, progressionId: 'pg-b', target: { sets: 1, reps: 12 }, sets: [{ w: 40, r: 12, done: true }] }
        ]
      }]
    }
    expect(sessionsFor(S, LIFT, { id: LIFT, progressionId: 'pg-a' })[0]).toMatchObject({ weight: 60, goal: 8 })
    expect(sessionsFor(S, LIFT, { id: LIFT, progressionId: 'pg-b' })[0]).toMatchObject({ weight: 40, goal: 12 })
  })

  it('keeps legacy entries as a baseline but excludes another explicit progression', () => {
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2025-12-01', entries: [{ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 50, r: 5, done: true }] }] },
        { d: '2026-01-01', entries: [{ id: LIFT, progressionId: 'pg-b', target: { sets: 1, reps: 8 }, sets: [{ w: 80, r: 8, done: true }] }] }
      ]
    }
    const scoped = sessionsFor(S, LIFT, { id: LIFT, progressionId: 'pg-a', sets: 1, reps: 5 })
    expect(scoped).toHaveLength(1)
    expect(scoped[0]).toMatchObject({ d: '2025-12-01', weight: 50 })
  })

  it('prefers the exact scoped session over an earlier legacy entry in the same workout', () => {
    const cfg = { id: LIFT, progressionId: 'pg-a', sets: 1, reps: 8 }
    const S = {
      unit: 'kg', routines: [{ id: 'day-a', ex: [cfg] }],
      workouts: [{
        routineId: 'day-a', d: '2026-01-01',
        entries: [
          { id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 50, r: 5, done: true }] },
          { id: LIFT, progressionId: 'pg-a', target: { sets: 1, reps: 8 }, sets: [{ w: 72, r: 8, done: true }] }
        ]
      }]
    }
    expect(sessionsFor(S, LIFT, cfg)).toHaveLength(1)
    expect(sessionsFor(S, LIFT, cfg)[0]).toMatchObject({ weight: 72, goal: 8 })
  })
})

// Workouts only began storing their prescription in v1.2.2. Everything logged before that is
// targetless, and reading it as "missed" would tell every long-standing user to deload on
// their first session after updating — which is exactly what the demo history did.
describe('history logged before targets were recorded', () => {
  const legacy = rows => ({
    unit: 'kg',
    workouts: rows.map((row, i) => ({
      d: '2026-03-' + String(i + 1).padStart(2, '0'),
      entries: [{ id: LIFT, sets: row.slice(1).map(r => ({ w: row[0], r, done: true })) }]   // no target
    }))
  })
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }

  it('judges a targetless session against the current plan instead of calling it a miss', () => {
    const p = nextPrescription(legacy([[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('does not manufacture a stall out of a long clean history', () => {
    const p = nextPrescription(legacy(Array.from({ length: 11 }, () => [60, 5, 5, 5])), cfg)
    expect(p.kind).toBe('up')
  })

  it('still spots a genuine miss in old data', () => {
    expect(nextPrescription(legacy([[60, 5, 5, 2]]), cfg).kind).toBe('hold')
  })

  it('matches the weight hint the app showed before this engine existed', () => {
    // Old rule: every set at or above the plan's reps, with a real weight → suggest a step up.
    expect(nextPrescription(legacy([[60, 5, 6, 5]]), cfg).weight).toBe(62.5)
    expect(nextPrescription(legacy([[60, 5, 4, 5]]), cfg).kind).toBe('hold')
  })
})

describe('applyPrescription', () => {
  const sets = [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: false }]

  it('rewrites only what the policy decided, and only unlogged sets', () => {
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5 })
    expect(out[0]).toEqual({ w: 60, r: 5, done: true })
    expect(out[1]).toEqual({ w: 62.5, r: 5, done: false })
  })

  it('sets reps too when the policy has an opinion about them', () => {
    expect(applyPrescription(sets, { kind: 'up', weight: 42.5, reps: 8 })[1]).toEqual({ w: 42.5, r: 8, done: false })
  })

  it('touches nothing for "off" or a first session without explicit targets', () => {
    expect(applyPrescription(sets, { kind: 'off' })).toBe(sets)
    expect(applyPrescription(sets, { kind: 'first' })).toBe(sets)
    expect(applyPrescription(sets, null)).toBe(sets)
  })

  it('applies explicit targets from a first prescription', () => {
    expect(applyPrescription(sets, { kind: 'first', reps: 8 })).toEqual([
      { w: 60, r: 5, done: true },
      { w: 60, r: 8, done: false }
    ])
  })

  it('adjusts a timed set without inventing a weight', () => {
    const timed = [{ sec: 45, w: 0, done: false }]
    expect(applyPrescription(timed, { kind: 'up', sec: 50 })).toEqual([{ sec: 50, w: 0, done: false }])
  })

  it('grows the list when the policy added a set (issue #33)', () => {
    const three = [{ w: 0, r: 10, done: false }, { w: 0, r: 10, done: false }, { w: 0, r: 10, done: false }]
    const out = applyPrescription(three, { kind: 'up', weight: 0, reps: 10, sets: 4 })
    expect(out).toHaveLength(4)
    expect(out[3]).toEqual({ w: 0, r: 10, done: false })
  })

  it('never shrinks a session that has already logged sets', () => {
    expect(applyPrescription(sets, { kind: 'up', weight: 60, sets: 1 })).toHaveLength(sets.length)
  })
})
