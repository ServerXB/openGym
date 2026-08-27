import { buildSets } from './history.js'
import { applyPrescription, nextPrescription } from './progression.js'
import { progressionScopeSnapshot } from './progression-scope.js'
import { targetForPrescription } from './workout-prescription.js'

export function buildScopedWorkoutEntry(state, config, routine) {
  const plan = nextPrescription(state, config, routine)
  return {
    id: config.id,
    sg: config.sg,
    ...progressionScopeSnapshot(config),
    target: targetForPrescription(config, plan),
    plan,
    sets: applyPrescription(buildSets(state, config), plan)
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
  )
