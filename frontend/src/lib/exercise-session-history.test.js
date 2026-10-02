import { describe, expect, it } from 'vitest'
import { recentExerciseSessions, exerciseSessionOutcome } from './exercise-session-history.js'
import { buildScopedWorkoutEntry, completedWorkoutEntry } from './workout-scope.js'
import { nextPrescription } from './progression.js'

const config = { id: 'history-lift', progressionId: 'p', routineExerciseId: 'slot', mode: 'reps',
  prog: 'confirmed_rep_range', sets: 4, reps: 8, minReps: 8, maxReps: 10, weight: 70,
  inc: 2, restSeconds: 120, maxRestSeconds: 180, restReductionStrategy: 'auto_after_successes' }
const entry = (overrides = {}) => ({ id: config.id, progressionId: 'p', routineExerciseId: 'slot',
  target: { ...config, targetReps: 10, restBaseSeconds: 120, topRangeStreak: 0 },
  sets: Array.from({ length: 4 }, () => ({ w: 70, r: 10, done: true })), ...overrides })
const workout = (n, en = entry()) => ({ id: `w${n}`, d: `2026-09-${String(n).padStart(2, '0')}`,
  routineId: 'r', name: 'Historical Monday', entries: [en] })
const state = count => ({ unit: 'kg', restSec: 120,
  routines: [{ id: 'r', name: 'Renamed routine', ex: [{ ...config }] }],
  active: { id: 'active', routineId: 'r', entries: [entry()] },
  workouts: Array.from({ length: count }, (_, i) => workout(i + 1)) })
const freeze = value => { Object.freeze(value); Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v) }); return value }

