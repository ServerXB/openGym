import { uid } from './format.js'
import { modeOf, supersetUnits, unitOf } from './history.js'
import {
  entrySetStatus,
  invalidateEntryReview,
  isOptionalSet,
  prescribedSetCount,
  unitPrescribedComplete,
  workoutSetStatus
} from './workout-set-status.js'
import { restSecondsForUnit } from './workout-timer.js'

const validId = value => typeof value === 'string' && value.trim().length > 0
const timedEntry = entry => modeOf({ ...(entry.target || {}), id: entry.id }) === 'time'
const matchingEntryIndices = (entries, id) => entries.reduce((indices, entry, index) => {
  if (entry?.localTimerEntryId === id) indices.push(index)
  return indices
}, [])
const matchingSetCount = (entries, id) => entries.reduce((count, entry) => count +
  (Array.isArray(entry?.sets) ? entry.sets.filter(set => set?.localTimerSetId === id).length : 0), 0)

// IDs belong only to the active rows that start a timer. Neither exercise IDs nor routine
// slots identify a particular row: both can recur, and array indices can change during work.
export function bindTimedSet(state, entryIndex, setIndex, idFactory = uid) {
  const active = state?.active
  const entries = active?.entries
  if (!validId(active?.id) || !Array.isArray(entries)
    || !Number.isInteger(entryIndex) || entryIndex < 0
    || !Number.isInteger(setIndex) || setIndex < 0) return null
  const entry = entries[entryIndex]
  const set = Array.isArray(entry?.sets) ? entry.sets[setIndex] : null
  if (!entry || !set || !timedEntry(entry) || set.done) return null

  let entryId = validId(entry.localTimerEntryId) ? entry.localTimerEntryId : null
  let setId = validId(set.localTimerSetId) ? set.localTimerSetId : null
  if ((entryId && matchingEntryIndices(entries, entryId).length !== 1)
    || (setId && matchingSetCount(entries, setId) !== 1)) return null

  const occupied = new Set()
  entries.forEach(item => {
    if (validId(item?.localTimerEntryId)) occupied.add(item.localTimerEntryId)
    if (Array.isArray(item?.sets)) item.sets.forEach(row => {
      if (validId(row?.localTimerSetId)) occupied.add(row.localTimerSetId)
    })
  })
  const freshId = () => {
    if (typeof idFactory !== 'function') return null
    // A broken/colliding factory must not leave a half-bound row or loop forever.
    for (let attempt = 0; attempt < 32; attempt++) {
      let candidate
      try { candidate = idFactory() } catch { return null }
      if (validId(candidate) && !occupied.has(candidate)) {
        occupied.add(candidate)
        return candidate
      }
    }
    return null
  }
  entryId ||= freshId()
  if (!entryId) return null
  setId ||= freshId()
  if (!setId) return null
  entry.localTimerEntryId = entryId
  set.localTimerSetId = setId
  return { workoutId: active.id, entryId, setId }
}

// Apply a timer result to the live workout, then describe the existing completion flow.
// The caller owns notifications, rest timers and sheets; stale records simply do nothing.
export function applyTimedSetCompletion(state, record, elapsedSeconds) {
  const active = state?.active
  const entries = active?.entries
  const binding = record?.binding
  if (!validId(active?.id) || record?.workoutId !== active.id
    || !validId(binding?.entryId) || !validId(binding?.setId)
    || !Array.isArray(entries)
    || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null

  const matches = matchingEntryIndices(entries, binding.entryId)
  if (matches.length !== 1 || matchingSetCount(entries, binding.setId) !== 1) return null
  const entryIndex = matches[0]
  const entry = entries[entryIndex]
  if (!Array.isArray(entry.sets) || !timedEntry(entry)) return null
  const setIndex = entry.sets.findIndex(set => set?.localTimerSetId === binding.setId)
  const set = entry.sets[setIndex]
  if (!set || set.done) return null

  const wasPrescribedComplete = entrySetStatus(entry).prescribedComplete
  const optional = isOptionalSet(entry, setIndex)
  invalidateEntryReview(entry, { optionalOnly: optional })
  set.sec = elapsedSeconds
  set.done = true

  const units = supersetUnits(entries)
  const unit = unitOf(units, entryIndex)
  const unitEntries = unit.map(index => entries[index])
  let restSeconds = null
  let workoutDone = false
  let entryDone = false
  if (optional) {
    const optionalPending = unitEntries.some(item =>
      item.sets.slice(prescribedSetCount(item)).some(row => !row.done))
    if (optionalPending) restSeconds = restSecondsForUnit(unitEntries, state.restSec)
  } else {
    const unitDone = unitPrescribedComplete(entries, unit)
    if (entryIndex === unit[unit.length - 1] && !unitDone) {
      restSeconds = restSecondsForUnit(unitEntries, state.restSec)
    }
    const isLastUnit = unit === units[units.length - 1]
    workoutDone = unitDone && isLastUnit && workoutSetStatus(active).allPrescribedComplete
    entryDone = !wasPrescribedComplete && entrySetStatus(entry).prescribedComplete
  }
  return { restSeconds, workoutDone, entryDone, entryIndex, setIndex }
}
