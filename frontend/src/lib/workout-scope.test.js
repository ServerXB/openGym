import { describe, expect, it } from 'vitest'
import { normalizeProgressionScopes } from './progression-scope.js'
import { appendScopedWorkoutEntry, buildScopedWorkoutEntry, completedWorkoutEntries } from './workout-scope.js'

describe('workout progression scope lifecycle', () => {
  it('snapshots both ids at start and keeps them unchanged through refresh and finish', () => {
    const state = {
      unit: 'kg', restSec: 90, exWeights: {}, progressionWeights: {}, workouts: [],
      progressionControls: {},
      routines: [{ id: 'day-a', ex: [{ id: 'lift', sets: 3, reps: 8, weight: 70, prog: 'linear' }] }]
    }
    normalizeProgressionScopes(state)
    const config = state.routines[0].ex[0]
    const activeEntry = buildScopedWorkoutEntry(state, config, state.routines[0])
    expect(activeEntry).toMatchObject({
      routineExerciseId: config.routineExerciseId,
      progressionId: config.progressionId
    })

    const refreshed = JSON.parse(JSON.stringify(activeEntry))
    refreshed.sets[0].done = true
    config.reps = 12
    normalizeProgressionScopes(state)
    const [completed] = completedWorkoutEntries([refreshed])
    expect(completed.routineExerciseId).toBe(activeEntry.routineExerciseId)
    expect(completed.progressionId).toBe(activeEntry.progressionId)
    expect(completed.target.reps).toBe(activeEntry.target.reps)
  })

  it('finishes a pre-upgrade active entry as unscoped immutable legacy history', () => {
    const [completed] = completedWorkoutEntries([{
      id: 'lift',
      sets: [{ w: 70, r: 8, done: true }],
      target: { sets: 1, reps: 8 }
    }])
    expect(completed).not.toHaveProperty('routineExerciseId')
    expect(completed).not.toHaveProperty('progressionId')
  })

  it('resolves equipment once, keeps local ids out of the target and persists the binding at finish', () => {
    const equipmentSnapshot = {
      schemaVersion: 1, id: 'gym', name: 'Gym', unit: 'kg', workoutUnit: 'kg',
      items: [{
        id: 'bar', label: '20 kg bar', kind: 'symmetric_bar', catalogEquipment: 'barbell',
        tareWeight: 20, implementCount: 1, sideCount: 2,
        denominations: [{ weight: 20, count: 2 }, { weight: 5, count: 2 }]
      }]
    }
    const state = {
      unit: 'kg', restSec: 90, workouts: [], exWeights: {}, progressionWeights: {}, progressionControls: {}
    }
    const config = {
      id: 'bench', sets: 1, reps: 8, weight: 70,
      equipmentUse: {
        mode: 'item', profileId: 'gym', itemId: 'bar',
        catalogEquipment: 'barbell', loadSemantics: 'total'
      }
    }

    const active = buildScopedWorkoutEntry(state, config, null, equipmentSnapshot)
    expect(active.equipmentUse).toMatchObject({
      status: 'resolved', profileId: 'gym', itemId: 'bar', source: 'slot_override'
    })
    expect(active.target).not.toHaveProperty('equipmentUse')

    active.sets[0].done = true
    const [finished] = completedWorkoutEntries([JSON.parse(JSON.stringify(active))])
    expect(finished.equipmentUse).toEqual(active.equipmentUse)
  })

  it('keeps legacy workouts without equipment snapshots readable', () => {
    const [finished] = completedWorkoutEntries([{
      id: 'legacy', sets: [{ w: 40, r: 10, done: true }], target: { sets: 1, reps: 10 }
    }])
    expect(finished).not.toHaveProperty('equipmentUse')
  })

  it('uses the workout-start snapshot for an exercise added after profile settings change', () => {
    const frozen = {
      schemaVersion: 1, id: 'gym', name: 'Gym', unit: 'kg', workoutUnit: 'kg',
      items: [{
        id: 'old-bar', label: 'Old bar', kind: 'symmetric_bar', catalogEquipment: 'barbell',
        tareWeight: 20, implementCount: 1, sideCount: 2, denominations: []
      }]
    }
    const state = {
      unit: 'kg', restSec: 90, workouts: [], exWeights: {}, progressionWeights: {}, progressionControls: {},
      activeEquipmentProfileId: 'gym',
      equipmentProfiles: [{ ...frozen, items: [{ ...frozen.items[0], id: 'new-bar', tareWeight: 15 }] }],
      active: { equipmentSnapshot: frozen, entries: [], cur: 0 }
    }
    const entry = appendScopedWorkoutEntry(state, {
      id: '0025', sets: 1, reps: 8, weight: 70
    })
    expect(entry.equipmentUse).toMatchObject({ status: 'resolved', itemId: 'old-bar' })
    expect(state.active.cur).toBe(0)
    expect(state.active.equipmentSnapshot.items[0].tareWeight).toBe(20)
  })

  it('does not adopt a profile activated after a profile-less workout started', () => {
    const state = {
      unit: 'kg', restSec: 90, workouts: [], exWeights: {}, progressionWeights: {}, progressionControls: {},
      activeEquipmentProfileId: 'gym',
      equipmentProfiles: [{
        id: 'gym', name: 'Gym', unit: 'kg',
        items: [{ id: 'bar', label: 'Bar', kind: 'symmetric_bar', catalogEquipment: 'barbell' }]
      }],
      active: { entries: [], cur: 0 }
    }
    const entry = appendScopedWorkoutEntry(state, { id: '0025', sets: 1, reps: 8, weight: 70 })
    expect(entry).not.toHaveProperty('equipmentUse')
  })

  it('retains a fully skipped Confirmed prescription but still omits unlogged other policies', () => {
    const confirmed = {
      id: 'confirmed', target: { prog: 'confirmed_rep_range', sets: 2, targetReps: 8 },
      sets: [{ w: 70, r: 8, done: false }, { w: 70, r: 8, done: false }]
    }
    const linear = {
      id: 'linear', target: { prog: 'linear', sets: 2, reps: 5 },
      sets: [{ w: 70, r: 5, done: false }, { w: 70, r: 5, done: false }]
    }

    expect(completedWorkoutEntries([confirmed, linear])).toEqual([
      expect.objectContaining({ id: 'confirmed', target: confirmed.target, sets: confirmed.sets })
    ])
  })

  it.each([
    ['reps', { reps: 10, prog: 'linear' }],
    ['time', { sec: 45, prog: 'time' }],
    ['confirmed', { reps: 8, minReps: 8, maxReps: 12, prog: 'confirmed_rep_range' }]
  ])('persists zero load for a pure bodyweight %s prescription', (_case, fields) => {
    const config = {
      id: 'bodyweight-movement', bodyweight: true, weight: 0, sets: 3,
      mode: fields.sec ? 'time' : 'reps', ...fields
    }
    const state = {
      unit: 'kg', restSec: 90, workouts: [], exWeights: { [config.id]: { w: 50 } },
      progressionWeights: {}, progressionControls: {}
    }

    const entry = buildScopedWorkoutEntry(state, config)
    expect(entry.target.weight).toBe(0)
    expect(entry.sets.every(set => set.w === 0)).toBe(true)
  })
})
