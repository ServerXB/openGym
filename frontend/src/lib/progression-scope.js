// Stable identity for a configured exercise.
//
// `id` says which catalogue movement this is. It is intentionally still used by PRs and
// statistics. Progression needs two narrower identities:
//   - routineExerciseId: the stable slot in a routine;
//   - progressionId: the history group used for targets, working load and recovery.
//
// Old workouts have neither field. They remain a read-only shared baseline for their exercise;
// every newly-created workout snapshots both fields, so configurations can diverge safely from
// that point onwards without rewriting history.
import { exOr, isBodyweightEq, isCardio } from './exercises.js'
import { isPureBodyweight } from './exercise-load-mode.js'

export const LEGACY_PROGRESSION_PREFIX = 'exercise:'
export const ROUTINE_EXERCISE_PREFIX = 'routine-exercise:'
export const PROGRESSION_PREFIX = 'progression:'

const nonEmpty = value => typeof value === 'string' && value.trim() ? value.trim() : null
const finite = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
const rounded = (value, fallback = 0) => Math.round(finite(value, fallback) * 100) / 100
const positiveInt = (value, fallback) => Math.max(1, Math.round(finite(value, fallback)))
const safePart = value => encodeURIComponent(String(value ?? ''))

export const legacyProgressionId = exerciseId =>
  (nonEmpty(exerciseId) ? LEGACY_PROGRESSION_PREFIX + exerciseId : null)

export function progressionIdOf(configOrId) {
  if (configOrId && typeof configOrId === 'object') {
    return nonEmpty(configOrId.progressionId) || legacyProgressionId(configOrId.id)
  }
  return legacyProgressionId(configOrId)
}

