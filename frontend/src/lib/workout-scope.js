import { buildSets } from './history.js'
import { applyPrescription, nextPrescription } from './progression.js'
import { progressionScopeSnapshot } from './progression-scope.js'
import { targetForPrescription } from './workout-prescription.js'
import { isPureBodyweight } from './exercise-load-mode.js'

export function buildScopedWorkoutEntry(state, config, routine) {
  const plan = nextPrescription(state, config, routine)
  const target = targetForPrescription(config, plan)
  const sets = applyPrescription(buildSets(state, config), plan)
  return {
    id: config.id,
    sg: config.sg,
    ...progressionScopeSnapshot(config),
    target,
    plan,
    // Defence in depth at the persistence boundary. Both builders already enforce this rule,
    // but the workout snapshot must remain safe if a future policy accidentally returns load.
    sets: isPureBodyweight(target) ? sets.map(set => ({ ...set, w: 0 })) : sets
  }
}

export function completedWorkoutEntry(entry) {
  return {
    id: entry.id,
    // A workout started by an older build stays unscoped and therefore readable as legacy
    // baseline. Modern entries retain their exact immutable slot/group snapshot.
    ...progressionScopeSnapshot(entry, { legacyFallback: false }),
    sets: entry.sets,
    topW: entry.topW || null,
    target: entry.target || null
  }
}

export const completedWorkoutEntries = entries =>
  (entries || []).map(completedWorkoutEntry).filter(entry =>
    (entry.sets || []).some(set => set.done)
    // A fully skipped Confirmed prescription is meaningful incomplete history: omitting it
    // would let two top successes on either side combine into a false load increase.
    || entry.target?.prog === 'confirmed_rep_range'
  )
