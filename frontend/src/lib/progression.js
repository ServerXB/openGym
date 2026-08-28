// Automatic progression (issue #17).
//
// Everything here is a pure function of the workout history. Nothing writes back into a
// finished workout: the log is what happened, and the next prescription is *derived* from
// it every time it is needed. That means changing a policy — or fixing a mistyped set —
// immediately produces the right next target, with no stored counters to drift out of sync.
//
// It replaces a single hard-coded rule ("all reps done → add 2.5") with a small set of named
// policies. The rule that applies is always visible in the app, together with the reason it
// picked this weight, because a suggestion you can't audit is one you stop trusting.
//
// Reading a session honestly is the whole game:
//   · a set checked off with at least its target reps  → hit
//   · a set checked off with fewer reps                → miss (you logged what you got)
//   · a set never checked off                          → miss (it was not performed)
//   · fewer sets than prescribed                       → miss
// So a session that fell apart can never advance the load as though it had succeeded.

import { modeOf, repStep } from './history.js'
import { EXIDX } from './exercises.js'
import { confirmedRepRangeConfig } from './confirmedRepRangeConfig.js'
import { confirmedRepRangeRestControl } from './confirmedRepRangeRest.js'
import {
  CONFIRMED_REST_DECREASE_AFTER_SUCCESSES,
  CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES,
  confirmedRestAutoReduction
} from './confirmedRepRangeAutoRest.js'
import { findWorkoutProgressionEntry } from './progression-scope.js'

export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'confirmed_rep_range', 'time']

// Which policies can sensibly drive which logging mode.
export const POLICIES_FOR = {
  reps: ['off', 'linear', 'greyskull', 'double', 'confirmed_rep_range'],
  time: ['off', 'time'],
  cardio: ['off']
}

export const POLICY_NAME = {
  off: 'No automatic progression',
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  confirmed_rep_range: 'Confirmed Rep-Range',
  time: 'Add time'
}
export const POLICY_DESC = {
  off: 'Targets stay where you set them.',
  linear: 'Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.',
  greyskull: 'Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up — double if you double the reps. One failure resets 10 %.',
  double: 'Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom.',
  confirmed_rep_range: 'Add one rep after a clean session. At the top, confirm twice before adding weight; later-set misses add recovery time.',
  time: 'Hold every set for the full duration and the target goes up.'
}

// Sessions of repeated misses before a deload. Greyskull resets on the first failure by
// design; the general linear policy gives you two more cracks at it first.
export const DELOAD_AFTER = { linear: 3, greyskull: 1, double: 3, time: 3 }
const DELOAD_FACTOR = 0.9

// Body parts where a 5 kg jump is normal rather than brutal.
const HEAVY_BP = ['upper legs', 'lower legs', 'back', 'hips', 'glutes']

// Default load step. Lower-body lifts take the bigger jump — that is the "lift-specific
// increment" a linear program lives on; an exercise can override it with cfg.inc.
export function defaultIncrement(exId, unit) {
  const ex = EXIDX[exId]
  const heavy = ex && HEAVY_BP.includes(ex.bp)
  if (unit === 'lb') return heavy ? 10 : 5
  return heavy ? 5 : 2.5
}
export const DEFAULT_SEC_INCREMENT = 5
export const CONFIRMED_REST_INCREMENT = 30
// Where adding another set of push-ups stops being progress and starts being a way to spend
// an evening. Past this the honest advice is load or a harder variation (issue #33).
export const MAX_BW_SETS = 6

// The policy in force for one exercise: its own override, else the routine's default, else
// the mode's default. Reps keeps behaving the way the app always did (all reps → add a step).
export function policyFor(cfg, routine, mode) {
  const m = mode || modeOf(cfg || {})
  const allowed = POLICIES_FOR[m] || ['off']
  const pick = (cfg && cfg.prog) || (routine && routine.prog) || (m === 'reps' ? 'linear' : 'off')
  return allowed.includes(pick) ? pick : 'off'
}

// Loads and increments are stored with at most two decimal places. Keeping this rounding at
// the domain boundary avoids binary floating-point tails (63.75 + 0.25 must serialize as 64)
// without turning an increment into an absolute loading grid.
export const roundLoad = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100

const positiveIncrement = value => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const rounded = roundLoad(n)
  return rounded >= 0.01 ? rounded : null
}

// Validation for newly typed configuration. Legacy JSON deliberately follows the more lenient
// resolver above (positive values are rounded for future prescriptions), while new input must
// receive explicit feedback instead of being silently truncated or replaced by a default.
export function loadIncrementValidation(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0.01) return 'minimum'
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-8) return 'precision'
  return null
}

export function loadIncrementRawValidation(value) {
  return /^\d*(?:[.,]\d*)?$/.test(String(value)) ? null : 'format'
}

