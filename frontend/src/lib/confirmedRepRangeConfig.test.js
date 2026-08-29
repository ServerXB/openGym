import { describe, expect, it } from 'vitest'
import {
  applyConfirmedRepRangeRoutineSelection,
  applyConfirmedRepRangeSelection,
  confirmedRepRangeConfig,
  confirmedRepRangeRecoveryPreference
} from './confirmedRepRangeConfig.js'

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

  it('keeps legacy recovery reduction manual and normalizes unknown values', () => {
    expect(confirmedRepRangeConfig({})).toMatchObject({ restReductionStrategy: 'manual' })
    expect(confirmedRepRangeConfig({ restReductionStrategy: null })).toMatchObject({
      restReductionStrategy: 'manual'
    })
    expect(confirmedRepRangeConfig({ restReductionStrategy: 'auto_after_successes' })).toMatchObject({
      restReductionStrategy: 'auto_after_successes'
    })
    expect(confirmedRepRangeConfig({ restReductionStrategy: 'future-mode' })).toMatchObject({
      restReductionStrategy: 'manual'
    })
  })
})

describe('new Confirmed Rep-Range selections', () => {
  const transition = config => applyConfirmedRepRangeSelection(config, {
    previousPolicy: 'linear',
    nextPolicy: 'confirmed_rep_range',
    profileRestSeconds: 120
  })

  it('materializes automatic recovery only for a new transition', () => {
    const original = { id: 'new-lift', sets: 3, reps: 10 }
    const selected = transition(original)

    expect(selected).toMatchObject({
      id: 'new-lift',
      minReps: 8,
      maxReps: 12,
      restSeconds: 120,
      restReductionStrategy: 'auto_after_successes'
    })
    expect(original).not.toHaveProperty('restReductionStrategy')

    expect(applyConfirmedRepRangeSelection(original, {
      previousPolicy: 'confirmed_rep_range',
      nextPolicy: 'confirmed_rep_range'
    })).toBe(original)
    expect(applyConfirmedRepRangeSelection(original, {
      previousPolicy: 'linear',
      nextPolicy: 'double'
    })).toBe(original)
  })

  it('never overwrites an explicit or conservatively decoded choice', () => {
    expect(transition({ restReductionStrategy: 'manual' })).toMatchObject({
      restReductionStrategy: 'manual'
    })
    expect(transition({ restReductionStrategy: 'auto_after_successes' })).toMatchObject({
      restReductionStrategy: 'auto_after_successes'
    })
    expect(transition({ restReductionStrategy: null })).toMatchObject({
      restReductionStrategy: 'manual'
    })
    expect(transition({ restReductionStrategy: 'future-mode' })).toMatchObject({
      restReductionStrategy: 'manual'
    })
  })

  it('keeps only an explicit normalized preference dormant under another policy', () => {
    expect(confirmedRepRangeRecoveryPreference({})).toEqual({})
    expect(confirmedRepRangeRecoveryPreference({ restReductionStrategy: 'manual' })).toEqual({
      restReductionStrategy: 'manual'
    })
    expect(confirmedRepRangeRecoveryPreference({ restReductionStrategy: 'auto_after_successes' })).toEqual({
      restReductionStrategy: 'auto_after_successes'
    })
    expect(confirmedRepRangeRecoveryPreference({ restReductionStrategy: 'future-mode' })).toEqual({
      restReductionStrategy: 'manual'
    })
  })

  it('updates only inheriting reps exercises when a routine newly selects Confirmed', () => {
    const inherited = { id: 'inherited', mode: 'reps', reps: 10, targetReps: 10, topRangeStreak: 1 }
    const explicitManual = { id: 'manual', mode: 'reps', restReductionStrategy: 'manual' }
    const override = { id: 'override', mode: 'reps', prog: 'double' }
    const timed = { id: 'timed', mode: 'time', sec: 45 }
    const cardio = { id: 'cardio', mode: 'cardio', min: 20 }
    const exercises = [inherited, explicitManual, override, timed, cardio]

    const selected = applyConfirmedRepRangeRoutineSelection(exercises, {
      previousPolicy: 'linear',
      nextPolicy: 'confirmed_rep_range',
      profileRestSeconds: 90
    })

    expect(selected[0]).toMatchObject({ restReductionStrategy: 'auto_after_successes' })
    expect(selected[0]).not.toHaveProperty('targetReps')
    expect(selected[0]).not.toHaveProperty('topRangeStreak')
    expect(selected[1]).toMatchObject({ restReductionStrategy: 'manual' })
    expect(selected[2]).toBe(override)
    expect(selected[3]).toBe(timed)
    expect(selected[4]).toBe(cardio)
    expect(inherited).not.toHaveProperty('restReductionStrategy')
  })

  it('does not rewrite exercises when the routine was already Confirmed', () => {
    const exercises = [{ id: 'legacy', mode: 'reps' }]
    expect(applyConfirmedRepRangeRoutineSelection(exercises, {
      previousPolicy: 'confirmed_rep_range',
      nextPolicy: 'confirmed_rep_range'
    })).toBe(exercises)
    expect(exercises[0]).not.toHaveProperty('restReductionStrategy')
  })
})
