import { describe, expect, it } from 'vitest'
import { restSecondsFor, restSecondsForUnit } from './workout-timer.js'

describe('workout recovery timer selection', () => {
  it('prefers the immutable plan snapshot, then target, then profile fallback', () => {
    expect(restSecondsFor({ plan: { restSeconds: 180 }, target: { restSeconds: 150 } }, 90)).toBe(180)
    expect(restSecondsFor({ plan: {}, target: { restSeconds: 150 } }, 90)).toBe(150)
    expect(restSecondsFor({ plan: {}, target: {} }, 90)).toBe(90)
  })

  it('uses the longest prescribed recovery in a superset round', () => {
    const unit = [
      { plan: { restSeconds: 180 }, target: { restSeconds: 120 } },
      { plan: { restSeconds: 120 }, target: { restSeconds: 120 } }
    ]
    expect(restSecondsForUnit(unit, 90)).toBe(180)
    expect(restSecondsForUnit([...unit].reverse(), 90)).toBe(180)
  })

  it('falls back safely for an empty unit or missing exercise prescriptions', () => {
    expect(restSecondsForUnit([], 90)).toBe(90)
    expect(restSecondsForUnit([{ plan: {}, target: {} }], 90)).toBe(90)
  })
})
