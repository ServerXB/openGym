import { describe, expect, it, vi } from 'vitest'
import { applyTimedSetCompletion, bindTimedSet } from './timed-set-completion.js'

const ids = () => {
  let next = 0
  return () => `timer-${++next}`
}
const timedEntry = (overrides = {}) => ({
  id: 'plank', routineExerciseId: 'plank-slot',
  target: { mode: 'time', sec: 45, sets: 2 },
  plan: { restSeconds: 90 },
  sets: [{ sec: 45, w: 0, done: false }, { sec: 45, w: 0, done: false }],
  ...overrides
})
const stateWith = (...entries) => ({
  restSec: 60,
  active: { id: 'workout-a', cur: 0, entries },
  routines: [{ id: 'routine-a', ex: [{ id: 'plank', mode: 'time', sec: 45, sets: 2 }] }],
  workouts: [{ id: 'history-a', entries: [timedEntry()] }]
})
const timerRecord = binding => ({
  workoutId: binding.workoutId,
  binding: { entryId: binding.entryId, setId: binding.setId }
})
const bindRecord = (state, entryIndex = 0, setIndex = 0, factory = ids()) =>
  timerRecord(bindTimedSet(state, entryIndex, setIndex, factory))

describe('timed set binding', () => {
  it('binds only the active entry and set that actually start a timer', () => {
    const state = stateWith(timedEntry(), timedEntry())
    const history = structuredClone(state.workouts)
    const routines = structuredClone(state.routines)

    expect(bindTimedSet(state, 1, 1, ids())).toEqual({
      workoutId: 'workout-a', entryId: 'timer-1', setId: 'timer-2'
    })
    expect(state.active.entries[0]).not.toHaveProperty('localTimerEntryId')
    expect(state.active.entries[0].sets[0]).not.toHaveProperty('localTimerSetId')
    expect(state.active.entries[1].sets[0]).not.toHaveProperty('localTimerSetId')
    expect(state.workouts).toEqual(history)
    expect(state.routines).toEqual(routines)
  })

  it('reuses existing unique IDs and assigns a distinct ID to another set', () => {
    const state = stateWith(timedEntry())
    const factory = vi.fn(ids())
    const first = bindTimedSet(state, 0, 0, factory)
    expect(bindTimedSet(state, 0, 0, factory)).toEqual(first)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(bindTimedSet(state, 0, 1, factory)).toEqual({
      workoutId: 'workout-a', entryId: first.entryId, setId: 'timer-3'
    })
  })

  it('skips generated collisions with any existing active token', () => {
    const state = stateWith(timedEntry({ localTimerEntryId: 'occupied' }), timedEntry())
    const tokens = ['occupied', 'new-entry', 'new-entry', 'new-set']
    expect(bindTimedSet(state, 1, 0, () => tokens.shift())).toEqual({
      workoutId: 'workout-a', entryId: 'new-entry', setId: 'new-set'
    })
  })

  it('does not partially bind a row when the ID factory cannot make unique tokens', () => {
    const state = stateWith(timedEntry())
    const before = structuredClone(state)
    expect(bindTimedSet(state, 0, 0, () => 'same-token')).toBeNull()
    expect(state).toEqual(before)
  })

  it.each([
    [null, 0, 0],
    [{ active: null }, 0, 0],
    [stateWith(timedEntry()), -1, 0],
    [stateWith(timedEntry()), 0.5, 0],
    [stateWith(timedEntry()), 0, -1],
    [stateWith(timedEntry()), 0, 0.5],
    [stateWith(timedEntry()), 8, 0],
    [stateWith(timedEntry()), 0, 8],
    [stateWith(timedEntry({ target: { mode: 'reps' } })), 0, 0],
    [stateWith(timedEntry({ target: { mode: 'cardio' } })), 0, 0],
    [stateWith(timedEntry({ sets: [{ sec: 45, done: true }] })), 0, 0]
  ])('refuses an invalid timer start %#', (state, entryIndex, setIndex) => {
    const before = structuredClone(state)
    expect(bindTimedSet(state, entryIndex, setIndex, ids())).toBeNull()
    expect(state).toEqual(before)
  })

  it('rejects duplicate pre-existing tokens instead of binding an ambiguous row', () => {
    const state = stateWith(
      timedEntry({ localTimerEntryId: 'duplicate' }),
      timedEntry({ localTimerEntryId: 'duplicate' })
    )
    expect(bindTimedSet(state, 0, 0, ids())).toBeNull()
    delete state.active.entries[1].localTimerEntryId
    state.active.entries[0].sets[0].localTimerSetId = 'set-duplicate'
    state.active.entries[1].sets[1].localTimerSetId = 'set-duplicate'
    expect(bindTimedSet(state, 0, 0, ids())).toBeNull()
  })
})