describe('recent scoped exercise sessions', () => {
  it.each([0, 1, 4, 7])('returns at most four previous sessions out of %s', count => {
    const s = state(count)
    expect(recentExerciseSessions(s, s.active.entries[0]).map(row => row.workoutId))
      .toEqual(s.workouts.slice(-4).reverse().map(w => w.id))
  })
  it('orders out-of-order imports by date without sorting the stored array', () => {
    const s = state(6); s.workouts = [s.workouts[5], ...s.workouts.slice(0, 5)]
    const before = structuredClone(s)
    expect(recentExerciseSessions(freeze(s), s.active.entries[0]).map(row => row.workoutId)).toEqual(['w6', 'w5', 'w4', 'w3'])
    expect(s).toEqual(before)
  })
  it('uses real timestamps for sessions on the same day and preserves deterministic ties', () => {
    const s = state(3); s.workouts.forEach(w => { w.d = '2026-09-01' })
    s.workouts[0].start = Date.parse('2026-09-01T17:00:00Z')
    s.workouts[1].start = Date.parse('2026-09-01T16:00:00Z')
    s.workouts[2].start = s.workouts[1].start
    expect(recentExerciseSessions(s, s.active.entries[0]).map(r => r.workoutId)).toEqual(['w1', 'w3', 'w2'])
  })
  it('keeps invalid dates readable after known dates and does not trust synthetic date-only clocks', () => {
    const s = state(3); s.workouts[2].d = 'not a date'
    s.workouts[0].start = Date.parse('2030-01-01'); s.workouts[0].timePrecision = 'date-only'
    expect(recentExerciseSessions(s, s.active.entries[0]).map(r => r.workoutId)).toEqual(['w2', 'w1', 'w3'])
  })
  it('excludes the active workout and repeated ids', () => {
    const s = state(2); s.workouts.push(s.active, structuredClone(s.workouts[1]))
    expect(recentExerciseSessions(s, s.active.entries[0]).map(r => r.workoutId)).toEqual(['w2', 'w1'])
  })
  it('separates Monday and Thursday but includes deliberately shared progressions', () => {
    const s = state(3)
    s.workouts[1].entries[0].progressionId = 'independent'
    s.workouts[2].routineId = 'thursday'; s.workouts[2].name = 'Thursday'
    s.workouts[2].entries[0].routineExerciseId = 'other-slot'
    const rows = recentExerciseSessions(s, s.active.entries[0])
    expect(rows.map(r => r.workoutId)).toEqual(['w3', 'w1']); expect(rows[0].shared).toBe(true)
  })
  it('keeps the frozen scope after configuration edits or routine deletion', () => {
    const s = state(2); s.routines[0].ex[0].progressionId = 'new'
    expect(recentExerciseSessions(s, s.active.entries[0])).toHaveLength(2)
    s.routines = []
    expect(recentExerciseSessions(s, s.active.entries[0])[0].routineName).toBe('Historical Monday')
  })
  it('does not replace missing historical routine names with renamed current routines', () => {
    const s = state(1); delete s.workouts[0].name
    expect(recentExerciseSessions(s, s.active.entries[0])[0].routineName).toBeNull()
  })
  it('selects the exact slot among duplicate scoped occurrences and rejects unresolved ambiguity', () => {
    const s = state(1); s.workouts[0].entries.unshift(entry({ routineExerciseId: 'other', topW: 999 }))
    expect(recentExerciseSessions(s, s.active.entries[0])[0].entry.topW).toBeUndefined()
    s.active.entries[0].routineExerciseId = 'missing'
    expect(recentExerciseSessions(s, s.active.entries[0])).toEqual([])
  })
  it('attributes a single legacy occurrence using the existing resolver', () => {
    const s = state(1); delete s.workouts[0].entries[0].progressionId
    expect(recentExerciseSessions(s, s.active.entries[0])[0].scopeKind).toBe('legacy_attributed')
    s.routines[0].ex[0].progressionId = 'another'
    expect(recentExerciseSessions(s, s.active.entries[0])).toEqual([])
  })
  it('attributes legacy duplicated exercises by the resolver occurrence order', () => {
    const s = state(1)
    s.routines[0].ex.unshift({ ...config, progressionId: 'other', routineExerciseId: 'other' })
    delete s.workouts[0].entries[0].progressionId
    s.workouts[0].entries.unshift(entry({ progressionId: undefined, topW: 999 }))
    expect(recentExerciseSessions(s, s.active.entries[0])[0].entry.topW).toBeUndefined()
  })
  it('labels unattributable single legacy baselines but skips ambiguous legacy duplicates', () => {
    const s = state(1); s.routines = []; delete s.workouts[0].entries[0].progressionId
    expect(recentExerciseSessions(s, s.active.entries[0])[0].scopeKind).toBe('legacy_shared')
    s.workouts[0].entries.push(entry({ progressionId: undefined }))
    expect(recentExerciseSessions(s, s.active.entries[0])).toEqual([])
  })
  it.each(['time', 'cardio'])('does not mix a %s block into reps history', mode => {
    const s = state(2); s.workouts[1].entries[0].target.mode = mode
    expect(recentExerciseSessions(s, s.active.entries[0]).map(r => r.workoutId)).toEqual(['w1'])
  })
  it('separates pure bodyweight, added weight and external load', () => {
    const s = state(3)
    s.workouts[1].entries[0].target.bodyweight = true
    s.workouts[2].entries[0].target = { ...s.workouts[2].entries[0].target, bodyweight: true, weight: 0 }
    expect(recentExerciseSessions(s, s.active.entries[0]).map(r => r.workoutId)).toEqual(['w1'])
    s.active.entries[0].target.bodyweight = true
    expect(recentExerciseSessions(s, s.active.entries[0]).map(r => r.workoutId)).toEqual(['w2'])
    s.active.entries[0].target.weight = 0
    expect(recentExerciseSessions(s, s.active.entries[0]).map(r => r.workoutId)).toEqual(['w3'])
  })
  it('preserves actual sets, effort and topW as separate facts', () => {
    const s = state(1); const e = s.workouts[0].entries[0]
    e.sets[0].rir = 0; e.sets[1].rpe = 8.5; e.topW = 999
    const row = recentExerciseSessions(s, s.active.entries[0])[0]
    expect(row.entry.sets[0]).toEqual({ w: 70, r: 10, done: true, rir: 0 })
    expect(row.entry.topW).toBe(999); expect(row.outcome).toBe('maximum_first')
  })
  it('reads only historical equipment, tare and units', () => {
    const s = state(1); s.equipmentProfiles = [{ id: 'gym', name: 'Changed gym', items: [] }]
    s.workouts[0].equipmentSnapshot = { id: 'gym', name: 'Old gym', unit: 'lb', workoutUnit: 'lb',
      items: [{ id: 'bar', label: 'Old bar', tareWeight: 45 }] }
    s.workouts[0].entries[0].equipmentUse = { status: 'resolved', profileId: 'gym', itemId: 'bar', loadSemantics: 'total' }
    const row = recentExerciseSessions(s, s.active.entries[0])[0]
    expect(row.unit).toBe('lb'); expect(row.unitInferred).toBe(false)
    expect(row.equipment).toMatchObject({ label: 'Old bar', profileName: 'Old gym', tareWeight: 45, unit: 'lb' })
  })
  it('does not manufacture an equipment profile when its historical snapshot is missing', () => {
    const s = state(1); s.workouts[0].entries[0].equipmentUse = { profileId: 'gym', itemId: 'bar', label: 'Saved bar' }
    s.equipmentProfiles = [{ id: 'gym', name: 'Today', items: [{ id: 'bar', tareWeight: 20 }] }]
    const row = recentExerciseSessions(s, s.active.entries[0])[0]
    expect(row.equipment).toMatchObject({ label: 'Saved bar', profileName: null, tareWeight: null })
    expect(row.unitInferred).toBe(true)
  })
  it('supports empty/missing state and limits without introducing persisted fields', () => {
    expect(recentExerciseSessions()).toEqual([])
    const s = state(6)
    expect(recentExerciseSessions(s, entry(), { limit: 0 })).toEqual([])
    expect(recentExerciseSessions(s, entry(), { limit: 100 })).toHaveLength(4)
    const before = JSON.stringify(s); recentExerciseSessions(s, entry()); expect(JSON.stringify(s)).toBe(before)
  })
})

