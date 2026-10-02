import { describe, expect, it } from 'vitest'
import { recentExerciseSessions } from './exercise-session-history.js'
import { nextPrescription } from './progression.js'
import { buildScopedWorkoutEntry, completedWorkoutEntries } from './workout-scope.js'
import { applyActiveTopWeight, applyWorkoutWeights, recordsForWorkout } from './workout-records.js'
import { confirmedLoadProgressionKey } from './confirmedRepRangeLoad.js'
import { snapshotActiveEquipmentProfile } from './equipment-load.js'
import { threeWayMerge } from './sync-merge.js'

const config = {
  id: 'session-history-lift', progressionId: 'history:main', routineExerciseId: 'slot:main',
  mode: 'reps', prog: 'confirmed_rep_range', sets: 4, minReps: 8, maxReps: 10,
  reps: 8, weight: 70, inc: 2, restSeconds: 120, maxRestSeconds: 180,
  restReductionStrategy: 'auto_after_successes'
}
const state = () => ({
  unit: 'kg', restSec: 90, active: null, workouts: [],
  routines: [{ id: 'monday', name: 'Monday', prog: 'confirmed_rep_range', ex: [{ ...config }] }],
  progressionControls: {}, progressionWeights: { [config.progressionId]: { w: 70 } },
  exWeights: { [config.id]: { w: 90 } }
})

function start(S, routine = S.routines[0]) {
  const equipmentSnapshot = snapshotActiveEquipmentProfile(S)
  const day = String(S.workouts.length + 1).padStart(2, '0')
  S.active = {
    id: `workout-${day}`, d: `2026-09-${day}`, start: Date.parse(`2026-09-${day}T10:00:00Z`),
    routineId: routine.id, name: routine.name, unit: S.unit,
    ...(equipmentSnapshot ? { equipmentSnapshot } : {}),
    entries: routine.ex.map(cfg => buildScopedWorkoutEntry(S, cfg, routine, equipmentSnapshot))
  }
  return S.active
}

function complete(S) {
  const workout = { ...S.active, entries: completedWorkoutEntries(S.active.entries) }
  applyWorkoutWeights(S, workout.entries, workout.d)
  S.workouts.push(workout)
  S.active = null
  return workout
}

function finish(S, { routine = S.routines[0], reps = 10 } = {}) {
  start(S, routine).entries.forEach(entry => entry.sets.forEach(set => {
    set.r = reps
    set.done = true
  }))
  return complete(S)
}

function acceptLoadReset(S, epochId = 'load-reset-1', baselineWeight = 64) {
  S.progressionControls[config.progressionId] = {
    ...S.progressionControls[config.progressionId],
    confirmedRepRangeLoad: {
      epochId, baselineWeight, resetAt: 1000, reason: 'stall',
      sourceWorkoutIds: S.workouts.map(workout => workout.id),
      progressionKey: confirmedLoadProgressionKey(config), loadMode: 'external', plannedSets: 4
    }
  }
}

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    Object.values(value).forEach(freeze)
  }
  return value
}

