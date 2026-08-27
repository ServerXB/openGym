// Global exercise statistics intentionally aggregate by catalog exercise id, not by
// progression id. Multiple routine slots can progress independently while still contributing
// to one exercise chart and one all-time best.

export function exerciseEntriesOf(workout, exerciseId) {
  return (workout?.entries || []).filter(entry => entry.id === exerciseId)
}

// The last occurrence is the most recent piece of logging configuration. Walking entries in
// reverse matters when the same exercise appears twice in the latest workout.
export function latestExerciseEntry(workouts, exerciseId) {
  for (let wi = (workouts || []).length - 1; wi >= 0; wi--) {
    const entries = workouts[wi]?.entries || []
    for (let ei = entries.length - 1; ei >= 0; ei--) {
      if (entries[ei].id === exerciseId) return entries[ei]
    }
  }
  return null
}

// Build one chart point per workout while reading every occurrence of the exercise. `loggedSets`
// retains each occurrence's target so mixed legacy/config snapshots can still be labelled with
// the mode in which that set was actually recorded.
export function exerciseMetricPoint(workout, exerciseId, metric, {
  includeTopWeight = true,
  entryFilter = () => true
} = {}) {
  const entries = exerciseEntriesOf(workout, exerciseId).filter(entryFilter)
  if (!entries.length) return null

  const loggedSets = entries.flatMap(entry => (entry.sets || [])
    .filter(set => set.done)
    .map(set => ({ set, target: entry.target || null })))
  const values = loggedSets.map(({ set }) => Number(metric(set))).filter(Number.isFinite)
  if (includeTopWeight) {
    entries.forEach(entry => {
      const topWeight = Number(entry.topW)
      if (Number.isFinite(topWeight)) values.push(topWeight)
    })
  }
  const y = Math.max(0, ...values)
  if (!(y > 0)) return null

  return {
    t: workout.start,
    d: workout.d,
    y,
    sets: loggedSets.map(({ set }) => set),
    loggedSets
  }
}
