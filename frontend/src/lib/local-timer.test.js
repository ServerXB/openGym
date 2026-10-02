import { describe, expect, it } from 'vitest'
import {
  TIMER_VERSION,
  anchorTimer,
  changeTimer,
  createTimer,
  displayTimer,
  matchesTimer,
  remainingTimerMs,
  timerToken,
  validateTimer,
} from './local-timer.js'

const start = (fields = {}, previous = null, clocks = {}) => createTimer({
  kind: 'rest', accountId: 'account-1', workoutId: 'workout-1', durationMs: 60_000,
  ...fields,
}, previous, { wallNow: 1_000_000, monoNow: 100, id: 'timer-1', ...clocks })
const clock = (elapsed, wallOffset = 0) => ({ wallNow: 1_000_000 + elapsed + wallOffset, monoNow: 100 + elapsed })

describe('local timer elapsed time', () => {
  it('uses the deadline after a delayed 35-second callback', () => {
    const timer = start()
    const anchor = anchorTimer(timer, clock(0))
    expect(remainingTimerMs(timer, anchor, clock(35_000))).toBe(25_000)
    expect(displayTimer(timer, remainingTimerMs(timer, anchor, clock(35_000)))).toMatchObject({ left: 25, total: 60, endsAt: 1_060_000 })
  })

  it('keeps the last 499 ms visible and clamps elapsed time at zero', () => {
    const timer = start()
    const anchor = anchorTimer(timer, clock(0))
    expect(displayTimer(timer, remainingTimerMs(timer, anchor, clock(59_501))).left).toBe(1)
    expect(displayTimer(timer, remainingTimerMs(timer, anchor, clock(65_000))).left).toBe(0)
    expect(displayTimer(timer, -10).left).toBe(0)
  })

  it('ignores both forward and backward wall-clock changes while anchored', () => {
    const timer = start()
    const anchor = anchorTimer(timer, clock(0))
    expect(remainingTimerMs(timer, anchor, clock(20_000, 3_600_000))).toBe(40_000)
    expect(remainingTimerMs(timer, anchor, clock(20_000, -900_000))).toBe(40_000)
  })

  it('restores elapsed time from the wall deadline before anchoring again', () => {
    const timer = validateTimer(JSON.parse(JSON.stringify(start())))
    expect(remainingTimerMs(timer, null, clock(35_000))).toBe(25_000)
    const restored = anchorTimer(timer, { wallNow: 1_035_000, monoNow: 0 })
    expect(restored.monoDeadline).toBe(25_000)
    expect(remainingTimerMs(timer, restored, { wallNow: 1_400_000, monoNow: 10_000 })).toBe(15_000)
    expect(anchorTimer(timer, clock(90_000)).monoDeadline).toBe(90_100)
    expect(remainingTimerMs(timer, null, clock(90_000))).toBe(0)
  })

  it('falls back to wall time for an anchor from another identity or revision', () => {
    const timer = start()
    const anchor = anchorTimer(timer, clock(0))
    expect(remainingTimerMs(timer, { ...anchor, timerId: 'other' }, clock(20_000, 5_000))).toBe(35_000)
    expect(remainingTimerMs(timer, { ...anchor, revision: 2 }, clock(20_000, 5_000))).toBe(35_000)
  })
})

