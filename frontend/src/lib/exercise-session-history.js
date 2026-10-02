import { modeOf } from './history.js'
import { confirmedRepRangeSession, readSession, MAX_BW_SETS } from './progression.js'
import { findWorkoutProgressionEntry, progressionIdOf } from './progression-scope.js'
import { workoutEntryLoadMode } from './exercise-load-mode.js'

const idOf = value => typeof value === 'string' && value.trim() ? value.trim() : null
const number = value => value != null && value !== '' && typeof value !== 'boolean'
  && Number.isFinite(Number(value)) ? Number(value) : null
const positive = value => number(value) > 0
const validSets = value => Number.isInteger(number(value)) && number(value) > 0
const sameLoad = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-8

// Use the existing identity resolver, with a conservative ambiguity guard for malformed
// imports containing duplicate scoped entries. Never select another occurrence arbitrarily.
function matchingEntry(state, workout, activeEntry) {
  const scope = progressionIdOf(activeEntry)
  let entry = findWorkoutProgressionEntry(state, workout, activeEntry.id, scope)
  if (!entry) return null
  const exact = (workout.entries || []).filter(row => row?.id === activeEntry.id && idOf(row.progressionId) === scope)
  if (exact.length > 1) {
    const slots = exact.filter(row => idOf(row.routineExerciseId)
      && row.routineExerciseId === activeEntry.routineExerciseId)
    if (slots.length !== 1) return { ambiguous: true }
    entry = slots[0]
  }
  if (idOf(entry.progressionId)) return { entry, scopeKind: 'exact' }
  const legacy = (workout.entries || []).filter(row => row?.id === activeEntry.id && !idOf(row.progressionId))
  const routine = (state.routines || []).find(row => row.id === workout.routineId)
  const slots = (routine?.ex || []).filter(row => row.id === activeEntry.id)
  const attributable = slots.filter(row => progressionIdOf(row) === scope).length === 1
    && (slots.length === 1 && legacy.length === 1 || slots.length > 1 && slots.length === legacy.length)
  if (!attributable && legacy.length > 1) return { ambiguous: true }
  return { entry, scopeKind: attributable ? 'legacy_attributed' : 'legacy_shared' }
}

export function exerciseSessionOutcome(entry, { previousEntry } = {}) {
  const target = entry?.target
  const mode = modeOf({ ...target, id: entry?.id })
  const sets = Array.isArray(entry?.sets) ? entry.sets : []
  const result = { outcome: 'unknown', confirmation: null, progressionEarned: null }
  // A legacy snapshot without a prescribed count cannot certify completion.
  if (!target || !validSets(target.sets)) return result
  if (mode === 'reps' && target.prog === 'confirmed_rep_range') {
    const session = confirmedRepRangeSession(entry)
    result.outcome = session.outcome === 'legacy_unknown' ? 'unknown' : session.outcome
    if (!session.topRangeSuccess) return result
    const { restBaseSeconds: base, prescribedRestSeconds: rest } = session
    if (base == null || rest == null) return { ...result, outcome: 'maximum_unverified' }
    if (rest > base) return { ...result, outcome: 'maximum_recovery', confirmation: 0 }
    if (rest < base) return { ...result, outcome: 'maximum_unverified' }
    // A counter frozen at start can become stale after a deletion, correction or offline
    // completion. Certify the second maximum only from the preceding historical exposure,
    // using both snapshots, never today's routine, rest controls or accepted load reset.
    if (previousEntry === undefined) {
      return { ...result, outcome: 'maximum_unverified' }
    }
    const prior = previousEntry ? confirmedRepRangeSession(previousEntry) : null
    const second = prior?.topRangeSuccess && prior.progressionKey === session.progressionKey
      && prior.planned === session.planned && sameLoad(prior.workingWeight, session.workingWeight)
      && prior.restBaseSeconds === base && prior.prescribedRestSeconds === base
      && prior.restEpochId === session.restEpochId && prior.loadEpochId === session.loadEpochId
    result.confirmation = second ? 2 : 1
    result.outcome = second ? 'progression_earned' : 'maximum_first'
    if (second) result.progressionEarned = session.workingWeight > 0 ? 'weight'
      : session.planned < MAX_BW_SETS ? 'sets' : 'variation'
    return result
  }
  const count = Number(target.sets)
  if (sets.length < count || sets.some(set => !set?.done)) return { ...result, outcome: 'incomplete' }
  // readSession has no cardio success rule. Present the recorded activity, not an invented
  // Confirmed judgement or a diagnosis based on a current cardio configuration.
  if (mode === 'cardio') return { ...result, outcome: 'recorded' }
  if (!positive(mode === 'time' ? target.sec : target.reps)) return result
  const session = readSession(entry)
  return { ...result, outcome: session.ok ? 'success' : 'failed' }
}