describe('historical outcome without current configuration', () => {
  it.each([
    ['incomplete', e => { e.sets[0].done = false }],
    ['failed', e => { e.sets[0].r = 9 }],
    ['mixed_load', e => { e.sets[0].w = 68 }],
    ['technique_failed', e => { e.review = { technique: 'degraded' } }],
    ['interrupted', e => { e.review = { failureReason: 'illness' } }],
    ['unknown', e => { delete e.target }],
    ['unknown', e => { delete e.target.sets }],
    ['unknown', e => { delete e.target.targetReps; delete e.target.reps }],
    ['maximum_recovery', e => { e.target.restSeconds = 150 }],
    ['maximum_unverified', e => { delete e.target.restBaseSeconds }],
    ['maximum_first', e => { delete e.target.topRangeStreak }],
    ['maximum_first', e => { e.sets.forEach(s => { s.w = 68 }) }],
    ['maximum_first', () => {}],
    ['progression_earned', e => { e.target.topRangeStreak = 1 }],
    ['legacy_success', e => { delete e.target.minReps; delete e.target.maxReps }],
    ['success', e => { e.target.targetReps = 8; e.sets.forEach(s => { s.r = 9 }) }]
  ])('reports %s conservatively', (outcome, mutate) => {
    const e = entry(); mutate(e)
    expect(exerciseSessionOutcome(e, { previousEntry: outcome === 'progression_earned' ? entry() : null }).outcome).toBe(outcome)
  })
  it('keeps optional incomplete/low-load sets neutral for Confirmed', () => {
    const e = entry(); e.sets.push({ r: 2, w: 5, done: false })
    expect(exerciseSessionOutcome(e, { previousEntry: null }).outcome).toBe('maximum_first')
  })
  it.each([4, 6])('does not promise a weight increase for pure bodyweight at %s sets', sets => {
    const e = entry(); e.target = { ...e.target, bodyweight: true, weight: 0, sets, topRangeStreak: 1 }
    e.sets = Array.from({ length: sets }, () => ({ r: 10, w: 0, done: true }))
    expect(exerciseSessionOutcome(e, { previousEntry: structuredClone(e) }).progressionEarned).toBe(sets === 4 ? 'sets' : 'variation')
  })
  it.each(['reps', 'time', 'cardio'])('preserves the historical %s policy', mode => {
    const e = entry(); e.target = { ...e.target, prog: 'off', mode, sec: 45, min: 10, speed: 8 }
    e.sets.forEach(s => Object.assign(s, { sec: 45, min: 10, speed: 8 }))
    expect(exerciseSessionOutcome(e).outcome).toBe(mode === 'cardio' ? 'recorded' : 'success')
    e.sets[0].done = false
    expect(exerciseSessionOutcome(e).outcome).toBe('incomplete')
  })
  it('uses real prescription snapshots across two maxima and a new load cycle', () => {
    const s = state(0), cfg = s.routines[0].ex[0]
    const results = []
    for (let i = 1; i <= 3; i++) {
      const e = buildScopedWorkoutEntry(s, cfg, s.routines[0])
      e.sets.forEach(set => { set.done = true; set.r = 10 })
      const stored = completedWorkoutEntry(e); s.workouts.push(workout(i, stored))
      results.push(recentExerciseSessions(s, s.active.entries[0])[0])
    }
    expect(results.map(r => r.confirmation)).toEqual([1, 2, 1])
    expect(results[1].progressionEarned).toBe('weight')
    expect(s.workouts[2].entries[0].target.weight).toBe(72)
    const before = nextPrescription(s, cfg, s.routines[0])
    recentExerciseSessions(freeze(s), s.active.entries[0])
    expect(nextPrescription(s, cfg, s.routines[0])).toEqual(before)
  })
  it('requires historical evidence instead of trusting a stale frozen counter', () => {
    const s = state(2)
    s.workouts[1].entries[0].target.topRangeStreak = 1
    expect(recentExerciseSessions(s, entry())[0].confirmation).toBe(2)
    s.workouts[0].entries[0].sets[0].r = 8
    expect(recentExerciseSessions(s, entry())[0].confirmation).toBe(1)
    s.workouts.shift()
    expect(recentExerciseSessions(s, entry())[0].confirmation).toBe(1)
    expect(exerciseSessionOutcome(s.workouts[0].entries[0]).outcome).toBe('maximum_unverified')
  })
  it.each(['weight', 'restEpochId', 'loadEpochId', 'restBaseSeconds', 'minReps', 'sets'])('a previous %s boundary prevents double confirmation', field => {
    const s = state(2), prior = s.workouts[0].entries[0]
    if (field === 'weight') prior.sets.forEach(set => { set.w = 68 })
    else if (field === 'sets') { prior.target.sets = 3; prior.sets.pop() }
    else prior.target[field] = field.endsWith('Id') ? 'old-epoch' : field === 'minReps' ? 6 : 90
    expect(recentExerciseSessions(s, entry())[0].confirmation).toBe(1)
  })
  it('validates the fourth displayed maximum using a fifth non-displayed exposure', () => {
    const s = state(5)
    const rows = recentExerciseSessions(s, entry())
    expect(rows).toHaveLength(4)
    expect(rows[3].workoutId).toBe('w2')
    expect(rows[3].confirmation).toBe(2)
  })
  it('preserves all-row scoring outside Confirmed, where extra rows are not optional', () => {
    const e = entry(); e.target.prog = 'linear'
    e.sets.push({ w: 70, r: 2, done: false })
    expect(exerciseSessionOutcome(e).outcome).toBe('incomplete')
    e.sets[4].done = true
    expect(exerciseSessionOutcome(e).outcome).toBe('failed')
  })
  it('does not equate an explicit historical pound load with the same number of kilograms', () => {
    const s = state(2); s.workouts[0].unit = 'lb'; s.workouts[1].unit = 'kg'
    const latest = recentExerciseSessions(s, entry())[0]
    expect(latest.outcome).toBe('maximum_unverified')
    expect(latest.confirmation).toBeNull()
  })
  it('cannot confirm adjacency around a session whose date is unusable', () => {
    const s = state(3); s.workouts[1].d = 'not-a-date'; s.workouts[1].entries[0].sets[0].r = 8
    expect(recentExerciseSessions(s, entry())[0].outcome).toBe('maximum_unverified')
  })
  it('does not bridge a dated exposure with ambiguous duplicate occurrences', () => {
    const s = state(3)
    s.workouts[1].entries = [entry({ routineExerciseId: 'unknown-a' }), entry({ routineExerciseId: 'unknown-b' })]
    const rows = recentExerciseSessions(s, entry())
    expect(rows.map(row => row.workoutId)).toEqual(['w3', 'w1'])
    expect(rows[0].outcome).toBe('maximum_unverified')
  })
  it('does not call a malformed recovery below its historical base an above-base success', () => {
    const e = entry(); e.target.restSeconds = 90
    expect(exerciseSessionOutcome(e, { previousEntry: null }).outcome).toBe('maximum_unverified')
  })
  it('does not substitute a newer exposure when ambiguity exhausts the bounded predecessor window', () => {
    const s = state(8)
    for (let n = 2; n < 8; n++) s.workouts[n].entries = [
      entry({ routineExerciseId: 'unknown-a' }), entry({ routineExerciseId: 'unknown-b' })]
    const rows = recentExerciseSessions(s, entry())
    expect(rows.map(row => row.workoutId)).toEqual(['w2', 'w1'])
    expect(rows.every(row => row.outcome === 'maximum_unverified')).toBe(true)
  })
})
