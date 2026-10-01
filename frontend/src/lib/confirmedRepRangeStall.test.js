import { describe, expect, it } from 'vitest'
import { assessConfirmedStall, applyConfirmedStall, dismissConfirmedStall, CONFIRMED_STALL_LONG_GAP_MS } from './confirmedRepRangeStall.js'
import { nextPrescription } from './progression.js'

const DAY = 86400000
const START = Date.UTC(2026, 8, 1)
const NOW = START + 20 * DAY
const config = (patch = {}) => ({ id: 'test-bench', routineExerciseId: 'slot', progressionId: 'p',
  prog: 'confirmed_rep_range', mode: 'reps', sets: 4, minReps: 8, maxReps: 10,
  reps: 8, weight: 70, inc: 2, restSeconds: 120, maxRestSeconds: 120, ...patch })
function workout(index, reps = [9, 9, 9, 9], { cfg = config(), target = {}, review, entry = {}, ...extra } = {}) {
  return { id: `w${index}`, d: new Date(START + index * DAY).toISOString(), routineId: 'r', ...extra,
    entries: [{ id: cfg.id, progressionId: cfg.progressionId, routineExerciseId: cfg.routineExerciseId,
      target: { prog: 'confirmed_rep_range', sets: cfg.sets, targetReps: 10, reps: 10,
        minReps: cfg.minReps, maxReps: cfg.maxReps, rangeStep: 1, weight: cfg.weight,
        restSeconds: cfg.restSeconds, maxRestSeconds: cfg.maxRestSeconds, restBaseSeconds: cfg.restSeconds,
        restEpochId: null, loadEpochId: null, stallDetectionVersion: 1, bodyweight: !!cfg.bodyweight,
        ...(cfg.setBaselineId ? { setBaselineId: cfg.setBaselineId } : {}), ...target },
      sets: reps.map(r => ({ r, w: cfg.weight, done: true })), ...(review ? { review } : {}), ...entry }] }
}
const state = (workouts, cfg = config(), patch = {}) => ({ unit: 'kg', restSec: 120, workouts,
  routines: [{ id: 'r', name: 'Monday', prog: 'confirmed_rep_range', ex: [cfg] }], ...patch })
const assess = (s, cfg = config(), options = {}) => assessConfirmedStall(s, cfg, nextPrescription(s, cfg, s.routines[0]), { now: NOW, ...options })
const missed = (count = 3, opts = {}) => state(Array.from({ length: count }, (_, i) => workout(i + 1, undefined, opts)), opts.cfg)

