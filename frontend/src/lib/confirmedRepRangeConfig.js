import {
  CONFIRMED_REST_REDUCTION_MANUAL,
  confirmedRestReductionStrategy
} from './confirmedRepRangeAutoRest.js'
import { confirmedRepRangeBounds } from './history.js'

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
