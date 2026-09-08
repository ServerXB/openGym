// Keep target snapshots identical for routine workouts and exercises added mid-session.
// Finished workouts retain `target` but not the explanatory live `plan`, so every field that
// future progression needs must be copied here in one place.
import { isPureBodyweight } from './exercise-load-mode.js'

const PLAN_TARGET_FIELDS = [
  // These are part of the prescription, not merely of the routine configuration. In
  // particular `inc` is already resolved by the progression engine when the routine leaves
  // it at its default. Keeping it here makes the +/- controls of an active workout stable if
  // the routine (or a default) changes after the workout has started.
  'sets',
  'weight',
  'sec',
  'inc',
  // Confirmed Rep-Range must be auditable from the historical snapshot alone. Materializing
  // normalized bounds/step here also makes legacy routine configs safe for every new workout.
  'minReps',
  'maxReps',
  'rangeStep',
  'setBaselineId',
  'restSeconds',
  'restBaseSeconds',
  'restEpochId',
  'restSource',
  'restReductionStrategy',
  'restSuccessStreak',
  'topRangeStreak'
]

export function targetForPrescription(config = {}, plan = {}) {
  const pureBodyweight = isPureBodyweight(config)
  // Equipment ids belong to the local profile and are resolved separately at workout start.
  // Keeping them out of the prescription avoids duplicating mutable configuration in History.
  const { equipmentUse: _equipmentUse, ...target } = config
  if (plan.policy === 'confirmed_rep_range') target.prog = plan.policy
  if (plan.reps != null) {
    target.reps = plan.reps
    target.targetReps = plan.reps
  }
  for (const field of PLAN_TARGET_FIELDS) {
    if (plan[field] != null) target[field] = plan[field]
  }
  // Final snapshot invariant: an imported/stale plan can never turn a configuration that was
  // explicitly pure when the workout started into an invisibly loaded entry.
  if (pureBodyweight) {
    target.weight = 0
    // In reps mode this is a load increment and has no meaning until added weight is explicitly
    // enabled. Timed bodyweight work keeps `inc`, where it means seconds rather than kilograms.
    if (target.mode !== 'time') {
      delete target.inc
      delete target.weightIncrement
    }
  }
  return target
}

// Active workouts created before the increment snapshot existed can still carry an explicit
// exercise increment in `target`, or the resolved value in their live explanatory `plan`.
// Keep the old 2.5 step as the final fallback so an in-progress legacy workout remains usable.
export function loadIncrementForPrescription(entry = {}, fallback = 2.5) {
  const target = entry.target || {}
  const hasCanonicalTarget = Object.prototype.hasOwnProperty.call(target, 'inc')
  // A resolved live plan is safe even when an old target contains an invalid canonical value.
  // The legacy target field is a fallback only when that target has no canonical property;
  // otherwise `{ inc: 0, weightIncrement: 5 }` would resurrect stale configuration here while
  // the progression engine correctly chooses its established default.
  const candidates = [target.inc, entry.plan?.inc]
  if (!hasCanonicalTarget) candidates.push(target.weightIncrement)
  for (const value of candidates) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return n
  }
  return fallback
}
