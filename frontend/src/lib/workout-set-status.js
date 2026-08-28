// A workout may contain more rows than the frozen prescription. Only the first
// `target.sets` rows are prescribed; later rows are optional work. Keeping this
// distinction in one pure helper prevents progress indicators, completion flows
// and finish confirmation from each inventing slightly different rules.

export function prescribedSetCount(entry) {
  const rows = Array.isArray(entry?.sets) ? entry.sets : []
  // Optional rows are a Confirmed Rep-Range concept. Other policies historically score every
  // row and must keep doing so until their domain rules explicitly say otherwise.
  if (entry?.target?.prog !== 'confirmed_rep_range') return rows.length
  const captured = Number(entry?.target?.sets)
  if (Number.isFinite(captured) && captured >= 0) return Math.trunc(captured)

  // Active workouts created before prescription snapshots existed have no safer
  // source of truth. Treat their existing rows as prescribed for compatibility.
  return rows.length
}

export function isOptionalSet(entry, index) {
  return index >= prescribedSetCount(entry)
}

export function entrySetStatus(entry) {
  const rows = Array.isArray(entry?.sets) ? entry.sets : []
  const prescribedTotal = prescribedSetCount(entry)
  const prescribedPresent = Math.min(rows.length, prescribedTotal)
  const prescribedDone = rows
    .slice(0, prescribedTotal)
    .reduce((count, set) => count + (set?.done ? 1 : 0), 0)
  const optional = rows.slice(prescribedTotal)
  const optionalDone = optional.reduce((count, set) => count + (set?.done ? 1 : 0), 0)

  return {
    prescribedTotal,
    prescribedPresent,
    prescribedDone,
    prescribedMissing: Math.max(0, prescribedTotal - prescribedPresent),
    prescribedUnchecked: Math.max(0, prescribedTotal - prescribedDone),
    optionalTotal: optional.length,
    optionalDone,
    prescribedComplete: prescribedTotal > 0 &&
      prescribedPresent === prescribedTotal && prescribedDone === prescribedTotal
  }
}

export function workoutSetStatus(active) {
  const entries = Array.isArray(active?.entries) ? active.entries : []
  const perEntry = entries.map(entrySetStatus)
  const sum = key => perEntry.reduce((total, status) => total + status[key], 0)

  return {
    prescribedTotal: sum('prescribedTotal'),
    prescribedDone: sum('prescribedDone'),
    prescribedMissing: sum('prescribedMissing'),
    prescribedUnchecked: sum('prescribedUnchecked'),
    optionalTotal: sum('optionalTotal'),
    optionalDone: sum('optionalDone'),
    exercisesComplete: perEntry.filter(status => status.prescribedComplete).length,
    allPrescribedComplete: entries.length > 0 && perEntry.every(status => status.prescribedComplete),
    anyLogged: entries.some(entry => (entry.sets || []).some(set => set?.done))
  }
}

export function unitPrescribedComplete(entries, indices) {
  return Array.isArray(indices) && indices.length > 0 &&
    indices.every(index => entrySetStatus(entries?.[index]).prescribedComplete)
}

// `asked` and `topW` describe the rows as they looked when the confirmation
// sheet ran. Any edit to the prescribed block makes that answer stale, so the
// next completion can ask again using the actual final sets. Confirmed Rep-Range
// optional rows sit outside that frozen block: changing only one of those rows
// must not silently discard an explicit confirmation that is still true.
export function invalidateEntryReview(entry, { optionalOnly = false } = {}) {
  if (!entry) return
  if (optionalOnly && entry.target?.prog === 'confirmed_rep_range') return
  delete entry.asked
  delete entry.topW
}

const nonEmptyId = value =>
  typeof value === 'string' && value.trim() ? value.trim() : null

// Describe the set-count action shown during a Confirmed workout. A manual row delta can be
// applied for the first time; a boundary already applied during this active workout remains
// visible and can be replaced again if the user changes their mind. The active target itself is
// never used as writable configuration.
export function futureSetCountPresentation(entry, routineConfig) {
  const currentCount = Array.isArray(entry?.sets) ? entry.sets.length : 0
  const prescribedCount = prescribedSetCount(entry)
  const parsedFutureCount = Number(routineConfig?.sets)
  const hasFutureConfig = !!routineConfig
    && Number.isInteger(parsedFutureCount)
    && parsedFutureCount > 0
  const futureCount = hasFutureConfig ? parsedFutureCount : prescribedCount
  const changedInSession = currentCount !== prescribedCount
  const futureBoundaryChanged = !!(
    nonEmptyId(routineConfig?.setBaselineId)
    && nonEmptyId(routineConfig?.setBaselineId) !== nonEmptyId(entry?.target?.setBaselineId)
  )
  const futureDiffersFromRows = futureCount !== currentCount
  const confirmed = entry?.target?.prog === 'confirmed_rep_range'

  return {
    currentCount,
    prescribedCount,
    futureCount,
    changedInSession,
    futureBoundaryChanged,
    // Do not offer a no-op after the current row count has already been saved. If the user
    // subsequently changes the rows again, the action reappears and replaces that future
    // choice without mutating the active snapshot.
    canApply: confirmed && hasFutureConfig && futureDiffersFromRows
      && (changedInSession || futureBoundaryChanged),
    // Keep the persisted choice visible even while a replacement action is offered. Showing
    // "Next workout: 5" next to "Use 4..." makes the pending state and the undo explicit.
    showFuture: confirmed && hasFutureConfig && futureBoundaryChanged
  }
}

// Persist an explicit set-count choice for future workouts without touching the active target.
// The stable routine slot id is mandatory: falling back to the exercise id would update the
// wrong occurrence when the same exercise appears twice in one routine.
export function applySetCountFromNextWorkout(state, entry, count = entry?.sets?.length, baselineId) {
  const nextCount = Number(count)
  const routineId = state?.active?.routineId
  const slotId = entry?.routineExerciseId
  if (entry?.target?.prog !== 'confirmed_rep_range'
    || !routineId || !slotId || !Number.isInteger(nextCount) || nextCount < 1
    || typeof baselineId !== 'string' || !baselineId.trim()) return false
  const routine = (state.routines || []).find(item => item.id === routineId)
  const config = routine?.ex?.find(item => item.routineExerciseId === slotId)
  if (!config) return false
  config.sets = nextCount
  // The boundary makes an explicit reduction authoritative even when bodyweight progression
  // had previously grown beyond the configured count. It is snapshotted into future workouts;
  // completed/active targets remain untouched.
  config.setBaselineId = baselineId.trim()
  return true
}