describe('timed set completion', () => {
  it('logs the actual elapsed duration and invalidates review without changing the prescription', () => {
    const entry = timedEntry({ asked: true, topW: 12, review: { confirmed: true } })
    Object.freeze(entry.target)
    Object.freeze(entry.plan)
    const state = stateWith(entry)
    const history = structuredClone(state.workouts)
    const routines = structuredClone(state.routines)
    const record = bindRecord(state)

    expect(applyTimedSetCompletion(state, record, 37.5)).toEqual({
      restSeconds: 90, workoutDone: false, entryDone: false, entryIndex: 0, setIndex: 0
    })
    expect(entry.sets[0]).toMatchObject({ sec: 37.5, w: 0, done: true })
    expect(entry.target.sec).toBe(45)
    expect(entry.plan.restSeconds).toBe(90)
    expect(entry).not.toHaveProperty('asked')
    expect(entry).not.toHaveProperty('topW')
    expect(entry).not.toHaveProperty('review')
    expect(state.workouts).toEqual(history)
    expect(state.routines).toEqual(routines)
  })

  it('distinguishes repeated exercises in independent routine slots', () => {
    const state = stateWith(timedEntry({ routineExerciseId: 'heavy' }), timedEntry({ routineExerciseId: 'light' }))
    const record = bindRecord(state, 1, 0)
    expect(applyTimedSetCompletion(state, record, 25)).toMatchObject({ entryIndex: 1, setIndex: 0 })
    expect(state.active.entries[0].sets[0]).toMatchObject({ sec: 45, done: false })
    expect(state.active.entries[1].sets[0]).toMatchObject({ sec: 25, done: true })
  })

  it('follows the same set after entries and sets move, independent of the viewed row', () => {
    const state = stateWith(timedEntry(), timedEntry({ routineExerciseId: 'other-slot' }))
    const record = bindRecord(state, 0, 1)
    const boundEntry = state.active.entries.shift()
    state.active.entries.push(boundEntry)
    boundEntry.sets.unshift({ sec: 15, done: false })
    state.active.cur = 0

    expect(applyTimedSetCompletion(state, record, 33)).toMatchObject({ entryIndex: 1, setIndex: 2 })
    expect(boundEntry.sets.map(set => set.done)).toEqual([false, false, true])
    expect(state.active.entries[0].sets.every(set => !set.done)).toBe(true)
  })

  it('rejects a removed set even when another set is added at the same index', () => {
    const state = stateWith(timedEntry())
    const record = bindRecord(state, 0, 1)
    state.active.entries[0].sets.pop()
    state.active.entries[0].sets.push({ sec: 45, done: false })
    const before = structuredClone(state)
    expect(applyTimedSetCompletion(state, record, 20)).toBeNull()
    expect(state).toEqual(before)
  })

  it('rejects a removed entry even when the same exercise and routine slot are re-added', () => {
    const state = stateWith(timedEntry())
    const record = bindRecord(state)
    state.active.entries.splice(0, 1, timedEntry())
    const before = structuredClone(state)
    expect(applyTimedSetCompletion(state, record, 20)).toBeNull()
    expect(state).toEqual(before)
  })

  it('cannot complete another workout or a fresh session of the same routine', () => {
    const state = stateWith(timedEntry())
    const factory = ids()
    const oldBinding = bindTimedSet(state, 0, 0, factory)
    const oldRecord = timerRecord(oldBinding)
    state.active = { id: 'workout-b', entries: [timedEntry()] }
    const newBinding = bindTimedSet(state, 0, 0, factory)
    const before = structuredClone(state)

    expect(newBinding.entryId).not.toBe(oldBinding.entryId)
    expect(newBinding.setId).not.toBe(oldBinding.setId)
    expect(applyTimedSetCompletion(state, oldRecord, 38)).toBeNull()
    expect(state).toEqual(before)
    expect(applyTimedSetCompletion(state, timerRecord(newBinding), 38)).not.toBeNull()
  })

  it('is idempotent and preserves a manually completed row', () => {
    const state = stateWith(timedEntry())
    const record = bindRecord(state)
    expect(applyTimedSetCompletion(state, record, 36)).not.toBeNull()
    const completed = structuredClone(state)
    expect(applyTimedSetCompletion(state, record, 45)).toBeNull()
    expect(state).toEqual(completed)

    const second = bindRecord(state, 0, 1)
    state.active.entries[0].sets[1].done = true
    state.active.entries[0].sets[1].sec = 29
    const manual = structuredClone(state)
    expect(applyTimedSetCompletion(state, second, 45)).toBeNull()
    expect(state).toEqual(manual)
  })

  it.each([0, -1, NaN, Infinity, -Infinity, undefined, null, '38'])('rejects invalid elapsed duration %s', elapsed => {
    const state = stateWith(timedEntry())
    const record = bindRecord(state)
    const before = structuredClone(state)
    expect(applyTimedSetCompletion(state, record, elapsed)).toBeNull()
    expect(state).toEqual(before)
  })

  it('refuses ended workouts, missing binding IDs, or a changed exercise mode', () => {
    const state = stateWith(timedEntry())
    const record = bindRecord(state)
    expect(applyTimedSetCompletion(state, { workoutId: 'workout-a', binding: {} }, 38)).toBeNull()
    state.active.entries[0].target.mode = 'reps'
    const before = structuredClone(state)
    expect(applyTimedSetCompletion(state, record, 38)).toBeNull()
    expect(state).toEqual(before)
    state.active = null
    expect(applyTimedSetCompletion(state, record, 38)).toBeNull()
  })

  it('rejects duplicate entry IDs', () => {
    const state = stateWith(timedEntry(), timedEntry())
    const record = bindRecord(state)
    state.active.entries[1].localTimerEntryId = record.binding.entryId
    const before = structuredClone(state)
    expect(applyTimedSetCompletion(state, record, 38)).toBeNull()
    expect(state).toEqual(before)
  })

  it.each([false, true])('rejects duplicate set IDs within or outside the bound entry (%s)', anotherEntry => {
    const state = stateWith(timedEntry(), timedEntry())
    const record = bindRecord(state)
    state.active.entries[anotherEntry ? 1 : 0].sets[1].localTimerSetId = record.binding.setId
    const before = structuredClone(state)
    expect(applyTimedSetCompletion(state, record, 38)).toBeNull()
    expect(state).toEqual(before)
  })

  it('rejects a set ID belonging to a different entry', () => {
    const state = stateWith(timedEntry(), timedEntry())
    const factory = ids()
    const first = bindTimedSet(state, 0, 0, factory)
    const second = bindTimedSet(state, 1, 0, factory)
    const record = { workoutId: first.workoutId, binding: { entryId: first.entryId, setId: second.setId } }
    const before = structuredClone(state)
    expect(applyTimedSetCompletion(state, record, 38)).toBeNull()
    expect(state).toEqual(before)
  })

  it('rests after the last exercise of a superset round using its longest recovery', () => {
    const state = stateWith(
      timedEntry({ sg: 'pair', plan: { restSeconds: 120 } }),
      timedEntry({ sg: 'pair', plan: { restSeconds: 75 } })
    )
    const factory = ids()
    const first = bindRecord(state, 0, 0, factory)
    const last = bindRecord(state, 1, 0, factory)
    expect(applyTimedSetCompletion(state, first, 30)).toMatchObject({ restSeconds: null })
    expect(applyTimedSetCompletion(state, last, 35)).toMatchObject({ restSeconds: 120 })
    expect(state.active.entries.map(entry => entry.sg)).toEqual(['pair', 'pair'])
  })

  it('stops resting on the final prescribed superset sets and completes the workout', () => {
    const state = stateWith(
      timedEntry({ sg: 'pair', sets: [{ sec: 45, done: false }] }),
      timedEntry({ sg: 'pair', sets: [{ sec: 45, done: false }] })
    )
    const factory = ids()
    expect(applyTimedSetCompletion(state, bindRecord(state, 0, 0, factory), 32)).toMatchObject({
      restSeconds: null, entryDone: true, workoutDone: false
    })
    expect(applyTimedSetCompletion(state, bindRecord(state, 1, 0, factory), 35)).toMatchObject({
      restSeconds: null, entryDone: true, workoutDone: true
    })
    expect(state.active.entries.map(entry => entry.sg)).toEqual(['pair', 'pair'])
  })

  it('derives the current superset after a bound entry moves', () => {
    const state = stateWith(
      timedEntry({ sg: 'pair', plan: { restSeconds: 120 } }),
      timedEntry({ sg: 'pair', plan: { restSeconds: 75 } })
    )
    const record = bindRecord(state, 0, 0)
    state.active.entries.reverse()
    expect(applyTimedSetCompletion(state, record, 30)).toMatchObject({ entryIndex: 1, restSeconds: 120 })
  })

  it('uses captured target recovery then profile recovery when no plan recovery exists', () => {
    const state = stateWith(timedEntry({ plan: {}, target: { mode: 'time', restSeconds: 80 } }))
    expect(applyTimedSetCompletion(state, bindRecord(state), 30).restSeconds).toBe(80)
    const fallback = stateWith(timedEntry({ plan: {} }))
    expect(applyTimedSetCompletion(fallback, bindRecord(fallback), 30).restSeconds).toBe(60)
  })

  it('ignores unchecked Confirmed optional rows when prescribed work completes', () => {
    const entry = timedEntry({ target: { mode: 'time', prog: 'confirmed_rep_range', sets: 1 } })
    const state = stateWith(entry)
    expect(applyTimedSetCompletion(state, bindRecord(state), 31)).toMatchObject({
      restSeconds: null, entryDone: true, workoutDone: true
    })
    expect(entry.sets[1].done).toBe(false)
  })

  it('preserves Confirmed review metadata for optional work and rests while optional rows remain', () => {
    const entry = timedEntry({
      target: { mode: 'time', prog: 'confirmed_rep_range', sets: 1 },
      asked: true, topW: 10, review: { confirmed: true },
      sets: [{ sec: 45, done: true }, { sec: 45, done: false }, { sec: 45, done: false }]
    })
    const state = stateWith(entry)
    const factory = ids()
    expect(applyTimedSetCompletion(state, bindRecord(state, 0, 1, factory), 32)).toMatchObject({
      restSeconds: 90, entryDone: false, workoutDone: false
    })
    expect(entry).toMatchObject({ asked: true, topW: 10, review: { confirmed: true } })
    expect(applyTimedSetCompletion(state, bindRecord(state, 0, 2, factory), 34)).toMatchObject({
      restSeconds: null, entryDone: false, workoutDone: false
    })
  })

  it('checks optional work across the complete superset even on its first exercise', () => {
    const confirmed = () => timedEntry({
      sg: 'pair', target: { mode: 'time', prog: 'confirmed_rep_range', sets: 1 },
      sets: [{ sec: 45, done: true }, { sec: 45, done: false }]
    })
    const state = stateWith(confirmed(), confirmed())
    state.active.entries[1].plan.restSeconds = 120
    const factory = ids()
    expect(applyTimedSetCompletion(state, bindRecord(state, 0, 1, factory), 32)).toMatchObject({ restSeconds: 120 })
    expect(applyTimedSetCompletion(state, bindRecord(state, 1, 1, factory), 34)).toMatchObject({ restSeconds: null })
  })

  it('keeps added timed rows prescribed outside Confirmed optional rules', () => {
    const entry = timedEntry({ target: { mode: 'time', prog: 'time', sets: 1 } })
    const state = stateWith(entry)
    const factory = ids()
    expect(applyTimedSetCompletion(state, bindRecord(state, 0, 0, factory), 31)).toMatchObject({
      restSeconds: 90, entryDone: false, workoutDone: false
    })
    expect(applyTimedSetCompletion(state, bindRecord(state, 0, 1, factory), 32)).toMatchObject({
      restSeconds: null, entryDone: true, workoutDone: true
    })
  })
})