// `inc` is the canonical field. `weightIncrement` is accepted only as a read fallback for old
// JSON; when both are valid, the canonical value wins. Legacy precision beyond hundredths is
// normalized for future prescriptions, never written back into history.
export function loadIncrementFor(cfg = {}, unit = 'kg') {
  // Presence matters: once a canonical field exists, an invalid value must not resurrect a
  // stale legacy value sitting beside it. The legacy field is consulted only by older JSON
  // that has no canonical property at all.
  if (Object.prototype.hasOwnProperty.call(cfg, 'inc')) return positiveIncrement(cfg.inc) ?? defaultIncrement(cfg.id, unit)
  return positiveIncrement(cfg.weightIncrement) ?? defaultIncrement(cfg.id, unit)
}

function addLoad(weight, increment, multiples = 1) {
  return roundLoad(Number(weight) + increment * multiples)
}

// Snap to a loadable multiple of the step.
function snap(v, step) {
  if (!(step > 0)) return roundLoad(v)
  return roundLoad(Math.round(v / step) * step)
}
// Back off by DELOAD_FACTOR, landing on something you can actually load. Rounding to the
// nearest step keeps the cut close to the intended 10 %, but on small weights the nearest
// step can be the weight you started from — so a deload that did not actually reduce
// anything takes one step down instead. Never goes below a single step.
function deloadTo(cur, step) {
  let next = snap(cur * DELOAD_FACTOR, step)
  if (next >= cur) next = snap(cur - step, step)
  return Math.max(step, next)
}

/**
 * Reduce one finished workout entry to what a policy needs to judge it.
 *
 * Workouts only started recording their prescription in v1.2.2, so most existing history has
 * no `target` at all. Judging those against nothing would score every past session as a miss
 * — and then greet a long-standing user with "missed reps 11 sessions running, deload". So an
 * entry without its own target is judged against `fallback`, the exercise's current plan,
 * which is exactly what the app's old weight hint compared against.
 */
export function readSession(entry, fallback) {
  const target = (entry && entry.target) || fallback || {}
  const mode = modeOf({ ...target, id: entry && entry.id })
  const sets = (entry && entry.sets) || []
  const scoredSets = target.sets || sets.length
  // Set-count progression needs provenance, not merely the fallback used to score old history:
  // a modern snapshot's prescribed count wins over optional/missing rows, while a pre-snapshot
  // workout has only its actual row count and must not be mistaken for today's cfg.sets.
  const planned = entry?.target?.sets || sets.length
  const enough = sets.length >= scoredSets

  if (mode === 'time') {
    const goal = target.sec || 0
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0))
    return {
      mode, goal, held, planned,
      weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)),
      best: Math.max(0, ...held),
      ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal)
    }
  }
  const goal = target.reps || 0
  const reps = sets.map(s => (s.done ? (s.r || 0) : 0))
  return {
    mode, goal, reps, planned,
    weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)),
    count: reps.length,                                   // the dimension bodyweight work grows (#33)
    low: reps.length ? Math.min(...reps) : 0,
    amrap: reps.length ? reps[reps.length - 1] : 0,       // Greyskull's final set
    ok: goal > 0 && enough && reps.length > 0 && reps.every(r => r >= goal)
  }
}

/** Every past session for one exercise, oldest first. `fallback` — see readSession. */
export function sessionsFor(S, exId, fallback) {
  const out = []
  const progressionId = fallback?.progressionId
  ;(S.workouts || []).forEach(w => {
    const entry = findWorkoutProgressionEntry(S, w, exId, progressionId)
    if (entry && entry.sets.some(s => s.done)) out.push({ d: w.d, ...readSession(entry, fallback) })
  })
  return out
}

// How many sessions in a row ended in a miss, counting back from the most recent.
export function stallCount(sessions) {
  let n = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].ok) break
    n++
  }
  return n
}

const snapshotPositiveInt = value => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : null
}

const snapshotLoad = value => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? roundLoad(n) : null
}

const snapshotId = value => typeof value === 'string' && value.trim() ? value.trim() : null

// A historical range is usable only when the historical snapshot actually contains it. Never
// fill a missing bound from today's routine: doing so would turn an old 8-rep result into a new
// 8-10 confirmation after the fact. `repsMin/repsMax` are accepted as old persisted spellings.
function confirmedSnapshotRange(snapshot) {
  if (!snapshot) return null
  const minReps = snapshotPositiveInt(snapshot.minReps ?? snapshot.repsMin)
  const maxReps = snapshotPositiveInt(snapshot.maxReps ?? snapshot.repsMax)
  if (minReps == null || maxReps == null || maxReps < minReps) return null
  const explicitStep = snapshotPositiveInt(snapshot.rangeStep)
  const step = explicitStep || repStep(snapshot)
  return { minReps, maxReps, step, key: `${minReps}:${maxReps}:${step}` }
}

