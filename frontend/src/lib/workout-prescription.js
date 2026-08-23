// Keep target snapshots identical for routine workouts and exercises added mid-session.
// Finished workouts retain `target` but not the explanatory live `plan`, so every field that
// future progression needs must be copied here in one place.
const PLAN_TARGET_FIELDS = [
  'restSeconds',
  'restBaseSeconds',
  'restEpochId',
  'restSource',
  'restReductionStrategy',
  'restSuccessStreak',
  'topRangeStreak'
]

export function targetForPrescription(config = {}, plan = {}) {
  const target = { ...config }
  if (plan.policy === 'confirmed_rep_range') target.prog = plan.policy
  if (plan.reps != null) {
    target.reps = plan.reps
    target.targetReps = plan.reps
  }
  for (const field of PLAN_TARGET_FIELDS) {
    if (plan[field] != null) target[field] = plan[field]
  }
  return target
}
