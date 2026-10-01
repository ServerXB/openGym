import { confirmedRepRangeSession, loadIncrementFor, nextPrescription, roundLoad } from './progression.js'
import { confirmedRepRangeConfig } from './confirmedRepRangeConfig.js'
import { exerciseLoadMode, LOAD_MODE } from './exercise-load-mode.js'
import { findWorkoutProgressionEntry, progressionConfigSignature } from './progression-scope.js'
import { calculateLoadingGuide, normalizeEquipmentProfile, resolveEquipmentUse, snapshotActiveEquipmentProfile } from './equipment-load.js'
import { repStep } from './history.js'
import { exOr } from './exercises.js'

// Versioned product policy, not a clinically validated threshold or a medical diagnosis.
export const CONFIRMED_STALL_POLICY = 'confirmed_stall_assistant_v1'
export const CONFIRMED_STALL_VERSION = 1
export const CONFIRMED_STALL_NUMERIC_THRESHOLD = 3
export const CONFIRMED_STALL_TECHNIQUE_THRESHOLD = 2
export const CONFIRMED_STALL_LONG_GAP_MS = 28 * 24 * 60 * 60 * 1000
export const CONFIRMED_STALL_REDUCTION = 0.075

const finite = value => typeof value !== 'boolean' && value != null && value !== '' && Number.isFinite(Number(value))
const same = (a, b) => finite(a) && finite(b) && Math.abs(Number(a) - Number(b)) < 1e-8
const techniqueOf = entry => ['clean', 'degraded'].includes(entry?.review?.technique) ? entry.review.technique : 'unknown'
const dateOf = workout => {
  // Native snapshots own end/start; ISO-only legacy dates are a final fallback.
  // Invalid optional timestamps must not mask a usable native start or date.
  for (const raw of [workout.end, workout.endedAt, workout.finishedAt, workout.start, workout.startedAt, workout.d]) {
    if (raw == null || raw === '' || typeof raw === 'boolean') continue
    const parsed = typeof raw === 'number' ? raw : Date.parse(raw)
    if (Number.isFinite(parsed) && Number.isFinite(new Date(parsed).getTime())) return parsed
  }
  return null
}
const scoreOf = (entry, session) => {
  const reps = entry.sets.slice(0, session.planned).map(set => Math.max(0, Number(set.r) || 0))
  return [Math.min(session.goal, ...reps), reps.filter(value => value >= session.goal).length,
    reps.reduce((total, value) => total + Math.min(session.goal, value), 0)]
}
const improves = (next, previous) => {
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== previous[i]) return next[i] > previous[i]
  }
  return false
}
const hash = value => {
  let result = 2166136261
  for (const char of JSON.stringify(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619)
  return (result >>> 0).toString(36)
}
const equipmentKey = (use, profile) => {
  if (!use || ['no_profile', 'disabled', 'bodyweight'].includes(use.status)) return 'none'
  const normalized = normalizeEquipmentProfile(profile)
  const item = normalized?.items?.find(candidate => candidate.id === use.itemId)
  return JSON.stringify([use.status, use.profileId, use.itemId, use.loadSemantics, use.implementCount,
    item?.kind, item?.tareWeight, item?.sideCount, item?.catalogEquipment,
    normalized?.unit, profile?.workoutUnit || normalized?.unit])
}
const assisted = (cfg, use) => exOr(cfg?.id)?.eq === 'assisted' || cfg?.assisted === true || cfg?.loadMode === 'assisted'
  || cfg?.loadSemantics === 'assistance' || use?.loadSemantics === 'assistance'
const equipmentContext = (state, supplied, cfg) => {
  if (!supplied) {
    const profile = snapshotActiveEquipmentProfile(state)
    if (!profile) return null
    return { profile, equipmentUse: resolveEquipmentUse({ profile, config: cfg,
      catalogEquipment: exOr(cfg.id)?.eq, loadMode: exerciseLoadMode(cfg) }) }
  }
  const use = supplied.equipmentUse || supplied
  const profile = supplied.profile || state.equipmentProfiles?.find(candidate => candidate.id === (use.profileId || state.activeEquipmentProfileId))
  return { equipmentUse: use, profile }
}
const routineFor = (state, cfg) => state.routines?.find(routine => routine.ex?.some(slot =>
  slot.id === cfg.id && slot.progressionId === cfg.progressionId
  && (!cfg.routineExerciseId || slot.routineExerciseId === cfg.routineExerciseId)))

function recordFor(state, cfg, workout) {
  const entry = findWorkoutProgressionEntry(state, workout, cfg.id, cfg.progressionId)
  if (!entry) return null
  const session = confirmedRepRangeSession(entry, cfg)
  const technique = techniqueOf(entry)
  const failureReason = entry.review?.failureReason || null
  const date = dateOf(workout)
  const eligible = entry.progressionId === cfg.progressionId && !!workout.id && date != null
    && workout.entries.filter(e => e.id === cfg.id && e.progressionId === cfg.progressionId).length === 1
    && entry.target?.prog === 'confirmed_rep_range' && entry.target.stallDetectionVersion === CONFIRMED_STALL_VERSION
    && session.rangeKnown && session.complete && session.loadUniform && session.goal > 0
    && entry.sets.slice(0, session.planned).every(set => finite(set.r) && Number(set.r) >= 0)
    && same(session.workingWeight, session.prescribedWeight)
    && session.prescribedRestSeconds != null && session.restBaseSeconds != null
    && !['pain', 'equipment', 'time', 'illness'].includes(failureReason)
    && !assisted(entry.target, entry.equipmentUse)
  const equipment = equipmentKey(entry.equipmentUse, workout.equipmentSnapshot)
  const epoch = entry.target?.loadEpochId || null
  const signature = JSON.stringify([session.progressionKey, session.goal, session.planned, session.workingWeight,
    session.prescribedRestSeconds, session.restBaseSeconds, session.restEpochId, epoch, equipment])
  const successful = session.ok && technique !== 'degraded' && failureReason !== 'technique'
  return { workout, entry, session, technique, failureReason, date, eligible, equipment, epoch, signature, successful,
    score: eligible ? scoreOf(entry, session) : null }
}

function proposalFor(state, cfg, fromWeight, preferredWeight, context) {
  const increment = loadIncrementFor(cfg, state.unit || 'kg')
  // The increment is a DELTA from the current load, not an absolute zero-anchored grid.
  const steps = Math.max(1, Math.ceil((fromWeight * CONFIRMED_STALL_REDUCTION - 1e-8) / increment))
  let weight = preferredWeight ?? roundLoad(fromWeight - steps * increment)
  // A zero result changes added-bodyweight semantics to unloaded work and can imply set
  // progression. That is an exercise/configuration choice, never a silent load reset.
  if (!(weight > 0) || weight >= fromWeight) return { weight: null, explanation: 'no_lower_load' }
  let guide = null
  if (context?.equipmentUse?.status === 'resolved') {
    guide = calculateLoadingGuide({ ...context, targetWeight: weight, workoutUnit: state.unit || 'kg' })
    if (guide.status === 'nearest') weight = guide.lower?.weight ?? null
    else if (guide.status === 'exact') weight = guide.exact.weight
    else if (!['manual_per_side', 'manual', 'no_load'].includes(guide.status)) return { weight: null, guide, explanation: guide.status }
  }
  if (context && !['resolved', 'disabled', 'no_profile', 'bodyweight'].includes(context.equipmentUse?.status)) {
    return { weight: null, guide, explanation: 'equipment_unavailable' }
  }
  if (!finite(weight) || weight <= 0 || weight >= fromWeight) return { weight: null, guide, explanation: 'no_lower_load' }
  return { weight: roundLoad(weight), guide, explanation: preferredWeight != null ? 'return_to_successful_load' : 'product_policy_reduction' }
}

/** Read only completed, post-activation evidence; never inspect or mutate an active workout. */
export function assessConfirmedStall(state = {}, cfg = {}, nextPlan = {}, { now = Date.now(), equipmentUse = null } = {}) {
  const result = { policy: CONFIRMED_STALL_POLICY, status: 'none', reason: null, assessmentId: null,
    evidenceWorkoutIds: [], evidence: [], count: 0, fromWeight: null, proposedWeight: null,
    effectiveReductionPercent: null, minReps: null, progressionId: cfg.progressionId || null,
    progressionKey: null, loadMode: exerciseLoadMode(cfg), sharedRoutineNames: [], canApply: false, explanation: null }
  if (!cfg.progressionId || nextPlan.policy !== 'confirmed_rep_range' || assisted(cfg, equipmentUse)) return result
  const normalized = confirmedRepRangeConfig(cfg, state.restSec)
  const key = `${normalized.minReps}:${normalized.maxReps}:${repStep({ ...cfg, ...normalized })}|sets:${cfg.setBaselineId || 'legacy'}|load:${result.loadMode}`
  result.progressionKey = key
  result.minReps = normalized.minReps
  result.sharedRoutineNames = (state.routines || []).filter(routine => routine.ex?.some(slot =>
    slot.id === cfg.id && slot.progressionId === cfg.progressionId)).map(routine => routine.name || routine.id).filter(Boolean)
  const seen = new Set()
  const rows = (state.workouts || []).filter(workout => {
    if (workout.id === state.active?.id || seen.has(workout.id)) return false
    seen.add(workout.id); return true
  })
    .map(workout => recordFor(state, cfg, workout)).filter(Boolean)
  const last = rows.at(-1)
  if (!last?.eligible || last.successful || last.session.progressionKey !== key) return result
  const currentEpoch = nextPlan.loadEpochId || null
  const currentRestEpoch = nextPlan.restEpochId || null
  if (last.epoch !== currentEpoch || last.session.restEpochId !== currentRestEpoch
    || last.session.planned !== Number(nextPlan.sets ?? cfg.sets)
    || !same(last.session.goal, nextPlan.reps)
    || !same(last.session.workingWeight, nextPlan.weight ?? cfg.weight)
    || !same(last.session.restBaseSeconds, normalized.restSeconds)
    || !same(last.session.prescribedRestSeconds, nextPlan.restSeconds)
    || !finite(now) || now < last.date || now - last.date > CONFIRMED_STALL_LONG_GAP_MS) return result
  // A pending recovery increase owns this step. A technical miss is not a recovery miss.
  if (last.technique !== 'degraded' && last.failureReason !== 'technique'
    && last.session.firstHit && last.session.laterMiss && last.session.prescribedRestSeconds < normalized.maxRestSeconds) {
    return { ...result, explanation: 'recovery_priority' }
  }
  const context = equipmentContext(state, equipmentUse, cfg)
  if (equipmentKey(context?.equipmentUse, context?.profile) !== last.equipment) return result
  let numeric = []
  let technical = []
  let comparable = []
  let previous = null
  for (const row of rows) {
    if (!row.eligible || row.signature !== last.signature || row.successful
      || (previous && (row.date < previous.date || row.date - previous.date > CONFIRMED_STALL_LONG_GAP_MS))) {
      numeric = []; technical = []; comparable = []; previous = row
      if (!row.eligible || row.signature !== last.signature || row.successful) continue
    }
    comparable.push(row)
    if (numeric.length && improves(row.score, numeric.at(-1).score)) numeric = []
    numeric.push(row)
    if (row.technique === 'degraded' || row.failureReason === 'technique') technical.push(row)
    else technical = []
    previous = row
  }
  if (!numeric.length) return result
  let reason = technical.length >= CONFIRMED_STALL_TECHNIQUE_THRESHOLD ? 'technique_stall'
    : numeric.length >= CONFIRMED_STALL_NUMERIC_THRESHOLD ? 'numeric_stall' : null
  let evidence = reason === 'technique_stall' ? technical : numeric
  let preferredWeight = null
  // Only the uninterrupted exposures immediately following a successful lower load qualify.
  const start = rows.indexOf(comparable[0])
  const prior = start > 0 ? rows[start - 1] : null
  const beforeIncrease = prior ? nextPrescription({ ...state,
    workouts: state.workouts.slice(0, state.workouts.indexOf(comparable[0].workout))
  }, cfg, routineFor(state, cfg)) : null
  if (comparable.length >= 2 && comparable.every(row => row.session.minCompletedReps < normalized.minReps)
    && last.session.goal === normalized.minReps && prior?.eligible && prior.successful
    && prior.session.progressionKey === key && prior.equipment === last.equipment && prior.epoch === last.epoch
    && prior.session.restEpochId === last.session.restEpochId
    && prior.session.restBaseSeconds === last.session.restBaseSeconds
    && prior.session.planned === last.session.planned
    && last.date - prior.date <= CONFIRMED_STALL_LONG_GAP_MS
    && beforeIncrease?.kind === 'up' && beforeIncrease.reps === normalized.minReps
    && same(beforeIncrease.weight, last.session.workingWeight)
    && same(prior.session.workingWeight + loadIncrementFor(cfg, state.unit || 'kg'), last.session.workingWeight)) {
    reason = 'post_increase_failure'; evidence = comparable; preferredWeight = prior.session.workingWeight
  }
  const proposed = reason ? proposalFor(state, cfg, last.session.workingWeight, preferredWeight, context) : null
  const pure = result.loadMode === LOAD_MODE.PURE_BODYWEIGHT
  result.status = reason ? (pure || proposed.weight == null ? 'manual_review' : 'proposed')
    : technical.length ? 'technique_warning' : numeric.length >= 2 ? 'observe' : 'none'
  result.reason = reason
  result.count = evidence.length
  result.fromWeight = last.session.workingWeight
  result.proposedWeight = pure ? null : proposed?.weight ?? null
  result.effectiveReductionPercent = result.proposedWeight != null && result.fromWeight > 0
    ? roundLoad((result.fromWeight - result.proposedWeight) / result.fromWeight * 100) : null
  result.explanation = pure && reason ? 'review_bodyweight_variation' : proposed?.explanation || null
  result.canApply = result.status === 'proposed'
  result.evidenceWorkoutIds = evidence.map(row => row.workout.id)
  result.evidence = evidence.map(row => ({ workoutId: row.workout.id, date: row.date,
    routineId: row.workout.routineId || null,
    routineName: row.workout.name || row.workout.routineName || state.routines?.find(routine => routine.id === row.workout.routineId)?.name || null,
    reps: row.entry.sets.slice(0, row.session.planned).map(set => Number(set.r)), weight: row.session.workingWeight,
    goal: row.session.goal, restSeconds: row.session.prescribedRestSeconds, technique: row.technique,
    failureReason: row.failureReason, score: row.score }))
  result.equipmentUse = equipmentUse
  result.assessmentId = `${CONFIRMED_STALL_POLICY}:${hash([cfg.progressionId, last.signature, reason,
    result.proposedWeight, result.evidence])}`
  const saved = state.progressionControls?.[cfg.progressionId]?.confirmedRepRangeStall
  if (saved?.assessmentId === result.assessmentId && ['dismissed', 'snoozed', 'accepted'].includes(saved.status)) {
    result.status = saved.status === 'accepted' ? 'none' : saved.status
    result.canApply = false
  }
  return result
}

function freshAssessment(state, cfg, assessment, now) {
  if (!assessment?.assessmentId || assessment.progressionId !== cfg.progressionId) return null
  const savedRoutine = routineFor(state, cfg)
  const saved = savedRoutine?.ex?.find(slot => slot.id === cfg.id && slot.progressionId === cfg.progressionId
    && (!cfg.routineExerciseId || slot.routineExerciseId === cfg.routineExerciseId))
  if (saved && progressionConfigSignature(saved, savedRoutine, state) !== progressionConfigSignature(cfg, savedRoutine, state)) return null
  if (saved) cfg = saved
  const plan = nextPrescription(state, cfg, routineFor(state, cfg))
  // Decisions re-resolve today's equipment, never a profile captured by an old dialog.
  const fresh = assessConfirmedStall(state, cfg, plan, { now })
  return fresh.assessmentId === assessment.assessmentId ? fresh : null
}
const controlRecord = (assessment, status, now) => ({
  assessmentId: assessment.assessmentId, status, evidenceWorkoutIds: [...assessment.evidenceWorkoutIds],
  reason: assessment.reason, fromWeight: assessment.fromWeight, proposedWeight: assessment.proposedWeight,
  effectiveReductionPercent: assessment.effectiveReductionPercent, updatedAt: now
})

/** Confirmation changes a future control only. Finished/active workouts and tracked PRs are shared untouched. */
export function applyConfirmedStall(state, cfg, assessment, { now = Date.now(), epochId } = {}) {
  if (state.active?.entries?.some(entry => entry.id === cfg.id && entry.progressionId === cfg.progressionId
    && ['pain', 'illness'].includes(entry.review?.failureReason))) return state
  const fresh = freshAssessment(state, cfg, assessment, now)
  if (!fresh?.canApply || !finite(now)) return state
  const epoch = typeof epochId === 'string' && epochId ? epochId : `load:${fresh.assessmentId}:${Math.round(now)}`
  const sibling = state.progressionControls?.[cfg.progressionId] || {}
  return { ...state, progressionControls: { ...state.progressionControls, [cfg.progressionId]: {
    ...sibling,
    confirmedRepRangeStall: controlRecord(fresh, 'accepted', now),
    confirmedRepRangeLoad: { epochId: epoch, baselineWeight: fresh.proposedWeight, resetAt: now,
      reason: 'stall', sourceWorkoutIds: [...fresh.evidenceWorkoutIds], progressionKey: fresh.progressionKey,
      loadMode: fresh.loadMode }
  } } }
}

/** Snooze, like dismissal, expires only when new/changed evidence creates a different assessment. */
export function dismissConfirmedStall(state, cfg, assessment, { snooze = false, now = Date.now() } = {}) {
  const fresh = freshAssessment(state, cfg, assessment, now)
  if (!fresh || !['proposed', 'manual_review', 'observe', 'technique_warning'].includes(fresh.status)) return state
  return { ...state, progressionControls: { ...state.progressionControls, [cfg.progressionId]: {
    ...state.progressionControls?.[cfg.progressionId],
    confirmedRepRangeStall: controlRecord(fresh, snooze ? 'snoozed' : 'dismissed', now)
  } } }
}