const sameLoad = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-8

// Confirmed Rep-Range deliberately judges only the prescribed sets. Extra sets are optional
// work: they neither rescue a missed prescription nor turn an otherwise clean session into a
// miss. Modern snapshots are rich enough to credit the highest range level demonstrated by
// every prescribed set; incomplete legacy snapshots remain readable but never receive invented
// range credit from the current routine configuration.
export function confirmedRepRangeSession(entry, fallback) {
  const snapshot = entry?.target || null
  const target = snapshot || {}
  const rows = Array.isArray(entry?.sets) ? entry.sets : []
  const snapshotPlanned = snapshotPositiveInt(target.sets)
  const planned = snapshotPlanned || Math.max(1, rows.length || 1)
  const goal = snapshotPositiveInt(target.targetReps ?? target.reps)
  const range = confirmedSnapshotRange(snapshot)
  const setBaselineId = snapshotId(target.setBaselineId)
  const prescribed = rows.slice(0, planned)
  const complete = snapshotPlanned != null
    && prescribed.length === planned
    && prescribed.every(set => !!set?.done)
  const reps = complete ? prescribed.map(set => Math.max(0, Number(set.r) || 0)) : []
  const loads = complete ? prescribed.map(set => snapshotLoad(set.w)) : []
  const loadKnown = complete && loads.every(load => load != null)
  const loadUniform = loadKnown && loads.every(load => sameLoad(load, loads[0]))
  const prescribedWeight = snapshotLoad(target.weight)
  const workingWeight = loadUniform ? loads[0] : null
  const minCompletedReps = reps.length ? Math.min(...reps) : null
  const firstHit = goal != null && !!prescribed[0]?.done && (Number(prescribed[0].r) || 0) >= goal
  const laterMiss = goal != null && prescribed.slice(1).some(set =>
    !!set?.done && (Number(set.r) || 0) < goal
  )

  let outcome = 'incomplete'
  let validatedReps = null
  if (complete && goal == null) outcome = 'legacy_unknown'
  else if (complete && minCompletedReps < goal) outcome = 'failed'
  else if (complete && !loadUniform) outcome = 'mixed_load'
  else if (complete && range && minCompletedReps < range.minReps) {
    // A malformed/old target below the frozen range can be successful on its own terms, but it
    // has not demonstrated any valid level in that range.
    outcome = 'below_range_success'
  }
  else if (complete && range) {
    const bounded = Math.min(range.maxReps, minCompletedReps)
    validatedReps = Math.min(
      range.maxReps,
      range.minReps + Math.floor((bounded - range.minReps) / range.step) * range.step
    )
    outcome = validatedReps >= range.maxReps ? 'top_range_success' : 'success'
  } else if (complete) {
    // Enough historical data to preserve the old sequential success/failure decision, but not
    // enough to award an accelerated level or a top-range confirmation.
    outcome = 'legacy_success'
  }

  const ok = outcome === 'success'
    || outcome === 'top_range_success'
    || outcome === 'below_range_success'
    || outcome === 'legacy_success'
  return {
    goal: goal || 0,
    planned,
    prescribedSets: planned,
    complete,
    minCompletedReps,
    validatedReps,
    rangeKnown: !!range,
    rangeMin: range?.minReps ?? null,
    rangeMax: range?.maxReps ?? null,
    rangeStep: range?.step ?? null,
    rangeKey: range?.key ?? null,
    setBaselineId,
    progressionKey: range ? `${range.key}|sets:${setBaselineId || 'legacy'}` : null,
    loadUniform,
    workingWeight,
    prescribedWeight,
    // A complete uniform manual change becomes the operational baseline. Mixed/incomplete
    // work holds the frozen prescribed weight and never promotes an isolated maximum.
    weight: workingWeight ?? prescribedWeight ?? 0,
    firstHit,
    firstOk: firstHit,
    laterMiss,
    topRangeSuccess: outcome === 'top_range_success',
    outcome,
    ok,
    restSeconds: Math.max(0, target.restSeconds ?? fallback?.restSeconds ?? 0),
    maxRestSeconds: Math.max(0, target.maxRestSeconds ?? fallback?.maxRestSeconds ?? 0),
    restEpochId: typeof target.restEpochId === 'string' ? target.restEpochId : null,
    restReductionStrategy: target.restReductionStrategy,
    // Never infer this from today's config: doing so would reinterpret old successes after
    // the user edits the base. Missing means the session predates automatic reduction.
    restBaseSeconds: Number.isFinite(Number(target.restBaseSeconds))
      ? Math.max(0, Math.round(Number(target.restBaseSeconds)))
      : null
  }
}

