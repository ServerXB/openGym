import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workoutDateKey } from './lib/workout-time.js'

const harness = vi.hoisted(() => ({
  S: null,
  nav: vi.fn(),
  stopRest: vi.fn(),
  openSheet: vi.fn(),
  toast: vi.fn()
}))

vi.mock('./store/useStore.js', () => {
  const clone = value => JSON.parse(JSON.stringify(value))
  const useStore = selector => selector({ S: harness.S })
  useStore.getState = () => ({
    S: harness.S,
    update: mutator => {
      const next = clone(harness.S)
      mutator(next)
      harness.S = next
    }
  })
  return { useStore }
})

vi.mock('./store/useUI.js', () => {
  const ui = {
    stopRest: harness.stopRest,
    openSheet: harness.openSheet,
    toast: harness.toast
  }
  const useUI = selector => selector(ui)
  useUI.getState = () => ui
  return { useUI }
})

vi.mock('./lib/nav.js', () => ({ nav: harness.nav }))
vi.mock('./lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

import { beginWorkout, discardActiveWorkout, doFinishWorkout } from './sheets.jsx'

const emptyState = () => ({
  routines: [], workouts: [], active: null,
  exWeights: {}, progressionWeights: {},
  sound: false, unit: 'kg', body: 'male'
})

beforeEach(() => {
  vi.restoreAllMocks()
  harness.S = emptyState()
  harness.nav.mockReset()
  harness.stopRest.mockReset()
  harness.openSheet.mockReset()
  harness.toast.mockReset()
})

describe('workout lifecycle timestamp wiring', () => {
  it('carries the exact captured start through one idempotent finish', () => {
    const start = Date.parse('2026-08-29T16:05:00.123Z')
    const end = Date.parse('2026-08-29T17:12:00.456Z')
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)

    beginWorkout(null, 78)

    const active = structuredClone(harness.S.active)
    expect(active).toMatchObject({
      start, bw: 78, timeSource: 'native', timePrecision: 'millisecond'
    })
    expect(active.d).toBe(workoutDateKey(start, active.startTimeZone))
    expect(harness.nav).toHaveBeenLastCalledWith('/workout')

    now.mockReturnValue(end)
    doFinishWorkout()

    expect(harness.S.active).toBeNull()
    expect(harness.S.workouts).toHaveLength(1)
    expect(harness.S.workouts[0]).toMatchObject({
      id: active.id,
      d: active.d,
      start,
      end,
      startTimeZone: active.startTimeZone,
      timeSource: 'native',
      timePrecision: 'millisecond'
    })
    expect(harness.S.workouts[0].endTimeZone).toBeTruthy()
    expect(harness.openSheet).toHaveBeenCalledTimes(1)

    doFinishWorkout()
    expect(harness.S.workouts).toHaveLength(1)
    expect(harness.openSheet).toHaveBeenCalledTimes(1)
  })

  it('discards only the active snapshot and never creates completed history', () => {
    const existing = { id: 'already-done', d: '2026-08-28', entries: [] }
    harness.S.workouts.push(existing)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-29T16:05:00Z'))
    beginWorkout(null, 78)
    expect(harness.S.active).not.toBeNull()

    harness.nav.mockClear()
    harness.stopRest.mockClear()
    discardActiveWorkout()

    expect(harness.S.active).toBeNull()
    expect(harness.S.workouts).toEqual([existing])
    expect(harness.stopRest).toHaveBeenCalledTimes(1)
    expect(harness.nav).toHaveBeenCalledWith('/home')
  })
})