describe('Confirmed stall detector — versioned conservative evidence', () => {
  it('requires three comparable numerical misses and never mutates input', () => {
    const s = missed(); const before = JSON.stringify(s)
    expect(assess(missed(1)).status).toBe('none')
    expect(assess(missed(2)).status).toBe('observe')
    const result = assess(s)
    expect(result).toMatchObject({ status: 'proposed', reason: 'numeric_stall', count: 3,
      fromWeight: 70, proposedWeight: 64, effectiveReductionPercent: 8.57, minReps: 8, canApply: true })
    expect(result.evidenceWorkoutIds).toEqual(['w1', 'w2', 'w3'])
    expect(result.evidence[0].technique).toBe('unknown')
    expect(JSON.stringify(s)).toBe(before)
  })

  it('uses lexicographic progress instead of treating every miss as a stall', () => {
    const s = state([workout(1, [8, 8, 8, 8]), workout(2, [9, 9, 9, 9]), workout(3)])
    expect(assess(s)).toMatchObject({ status: 'observe', count: 2 })
    const firstTargetHit = state([workout(1), workout(2, [10, 9, 9, 9]), workout(3, [10, 9, 9, 9])])
    expect(assess(firstTargetHit)).toMatchObject({ status: 'observe', count: 2 })
    const sumProgress = state([workout(1, [8, 8, 8, 8]), workout(2, [9, 8, 8, 8]), workout(3, [9, 8, 8, 8])])
    expect(assess(sumProgress)).toMatchObject({ status: 'observe', count: 2 })
  })

  it('success clears evidence, including accelerated 9 then 10 performances', () => {
    const s = missed(); s.workouts.push(workout(4, [10, 10, 10, 10]))
    expect(assess(s).status).toBe('none')
    expect(assess(state([workout(1), workout(2, [10, 10, 10, 10])])).status).toBe('none')
  })

  it('requires two explicitly degraded performances even when all targets are hit', () => {
    const rows = [1, 2].map(i => workout(i, [10, 10, 10, 10], { review: { technique: 'degraded', failureReason: 'technique' } }))
    expect(assess(state(rows.slice(0, 1))).status).toBe('technique_warning')
    expect(assess(state(rows))).toMatchObject({ status: 'proposed', reason: 'technique_stall', count: 2 })
    const unknown = state([rows[0], workout(2, [10, 10, 10, 10])])
    expect(assess(unknown).status).toBe('none')
  })

  it.each(['pain', 'equipment', 'time', 'illness'])('%s is not treated as stall evidence', failureReason => {
    const s = missed(); s.workouts[1].entries[0].review = { failureReason }
    expect(assess(s)).toMatchObject({ status: 'none', count: 1 })
    s.workouts[2].entries[0].review = { failureReason }
    expect(assess(s).evidence).toEqual([])
  })

  it.each(['legacy', 'incomplete', 'mixed', 'manual', 'policy'])('%s exposure breaks the comparable window', variant => {
    const s = missed(4); const e = s.workouts[2].entries[0]
    if (variant === 'legacy') delete e.target.stallDetectionVersion
    if (variant === 'incomplete') e.sets[0].done = false
    if (variant === 'mixed') e.sets[0].w = 80
    if (variant === 'manual') e.sets.forEach(set => { set.w = 72 })
    if (variant === 'policy') e.target.prog = 'linear'
    expect(assess(s)).toMatchObject({ status: 'none', count: 1 })
  })

  it('optional rows are neutral to outcome and score', () => {
    const s = missed()
    for (const w of s.workouts) w.entries[0].sets.push({ r: 0, w: 999, done: false })
    expect(assess(s)).toMatchObject({ status: 'proposed', count: 3 })
    expect(assess(s).evidence[0].reps).toEqual([9, 9, 9, 9])
  })

  it.each(['goal', 'sets', 'range', 'rest', 'epoch', 'base'])('a changed historical %s begins a new window', variant => {
    const s = missed(); const t = s.workouts[0].entries[0].target
    if (variant === 'goal') t.targetReps = 9
    if (variant === 'sets') t.sets = 3
    if (variant === 'range') t.minReps = 7
    if (variant === 'rest') t.restSeconds = 90
    if (variant === 'epoch') t.restEpochId = 'earlier'
    if (variant === 'base') t.restBaseSeconds = 90
    expect(assess(s)).toMatchObject({ status: 'observe', count: 2 })
  })

  it('current configuration edits and pending manual controls invalidate old evidence', () => {
    const s = missed()
    expect(assess(s, config({ minReps: 6 })).status).toBe('none')
    expect(assess(s, config({ sets: 3 })).status).toBe('none')
    expect(assess(s, config({ restSeconds: 150, maxRestSeconds: 180 })).status).toBe('none')
    s.progressionControls = { p: { confirmedRepRangeRest: { epochId: 'new-rest', resetAt: NOW, resetSeconds: 120 } } }
    expect(assess(s).status).toBe('none')
  })

  it('prioritizes adaptable recovery for later-set misses', () => {
    const cfg = config({ maxRestSeconds: 180 })
    const s = state([1, 2, 3].map(i => workout(i, [10, 9, 9, 9], { cfg })), cfg)
    expect(assess(s, cfg).status).toBe('none')
    const capped = config({ restSeconds: 180, maxRestSeconds: 180 })
    expect(assess(state([1, 2, 3].map(i => workout(i, [10, 9, 9, 9], { cfg: capped })), capped), capped).status).toBe('proposed')
  })

  it('can propose for first-set misses while rest is below its cap but unchanged', () => {
    const cfg = config({ maxRestSeconds: 180 })
    expect(assess(missed(3, { cfg }), cfg).status).toBe('proposed')
  })

  it('excludes old workouts and long breaks without invalidating their stored data', () => {
    const s = missed()
    expect(assess(s, config(), { now: START + 3 * DAY + CONFIRMED_STALL_LONG_GAP_MS + 1 }).status).toBe('none')
    s.workouts[0].d = new Date(START - 40 * DAY).toISOString()
    expect(assess(s)).toMatchObject({ status: 'observe', count: 2 })
  })

  it('rejects missing dates, future dates and unscoped legacy identity', () => {
    for (const mutation of [w => { delete w.d }, w => { w.d = new Date(NOW + DAY).toISOString() }, w => { delete w.entries[0].progressionId }]) {
      const s = missed(); mutation(s.workouts[2])
      expect(assess(s).status).toBe('none')
    }
  })

  it.each([-60000, 60000])('uses native end timestamps at the 28-day boundary (%i ms)', offset => {
    const s = missed()
    const lastEnd = NOW - CONFIRMED_STALL_LONG_GAP_MS + offset
    s.workouts.forEach((w, i) => { w.end = lastEnd - (2 - i) * DAY })
    expect(assess(s).status).toBe(offset > 0 ? 'proposed' : 'none')
  })

  it('falls back to a valid native start when end is unavailable or malformed', () => {
    const s = missed()
    s.workouts.forEach((w, i) => { w.end = 'invalid'; w.start = NOW - (3 - i) * DAY; w.d = 'invalid' })
    expect(assess(s).status).toBe('proposed')
    expect(assess(s).evidence[2].date).toBe(s.workouts[2].start)
  })

  it('separates independent scopes and includes shared routine evidence with names', () => {
    const s = missed(); const other = config({ progressionId: 'thursday', routineExerciseId: 'other' })
    s.workouts.splice(1, 0, workout(20, [10, 10, 10, 10], { cfg: other }))
    expect(assess(s).evidenceWorkoutIds).toEqual(['w1', 'w2', 'w3'])
    expect(assess(s, other).status).toBe('none')
    s.routines.push({ id: 'r2', name: 'Thursday', ex: [config({ routineExerciseId: 'shared' })] })
    s.workouts[2].routineId = 'r2'
    expect(assess(s).sharedRoutineNames).toEqual(['Monday', 'Thursday'])
  })

  it('does not include active workout evidence', () => {
    const s = missed(); s.active = s.workouts[2]
    expect(assess(s)).toMatchObject({ status: 'observe', count: 2 })
  })

  it('discloses shared routines even with identical names and preserves historical routine labels', () => {
    const s = missed()
    s.routines.push({ id: 'r2', name: 'Monday', ex: [config({ routineExerciseId: 'slot2' })] })
    s.workouts[0].name = 'Original routine name'
    expect(assess(s).sharedRoutineNames).toEqual(['Monday', 'Monday'])
    expect(assess(s).evidence[0].routineName).toBe('Original routine name')
  })

  it('proposes previous successful load after two below-minimum attempts after an increase', () => {
    const cfg = config({ weight: 72 })
    const s = state([workout(1, [10, 10, 10, 10]), workout(2, [10, 10, 10, 10]),
      workout(3, [7, 7, 7, 7], { cfg, target: { targetReps: 8, reps: 8 } }),
      workout(4, [7, 7, 7, 7], { cfg, target: { targetReps: 8, reps: 8 } })], cfg)
    expect(assess(s, cfg)).toMatchObject({ status: 'proposed', reason: 'post_increase_failure', proposedWeight: 70 })
    s.workouts[0].entries[0].review = { technique: 'degraded' }
    expect(assess(s, cfg).reason).toBe(null)
  })
})