function confirmedSessionsFor(S, exId, fallback) {
  const out = []
  const progressionId = fallback?.progressionId
  ;(S.workouts || []).forEach(w => {
    const entry = findWorkoutProgressionEntry(S, w, exId, progressionId)
    // Do not turn workouts logged under Linear/Double into confirmation history when a user
    // switches strategy. New entries snapshot the effective policy, including routine-level
    // inheritance, so only this strategy's own sessions participate.
    // Completed workouts retain Confirmed entries even when every prescribed row was skipped:
    // that is an incomplete exposure and must break a top-range confirmation streak. Active
    // workouts never reach this reader because only S.workouts is traversed here.
    if (entry?.target?.prog === 'confirmed_rep_range') out.push(confirmedRepRangeSession(entry, fallback))
  })
  return out
}

// Find the most recent load that is safe to carry into Confirmed Rep-Range. A Confirmed
// workout can promote its logged load only after every prescribed set is complete and uses
// the same load; otherwise an isolated edited set (or a mixed-load workout) would silently
// become the next prescription. Other reps policies keep their established max-load reading
// when they provide the baseline for a first switch to Confirmed.
function confirmedOperationalHistoryWeight(S, cfg) {
  let weight = null
  const progressionId = cfg?.progressionId
  ;(S.workouts || []).forEach(workout => {
    const entry = findWorkoutProgressionEntry(S, workout, cfg.id, progressionId)
    if (!entry?.sets?.some(set => set?.done)) return

    if (entry.target?.prog === 'confirmed_rep_range') {
      const session = confirmedRepRangeSession(entry, cfg)
      if (session.complete && session.loadUniform && session.workingWeight != null) {
        weight = session.workingWeight
      }
      return
    }

    const session = readSession(entry, cfg)
    if (session.mode === 'reps') weight = snapshotLoad(session.weight)
  })
  return weight
}

// Recovery has its own history boundary. A manual reset opens a new epoch without changing
// the sessions used for weight, rep targets or the top-range confirmation streak.
function confirmedRepRangeRecovery(sessions, control, initialRest, maxRest) {
  const restEpochId = control?.epochId
  const relevant = control
    ? sessions.filter(session => session.restEpochId === restEpochId)
    : sessions
  const last = relevant[relevant.length - 1]

  if (!last) {
    const restSeconds = control
      ? Math.min(maxRest, Math.max(0, Math.round(control.resetSeconds)))
      : initialRest
    return {
      restSeconds,
      ...(restEpochId ? { restEpochId } : {}),
      restSource: control ? 'manual_reset' : 'initial',
      restResetPending: !!control,
      restWhy: control
        ? ['Recovery manually reset to {0}s for the next workout.', restSeconds]
        : ['Recovery starts at the configured base of {0}s.', restSeconds]
    }
  }

  const rest = last.restSeconds ?? control?.resetSeconds ?? initialRest
  if (last.outcome === 'failed' && last.firstHit && last.laterMiss) {
    // Lowering the configured maximum must never turn a failed workout into an implicit
    // recovery decrease. Keep an already-higher effective value until the user explicitly
    // resets it (or the opt-in success rule earns a reduction).
    const restSeconds = rest >= maxRest ? rest : Math.min(maxRest, rest + CONFIRMED_REST_INCREMENT)
    return {
      restSeconds,
      ...(restEpochId ? { restEpochId } : {}),
      restSource: restSeconds > rest ? 'adaptive_increase' : rest > maxRest ? 'above_max' : 'max_cap',
      restResetPending: false,
      restWhy: restSeconds > rest
        ? ['Later sets missed the target — recovery increased from {0}s to {1}s.', rest, restSeconds]
        : rest > maxRest
          ? ['Later sets missed the target — recovery stays at {0}s despite the configured maximum of {1}s; a failure never decreases recovery.', rest, maxRest]
          : ['Later sets missed the target — recovery remains at its maximum of {0}s.', restSeconds]
    }
  }

  return {
    restSeconds: rest,
    ...(restEpochId ? { restEpochId } : {}),
    restSource: 'carried',
    restResetPending: false,
    restWhy: last.outcome === 'incomplete'
      ? ['Recovery stays at {0}s — the prescription was incomplete, not failed.', rest]
      : last.outcome === 'legacy_unknown'
        ? ['Recovery stays at {0}s — the historical target is unavailable.', rest]
      : last.outcome === 'mixed_load'
        ? ['Recovery stays at {0}s — prescribed sets used different loads.', rest]
        : last.firstHit
          ? ['Recovery stays at {0}s.', rest]
          : ['The first set missed the target — recovery stays at {0}s.', rest]
  }
}