export const routineExerciseIdOf = config => nonEmpty(config?.routineExerciseId)
export const createRoutineExerciseId = token =>
  ROUTINE_EXERCISE_PREFIX + (nonEmpty(token) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`)

export function progressionScopePreview(state = {}, draft = {}, routine = {}, persisted = null) {
  const signature = progressionConfigSignature(draft, routine, state)
  const slotId = routineExerciseIdOf(persisted || draft)
  const progressionId = nonEmpty((persisted || draft)?.progressionId)
  const peers = (state.routines || []).flatMap(candidateRoutine =>
    (candidateRoutine.ex || []).map(config => ({ routine: candidateRoutine, config }))
  ).filter(peer =>
    peer.routine !== routine
    && peer.config?.id === draft.id
    && (!slotId || routineExerciseIdOf(peer.config) !== slotId)
  )
  const groupPeers = progressionId
    ? peers.filter(peer => progressionIdOf(peer.config) === progressionId)
    : []
  const compatible = peers.filter(peer =>
    progressionConfigSignature(peer.config, peer.routine, state) === signature
    && (!progressionId || progressionIdOf(peer.config) === progressionId)
  )
  return {
    shared: compatible.length > 0,
    separating: groupPeers.length > 0 && compatible.length === 0,
    compatibleRoutines: compatible.map(peer => peer.routine.name || peer.routine.id).filter(Boolean)
  }
}

export function progressionScopeSnapshot(config = {}, { legacyFallback = true } = {}) {
  const routineExerciseId = routineExerciseIdOf(config)
  const progressionId = nonEmpty(config.progressionId)
    || (legacyFallback ? legacyProgressionId(config.id) : null)
  return {
    ...(routineExerciseId ? { routineExerciseId } : {}),
    ...(progressionId ? { progressionId } : {})
  }
}

// Legacy entries intentionally match every descendant scope of their catalogue exercise. They
// are an immutable common baseline. Entries written by the new model match only their exact
// progression group.
export function entryMatchesProgression(entry, exerciseId, progressionId) {
  if (!entry || entry.id !== exerciseId) return false
  const expected = nonEmpty(progressionId)
  if (!expected) return true
  const actual = nonEmpty(entry.progressionId)
  return !actual || actual === expected
}

// A mixed-era workout can contain both an old unscoped occurrence and a newly scoped one. The
// exact identity is stronger evidence and must win even when the legacy row appears first; only
// fall back to the immutable legacy baseline when no exact occurrence exists.
export function findProgressionEntry(entries, exerciseId, progressionId) {
  const list = Array.isArray(entries) ? entries : []
  const expected = nonEmpty(progressionId)
  if (!expected) return list.find(entry => entry?.id === exerciseId) || null
  return list.find(entry =>
    entry?.id === exerciseId && nonEmpty(entry.progressionId) === expected
  ) || list.find(entry =>
    entry?.id === exerciseId && !nonEmpty(entry.progressionId)
  ) || null
}

/**
 * Resolve one entry with the strongest identity available.
 *
 * Pre-scope workouts can still be attributed when their routine survives: one occurrence is
 * unambiguous, while equal occurrence counts can be paired by order. A scope that does not
 * belong to that routine must not consume its history. If the old routine/occurrence can no
 * longer be reconstructed, the entry deliberately remains a shared legacy baseline.
 */
export function findWorkoutProgressionEntry(state, workout, exerciseId, scope) {
  const entries = Array.isArray(workout?.entries) ? workout.entries : []
  const expected = typeof scope === 'string'
    ? nonEmpty(scope)
    : nonEmpty(scope?.progressionId)
  if (!expected) return findProgressionEntry(entries, exerciseId, null)

  const exact = entries.find(entry =>
    entry?.id === exerciseId && nonEmpty(entry.progressionId) === expected
  )
  if (exact) return exact
  const legacy = entries.filter(entry =>
    entry?.id === exerciseId && !nonEmpty(entry.progressionId)
  )
  if (!legacy.length) return null
  if (expected === legacyProgressionId(exerciseId)) return legacy[0]

  const routine = (state?.routines || []).find(candidate =>
    candidate?.id && candidate.id === workout?.routineId
  )
  if (!routine) return legacy[0]
  const slots = (routine.ex || []).filter(config => config?.id === exerciseId)
  if (!slots.length) return legacy[0]
  const slotIndex = slots.findIndex(config => progressionIdOf(config) === expected)
  if (slotIndex < 0) return null
  if (slots.length === 1) return legacy[0]
  return legacy.length === slots.length ? legacy[slotIndex] : legacy[0]
}

const modeFor = config => {
  const explicit = config?.mode
  if (explicit === 'reps' || explicit === 'time' || explicit === 'cardio') return explicit
  return isCardio(config?.id) ? 'cardio' : 'reps'
}

const policyForSignature = (config, routine, mode) => {
  const selected = config?.prog || routine?.prog || (mode === 'reps' ? 'linear' : 'off')
  if (mode === 'cardio') return 'off'
  if (mode === 'time') return selected === 'time' ? 'time' : 'off'
  return ['off', 'linear', 'greyskull', 'double', 'confirmed_rep_range'].includes(selected)
    ? selected
    : 'off'
}

const bound = (value, fallback, step) => {
  const n = positiveInt(value, fallback)
  return Math.ceil(n / step) * step
}

// Canonical effective configuration used only to decide whether two slots share progression.
// Runtime state (targetReps, streaks and recovery epochs) is deliberately excluded.
export function progressionConfigSignature(config = {}, routine = {}, profile = {}) {
  const mode = modeFor(config)
  const policy = policyForSignature(config, routine, mode)
  const sets = positiveInt(config.sets, 1)
  const bodyweight = config.bodyweight == null ? isBodyweightEq(config.id) : !!config.bodyweight
  const explicitEquipmentSemantics = ['total', 'per_implement', 'manual'].includes(config?.equipmentUse?.loadSemantics)
    ? config.equipmentUse.loadSemantics
    : null
  // Before equipment profiles existed, dumbbell/kettlebell values already meant one implement
  // in normal gym logging; other loaded values meant the total. Materializing that legacy
  // meaning keeps an explicit matching selection on the same progression id, while an actual
  // total <-> per-implement change still forks future history safely.
  const catalogEquipment = exOr(config.id).eq
  const equipmentLoadSemantics = mode !== 'cardio' && !isPureBodyweight(config)
    ? explicitEquipmentSemantics || (['dumbbell', 'kettlebell'].includes(catalogEquipment) ? 'per_implement' : 'total')
    : null
  const base = {
    v: 1,
    exerciseId: String(config.id || ''),
    mode,
    policy,
    sets,
    bodyweight,
    side: mode === 'reps' && !!config.side
  }
  if (equipmentLoadSemantics) base.equipmentLoadSemantics = equipmentLoadSemantics

  if (mode === 'cardio') {
    return JSON.stringify({ ...base, minutes: positiveInt(config.min, 20), speed: rounded(config.speed, 8) })
  }
  if (mode === 'time') {
    return JSON.stringify({
      ...base,
      seconds: positiveInt(config.sec, 45),
      weight: Math.max(0, rounded(config.weight, 0)),
      increment: config.inc == null ? null : Math.max(0, rounded(config.inc, 0))
    })
  }

  const reps = positiveInt(config.reps, 10)
  const pureBodyweight = isPureBodyweight(config)
  const hasCanonicalIncrement = Object.prototype.hasOwnProperty.call(config, 'inc')
  const rawIncrement = hasCanonicalIncrement ? config.inc : config.weightIncrement
  const parsedIncrement = Number(rawIncrement)
  const loadConfig = {
    ...base,
    weight: pureBodyweight ? 0 : Math.max(0, rounded(config.weight, 0)),
    // Presence is meaningful: an explicit increment is user configuration, while a missing
    // increment follows the exercise/unit default. Pure bodyweight has no load increment at
    // all, so an invisible stale value must not split otherwise-equivalent progression groups.
    increment: pureBodyweight
      ? 'not_applicable'
      : Number.isFinite(parsedIncrement) && parsedIncrement > 0
        ? Math.max(0.01, rounded(parsedIncrement, 0))
        : 'default'
  }

  if (policy === 'confirmed_rep_range') {
    const step = loadConfig.side ? 2 : 1
    const minReps = bound(config.minReps ?? config.repsMin, 8, step)
    const maxReps = Math.max(minReps, bound(config.maxReps ?? config.repsMax, 12, step))
    const restSeconds = Math.max(0, Math.round(finite(
      config.restSeconds ?? profile.restSec ?? 90,
      90
    )))
    const maxRestSeconds = Math.max(
      restSeconds,
      Math.round(finite(config.maxRestSeconds ?? 240, 240))
    )
    return JSON.stringify({
      ...loadConfig,
      minReps,
      maxReps,
      ...(nonEmpty(config.setBaselineId) ? { setBaselineId: nonEmpty(config.setBaselineId) } : {}),
      restSeconds,
      maxRestSeconds,
      restReductionStrategy: config.restReductionStrategy === 'auto_after_successes'
        ? 'auto_after_successes'
        : 'manual'
    })
  }

  if (policy === 'double') {
    return JSON.stringify({
      ...loadConfig,
      reps,
      repsMin: positiveInt(config.repsMin, Math.max(1, reps - 2)),
      repsMax: positiveInt(config.repsMax, reps)
    })
  }
  return JSON.stringify({ ...loadConfig, reps })
}

const defaultRoutineExerciseId = (routine, routineIndex, exerciseIndex) => {
  const routinePart = nonEmpty(routine?.id) || `index-${routineIndex}`
  return `${ROUTINE_EXERCISE_PREFIX}${safePart(routinePart)}:${exerciseIndex}`
}

/**
 * Backfill and reconcile routine slot identities in-place.
 *
 * Unchanged explicit groups are preserved. A slot whose effective progression configuration
 * changes joins an already-compatible group in another routine, or receives a fresh group.
 * Two occurrences of the same exercise inside one routine never share a group with each other.
 */
export function normalizeProgressionScopes(state = {}) {
  const routines = Array.isArray(state.routines) ? state.routines : []
  const usedSlotIds = new Set()
  // Missing legacy ids are derived from routine/index. Reserve every explicit id first so an
  // earlier legacy slot cannot steal a later slot's persisted identity during mixed JSON load.
  const reservedExplicitSlotIds = new Set(routines.flatMap(routine =>
    (Array.isArray(routine?.ex) ? routine.ex : [])
      .map(routineExerciseIdOf)
      .filter(Boolean)
  ))
  ;(state.active?.entries || []).forEach(entry => {
    const activeSlotId = routineExerciseIdOf(entry)
    if (activeSlotId) reservedExplicitSlotIds.add(activeSlotId)
  })
  const records = []

  routines.forEach((routine, routineIndex) => {
    const exercises = Array.isArray(routine?.ex) ? routine.ex : []
    exercises.forEach((config, exerciseIndex) => {
      if (!config || typeof config !== 'object' || !nonEmpty(config.id)) return
      const activeAtPosition = state.active?.routineId === routine?.id
        ? state.active.entries?.[exerciseIndex]
        : null
      const recoveredActiveSlotId = activeAtPosition?.id === config.id
        ? routineExerciseIdOf(activeAtPosition)
        : null
      const explicit = routineExerciseIdOf(config) || recoveredActiveSlotId
      const preferred = explicit || defaultRoutineExerciseId(routine, routineIndex, exerciseIndex)
      let routineExerciseId
      if (explicit && !usedSlotIds.has(explicit)) {
        routineExerciseId = explicit
        usedSlotIds.add(explicit)
      } else {
        let candidate = preferred
        let suffix = 2
        while (usedSlotIds.has(candidate) || reservedExplicitSlotIds.has(candidate)) {
          candidate = `${preferred}:${suffix++}`
        }
        routineExerciseId = candidate
        usedSlotIds.add(candidate)
      }
      config.routineExerciseId = routineExerciseId
      const configuredProgressionId = nonEmpty(config.progressionId)
      // Snapshot recovery is a one-time repair path for partial/legacy JSON. Do not rescan an
      // entire long workout history on every set edit once the routine already has its id.
      const scopedSnapshot = configuredProgressionId
        ? null
        : [state.active, ...[...(state.workouts || [])].reverse()]
          .filter(Boolean)
          .find(workout =>
            workout?.routineId === routine?.id
            && (workout.entries || []).some(entry =>
              entry?.routineExerciseId === routineExerciseId
              && entry?.id === config.id
              && nonEmpty(entry.progressionId)
            )
          )
      const snapshotMatch = configuredProgressionId
        ? null
        : (scopedSnapshot?.entries || []).find(entry =>
          entry?.routineExerciseId === routineExerciseId
          && entry?.id === config.id
          && nonEmpty(entry.progressionId)
        )
      records.push({
        routine,
        routineIndex,
        exerciseIndex,
        config,
        exerciseId: config.id,
        routineExerciseId,
        signature: progressionConfigSignature(config, routine, state),
        // During a server pull the local active workout is deliberately preserved. If the
        // incoming routine predates scope ids, reconnect it to the matching active slot rather
        // than forking away from the workout that is still being performed.
        previousProgressionId: configuredProgressionId
          || nonEmpty(snapshotMatch?.progressionId),
        previousSignature: nonEmpty(config.progressionSignature)
      })
    })
  })

  const reservedProgressionIds = new Set([
    ...records.map(record => record.previousProgressionId).filter(Boolean),
    ...Object.keys(state.progressionWeights || {}),
    ...Object.keys(state.progressionControls || {})
  ])
  ;[...(state.workouts || []), state.active].filter(Boolean).forEach(workout => {
    ;(workout.entries || []).forEach(entry => {
      const progressionId = nonEmpty(entry?.progressionId)
      if (progressionId) reservedProgressionIds.add(progressionId)
    })
  })
  const freshProgressionId = record => {
    const base = `${PROGRESSION_PREFIX}${record.routineExerciseId}`
    let candidate = base
    let suffix = 2
    while (reservedProgressionIds.has(candidate)) candidate = `${base}:${suffix++}`
    reservedProgressionIds.add(candidate)
    return candidate
  }

  // Preserve one coherent partition of every existing group. A configuration edit on an
  // already-independent slot therefore keeps its history. When a shared group diverges, the
  // unchanged partition keeps the old id and only the divergent slot is forked.
  const assigned = []
  const groupUse = new Map()
  const existingGroups = new Map()
  records.forEach(record => {
    if (!record.previousProgressionId) return
    const group = existingGroups.get(record.previousProgressionId) || []
    group.push(record)
    existingGroups.set(record.previousProgressionId, group)
  })
  existingGroups.forEach((group, pid) => {
    const partitions = new Map()
    group.forEach(record => {
      const partition = partitions.get(record.signature) || []
      partition.push(record)
      partitions.set(record.signature, partition)
    })
    const keeper = [...partitions.values()].sort((a, b) => {
      const aUnchanged = a.filter(record => record.previousSignature === record.signature).length
      const bUnchanged = b.filter(record => record.previousSignature === record.signature).length
      return bUnchanged - aUnchanged || b.length - a.length
    })[0] || []
    const uses = []
    keeper.forEach(record => {
      if (uses.some(other => other.routine === record.routine && other.exerciseId === record.exerciseId)) return
      record.progressionId = pid
      uses.push(record)
      assigned.push(record)
    })
    if (uses.length) groupUse.set(pid, uses)
  })

  records.forEach(record => {
    if (record.progressionId) return
    // Share by default only across different routines. A duplicate in this routine must remain
    // independently addressable even if its visible configuration is identical.
    const candidate = assigned.find(other =>
      other.exerciseId === record.exerciseId
      && other.signature === record.signature
      && other.routine !== record.routine
      && !(groupUse.get(other.progressionId) || []).some(use => use.routine === record.routine)
    )
    const progressionId = candidate?.progressionId || freshProgressionId(record)
    record.progressionId = progressionId
    const uses = groupUse.get(progressionId) || []
    uses.push(record)
    groupUse.set(progressionId, uses)
    assigned.push(record)
  })

  state.progressionWeights = state.progressionWeights && typeof state.progressionWeights === 'object'
    ? state.progressionWeights
    : {}

  const progressionGroupsByExercise = new Map()
  records.forEach(record => {
    const groups = progressionGroupsByExercise.get(record.exerciseId) || new Set()
    groups.add(record.progressionId)
    progressionGroupsByExercise.set(record.exerciseId, groups)
  })

  records.forEach(record => {
    const { config, progressionId, signature, previousProgressionId, exerciseId } = record
    config.progressionId = progressionId
    config.progressionSignature = signature

    // Preserve the user's current operational load while opening a new isolated history group.
    // Prefer the previous exact group, then the legacy global hint used by old openGym builds.
    if (!isPureBodyweight(config) && !state.progressionWeights[progressionId]) {
      const seed = previousProgressionId && state.progressionWeights[previousProgressionId]
        ? state.progressionWeights[previousProgressionId]
        // A legacy global hint is attributable only when the exercise has one effective group.
        // With divergent 70/100 kg configurations it is ambiguous (and usually the PR), so each
        // group must instead start from its own config or routine-attributed workout history.
        : progressionGroupsByExercise.get(exerciseId)?.size === 1
          ? state.exWeights?.[exerciseId]
          : null
      if (seed && Number.isFinite(Number(seed.w)) && Number(seed.w) >= 0) {
        state.progressionWeights[progressionId] = { ...seed, w: Number(seed.w) }
      }
    }
  })

  return state
}
