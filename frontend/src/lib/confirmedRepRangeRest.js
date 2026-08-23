import { uid } from './format.js'

export const CONFIRMED_REP_RANGE_REST_CONTROL = 'confirmedRepRangeRest'

const seconds = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error('Recovery seconds must be a finite number.')
  return Math.max(0, Math.round(number))
}

/**
 * Return the current recovery epoch for an exercise, or null for legacy profiles.
 *
 * Recovery controls live at profile level because Confirmed Rep-Range history is scoped by
 * exercise id (not by routine). Keeping this read tolerant makes profiles and backups created
 * before recovery reset support valid without a migration.
 */
export function confirmedRepRangeRestControl(S, exerciseId) {
  const value = S?.progressionControls?.[exerciseId]?.[CONFIRMED_REP_RANGE_REST_CONTROL]
  if (!value || typeof value.epochId !== 'string' || !value.epochId || !Number.isFinite(value.resetSeconds) || value.resetSeconds < 0) return null
  return value
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
export function applyConfirmedRepRangeRestReset(S, exerciseId, options) {
  if (!S || typeof S !== 'object') throw new Error('A recovery reset requires a profile.')
  if (typeof exerciseId !== 'string' || !exerciseId) throw new Error('A recovery reset requires an exercise id.')
  const record = createConfirmedRepRangeRestReset(options)
  return {
    ...S,
    progressionControls: {
      ...(S.progressionControls || {}),
      [exerciseId]: {
        ...(S.progressionControls?.[exerciseId] || {}),
        [CONFIRMED_REP_RANGE_REST_CONTROL]: record
      }
    }
  }
}

/**
 * Persist a new recovery epoch into a mutable profile draft (for example a Zustand update).
 * Other progression controls on the exercise are deliberately preserved.
 */
export function resetConfirmedRepRangeRest(S, exerciseId, options) {
  const next = applyConfirmedRepRangeRestReset(S, exerciseId, options)
  S.progressionControls = next.progressionControls
  const record = confirmedRepRangeRestControl(next, exerciseId)
  return record
}