// Automatic recovery reduction follows consecutive successful exposures at one prescribed
// recovery. Weight is deliberately not a boundary: narrow rep ranges can increase load before
// four sessions at one weight, and the evidence used for the default threshold reduced rest by
// exposure rather than by a fixed-load block.
function confirmedRepRangeRestPlan(recovery, sessions, normalized, last) {
  const strategy = normalized.restReductionStrategy
  const decision = confirmedRestAutoReduction({
    sessions,
    restSeconds: recovery.restSeconds,
    baseRestSeconds: normalized.restSeconds,
    restEpochId: recovery.restEpochId,
    strategy
  })
  const plan = {
    ...recovery,
    restSeconds: decision.restSeconds,
    restBaseSeconds: normalized.restSeconds,
    restReductionStrategy: strategy,
    restSuccessStreak: decision.restSuccessStreak
  }

  if (decision.reduced) {
    return {
      ...plan,
      restSource: 'automatic_decrease',
      restWhy: [
        '{0} consecutive successful sessions with the same prescribed recovery — recovery decreased from {1}s to {2}s.',
        CONFIRMED_REST_DECREASE_AFTER_SUCCESSES,
        recovery.restSeconds,
        decision.restSeconds
      ]
    }
  }

  // A miss already has a more useful recovery explanation (unchanged, increased, or cap),
  // and a pending manual reset must remain visibly attributable to the user action.
  if (strategy !== CONFIRMED_REST_REDUCTION_AFTER_SUCCESSES || !last?.ok || recovery.restResetPending) return plan

  if (decision.restSeconds <= normalized.restSeconds) {
    return {
      ...plan,
      restWhy: ['Recovery is already at its configured base of {0}s.', normalized.restSeconds]
    }
  }
  return {
    ...plan,
    restWhy: [
      'Recovery stays at {0}s — automatic reduction progress: {1} / {2} successful sessions.',
      decision.restSeconds,
      decision.restSuccessStreak,
      CONFIRMED_REST_DECREASE_AFTER_SUCCESSES
    ]
  }
}