// A bounded top-four selection tolerates out-of-order import/offline completion without
// sorting or rewriting S.workouts. One inverse scan, O(n), four displayed candidates plus
// at most five Confirmed exposures to validate their preceding maximum (including row four).
function chronology(workout) {
  if (workout.timePrecision !== 'date-only' && typeof workout.start === 'number'
    && Number.isFinite(workout.start) && Math.abs(workout.start) <= 8640000000000000) return workout.start
  if (typeof workout.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(workout.d)) return -Infinity
  const time = Date.parse(`${workout.d}T12:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === workout.d ? time : -Infinity
}

const historyUnit = (state, workout) => ['kg', 'lb'].includes(workout?.unit) ? workout.unit
  : ['kg', 'lb'].includes(workout?.equipmentSnapshot?.workoutUnit) ? workout.equipmentSnapshot.workoutUnit
    : state.unit || 'kg'

/** Read-only view of the active entry's frozen scope. No cache, migrations or network. */
export function recentExerciseSessions(state = {}, activeEntry, { limit = 4, activeWorkoutId = state.active?.id } = {}) {
  if (!activeEntry?.id) return []
  const cap = Math.min(4, Math.max(0, Math.trunc(Number(limit) || 0)))
  if (!cap) return []
  const mode = modeOf({ ...activeEntry.target, id: activeEntry.id })
  const loadMode = workoutEntryLoadMode(activeEntry)
  const selected = [], confirmed = [], seen = new Set()
  let uncertainChronology = false
  const retain = (list, candidate, max) => {
    list.push(candidate)
    list.sort((a, b) => b.order - a.order || b.index - a.index)
    if (list.length > max) list.pop()
  }
  const workouts = Array.isArray(state.workouts) ? state.workouts : []
  for (let index = workouts.length - 1; index >= 0; index--) {
    const workout = workouts[index]
    if (!workout || workout === state.active || (activeWorkoutId && workout.id === activeWorkoutId)
      || (state.active?.id && workout.id === state.active.id)) continue
    const id = idOf(workout.id)
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    const match = matchingEntry(state, workout, activeEntry)
    if (!match) continue
    if (match.ambiguous) {
      if (mode === 'reps') {
        const barrier = { ...match, workout, index, order: chronology(workout) }
        if (!Number.isFinite(barrier.order)) uncertainChronology = true
        retain(confirmed, barrier, cap + 1)
      }
      continue
    }
    if (modeOf({ ...match.entry.target, id: match.entry.id }) !== mode
      || workoutEntryLoadMode(match.entry) !== loadMode) continue
    const candidate = { ...match, workout, index, order: chronology(workout) }
    retain(selected, candidate, cap)
    if (mode === 'reps' && match.entry.target?.prog === 'confirmed_rep_range') {
      if (!Number.isFinite(candidate.order)) uncertainChronology = true
      retain(confirmed, candidate, cap + 1)
    }
  }
  return selected.map(({ entry, scopeKind, workout, index }) => {
    const use = entry.equipmentUse
    const profile = workout.equipmentSnapshot
    const item = use?.profileId === profile?.id
      ? profile?.items?.find(candidate => candidate.id === use?.itemId) : null
    const unit = historyUnit(state, workout)
    const confirmedIndex = confirmed.findIndex(row => row.index === index)
    const prior = confirmedIndex < 0 ? null : confirmed[confirmedIndex + 1]
    const evidenceUncertain = confirmedIndex < 0 || uncertainChronology || prior?.ambiguous
      || (prior && historyUnit(state, prior.workout) !== unit)
    return {
      workoutId: workout.id || `legacy-${index}`, workout, entry, target: entry.target || null,
      mode, loadMode, scopeKind,
      routineName: workout.name || workout.routineName || null,
      routineId: workout.routineId || null,
      shared: !!workout.routineId && !!state.active?.routineId && workout.routineId !== state.active.routineId && scopeKind === 'exact',
      unit, unitInferred: !['kg', 'lb'].includes(workout.unit) && !['kg', 'lb'].includes(profile?.workoutUnit),
      equipment: use ? { label: use.label || item?.label || null,
        profileName: use.profileId === profile?.id ? profile.name : null,
        tareWeight: item ? number(item.tareWeight) : null, unit: profile?.unit || unit,
        loadSemantics: use.loadSemantics || null, status: use.status || 'unavailable' } : null,
      ...exerciseSessionOutcome(entry, {
        previousEntry: evidenceUncertain ? undefined : prior?.entry || null
      })
    }
  })
}
