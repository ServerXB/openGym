export const CONFIRMED_REP_RANGE_DEFAULTS = {
  minReps: 8,
  maxReps: 12,
  targetReps: 8,
  restSeconds: 90,
  maxRestSeconds: 240,
  topRangeStreak: 0
}

// Materialize the strategy configuration instead of letting an exercise's ordinary
// `reps` value accidentally become both ends of the range.
export function confirmedRepRangeConfig(cfg = {}, profileRestSeconds = CONFIRMED_REP_RANGE_DEFAULTS.restSeconds) {
  const minReps = Math.max(1, Math.round(cfg.minReps ?? cfg.repsMin ?? CONFIRMED_REP_RANGE_DEFAULTS.minReps))
  const maxReps = Math.max(minReps, Math.round(cfg.maxReps ?? cfg.repsMax ?? CONFIRMED_REP_RANGE_DEFAULTS.maxReps))
  const targetReps = Math.min(maxReps, Math.max(minReps, Math.round(cfg.targetReps ?? minReps)))
  const restSeconds = Math.max(0, Math.round(cfg.restSeconds ?? profileRestSeconds ?? CONFIRMED_REP_RANGE_DEFAULTS.restSeconds))
  const maxRestSeconds = Math.max(restSeconds, Math.round(cfg.maxRestSeconds ?? CONFIRMED_REP_RANGE_DEFAULTS.maxRestSeconds))
  return { minReps, maxReps, targetReps, restSeconds, maxRestSeconds, topRangeStreak: 0 }
}