/** Pure domain rule for Confirmed Rep-Range. */
export function confirmedRepRangeProgression(S, cfg, unit = 'kg') {
  const normalized = confirmedRepRangeConfig(cfg, S.restSec)
  const { minReps, maxReps } = normalized
  const rangeStep = repStep({ ...cfg, ...normalized })
  const currentRangeKey = `${minReps}:${maxReps}:${rangeStep}`
  const currentSetBaselineId = snapshotId(cfg.setBaselineId)
  const currentProgressionKey = `${currentRangeKey}|sets:${currentSetBaselineId || 'legacy'}`
  const inc = loadIncrementFor(cfg, unit)
  const initialRest = normalized.restSeconds
  const maxRest = normalized.maxRestSeconds
  const sessions = confirmedSessionsFor(S, cfg.id, cfg)
  const latest = sessions[sessions.length - 1]
  const recovery = confirmedRepRangeRecovery(sessions, confirmedRepRangeRestControl(S, cfg), initialRest, maxRest)
  const rangePlan = {
    policy: 'confirmed_rep_range', inc, minReps, maxReps, rangeStep,
    ...(currentSetBaselineId ? { setBaselineId: currentSetBaselineId } : {})
  }

  // A range edit opens a new deterministic progression block. Sessions keep their own frozen
  // range and are never clamped into the new one. A legacy snapshot with a known target remains
  // usable only for the old one-step behavior; it cannot earn accelerated/top-range credit.
  let progressionSessions = []
  if (latest?.rangeKnown && latest.progressionKey === currentProgressionKey) {
    let start = sessions.length - 1
    while (start > 0 && sessions[start - 1].progressionKey === currentProgressionKey) start--
    progressionSessions = sessions.slice(start)
  } else if (latest && !latest.rangeKnown && latest.goal >= minReps && latest.goal <= maxReps) {
    progressionSessions = [latest]
  }
  const last = progressionSessions[progressionSessions.length - 1]

  const historyWeight = confirmedOperationalHistoryWeight(S, cfg)
  const trackedWeight = cfg.progressionId
    ? snapshotLoad(S.progressionWeights?.[cfg.progressionId]?.w)
    : null
  const operationalWeight = historyWeight ?? trackedWeight

  if (!last) {
    const restPlan = confirmedRepRangeRestPlan(recovery, sessions, normalized, latest)
    // "First Confirmed" means no history for this policy, not necessarily no history for the
    // exercise. Preserve the most recent operational load from another reps policy so plan,
    // snapshot and generated sets all describe the same prescription. Time-mode history does
    // not carry a reps working load and must not leak into this baseline.
    return {
      ...rangePlan, kind: 'first',
      ...(operationalWeight != null ? { weight: operationalWeight } : {}),
      reps: minReps, ...restPlan, topRangeStreak: 0,
      why: latest?.rangeKnown
        ? ['The prescription changed — the new block starts at {0} reps without rewriting prior workouts.', minReps]
        : ['Nothing logged yet — this session sets the baseline.']
    }
  }

  const target = Math.min(maxReps, Math.max(minReps, last.goal || minReps))
  const effectiveWeight = last.workingWeight
    ?? last.prescribedWeight
    ?? operationalWeight
    ?? snapshotLoad(cfg.weight)
    ?? 0
  // Set-count progression on unloaded work is historical state just like the rep target.
  // Once a completed Confirmed cycle adds a set, every following prescription must carry it
  // until another completed cycle adds the next one; falling back to cfg.sets here would make
  // the added set disappear after a single workout.
  const configuredSets = Math.max(1, cfg.sets || 1)
  const bodyweightSets = effectiveWeight <= 0
    ? Math.max(configuredSets, last.planned || 1)
    : null
  const carriedSets = bodyweightSets != null && bodyweightSets > configuredSets
    ? { sets: bodyweightSets }
    : {}
  let streak = 0
  if (last.topRangeSuccess) {
    for (let i = progressionSessions.length - 1; i >= 0; i--) {
      const session = progressionSessions[i]
      if (!session.topRangeSuccess
        || session.progressionKey !== last.progressionKey
        || !sameLoad(session.workingWeight, last.workingWeight)) break
      streak++
    }
  }
  if (!last.ok) {
    const restPlan = confirmedRepRangeRestPlan(recovery, sessions, normalized, last)
    const why = last.outcome === 'incomplete'
      ? ['The prescription was incomplete — weight and target stay unchanged.']
      : last.outcome === 'legacy_unknown'
        ? ['The historical target is unavailable — the current prescription starts from its minimum.']
      : last.outcome === 'mixed_load'
        ? ['Prescribed sets used different loads — progression holds the frozen working load and target.']
        : last.firstHit
          ? ['A later set missed the target — weight and target stay unchanged.']
          : ['The first set missed the target — weight and target stay unchanged.']
    return {
      ...rangePlan, kind: 'hold', weight: effectiveWeight, reps: target,
      ...carriedSets, ...restPlan, topRangeStreak: 0, why
    }
  }

  if (last.outcome === 'below_range_success') {
    const restPlan = confirmedRepRangeRestPlan(recovery, sessions, normalized, last)
    return {
      ...rangePlan, kind: 'hold', weight: effectiveWeight, reps: minReps,
      ...carriedSets, ...restPlan, topRangeStreak: 0,
      why: ['The historical result is below the frozen range — start from the minimum of {0} reps.', minReps]
    }
  }

  // Incomplete historical snapshots keep the conservative sequential rule. They can explain
  // their own target and result, but they cannot be upgraded into a top-range confirmation by
  // borrowing today's range.
  if (!last.rangeKnown) {
    const restPlan = confirmedRepRangeRestPlan(recovery, sessions, normalized, last)
    if (target >= maxReps) return {
      ...rangePlan, kind: 'hold', weight: effectiveWeight, reps: maxReps,
      ...carriedSets, ...restPlan, topRangeStreak: 0,
      why: ['The legacy workout has no frozen rep range — confirm the current maximum in a new workout.']
    }
    const nextTarget = Math.min(maxReps, minReps + (Math.floor((target - minReps) / rangeStep) + 1) * rangeStep)
    return {
      ...rangePlan, kind: 'up', weight: effectiveWeight, reps: nextTarget,
      ...carriedSets, ...restPlan, topRangeStreak: 0,
      why: ['Every prescribed set reached {0} reps — target increased conservatively to {1}.', target, nextTarget]
    }
  }

  if (!last.topRangeSuccess) {
    const restPlan = confirmedRepRangeRestPlan(recovery, sessions, normalized, last)
    const demonstrated = Math.max(target, last.validatedReps ?? target)
    // Advance from the highest valid level every prescribed set demonstrated. A single workout
    // may skip intermediate levels, but it still contributes at most one top confirmation.
    const nextTarget = Math.min(
      maxReps,
      minReps + (Math.floor((demonstrated - minReps) / rangeStep) + 1) * rangeStep
    )
    return {
      ...rangePlan, kind: 'up', weight: effectiveWeight, reps: nextTarget,
      ...carriedSets, ...restPlan, topRangeStreak: 0,
      why: ['Every prescribed set demonstrated {0} reps — target increased to {1}.', last.validatedReps, nextTarget]
    }
  }

  if (streak < 2) {
    const restPlan = confirmedRepRangeRestPlan(recovery, sessions, normalized, last)
    return { ...rangePlan, kind: 'hold', weight: effectiveWeight, reps: maxReps, ...carriedSets, ...restPlan, topRangeStreak: 1, why: ['Top range confirmation: 1 / 2'] }
  }
  const restPlan = confirmedRepRangeRestPlan(recovery, sessions, normalized, last)
  // With no external load there is no plate to add. Complete the same two-confirmation cycle,
  // then progress volume by one set and restart at the bottom of the range. Once the useful
  // set cap is reached, hold the target and ask for load or a harder variation instead of
  // inventing a weighted exercise from a bodyweight log.
  if (effectiveWeight <= 0) {
    const sets = bodyweightSets + 1
    if (sets <= MAX_BW_SETS) {
      return {
        ...rangePlan, kind: 'up', weight: 0, reps: minReps, sets,
        ...restPlan, topRangeStreak: 0,
        why: ['{0} reps in every set — add a set and go back to {1}.', maxReps, minReps]
      }
    }
    return {
      ...rangePlan, kind: 'hold', weight: 0, reps: maxReps, ...carriedSets,
      ...restPlan, topRangeStreak: 0,
      why: ['{0} sets of {1} — time to add weight or move to a harder variation.', sets - 1, maxReps]
    }
  }
  const nextWeight = addLoad(effectiveWeight, inc)
  return { ...rangePlan, kind: 'up', weight: nextWeight, reps: minReps, ...restPlan, topRangeStreak: 0, why: ['Weight increased: {0} → {1} {2}; target reps reset: {3} → {4}.', effectiveWeight, nextWeight, unit, maxReps, minReps] }
}