describe('local timer mutations', () => {
  it('completes only after expiry and completes the matching revision once', () => {
    const timer = start()
    const token = timerToken(timer)
    expect(changeTimer(timer, token, { type: 'complete' }, 1, clock(59_999))).toBe(timer)
    const completed = changeTimer(timer, token, { type: 'complete' }, 0, clock(60_000))
    expect(completed).toMatchObject({ status: 'completed', revision: 2, updatedAt: 1_060_000 })
    expect(changeTimer(completed, token, { type: 'complete' }, 0, clock(60_001))).toBe(completed)
    expect(changeTimer(completed, timerToken(completed), { type: 'complete' }, 0, clock(60_001))).toBe(completed)
    expect(remainingTimerMs(completed, null, clock(0))).toBe(0)
  })

  it('does not let stale actions mutate an extended or replacement timer', () => {
    const timer = start()
    const token = timerToken(timer)
    const extended = changeTimer(timer, token, { type: 'extend', deltaMs: 15_000 }, 40_000, clock(20_000))
    expect(extended.revision).toBe(2)
    expect(matchesTimer(extended, token)).toBe(false)
    expect(changeTimer(extended, token, { type: 'cancel' }, 0, clock(21_000))).toBe(extended)
    const replacement = start({}, extended, { id: 'timer-2', wallNow: 1_030_000 })
    expect(replacement.revision).toBe(3)
    expect(changeTimer(replacement, timerToken(extended), { type: 'cancel' }, 0, clock(31_000))).toBe(replacement)
  })

  it('starts with a revision newer than terminal records', () => {
    const timer = start()
    const cancelled = changeTimer(timer, timerToken(timer), { type: 'cancel' }, 50_000, clock(10_000))
    expect(cancelled.status).toBe('cancelled')
    expect(remainingTimerMs(cancelled, null, clock(10_000))).toBe(0)
    expect(start({}, cancelled, { id: 'timer-2' }).revision).toBe(3)
    expect(timer.revision).toBe(1)
  })

  it('extends the actual fractional remaining time without rounding to displayed seconds', () => {
    const timer = start()
    const extended = changeTimer(timer, timerToken(timer), { type: 'extend', deltaMs: 15_000 }, 499.25, clock(59_500.75))
    expect(extended).toMatchObject({ durationMs: 75_000, deadlineAt: 1_075_000, revision: 2, status: 'running' })
    expect(remainingTimerMs(extended, null, clock(59_500.75))).toBe(15_499.25)
    expect(timer.durationMs).toBe(60_000)
  })

  it.each([3_600_000, -900_000])('persists an extension after a wall clock shift of %s ms', wallOffset => {
    const timer = start()
    const anchor = anchorTimer(timer, clock(0))
    const time = clock(20_000, wallOffset)
    const remaining = remainingTimerMs(timer, anchor, time)
    const extended = changeTimer(timer, timerToken(timer), { type: 'extend', deltaMs: 15_000 }, remaining, time)
    expect(extended.deadlineAt).toBe(time.wallNow + 55_000)
    expect(validateTimer(extended)).toEqual(extended)
    expect(remainingTimerMs(extended, anchorTimer(extended, time), { ...time, monoNow: time.monoNow + 10_000 })).toBe(45_000)
  })

  it('subtracts time and cancels without completion when the remaining time is exhausted', () => {
    const timer = start()
    const shorter = changeTimer(timer, timerToken(timer), { type: 'extend', deltaMs: -15_000 }, 40_000, clock(20_000))
    expect(shorter).toMatchObject({ durationMs: 45_000, deadlineAt: 1_045_000, status: 'running' })
    const cancelled = changeTimer(timer, timerToken(timer), { type: 'extend', deltaMs: -15_000 }, 499, clock(59_501))
    expect(cancelled).toMatchObject({ durationMs: 45_000, deadlineAt: 1_045_000, status: 'cancelled' })
    expect(validateTimer(cancelled)).toEqual(cancelled)
    const zero = changeTimer(timer, timerToken(timer), { type: 'extend', deltaMs: -60_000 }, 60_000, clock(0))
    expect(zero).toMatchObject({ durationMs: 0, status: 'cancelled' })
    expect(validateTimer(zero)).toEqual(zero)
  })

  it('enforces the 24-hour bound for creation and extension', () => {
    const maximum = start({ durationMs: 86_400_000 })
    expect(maximum.durationMs).toBe(86_400_000)
    expect(() => start({ durationMs: 86_400_001 })).toThrow(RangeError)
    expect(() => changeTimer(maximum, timerToken(maximum), { type: 'extend', deltaMs: 1 }, 86_400_000, clock(0))).toThrow(RangeError)
    expect(maximum.revision).toBe(1)
  })
})

