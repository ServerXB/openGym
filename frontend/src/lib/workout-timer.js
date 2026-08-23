/** Resolve the exercise-specific recovery captured when the workout was built. */
export function restSecondsFor(entry, fallback = 0) {
  return entry?.plan?.restSeconds ?? entry?.target?.restSeconds ?? fallback
}

/** A superset rests for the most recovery-demanding exercise after each complete round. */
export function restSecondsForUnit(entries, fallback = 0) {
  if (!entries?.length) return fallback
  return Math.max(...entries.map(entry => restSecondsFor(entry, fallback)))
}
