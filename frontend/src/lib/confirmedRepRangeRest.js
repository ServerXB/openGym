import { uid } from './format.js'
import { LEGACY_PROGRESSION_PREFIX, progressionIdOf } from './progression-scope.js'

export const CONFIRMED_REP_RANGE_REST_CONTROL = 'confirmedRepRangeRest'

const seconds = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error('Recovery seconds must be a finite number.')
  return Math.max(0, Math.round(number))
}

/**
 * Return the current recovery epoch for a progression group, or null for legacy profiles.
 *
 * Keeping the lookup tolerant of the old raw exercise-id key makes profiles and backups created
 * before scoped progression valid without a manual migration.
 */
const scopeKeys = scope => {
  if (scope && typeof scope === 'object') {
    const primary = progressionIdOf(scope)
    return [primary, scope.id].filter((value, index, all) => value && all.indexOf(value) === index)
  }
  if (typeof scope !== 'string' || !scope) return []
  const rawExerciseId = scope.startsWith(LEGACY_PROGRESSION_PREFIX)
    ? scope.slice(LEGACY_PROGRESSION_PREFIX.length)
    : null
  return [scope, rawExerciseId].filter(Boolean)
}

const validControl = value =>
  !!value
  && typeof value.epochId === 'string'
  && !!value.epochId
  && Number.isFinite(value.resetSeconds)
  && value.resetSeconds >= 0

export function confirmedRepRangeRestControl(S, scope) {
  for (const key of scopeKeys(scope)) {
    const value = S?.progressionControls?.[key]?.[CONFIRMED_REP_RANGE_REST_CONTROL]
    if (validControl(value)) return value
  }
  return null
}

/** Build a serializable epoch record. Optional values are injectable to keep tests deterministic. */
export function createConfirmedRepRangeRestReset({
  resetSeconds,
  epochId = uid(),
  resetAt = Date.now()
} = {}) {
  if (typeof epochId !== 'string' || !epochId) throw new Error('A recovery reset requires an epoch id.')
  const at = Number(resetAt)
  if (!Number.isFinite(at)) throw new Error('A recovery reset requires a valid time.')
  const record = {
    epochId,
    resetSeconds: seconds(resetSeconds),
    resetAt: Math.max(0, Math.round(at))
  }
  return record
}

/** Return a new profile with the reset applied, leaving the input profile untouched. */
export function applyConfirmedRepRangeRestReset(S, scope, options) {
  if (!S || typeof S !== 'object') throw new Error('A recovery reset requires a profile.')
  const progressionId = scopeKeys(scope)[0]
  if (!progressionId) throw new Error('A recovery reset requires a progression id.')
  const record = createConfirmedRepRangeRestReset(options)
  return {
    ...S,
    progressionControls: {
      ...(S.progressionControls || {}),
      [progressionId]: {
        ...(S.progressionControls?.[progressionId] || {}),
        [CONFIRMED_REP_RANGE_REST_CONTROL]: record
      }
    }
  }
}

/**
 * Persist a new recovery epoch into a mutable profile draft (for example a Zustand update).
 * Other progression controls on the exercise are deliberately preserved.
 */
export function resetConfirmedRepRangeRest(S, scope, options) {
  const next = applyConfirmedRepRangeRestReset(S, scope, options)
  S.progressionControls = next.progressionControls
  const record = confirmedRepRangeRestControl(next, scope)
  return record
}
