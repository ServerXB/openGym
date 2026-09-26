import { describe, expect, it } from 'vitest'
import { resolveThreeWayMerge, threeWayMerge } from './sync-merge.js'

describe('three-way sync merge', () => {
  it('keys routine slots by routineExerciseId before the replaceable exercise id', () => {
    const base = { routines: [{ id: 'push', ex: [
      { id: 'bench', routineExerciseId: 'slot-1', sets: 3, minReps: 8 }
    ] }] }
    const local = { routines: [{ id: 'push', ex: [
      { id: 'incline', routineExerciseId: 'slot-1', sets: 3, minReps: 8 }
    ] }] }
    const remote = { routines: [{ id: 'push', ex: [
      { id: 'bench', routineExerciseId: 'slot-1', sets: 4, minReps: 8 }
    ] }] }

    const result = threeWayMerge({ base, local, remote })

    expect(result.clean).toBe(true)
    expect(result.state.routines[0].ex).toEqual([
      { id: 'incline', routineExerciseId: 'slot-1', sets: 4, minReps: 8 }
    ])
  })

  it('reports one field conflict instead of duplicating a slot when both sides replace it', () => {
    const slot = id => ({ id, routineExerciseId: 'slot-1', sets: 3 })
    const result = threeWayMerge({
      base: { routines: [{ id: 'push', ex: [slot('bench')] }] },
      local: { routines: [{ id: 'push', ex: [slot('incline')] }] },
      remote: { routines: [{ id: 'push', ex: [slot('dumbbell')] }] }
    })

    expect(result.clean).toBe(false)
    expect(result.state.routines[0].ex).toHaveLength(1)
    expect(result.conflicts).toEqual([
      expect.objectContaining({ path: expect.stringContaining('@routineExerciseId=') })
    ])
  })

  it('merges independent object changes without a conflict', () => {
    const base = { settings: { theme: 'dark', accent: 'lime' }, routines: [] }
    const local = { settings: { theme: 'light', accent: 'lime' }, routines: [] }
    const remote = { settings: { theme: 'dark', accent: 'blue' }, routines: [] }

    expect(threeWayMerge({ base, local, remote })).toEqual({
      state: { routines: [], settings: { accent: 'blue', theme: 'light' } },
      conflicts: [], clean: true
    })
  })

  it('reports a same-field conflict with both values and uses local provisionally', () => {
    const merged = threeWayMerge({
      base: { restSec: 90 }, local: { restSec: 120 }, remote: { restSec: 150 }
    })

    expect(merged.clean).toBe(false)
    expect(merged.state.restSec).toBe(120)
    expect(merged.conflicts).toEqual([{
      path: '/restSec', reason: 'value',
      baseExists: true, localExists: true, remoteExists: true,
      base: 90, local: 120, remote: 150
    }])
  })

  it('treats delete-versus-edit as an explicit conflict', () => {
    const merged = threeWayMerge({
      base: { reminder: { on: true, time: '08:00' } },
      local: {},
      remote: { reminder: { on: true, time: '09:00' } }
    })

    expect(merged.state).toEqual({})
    expect(merged.conflicts[0]).toMatchObject({
      path: '/reminder', localExists: false, remoteExists: true
    })
  })

  it('merges concurrent additions to stable-id entity collections', () => {
    const base = { workouts: [{ id: 'old', note: '' }] }
    const local = { workouts: [
      { id: 'local-new', start: 20 }, { id: 'old', note: '' }
    ] }
    const remote = { workouts: [
      { id: 'remote-new', start: 30 }, { id: 'old', note: '' }
    ] }
    const merged = threeWayMerge({ base, local, remote })

    expect(merged.clean).toBe(true)
    expect(merged.state.workouts.map(item => item.id)).toEqual([
      'local-new', 'remote-new', 'old'
    ])
  })

  it('merges separate changes inside the same identified entity', () => {
    const base = { routines: [{ id: 'day-a', name: 'A', note: '', ex: [] }] }
    const local = { routines: [{ id: 'day-a', name: 'Upper A', note: '', ex: [] }] }
    const remote = { routines: [{ id: 'day-a', name: 'A', note: 'Thursday', ex: [] }] }
    const merged = threeWayMerge({ base, local, remote })

    expect(merged).toMatchObject({ clean: true, conflicts: [] })
    expect(merged.state.routines[0]).toEqual({
      ex: [], id: 'day-a', name: 'Upper A', note: 'Thursday'
    })
  })

  it('merges legacy date-keyed bodyweight entries when dates are unique', () => {
    const merged = threeWayMerge({
      base: { bodyweight: [{ d: '2026-01-01', w: 80 }] },
      local: { bodyweight: [
        { d: '2026-01-02', w: 79.8 }, { d: '2026-01-01', w: 80 }
      ] },
      remote: { bodyweight: [
        { d: '2026-01-03', w: 79.5 }, { d: '2026-01-01', w: 80 }
      ] }
    })

    expect(merged.clean).toBe(true)
    expect(merged.state.bodyweight.map(entry => entry.d)).toEqual([
      '2026-01-02', '2026-01-03', '2026-01-01'
    ])
  })

  it('applies a one-sided entity deletion when the other side is unchanged', () => {
    const base = { customEx: [{ id: 'keep' }, { id: 'remove' }] }
    const local = { customEx: [{ id: 'keep' }] }
    const remote = { customEx: [{ id: 'keep' }, { id: 'remove' }] }

    expect(threeWayMerge({ base, local, remote })).toMatchObject({
      state: { customEx: [{ id: 'keep' }] }, clean: true, conflicts: []
    })
  })

  it('keeps unidentifiable set arrays atomic to avoid unsafe interleaving', () => {
    const base = { sets: [{ reps: 8, weight: 70 }, { reps: 8, weight: 70 }] }
    const local = { sets: [{ reps: 9, weight: 70 }, { reps: 8, weight: 70 }] }
    const remote = { sets: [{ reps: 8, weight: 70 }, { reps: 8, weight: 72 }] }
    const merged = threeWayMerge({ base, local, remote })

    expect(merged.clean).toBe(false)
    expect(merged.conflicts[0]).toMatchObject({ path: '/sets', reason: 'value' })
    expect(merged.state.sets).toEqual(local.sets)
  })

  it('detects incompatible concurrent collection reorders', () => {
    const base = { routines: [
      { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }
    ] }
    const local = { routines: [
      { id: 'b', name: 'B' }, { id: 'a', name: 'Local A' }, { id: 'c', name: 'C' }
    ] }
    const remote = { routines: [
      { id: 'a', name: 'A' }, { id: 'c', name: 'Remote C' }, { id: 'b', name: 'B' }
    ] }
    const merged = threeWayMerge({ base, local, remote })

    expect(merged.clean).toBe(false)
    expect(merged.conflicts).toContainEqual(expect.objectContaining({
      path: '/routines/$order', reason: 'array-order'
    }))
  })

  it('resolves only ambiguous nodes while preserving safe changes from both sides', () => {
    const input = {
      base: {
        settings: { accent: 'lime', theme: 'dark' },
        routines: [{ id: 'base', name: 'Base' }]
      },
      local: {
        settings: { accent: 'red', theme: 'dark' },
        routines: [{ id: 'base', name: 'Base' }, { id: 'local', name: 'Local' }]
      },
      remote: {
        settings: { accent: 'blue', theme: 'light' },
        routines: [{ id: 'base', name: 'Base' }, { id: 'remote', name: 'Remote' }]
      }
    }

    const chooseLocal = resolveThreeWayMerge(input, 'local')
    const chooseRemote = resolveThreeWayMerge(input, 'remote')
    expect(chooseLocal).toMatchObject({ clean: true, resolvedWith: 'local' })
    expect(chooseRemote).toMatchObject({ clean: true, resolvedWith: 'remote' })
    expect(chooseLocal.state.settings).toEqual({ accent: 'red', theme: 'light' })
    expect(chooseRemote.state.settings).toEqual({ accent: 'blue', theme: 'light' })
    for (const result of [chooseLocal, chooseRemote]) {
      expect(result.state.routines.map(routine => routine.id)).toEqual(['base', 'local', 'remote'])
    }
  })

  it('never includes the local active workout or timestamp in a merge result', () => {
    const merged = threeWayMerge({
      base: { unit: 'kg' },
      local: { unit: 'kg', active: { id: 'local-active' }, _ts: 1 },
      remote: { unit: 'kg', active: { id: 'remote-active' }, _ts: 2 }
    })
    expect(merged).toEqual({ state: { unit: 'kg' }, conflicts: [], clean: true })
  })

  it('validates the requested conflict resolution side', () => {
    expect(() => resolveThreeWayMerge({ base: {}, local: {}, remote: {} }, 'newest'))
      .toThrow(/local or remote/)
  })
})