describe('local timer durable schema and payload validation', () => {
  it('normalizes a clone, copies work bindings, and preserves completion delivery state', () => {
    const timer = start({ kind: 'work', binding: { entryId: 'entry-1', setId: 'set-1', ignored: true } })
    const input = { ...timer, status: 'completed', deliveryPending: true, elapsedSeconds: 45, extra: true }
    const normalized = validateTimer(input)
    expect(normalized).toEqual({ ...timer, status: 'completed', deliveryPending: true, elapsedSeconds: 45 })
    expect(normalized).not.toBe(input)
    expect(normalized.binding).not.toBe(input.binding)
    expect(normalized.version).toBe(TIMER_VERSION)
    expect(validateTimer({ ...timer, label: undefined, binding: timer.binding }).label).toBe('')
    expect(validateTimer({ ...timer, deliveryPending: 'yes' })).toBeNull()
  })

  it.each(['45', -1, 0, NaN, Infinity, 61])('rejects invalid delivered work elapsed time %s', elapsedSeconds => {
    expect(validateTimer({ ...start({ kind: 'work', binding: { entryId: 'e', setId: 's' } }), status: 'completed', elapsedSeconds })).toBeNull()
  })

  it('accepts the one-second minimum used when finishing a fractional work timer early', () => {
    const work = start({ kind: 'work', durationMs: 499, binding: { entryId: 'e', setId: 's' } })
    expect(validateTimer({ ...work, status: 'completed', elapsedSeconds: 1 })?.elapsedSeconds).toBe(1)
  })

  it.each([
    ['version', 2], ['timerId', ''], ['timerId', '  '], ['revision', 0], ['revision', 1.5],
    ['revision', Number.MAX_SAFE_INTEGER + 1], ['kind', 'other'], ['accountId', ''], ['workoutId', 1],
    ['durationMs', 0], ['durationMs', -1], ['durationMs', Infinity], ['durationMs', NaN],
    ['durationMs', '60000'], ['durationMs', 86_400_001], ['startedAt', -1],
    ['deadlineAt', Infinity], ['deadlineAt', Number.MAX_SAFE_INTEGER + 1], ['updatedAt', NaN],
    ['status', 'paused'], ['label', {}], ['binding', { entryId: 'entry-1', setId: '' }],
  ])('rejects invalid persisted %s (%s)', (field, value) => {
    expect(validateTimer({ ...start(), [field]: value })).toBeNull()
  })

  it('requires a complete work binding and safe timestamp arithmetic', () => {
    expect(validateTimer({ ...start(), kind: 'work' })).toBeNull()
    expect(validateTimer(null)).toBeNull()
    expect(validateTimer([])).toBeNull()
    expect(() => start({ kind: 'work' })).toThrow(TypeError)
    expect(() => start({}, null, { wallNow: Number.MAX_SAFE_INTEGER })).toThrow(RangeError)
    expect(() => start({}, null, { monoNow: NaN })).toThrow(RangeError)
    expect(() => start({}, { timerId: 'old', revision: Number.MAX_SAFE_INTEGER })).toThrow(RangeError)
  })

  it.each([0, -1, Infinity, NaN, '60'])('rejects invalid new timer duration %s', durationMs => {
    expect(() => start({ durationMs })).toThrow(RangeError)
  })

  it('rejects invalid actions while ignoring obsolete invalid payloads', () => {
    const timer = start()
    const token = timerToken(timer)
    expect(() => changeTimer(timer, token, { type: 'pause' }, 0, clock(0))).toThrow(TypeError)
    expect(() => changeTimer(timer, token, { type: 'extend', deltaMs: NaN }, 0, clock(0))).toThrow(RangeError)
    expect(() => changeTimer(timer, token, { type: 'extend', deltaMs: '15000' }, 0, clock(0))).toThrow(RangeError)
    expect(() => changeTimer(timer, token, { type: 'cancel' }, Infinity, clock(0))).toThrow(RangeError)
    expect(() => changeTimer(timer, token, { type: 'cancel' }, 0, { wallNow: NaN })).toThrow(RangeError)
    expect(changeTimer(timer, { ...token, revision: 10 }, null, NaN, { wallNow: NaN })).toBe(timer)
    expect(timerToken(null)).toBeNull()
    expect(timerToken({ timerId: '', revision: 1 })).toBeNull()
    expect(matchesTimer(timer, null)).toBe(false)
  })
})
