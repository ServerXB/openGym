import { describe, expect, it } from 'vitest'
import {
  confirmedRepRangeRestControl,
  createConfirmedRepRangeRestReset,
  applyConfirmedRepRangeRestReset,
  resetConfirmedRepRangeRest
} from './confirmedRepRangeRest.js'

describe('Confirmed Rep-Range recovery reset state', () => {
  it('creates a deterministic, JSON-safe epoch record', () => {
    const record = createConfirmedRepRangeRestReset({
      epochId: 'rest-epoch-2', resetSeconds: 120.4, resetAt: 1234.4
    })
    expect(record).toEqual({ epochId: 'rest-epoch-2', resetSeconds: 120, resetAt: 1234 })
    expect(JSON.parse(JSON.stringify(record))).toEqual(record)
  })

  it('keeps the legacy raw-exercise API and preserves unrelated controls', () => {
    const S = { progressionControls: { squat: { anotherControl: { enabled: true } } } }
    resetConfirmedRepRangeRest(S, 'squat', {
      epochId: 'rest-epoch-2', resetSeconds: 120, resetAt: 1234
    })
    expect(S.progressionControls.squat).toEqual({
      anotherControl: { enabled: true },
      confirmedRepRangeRest: { epochId: 'rest-epoch-2', resetSeconds: 120, resetAt: 1234 }
    })
    expect(confirmedRepRangeRestControl(S, 'squat')).toEqual(S.progressionControls.squat.confirmedRepRangeRest)
  })

  it('also exposes a pure apply helper that does not mutate the input profile', () => {
    const original = { progressionControls: { squat: { anotherControl: { enabled: true } } } }
    const next = applyConfirmedRepRangeRestReset(original, 'squat', {
      epochId: 'pure-epoch', resetSeconds: 120, resetAt: 1234
    })
    expect(original).toEqual({ progressionControls: { squat: { anotherControl: { enabled: true } } } })
    expect(confirmedRepRangeRestControl(next, 'squat')).toEqual({
      epochId: 'pure-epoch', resetSeconds: 120, resetAt: 1234
    })
  })

  it('treats absent and malformed legacy controls as no reset', () => {
    expect(confirmedRepRangeRestControl({}, 'squat')).toBeNull()
    expect(confirmedRepRangeRestControl({ progressionControls: {} }, 'squat')).toBeNull()
    expect(confirmedRepRangeRestControl({ progressionControls: { squat: { confirmedRepRangeRest: { resetSeconds: 120 } } } }, 'squat')).toBeNull()
    expect(confirmedRepRangeRestControl({ progressionControls: { squat: { confirmedRepRangeRest: { epochId: 'bad', resetSeconds: '120' } } } }, 'squat')).toBeNull()
  })

  it('rejects non-serializable reset values', () => {
    expect(() => createConfirmedRepRangeRestReset({ epochId: 'bad', resetSeconds: Infinity, resetAt: 1 })).toThrow()
    expect(() => createConfirmedRepRangeRestReset({ epochId: 'bad', resetSeconds: 120, resetAt: Infinity })).toThrow()
  })

  it('replaces only the previous recovery epoch when reset twice', () => {
    const S = {}
    resetConfirmedRepRangeRest(S, 'squat', { epochId: 'first', resetSeconds: 120, resetAt: 1 })
    resetConfirmedRepRangeRest(S, 'squat', { epochId: 'second', resetSeconds: 150, resetAt: 2 })
    expect(confirmedRepRangeRestControl(S, 'squat')).toMatchObject({ epochId: 'second', resetSeconds: 150, resetAt: 2 })
  })

  it('writes independent controls per progression group and inherits a legacy reset until overridden', () => {
    const legacy = { epochId: 'legacy', resetSeconds: 120, resetAt: 1 }
    const S = { progressionControls: { squat: { confirmedRepRangeRest: legacy } } }
    const a = { id: 'squat', progressionId: 'pg-a' }
    const b = { id: 'squat', progressionId: 'pg-b' }

    expect(confirmedRepRangeRestControl(S, a)).toEqual(legacy)
    expect(confirmedRepRangeRestControl(S, b)).toEqual(legacy)

    resetConfirmedRepRangeRest(S, a, { epochId: 'a-reset', resetSeconds: 90, resetAt: 2 })
    expect(confirmedRepRangeRestControl(S, a)).toMatchObject({ epochId: 'a-reset', resetSeconds: 90 })
    expect(confirmedRepRangeRestControl(S, b)).toEqual(legacy)
    expect(S.progressionControls['pg-a']).toBeDefined()
    expect(S.progressionControls['pg-b']).toBeUndefined()
  })
})
