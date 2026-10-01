import { confirmedRepRangeConfig } from './confirmedRepRangeConfig.js'
import { exerciseLoadMode, LOAD_MODE } from './exercise-load-mode.js'
import { progressionIdOf } from './progression-scope.js'
import { repStep } from './history.js'

// Only explicitly accepted reductions create a load epoch. No migration of old workouts,
// timestamp inference or automatic deload is performed by this reader.
export function confirmedLoadProgressionKey(config, restSec) {
  const normalized = confirmedRepRangeConfig(config, restSec)
  const step = repStep({ ...config, ...normalized })
  return `${normalized.minReps}:${normalized.maxReps}:${step}|sets:${config.setBaselineId || 'legacy'}|load:${exerciseLoadMode(config)}`
}

export function confirmedRepRangeLoadControl(state, config) {
  const control = state?.progressionControls?.[progressionIdOf(config)]?.confirmedRepRangeLoad
  if (!control || typeof control.epochId !== 'string' || !control.epochId.trim()
    || !Number.isFinite(control.baselineWeight) || control.baselineWeight <= 0
    || !Number.isFinite(control.resetAt) || control.resetAt < 0
    || control.reason !== 'stall'
    || control.progressionKey !== confirmedLoadProgressionKey(config, state.restSec)
    || control.loadMode !== exerciseLoadMode(config)
    || control.loadMode === LOAD_MODE.PURE_BODYWEIGHT
    || (control.plannedSets != null && control.plannedSets !== Number(config.sets))) return null
  return control
}