describe('exercise history through the workout lifecycle', () => {
  it('keeps inherited policy and active targets when the routine is edited before completion', () => {
    const S = state(), routine = S.routines[0], cfg = routine.ex[0]
    delete cfg.prog
    const active = start(S).entries[0]
    expect(active.target).toMatchObject({ prog: 'confirmed_rep_range', sets: 4, restSeconds: 120 })
    const target = structuredClone(active.target)
    routine.name = 'Renamed Monday'
    routine.prog = 'linear'
    Object.assign(cfg, { sets: 6, minReps: 6, maxReps: 15, restSeconds: 60 })
    active.sets.forEach(set => { set.done = true; set.r = 10 })
    complete(S)

    const [row] = recentExerciseSessions(S, active)
    expect(row).toMatchObject({ routineName: 'Monday', outcome: 'maximum_first', confirmation: 1 })
    expect(row.target).toEqual(target)
    expect(row.entry.sets).toHaveLength(4)
    expect(nextPrescription(S, cfg, routine).policy).toBe('linear')
  })

  it('records two maxima, earns a weight increase, and starts confirmation one at the new load', () => {
    const S = state()
    const workouts = Array.from({ length: 3 }, () => finish(S))
    const active = start(S).entries[0]
    expect(workouts.map(workout => workout.entries[0].target.weight)).toEqual([70, 70, 72])
    expect(workouts.map(workout => workout.entries[0].target.topRangeStreak)).toEqual([0, 1, 0])
    expect(recentExerciseSessions(S, active).map(row => [row.confirmation, row.progressionEarned]))
      .toEqual([[1, null], [2, 'weight'], [1, null]])
    expect(nextPrescription(S, S.routines[0].ex[0], S.routines[0]))
      .toMatchObject({ weight: 72, reps: 10, topRangeStreak: 1 })
  })

  it('reduces 150-second recovery after four successes before counting two base-recovery maxima', () => {
    const S = state()
    S.progressionControls[config.progressionId] = {
      confirmedRepRangeRest: { epochId: 'rest-reset', resetSeconds: 150, resetAt: 500 }
    }
    const outcomes = []
    const workouts = Array.from({ length: 6 }, () => {
      const workout = finish(S)
      outcomes.push(recentExerciseSessions(S, workout.entries[0])[0].outcome)
      return workout
    })
    expect(workouts.map(workout => workout.entries[0].target.restSeconds))
      .toEqual([150, 150, 150, 150, 120, 120])
    expect(workouts.every(workout => workout.entries[0].target.weight === 70)).toBe(true)
    expect(outcomes).toEqual([
      'maximum_recovery', 'maximum_recovery', 'maximum_recovery', 'maximum_recovery',
      'maximum_first', 'progression_earned'
    ])
    const active = start(S).entries[0]
    expect(active.target).toMatchObject({ weight: 72, restSeconds: 120, topRangeStreak: 0 })
    expect(recentExerciseSessions(S, active).map(row => row.confirmation)).toEqual([2, 1, 0, 0])
  })

  it('preserves earned older cards through accepted load controls and subsequent epochs', () => {
    const S = state()
    finish(S); finish(S)
    const old = structuredClone(S.workouts)
    const active = start(S).entries[0]
    const before = recentExerciseSessions(S, active)
    S.active = null
    acceptLoadReset(S)
    expect(recentExerciseSessions(S, active)).toEqual(before)
    expect(S.workouts).toEqual(old)
    finish(S); finish(S)
    expect(S.workouts.slice(-2).map(workout => workout.entries[0].target.weight)).toEqual([64, 64])
    acceptLoadReset(S, 'load-reset-2', 60)
    const current = start(S).entries[0]
    expect(current.target).toMatchObject({ weight: 60, loadEpochId: 'load-reset-2', topRangeStreak: 0 })
    expect(recentExerciseSessions(S, current).map(row => [row.confirmation, row.target.weight]))
      .toEqual([[2, 64], [1, 64], [2, 70], [1, 70]])
    expect(S.workouts.slice(0, 2)).toEqual(old)
  })

  it('uses the real equipment snapshot after profile, tare, unit and binding edits', () => {
    const S = state(), cfg = S.routines[0].ex[0]
    S.unit = 'lb'
    S.activeEquipmentProfileId = 'gym'
    S.equipmentProfiles = [{ id: 'gym', name: 'Original gym', unit: 'lb', items: [{
      id: 'bar', kind: 'symmetric_bar', label: 'Original bar', tareWeight: 45, denominations: []
    }] }]
    cfg.equipmentUse = { mode: 'item', profileId: 'gym', itemId: 'bar', loadSemantics: 'total' }
    const historical = finish(S)
    expect(historical.entries[0].equipmentUse.status).toBe('resolved')
    S.unit = 'kg'
    S.equipmentProfiles[0].name = 'Changed gym'
    S.equipmentProfiles[0].unit = 'kg'
    Object.assign(S.equipmentProfiles[0].items[0], { label: 'Changed bar', tareWeight: 20 })
    cfg.equipmentUse = { mode: 'none' }
    const active = start(S).entries[0]

    const [row] = recentExerciseSessions(S, active)
    expect(row).toMatchObject({ unit: 'lb', unitInferred: false, equipment: {
      profileName: 'Original gym', label: 'Original bar', tareWeight: 45, unit: 'lb', loadSemantics: 'total'
    } })
    expect(row.entry.sets.map(set => set.w)).toEqual([70, 70, 70, 70])
    expect(active.equipmentUse).toBeUndefined()
  })

  it('retains top-weight review and optional work without changing the prescribed working load', () => {
    const S = state()
    const entry = start(S).entries[0]
    entry.sets.forEach(set => { set.done = true; set.r = 10 })
    entry.sets[0].rir = 0
    entry.sets[1].rpe = 8.5
    entry.sets.push({ w: 95, r: 2, done: true })
    applyActiveTopWeight(S, entry, 100, S.active.d)
    complete(S)
    const [row] = recentExerciseSessions(S, start(S).entries[0])

    expect(row).toMatchObject({ outcome: 'maximum_first', confirmation: 1 })
    expect(row.entry.topW).toBe(100)
    expect(row.entry.sets).toEqual([
      { w: 70, r: 10, done: true, rir: 0 }, { w: 70, r: 10, done: true, rpe: 8.5 },
      { w: 70, r: 10, done: true }, { w: 70, r: 10, done: true }, { w: 95, r: 2, done: true }
    ])
    expect(S.exWeights[config.id].w).toBe(100)
    expect(S.progressionWeights[config.progressionId].w).toBe(70)
    expect(S.active.entries[0].target.weight).toBe(70)
  })

  it('separates duplicate catalog entries and includes deliberately shared routine sessions', () => {
    const S = state(), monday = S.routines[0]
    monday.ex.push({ ...config, progressionId: 'history:independent', routineExerciseId: 'slot:second', weight: 30 })
    S.progressionWeights['history:independent'] = { w: 30 }
    const shared = { id: 'saturday', name: 'Saturday', prog: 'confirmed_rep_range',
      ex: [{ ...config, routineExerciseId: 'slot:saturday' }] }
    S.routines.push(shared)
    finish(S)
    finish(S, { routine: shared })
    const active = start(S)

    expect(recentExerciseSessions(S, active.entries[0]).map(row => [row.routineName, row.shared, row.confirmation]))
      .toEqual([['Saturday', true, 2], ['Monday', false, 1]])
    const independent = recentExerciseSessions(S, active.entries[1])
    expect(independent).toHaveLength(1)
    expect(independent[0]).toMatchObject({ shared: false, confirmation: 1 })
    expect(independent[0].entry.sets.every(set => set.w === 30)).toBe(true)
    expect(active.entries.map(entry => entry.target.weight)).toEqual([72, 30])
  })

  it('re-reads merged and JSON-restored sessions and invalidates a deleted confirmation predecessor', () => {
    const base = state()
    finish(base)
    const local = structuredClone(base), remote = structuredClone(base)
    finish(local)
    remote.askBodyweightBeforeWorkout = false
    const merged = threeWayMerge({ base, local, remote })
    expect(merged.conflicts).toEqual([])
    const S = JSON.parse(JSON.stringify(merged.state))
    const active = start(S).entries[0]
    expect(recentExerciseSessions(S, active).map(row => row.confirmation)).toEqual([2, 1])

    const remoteDeletion = structuredClone(S)
    remoteDeletion.workouts = remoteDeletion.workouts.slice(1)
    const deletion = threeWayMerge({ base: S, local: S, remote: remoteDeletion })
    expect(deletion.conflicts).toEqual([])
    const [remaining] = recentExerciseSessions(deletion.state, active)
    expect(remaining.workoutId).toBe(S.workouts[1].id)
    expect(remaining.target.topRangeStreak).toBe(1)
    expect(remaining.confirmation).not.toBe(2)
    expect(remaining.outcome).not.toBe('progression_earned')
    expect(remaining.progressionEarned).toBeNull()
  })

  it('does not retain a second confirmation after the previous completed session is corrected', () => {
    const S = state()
    finish(S); finish(S)
    const active = start(S).entries[0]
    expect(recentExerciseSessions(S, active)[0].confirmation).toBe(2)
    S.workouts[0].entries[0].sets[0].done = false
    const [second, first] = recentExerciseSessions(S, active)
    expect(first.outcome).toBe('incomplete')
    expect(second.confirmation).not.toBe(2)
    expect(second.outcome).not.toBe('progression_earned')
    expect(second.progressionEarned).toBeNull()
  })

  it('leaves active data, numerical prescriptions, controls, maps and PR detection unchanged on repeated reads', () => {
    const S = state()
    finish(S); finish(S)
    acceptLoadReset(S)
    S.progressionControls[config.progressionId].confirmedRepRangeRest = {
      epochId: 'rest-reset', resetSeconds: 150, resetAt: 2000
    }
    const active = start(S).entries[0]
    active.sets[0] = { ...active.sets[0], w: 110, r: 10, done: true, rir: 0 }
    active.review = { technique: 'clean' }
    const before = structuredClone(S)
    const prescription = nextPrescription(S, S.routines[0].ex[0], S.routines[0])
    const records = recordsForWorkout(S, S.active.entries)
    expect(records.prs).toEqual([config.id])
    freeze(S)

    expect(recentExerciseSessions(S, active)).toEqual(recentExerciseSessions(S, active))
    expect(S).toEqual(before)
    expect(nextPrescription(S, S.routines[0].ex[0], S.routines[0])).toEqual(prescription)
    expect(recordsForWorkout(S, S.active.entries)).toEqual(records)
  })
})
