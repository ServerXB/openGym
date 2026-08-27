import { bestWeightFor } from './history.js'
import { is1RMRecordForEntries } from './onerm.js'
import { progressionIdOf } from './progression-scope.js'

// Records are global exercise achievements. Independent progression slots with the same
// exercise id therefore contribute together and can produce at most one load PR (or one e1RM
// PR) in the workout summary.
export function recordsForWorkout(S, entries) {
  const byExercise = new Map()
  ;(entries || []).forEach(entry => {
    if (!entry?.id) return
    const group = byExercise.get(entry.id) || []
    group.push(entry)
    byExercise.set(entry.id, group)
  })

  const prs = []
  const e1prs = []
  byExercise.forEach((exerciseEntries, id) => {
    const maxWeight = Math.max(0, ...exerciseEntries.flatMap(entry => (entry.sets || [])
      .filter(set => set.done)
      .map(set => Number(set.w) || 0)))
    const loadRecord = maxWeight > 0 && maxWeight > bestWeightFor(S, id)
    if (loadRecord) prs.push(id)

    // A load record takes precedence in the summary. The e1RM record still exists
    // mathematically, but showing both for the same exercise would describe one achievement
    // twice. This preserves the existing UX while making it deterministic for duplicates.
    const estimateRecord = is1RMRecordForEntries(S, id, exerciseEntries)
    if (estimateRecord && !loadRecord) e1prs.push({ id, ...estimateRecord })
  })

  return { prs, e1prs }
}

// Global best and operational load have different meanings. The PR never decreases; the scoped
// value is the latest confirmed working load and may legitimately go down after a deload/manual
// correction. This prevents one routine's record from becoming another's prescription.
export function applyWorkoutWeights(S, entries, date) {
  S.exWeights = S.exWeights || {}
  S.progressionWeights = S.progressionWeights || {}
  ;(entries || []).forEach(entry => {
    const working = Math.max(
      0,
      ...(entry.sets || []).filter(set => set.done).map(set => Number(set.w) || 0),
      Number(entry.topW) || 0
    )
    if (!(working > 0)) return

    const global = S.exWeights[entry.id]
    if (!global || working > global.w) S.exWeights[entry.id] = { w: working, d: date }

    const progressionId = progressionIdOf(entry)
    if (progressionId) S.progressionWeights[progressionId] = { w: working, d: date }
  })
}
