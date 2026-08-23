export const CONFIRMED_REST_REDUCTION_MANUAL = 'manual'
export const CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES = 'auto_after_successes'

// The decreasing-rest trials reviewed reduced recovery by 15 seconds per week while training
// an exercise twice weekly. Four successful exposures are therefore the conservative proxy
// for our larger 30-second step. This is an evidence-informed inference, not a clinically
// validated universal threshold; keep it centralized so it can be revised transparently.
export const CONFIRMED_REST_DECREASE_AFTER_SUCCESSES = 4
export const CONFIRMED_REST_DECREMENT_SECONDS = 30

export function confirmedRestReductionStrategy(value) {
  return value === CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES
    ? CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES
    : CONFIRMED_REST_REDUCTION_MANUAL
}

const seconds = value => Math.max(0, Math.round(Number(value) || 0))

function sameEpoch(sessionEpochId, currentEpochId) {
  // Undefined is the legacy epoch. A newly-created manual reset always has a token, so old
  // sessions cannot leak into its success streak.
  return (sessionEpochId ?? null) === (currentEpochId ?? null)
}

/**
 * Count the clean suffix earned at the current recovery level.
 *
 * The streak is intentionally derived from completed workout snapshots rather than stored
 * as mutable state. It stops at a miss, a recovery change, a strategy change, or an epoch
 * boundary. Consequently, after an automatic 180 -> 150 reduction, the first successful
 * 150-second workout starts a fresh streak instead of reusing the four successes at 180.
 */
export function confirmedRestSuccessStreak(
  sessions,
  { restSeconds, baseRestSeconds, restEpochId } = {}
) {
  const currentRest = seconds(restSeconds)
  const currentBase = seconds(baseRestSeconds)
  // A workout started on another device before a manual reset can arrive later in the
  // serialized history. It belongs to another recovery epoch and must be ignored, just as
  // the recovery calculation ignores it, rather than interrupting the current epoch's run.
  const relevant = (sessions || []).filter(session => sameEpoch(session?.restEpochId, restEpochId))
  let streak = 0

  for (let i = relevant.length - 1; i >= 0; i--) {
    const session = relevant[i] || {}
    if (confirmedRestReductionStrategy(session.restReductionStrategy) !== CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES) break
    if (seconds(session.restSeconds) !== currentRest) break
    // The base is part of the experiment. Lowering it must start a new observation window,
    // not reinterpret successes earned while the old base made reduction impossible.
    if (session.restBaseSeconds == null || seconds(session.restBaseSeconds) !== currentBase) break
    if (!session.ok) break
    streak++
  }

  return streak
}

/**
 * Decide whether a successful run has earned a 30-second recovery trial.
 *
 * `sessions` must be oldest-first and include the just-completed session. The returned
 * streak is progress toward the *next* reduction, hence it resets to zero when a reduction
 * is emitted. A miss is already represented by a zero suffix.
 */
export function confirmedRestAutoReduction({
  sessions = [],
  restSeconds,
  baseRestSeconds,
  restEpochId,
  strategy,
  successThreshold = CONFIRMED_REST_DECREASE_AFTER_SUCCESSES
} = {}) {
  const rest = seconds(restSeconds)
  const base = seconds(baseRestSeconds)
  const mode = confirmedRestReductionStrategy(strategy)
  const threshold = Math.max(1, Math.round(Number(successThreshold) || CONFIRMED_REST_DECREASE_AFTER_SUCCESSES))

  if (mode !== CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES || rest <= base) {
    return { restSeconds: rest, restSuccessStreak: 0, reduced: false }
  }

  const streak = confirmedRestSuccessStreak(sessions, {
    restSeconds: rest,
    baseRestSeconds: base,
    restEpochId
  })
  if (streak < threshold) {
    return { restSeconds: rest, restSuccessStreak: streak, reduced: false }
  }

  return {
    restSeconds: Math.max(base, rest - CONFIRMED_REST_DECREMENT_SECONDS),
    restSuccessStreak: 0,
    reduced: true
  }
}