describe('Controlled load proposal and persistent pure reducers', () => {
  it.each([
    { weight: 70, inc: 2, expected: 64 },
    { weight: 71, inc: 2, expected: 65 },
    { weight: 12.5, inc: 0.25, expected: 11.5 },
    { weight: 100, inc: 5, expected: 90, unit: 'lb' }
  ])('rounds down from $weight by the configured step $inc', ({ weight, inc, expected, unit }) => {
    const cfg = config({ weight, inc }); const s = missed(3, { cfg }); if (unit) s.unit = unit
    expect(assess(s, cfg).proposedWeight).toBe(expected)
  })

  it('never proposes negative loads; pure bodyweight offers only manual variant advice', () => {
    const cfg = config({ weight: 1, inc: 2 })
    expect(assess(missed(3, { cfg }), cfg)).toMatchObject({ status: 'manual_review', proposedWeight: null, canApply: false })
    const bw = config({ bodyweight: true, weight: 0 })
    expect(assess(missed(3, { cfg: bw }), bw)).toMatchObject({ status: 'manual_review', proposedWeight: null,
      explanation: 'review_bodyweight_variation', loadMode: 'pure_bodyweight', canApply: false })
  })

  it.each([false, true])('zero lower load requires explicit exercise configuration, not an epoch (bodyweight=%s)', bodyweight => {
    const cfg = config({ weight: 2, inc: 2, bodyweight })
    expect(assess(missed(3, { cfg }), cfg)).toMatchObject({ status: 'manual_review', proposedWeight: null, canApply: false })
  })

  it('counts a workout id once and excludes ambiguous duplicate occurrences of a progression', () => {
    const s = missed(2); s.workouts.push(structuredClone(s.workouts[1]))
    expect(assess(s)).toMatchObject({ status: 'observe', count: 2 })
    const ambiguous = missed()
    ambiguous.workouts[2].entries.push(structuredClone(ambiguous.workouts[2].entries[0]))
    expect(assess(ambiguous).status).toBe('none')
  })

  it('does not call an arbitrary manual increase an unconsolidated automatic increase', () => {
    const cfg = config({ weight: 72 })
    const s = state([workout(1, [10, 10, 10, 10]),
      workout(2, [7, 7, 7, 7], { cfg, target: { targetReps: 8 } }),
      workout(3, [7, 7, 7, 7], { cfg, target: { targetReps: 8 } })], cfg)
    expect(assess(s, cfg)).toMatchObject({ status: 'observe', reason: null })
  })

  it('unknown/invalid repetition data is not numerical evidence', () => {
    for (const value of [null, undefined, true, 'invalid', -2]) {
      const s = missed(); s.workouts[2].entries[0].sets[0].r = value
      expect(assess(s).status).toBe('none')
    }
  })

  it('reduces only additional bodyweight load and rejects assisted semantics', () => {
    const cfg = config({ bodyweight: true, weight: 20, inc: 2 })
    expect(assess(missed(3, { cfg }), cfg)).toMatchObject({ proposedWeight: 18, loadMode: 'added_bodyweight' })
    expect(assess(missed(), config({ assisted: true })).status).toBe('none')
  })

  it('uses registered selectable inventory and compares equipment semantics', () => {
    const cfg = config({ equipmentUse: { mode: 'item', profileId: 'gym', itemId: 'stack' } })
    const profile = { id: 'gym', unit: 'kg', items: [{ id: 'stack', kind: 'machine_stack', tareWeight: 0,
      denominations: [{ weight: 70, count: 1 }, { weight: 60, count: 1 }, { weight: 50, count: 1 }] }] }
    const use = { status: 'resolved', profileId: 'gym', itemId: 'stack', loadSemantics: 'total', implementCount: 1 }
    const s = missed(3, { cfg, equipmentSnapshot: structuredClone({ ...profile, workoutUnit: 'kg' }), entry: { equipmentUse: use } })
    s.activeEquipmentProfileId = 'gym'; s.equipmentProfiles = [profile]
    expect(assess(s, cfg)).toMatchObject({ proposedWeight: 60, effectiveReductionPercent: 14.29 })
    s.workouts[0].entries[0].equipmentUse = { ...use, loadSemantics: 'per_implement' }
    expect(assess(s, cfg)).toMatchObject({ status: 'observe', count: 2 })
    s.equipmentProfiles[0].items[0].tareWeight = 10
    expect(assess(s, cfg).status).toBe('none')
  })

  it('disabling an equipment profile invalidates its earlier suggestion', () => {
    const cfg = config({ equipmentUse: { mode: 'item', profileId: 'gym', itemId: 'bar' } })
    const profile = { id: 'gym', unit: 'kg', items: [{ id: 'bar', kind: 'symmetric_bar', tareWeight: 20 }] }
    const use = { status: 'resolved', profileId: 'gym', itemId: 'bar', loadSemantics: 'total', implementCount: 1 }
    const s = missed(3, { cfg, equipmentSnapshot: structuredClone(profile), entry: { equipmentUse: use } })
    s.equipmentProfiles = [profile]; s.activeEquipmentProfileId = 'gym'
    const a = assess(s, cfg)
    expect(a.canApply).toBe(true)
    s.activeEquipmentProfileId = null
    expect(assess(s, cfg).status).toBe('none')
    expect(applyConfirmedStall(s, cfg, a, { now: NOW })).toBe(s)
  })

  it('pain marked on an active exposure blocks a previously opened acceptance', () => {
    const s = missed(); const a = assess(s)
    s.active = { entries: [{ id: config().id, progressionId: 'p', review: { failureReason: 'pain' } }] }
    expect(applyConfirmedStall(s, config(), a, { now: NOW })).toBe(s)
  })

  it('invalid ignored load controls do not permanently silence new evidence', () => {
    const s = missed(); s.progressionControls = { p: { confirmedRepRangeLoad: { epochId: 'invalid' } } }
    expect(assess(s).status).toBe('proposed')
  })

  it('does not fabricate a load if no registered lower choice exists', () => {
    const cfg = config()
    const profile = { id: 'gym', unit: 'kg', items: [{ id: 'dumbbell', kind: 'fixed_weight', denominations: [{ weight: 70, count: 2 }] }] }
    const use = { status: 'resolved', profileId: 'gym', itemId: 'dumbbell', loadSemantics: 'per_implement', implementCount: 1 }
    const s = missed(3, { equipmentSnapshot: profile, entry: { equipmentUse: use } })
    expect(assess(s, cfg, { equipmentUse: { profile, equipmentUse: use } })).toMatchObject({ status: 'manual_review', proposedWeight: null })
  })

  it('stable assessment identities change when evidence changes', () => {
    const s = missed(); const first = assess(s)
    expect(assess(JSON.parse(JSON.stringify(s))).assessmentId).toBe(first.assessmentId)
    s.workouts[0].entries[0].sets[0].r = 8
    expect(assess(s).assessmentId).not.toBe(first.assessmentId)
  })

  it('acceptance preserves active/history/weights/PRs/rest and creates auditable epoch only', () => {
    const s = missed(); s.active = { id: 'active', entries: [] }; s.progressionWeights = { p: { w: 70 } }; s.prs = { bench: 100 }
    s.progressionControls = { p: { sibling: { value: 1 } }, other: { value: 2 } }
    const a = assess(s); const before = JSON.stringify(s)
    const next = applyConfirmedStall(s, config(), a, { now: NOW, epochId: 'new-epoch' })
    expect(next.progressionControls.p.confirmedRepRangeLoad).toEqual({ epochId: 'new-epoch', baselineWeight: 64,
      resetAt: NOW, reason: 'stall', sourceWorkoutIds: ['w1', 'w2', 'w3'], progressionKey: a.progressionKey, loadMode: 'external' })
    expect(next.progressionControls.p.confirmedRepRangeStall.status).toBe('accepted')
    expect(next.progressionControls.p.sibling).toBe(s.progressionControls.p.sibling)
    expect(next.progressionControls.other).toBe(s.progressionControls.other)
    for (const key of ['active', 'workouts', 'progressionWeights', 'prs']) expect(next[key]).toBe(s[key])
    expect(JSON.stringify(s)).toBe(before)
    expect(applyConfirmedStall(next, config(), a, { now: NOW, epochId: 'duplicate' })).toBe(next)
  })

  it('rechecks fresh history before acceptance and dismissals', () => {
    const s = missed(); const a = assess(s)
    s.workouts.push(workout(4, [10, 10, 10, 10]))
    expect(applyConfirmedStall(s, config(), a, { now: NOW })).toBe(s)
    expect(dismissConfirmedStall(s, config(), a, { now: NOW })).toBe(s)
    const other = missed()
    expect(applyConfirmedStall(other, config({ minReps: 6 }), a, { now: NOW })).toBe(other)
  })

  it.each([false, true])('dismiss/snooze persists across JSON roundtrip but new evidence reopens (%s)', snooze => {
    const s = missed(); const a = assess(s)
    const next = dismissConfirmedStall(s, config(), a, { snooze, now: NOW })
    const restored = JSON.parse(JSON.stringify(next))
    expect(assess(restored).status).toBe(snooze ? 'snoozed' : 'dismissed')
    expect(assess(restored).canApply).toBe(false)
    restored.workouts.push(workout(4))
    expect(assess(restored).status).toBe('proposed')
  })
})