/**
 * The next prescription for one exercise.
 *
 * Returns `{ weight, reps, sec, why, kind }` — `kind` being one of
 * first | up | hold | deload | off, and `why` a translatable template + args so the app can
 * always answer "why this number?". A field the policy has no opinion on comes back
 * undefined and the caller keeps whatever the plan said.
 */
export function nextPrescription(S, cfg, routine) {
  const mode = modeOf(cfg)
  const policy = policyFor(cfg, routine, mode)
  const unit = S.unit || 'kg'
  const configuredTimeIncrement = Number(cfg.inc)
  const inc = mode === 'time'
    ? (Number.isFinite(configuredTimeIncrement) && configuredTimeIncrement > 0 ? configuredTimeIncrement : DEFAULT_SEC_INCREMENT)
    : loadIncrementFor(cfg, unit)
  // Even with automatic progression disabled, a reps workout needs the resolved load step for
  // its manual +/- controls and snapshot. Time/cardio modes have no load increment semantics.
  if (policy === 'off') return { policy, kind: 'off', ...(mode === 'reps' ? { inc } : {}) }
  if (policy === 'confirmed_rep_range') return confirmedRepRangeProgression(S, cfg, unit)

  const sessions = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === mode)
  const last = sessions[sessions.length - 1]
  if (!last) return {
    policy, kind: 'first',
    ...(mode === 'reps' ? { inc } : {}),
    why: ['Nothing logged yet — this session sets the baseline.']
  }

  const stalls = stallCount(sessions)
  const deloadAt = DELOAD_AFTER[policy] || 3

  if (mode === 'time') {
    if (last.ok) {
      const sec = (last.goal || cfg.sec || 0) + inc
      return { policy, kind: 'up', sec, why: ['Held every set for the full time — target up by {0}s.', inc] }
    }
    if (stalls >= deloadAt) {
      const sec = deloadTo(last.goal || cfg.sec || 0, 5)
      return { policy, kind: 'deload', sec, why: ['Short {0} sessions in a row — back off to {1}s and build up again.', stalls, sec] }
    }
    return { policy, kind: 'hold', sec: last.goal || cfg.sec, why: ['Last time came up short — same target again.'] }
  }

  const w = last.weight
  // Bodyweight work carries no external load, so there is nothing to add or take away —
  // "deload your push-ups to 2.5 kg" is not advice. Progress in reps instead. This runs ahead
  // of the individual policies because it is true for all of them. Note the trigger is the
  // *logged* weight, not the `bw` flag: a dip done with a belt has a load to progress and
  // belongs on the normal policies, and a barbell lift logged at 0 has nothing to add to.
  if (w <= 0) {
    const goal = last.goal || cfg.reps || 0
    const configuredSets = Math.max(1, cfg.sets || 1)
    const bodyweightSets = Math.max(configuredSets, last.planned || last.count || 1)
    const carriedSets = bodyweightSets > configuredSets ? { sets: bodyweightSets } : {}
    if (!last.ok || goal <= 0) return { policy, kind: 'hold', weight: 0, inc, reps: goal || undefined, ...carriedSets, why: ['Bodyweight — same target again until every set is clean.'] }
    // A ceiling turns "+1 rep forever" into a plan (issue #33). Past the top of the range the
    // reps go back to the bottom and a set is added instead, which is how bodyweight work
    // actually progresses once a set of 30 push-ups stops being a strength stimulus.
    const top = cfg.repsMax > 0 ? cfg.repsMax : 0
    if (top > 0 && goal >= top) {
      const sets = bodyweightSets + 1
      const bottom = Math.max(1, Math.min(cfg.reps || top, top))
      if (sets <= MAX_BW_SETS) return { policy, kind: 'up', weight: 0, inc, reps: bottom, sets, why: ['{0} reps in every set — add a set and go back to {1}.', goal, bottom] }
      // Out of sets worth adding: more volume is no longer the answer, load or a harder
      // variation is — and that is a decision for a person, not a policy.
      return { policy, kind: 'hold', weight: 0, inc, reps: goal, ...carriedSets, why: ['{0} sets of {1} — time to add weight or move to a harder variation.', sets - 1, goal] }
    }
    // Unilateral work steps by two, so the total stays even and both sides get the rep.
    const next = goal + repStep(cfg)
    return { policy, kind: 'up', weight: 0, inc, reps: next, ...carriedSets, why: ['Bodyweight — every rep last time, so go for {0} this time.', next] }
  }
  if (policy === 'double') {
    const top = cfg.reps || last.goal || 10
    const bottom = Math.min(cfg.repsMin || Math.max(1, top - 2), top)
    if (last.ok) return { policy, kind: 'up', weight: addLoad(w, inc), inc, reps: bottom, why: ['Top of the rep range in every set — {0} {1} more, back to {2} reps.', inc, unit, bottom] }
    if (stalls >= deloadAt) {
      const dw = deloadTo(w, inc)
      return { policy, kind: 'deload', weight: dw, inc, reps: bottom, why: ['Stalled {0} sessions — deload to {1} {2}.', stalls, dw, unit] }
    }
    const aim = Math.min(top, Math.max(bottom, last.low + repStep(cfg)))
    return { policy, kind: 'hold', weight: w, inc, reps: aim, why: ['Same weight — aim for {0} reps this time.', aim] }
  }

  // linear + greyskull
  if (last.ok) {
    // Greyskull's final set is taken to failure: double the target reps there and you have
    // earned a double jump.
    const dbl = policy === 'greyskull' && last.goal > 0 && last.amrap >= last.goal * 2
    const step = dbl ? inc * 2 : inc
    return {
      policy, kind: 'up', weight: addLoad(w, inc, dbl ? 2 : 1), inc,
      why: dbl
        ? ['Last set hit {0} reps — twice the target, so take a double jump of {1} {2}.', last.amrap, step, unit]
        : ['Every rep last time — {0} {1} more.', step, unit]
    }
  }
  if (stalls >= deloadAt) {
    const dw = deloadTo(w, inc)
    return {
      policy, kind: 'deload', weight: dw, inc,
      why: stalls > 1
        ? ['Missed reps {0} sessions running — reset to {1} {2} and work back up.', stalls, dw, unit]
        : ['Missed reps — reset to {0} {1} and work back up.', dw, unit]
    }
  }
  return { policy, kind: 'hold', weight: w, inc, why: ['Missed reps last time — same weight again ({0} of {1} to go).', deloadAt - stalls, deloadAt] }
}

/**
 * Apply a prescription to freshly built sets. Only the fields the policy actually decided
 * are touched, and only on sets that have not been logged yet.
 */
export function applyPrescription(sets, p) {
  if (!p || p.kind === 'off') return sets
  // Most policies have no opinion on a first session, but some do. Confirmed Rep-Range, for
  // example, returns its configured starting target even when the only exercise history was
  // logged under another policy. Apply any explicit fields instead of leaking the old policy's
  // rows into the new workout; a fieldless `first` prescription remains a true no-op.
  const hasTargets = p.weight != null || p.reps != null || p.sec != null || p.sets != null
  if (!hasTargets) return sets
  const out = sets.map(s => {
    if (s.done) return s
    const o = { ...s }
    if (p.weight != null) o.w = p.weight
    if (p.reps != null) o.r = p.reps
    if (p.sec != null) o.sec = p.sec
    return o
  })
  // A policy that decided on a set count gets to grow the list — bodyweight progression adds
  // a set where a barbell would have added a plate. Only ever upwards, and only by copying a
  // row that is already there: a session in progress must not lose a set it has logged.
  if (p.sets > out.length) {
    const seed = out[out.length - 1]
    while (out.length < p.sets) out.push({ ...seed, done: false })
  }
  return out
}
