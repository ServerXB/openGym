/** Resolve the exercise-specific recovery captured when the workout was built. */
export function restSecondsFor(entry, fallback = 0) {
  return entry?.plan?.restSeconds ?? entry?.target?.restSeconds ?? fallback
}
