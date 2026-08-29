import {
  CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES,
  CONFIRMED_REST_REDUCTION_MANUAL,
  confirmedRestReductionStrategy
} from './confirmedRepRangeAutoRest.js'
import { confirmedRepRangeBounds, modeOf } from './history.js'

const CONFIRMED_REP_RANGE_POLICY = 'confirmed_rep_range'

export const CONFIRMED_REP_RANGE_DEFAULTS = {
  minReps: 8,
  maxReps: 12,
  restSeconds: 90,
  maxRestSeconds: 240,
  restReductionStrategy: CONFIRMED_REST_REDUCTION_MANUAL
}

// Materialize the strategy configuration instead of letting an exercise's ordinary
// `reps` value accidentally become both ends of the range.
export function confirmedRepRangeConfig(cfg = {}, profileRestSeconds = CONFIRMED_REP_RANGE_DEFAULTS.restSeconds) {
  const { minReps, maxReps } = confirmedRepRangeBounds(cfg)
  const restSeconds = Math.max(0, Math.round(cfg.restSeconds ?? profileRestSeconds ?? CONFIRMED_REP_RANGE_DEFAULTS.restSeconds))
  const maxRestSeconds = Math.max(restSeconds, Math.round(cfg.maxRestSeconds ?? CONFIRMED_REP_RANGE_DEFAULTS.maxRestSeconds))
  const restReductionStrategy = confirmedRestReductionStrategy(cfg.restReductionStrategy)
  // `targetReps` intentionally does not belong to routine configuration anymore. The first
  // Confirmed Rep-Range workout always starts at minReps. A targetReps stored in a workout
  // snapshot remains the authoritative prescription for that historical session.
  return { minReps, maxReps, restSeconds, maxRestSeconds, restReductionStrategy }
}

// Preserve an explicit preference while another policy is active without inventing one for
// legacy JSON that never stored the field. The normalized one-field object can be merged into a
// saved draft; an empty object means there is deliberately nothing dormant to persist.
export function confirmedRepRangeRecoveryPreference(cfg = {}) {
  if (!Object.prototype.hasOwnProperty.call(cfg, 'restReductionStrategy')) return {}
  return { restReductionStrategy: confirmedRestReductionStrategy(cfg.restReductionStrategy) }
}

/**
 * Materialize the product default only for an explicit transition into Confirmed Rep-Range.
 *
 * `confirmedRepRangeConfig` deliberately remains the tolerant legacy decoder: a missing or
 * unknown strategy still means manual there. Callers use this transition helper only after a
 * user action (or while creating a new exercise in an already-Confirmed routine), so loading a
 * backup can never silently enable automation. Presence is intentional: an explicit `manual`,
 * `null` or future/unknown value is conservatively normalized to manual rather than overwritten.
 */
export function applyConfirmedRepRangeSelection(cfg = {}, {
  previousPolicy,
  nextPolicy,
  profileRestSeconds = CONFIRMED_REP_RANGE_DEFAULTS.restSeconds
} = {}) {
  if (previousPolicy === CONFIRMED_REP_RANGE_POLICY || nextPolicy !== CONFIRMED_REP_RANGE_POLICY) {
    return cfg
  }

  const recoveryChoice = confirmedRepRangeRecoveryPreference(cfg)
  const hasRecoveryChoice = Object.prototype.hasOwnProperty.call(recoveryChoice, 'restReductionStrategy')
  const selected = hasRecoveryChoice
    ? { ...cfg, ...recoveryChoice }
    : { ...cfg, restReductionStrategy: CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES }
  return { ...cfg, ...confirmedRepRangeConfig(selected, profileRestSeconds) }
}

/**
 * Apply a newly-selected routine policy without touching Time/cardio exercises or local policy
 * overrides. Returning a new array keeps the event pure and makes the compatibility rules
 * independently testable from the React view.
 */
export function applyConfirmedRepRangeRoutineSelection(exercises = [], {
  previousPolicy,
  nextPolicy,
  profileRestSeconds = CONFIRMED_REP_RANGE_DEFAULTS.restSeconds
} = {}) {
  if (previousPolicy === CONFIRMED_REP_RANGE_POLICY || nextPolicy !== CONFIRMED_REP_RANGE_POLICY) {
    return exercises
  }

  return exercises.map(exercise => {
    if (exercise?.prog || modeOf(exercise) !== 'reps') return exercise
    const selected = applyConfirmedRepRangeSelection(exercise, {
      previousPolicy,
      nextPolicy,
      profileRestSeconds
    })
    // These were runtime-like fields in early routine JSON. A new explicit selection is the
    // safe boundary at which to remove them; completed and active workout snapshots are separate.
    const { targetReps: _legacyTarget, topRangeStreak: _legacyStreak, ...config } = selected
    return config
  })
}
