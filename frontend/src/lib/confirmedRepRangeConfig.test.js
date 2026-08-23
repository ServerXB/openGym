import { describe, expect, it } from 'vitest'
import { confirmedRepRangeConfig } from './confirmedRepRangeConfig.js'

describe('Confirmed Rep-Range configuration', () => {
  it('does not turn an ordinary rep target into an accidental degenerate range', () => {
    expect(confirmedRepRangeConfig({ reps: 10 }, 120)).toEqual({
      minReps: 8,
      maxReps: 12,
      targetReps: 8,
      restSeconds: 120,
      maxRestSeconds: 240,
      restReductionStrategy: 'manual',
      topRangeStreak: 0
    })
  })

  it('clamps configured targets and maximum recovery', () => {
    expect(confirmedRepRangeConfig({ minReps: 10, maxReps: 8, targetReps: 20, restSeconds: 300, maxRestSeconds: 240 })).toMatchObject({
      minReps: 10,
      maxReps: 10,
      targetReps: 10,
      restSeconds: 300,
      maxRestSeconds: 300
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
