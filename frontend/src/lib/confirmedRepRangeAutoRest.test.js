import { describe, expect, it } from 'vitest'
import {
  CONFIRMED_REST_DECREASE_AFTER_SUCCESSES,
  CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES,
  confirmedRestAutoReduction,
  confirmedRestReductionStrategy,
  confirmedRestSuccessStreak
} from './confirmedRepRangeAutoRest.js'

const AUTO = CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES
const session = (overrides = {}) => ({
  ok: true,
  restSeconds: 180,
  restBaseSeconds: 120,
  weight: 70,
  restEpochId: 'epoch-a',
  restReductionStrategy: AUTO,
  ...overrides
})
const cleanRun = (count, overrides) => Array.from({ length: count }, () => session(overrides))

describe('Confirmed Rep-Range automatic recovery reduction', () => {
  it('uses four repeatable successes as the exported threshold', () => {
    expect(CONFIRMED_REST_DECREASE_AFTER_SUCCESSES).toBe(4)
  })

  it('keeps manual reduction as the backward-compatible default', () => {
    expect(confirmedRestReductionStrategy()).toBe('manual')
    expect(confirmedRestReductionStrategy('unknown')).toBe('manual')
  })

  it('tracks progress without reducing before the configured threshold', () => {
    expect(confirmedRestAutoReduction({
      sessions: cleanRun(3),
      restSeconds: 180,
      baseRestSeconds: 120,
      restEpochId: 'epoch-a',
      weight: 70,
      strategy: AUTO
    })).toEqual({ restSeconds: 180, restSuccessStreak: 3, reduced: false })
  })

  it('reduces by 30 seconds after four consecutive successes', () => {
    expect(confirmedRestAutoReduction({
      sessions: cleanRun(4),
      restSeconds: 180,
      baseRestSeconds: 120,
      restEpochId: 'epoch-a',
      weight: 70,
      strategy: AUTO
    })).toEqual({ restSeconds: 150, restSuccessStreak: 0, reduced: true })
  })

  it('never reduces below the configured base', () => {
    expect(confirmedRestAutoReduction({
      sessions: cleanRun(4, { restSeconds: 130 }),
      restSeconds: 130,
      baseRestSeconds: 120,
      restEpochId: 'epoch-a',
      weight: 70,
      strategy: AUTO
    })).toEqual({ restSeconds: 120, restSuccessStreak: 0, reduced: true })

    expect(confirmedRestAutoReduction({
      sessions: cleanRun(4, { restSeconds: 120 }),
      restSeconds: 120,
      baseRestSeconds: 120,
      restEpochId: 'epoch-a',
      weight: 70,
      strategy: AUTO
    })).toEqual({ restSeconds: 120, restSuccessStreak: 0, reduced: false })
  })

  it('resets the success streak after any failed prescription', () => {
    const sessions = [session(), session(), session({ ok: false })]
    expect(confirmedRestSuccessStreak(sessions, { restSeconds: 180, baseRestSeconds: 120, restEpochId: 'epoch-a', weight: 70 })).toBe(0)
    expect(confirmedRestAutoReduction({
      sessions,
      restSeconds: 180,
      baseRestSeconds: 120,
      restEpochId: 'epoch-a',
      weight: 70,
      strategy: AUTO
    })).toEqual({ restSeconds: 180, restSuccessStreak: 0, reduced: false })
  })

  it('does not count successes from an earlier manual-reset epoch', () => {
    const sessions = [
      session({ restEpochId: 'epoch-old' }),
      session({ restEpochId: 'epoch-old' }),
      session({ restEpochId: 'epoch-a' })
    ]
    expect(confirmedRestSuccessStreak(sessions, { restSeconds: 180, baseRestSeconds: 120, restEpochId: 'epoch-a', weight: 70 })).toBe(1)
  })

  it('ignores a stale old-epoch workout appended after current-epoch successes', () => {
    const sessions = [
      ...cleanRun(3),
      session({ restEpochId: 'epoch-old', ok: false })
    ]
    expect(confirmedRestSuccessStreak(sessions, {
      restSeconds: 180, baseRestSeconds: 120, restEpochId: 'epoch-a', weight: 70
    })).toBe(3)
  })

  it('starts a new streak after an automatic recovery step', () => {
    const sessions = [
      ...cleanRun(4),
      session({ restSeconds: 150 })
    ]
    expect(confirmedRestAutoReduction({
      sessions,
      restSeconds: 150,
      baseRestSeconds: 120,
      restEpochId: 'epoch-a',
      weight: 70,
      strategy: AUTO
    })).toEqual({ restSeconds: 150, restSuccessStreak: 1, reduced: false })
  })

  it('does not reuse successes logged while the manual strategy was active', () => {
    const sessions = [
      session({ restReductionStrategy: 'manual' }),
      session({ restReductionStrategy: 'manual' }),
      session()
    ]
    expect(confirmedRestSuccessStreak(sessions, { restSeconds: 180, baseRestSeconds: 120, restEpochId: 'epoch-a', weight: 70 })).toBe(1)
  })

  it('does not change recovery when automatic reduction is disabled', () => {
    expect(confirmedRestAutoReduction({
      sessions: cleanRun(4),
      restSeconds: 180,
      baseRestSeconds: 120,
      restEpochId: 'epoch-a',
      weight: 70,
      strategy: 'manual'
    })).toEqual({ restSeconds: 180, restSuccessStreak: 0, reduced: false })
  })

  it('keeps counting consecutive exposures when the prescribed weight changes', () => {
    const sessions = [session(), session(), session({ weight: 72.5 })]
    expect(confirmedRestSuccessStreak(sessions, {
      restSeconds: 180, baseRestSeconds: 120, restEpochId: 'epoch-a'
    })).toBe(3)
  })
})
