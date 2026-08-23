import { describe, expect, it } from 'vitest'
import { confirmedRepRangeConfig } from './confirmedRepRangeConfig.js'

describe('Confirmed Rep-Range configuration', () => {
  it('does not turn an ordinary rep target into an accidental degenerate range', () => {
    expect(confirmedRepRangeConfig({ reps: 10 }, 120)).toEqual({
      minReps: 8,
      maxReps: 12,
      restSeconds: 120,
      maxRestSeconds: 240,
      restReductionStrategy: 'manual'
    })
    expect(confirmedRepRangeConfig({ reps: 10 }, 120)).not.toHaveProperty('topRangeStreak')
  })

  it('clamps the range and maximum recovery without materializing a configurable target', () => {
    expect(confirmedRepRangeConfig({ minReps: 10, maxReps: 8, targetReps: 20, restSeconds: 300, maxRestSeconds: 240 })).toMatchObject({
      minReps: 10,
      maxReps: 10,
      restSeconds: 300,
      maxRestSeconds: 300
    })
    expect(confirmedRepRangeConfig({ minReps: 10, maxReps: 12, targetReps: 11 })).not.toHaveProperty('targetReps')
  })

  it('ignores a legacy starting target even when it falls inside the range', () => {
    expect(confirmedRepRangeConfig({ minReps: 8, maxReps: 12, targetReps: 10 })).toMatchObject({
      minReps: 8,
      maxReps: 12
    })
    expect(confirmedRepRangeConfig({ minReps: 8, maxReps: 12, targetReps: 10 })).not.toHaveProperty('targetReps')
  })

  it('normalizes per-side range bounds to totals that split evenly', () => {
    expect(confirmedRepRangeConfig({ side: true, minReps: 15, maxReps: 19 })).toMatchObject({
      minReps: 16,
      maxReps: 20
    })
  })

  it('falls back to canonical range bounds for non-finite legacy values', () => {
    expect(confirmedRepRangeConfig({ minReps: Number.POSITIVE_INFINITY, maxReps: Number.NaN })).toMatchObject({
      minReps: 8,
      maxReps: 12
    })
  })

  it('keeps recovery reduction opt-in and normalizes unknown values to manual', () => {
    expect(confirmedRepRangeConfig({ restReductionStrategy: 'auto_after_successes' })).toMatchObject({
      restReductionStrategy: 'auto_after_successes'
    })
    expect(confirmedRepRangeConfig({ restReductionStrategy: 'future-mode' })).toMatchObject({
      restReductionStrategy: 'manual'
    })
  })
})
