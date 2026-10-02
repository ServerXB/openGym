import { useEffect, useId, useMemo, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { recentExerciseSessions } from '../lib/exercise-session-history.js'
import { LOAD_MODE } from '../lib/exercise-load-mode.js'
import { exOr } from '../lib/exercises.js'
import { fmtLoad, fmtNum } from '../lib/format.js'
import { fmtSec } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { workoutChronologyParts } from '../lib/workout-time.js'
import { isOptionalSet } from '../lib/workout-set-status.js'

const number = value => value != null && value !== '' && typeof value !== 'boolean'
  && Number.isFinite(Number(value)) ? Number(value) : null
const measurement = value => number(value) == null ? '—' : fmtNum(value)
const duration = value => number(value) == null ? '—' : fmtSec(value)

function loadLabel(value, row) {
  const weight = number(value)
  if (row.loadMode === LOAD_MODE.PURE_BODYWEIGHT) return t('Bodyweight')
  if (row.loadMode === LOAD_MODE.ADDED_BODYWEIGHT) {
    return `${t('Bodyweight')} · ${weight == null ? t('Load not recorded') : `+${fmtLoad(weight)} ${row.unit}`}`
  }
  return weight == null ? t('Load not recorded') : `${fmtLoad(weight)} ${row.unit}`
}

function repsLabel(value, side) {
  const reps = `${measurement(value)} ${t('Reps')}`
  return side && number(value) != null ? `${reps} · ${t('{0} per side', fmtNum(value / 2))}` : reps
}

// These summaries read only the historical snapshot. Missing values stay unknown;
// routine defaults would silently invent a target for an older imported workout.
export function sessionTargetLabel(row) {
  const target = row.target
  if (!target) return t('Historical target unavailable')
  const sets = number(target.sets)
  const count = sets > 0 ? fmtNum(sets) : '—'
  if (row.mode === 'cardio') return `${count} × ${measurement(target.min)} min · ${measurement(target.speed)} km/h`
  const work = row.mode === 'time'
    ? duration(target.sec)
    : repsLabel(target.targetReps ?? target.reps, target.side)
  const rest = number(target.restSeconds)
  return `${count} × ${work} · ${loadLabel(target.weight, row)}${rest == null ? '' : ` · ${t('{0}s recovery', fmtNum(rest))}`}`
}

export function sessionSetLabel(row, set = {}) {
  const effort = ['rir', 'rpe'].filter(key => number(set[key]) != null)
    .map(key => `${t(key.toUpperCase())} ${fmtNum(set[key])}`)
  const work = row.mode === 'cardio'
    ? `${measurement(set.min)} min · ${measurement(set.speed)} km/h`
    : `${row.mode === 'time' ? duration(set.sec) : repsLabel(set.r, row.target?.side)} · ${loadLabel(set.w, row)}`
  return [work, ...effort].join(' · ')
}

export function sessionOutcomeLabel(row) {
  if (row.outcome === 'progression_earned') return t(row.progressionEarned === 'sets'
    ? 'Extra set earned — confirmation 2 of 2'
    : row.progressionEarned === 'variation' ? 'Harder variation earned — confirmation 2 of 2'
      : 'Weight increase earned — confirmation 2 of 2')
  const labels = {
    success: 'Successful', legacy_success: 'Successful', below_range_success: 'Successful',
    maximum_first: 'Maximum reached — confirmation 1 of 2',
    maximum_recovery: 'Maximum reached — confirmation 0 of 2; recovery above base',
    maximum_unverified: 'Maximum reached — confirmations not determinable',
    failed: 'Target not reached', incomplete: 'Incomplete session',
    mixed_load: 'Load changed between sets', unknown: 'Outcome not determinable',
    technique_failed: 'Technique compromised — progression not confirmed',
    interrupted: 'Exercise interrupted', recorded: 'Activity recorded'
  }
  return t(labels[row.outcome] || labels.unknown)
}

export function ExerciseSessionCard({ row }) {
  const chronology = workoutChronologyParts(row.workout).join(' · ') || t('Unknown date')
  const sets = Array.isArray(row.entry.sets) ? row.entry.sets : []
  const equipment = row.equipment
  return <article className="session-history-card" data-session-history-card data-workout-id={row.workoutId}>
    <header>
      <h3>{chronology}</h3>
      <p className="session-history-routine">{row.routineName || (row.routineId ? t('Routine name unavailable') : t('Freestyle'))}</p>
    </header>
    {row.shared && <p className="session-history-notice">{t('Shared progression')}</p>}
    {row.scopeKind === 'legacy_shared' && <p className="session-history-notice">{t('History from before progressions were separated')}</p>}
    <p><strong>{t('Historical target')}</strong><br />{sessionTargetLabel(row)}</p>
    <p className="session-history-recorded"><strong>{t('Recorded sets')}</strong></p>
    {sets.length ? <ol className="session-history-sets">
      {sets.map((set, index) => <li key={index}>
        <span>{sessionSetLabel(row, set || {})}</span>
        <span className="session-history-set-status">
          {t(set?.done ? 'Completed set' : 'Set not completed')}
          {isOptionalSet(row.entry, index) ? ` · ${t('Optional')}` : ''}
        </span>
      </li>)}
    </ol> : <p className="muted">{t('No recorded sets')}</p>}
    {number(row.entry.topW) != null && <p className="session-history-confirmed">{t('Confirmed weight')}: {fmtLoad(row.entry.topW)} {row.unit}</p>}
    <p className="session-history-outcome" data-history-outcome={row.outcome}>{sessionOutcomeLabel(row)}</p>
    {equipment && <p className="session-history-equipment">
      <strong>{t('Historical equipment')}</strong>: {equipment.label || t('Equipment name unavailable')}
      {equipment.profileName ? ` · ${equipment.profileName}` : ''}
      {number(equipment.tareWeight) != null ? ` · ${t('Tare: {0} {1}', fmtLoad(equipment.tareWeight), equipment.unit)}` : ''}
      {equipment.loadSemantics === 'per_implement' ? ` · ${t('Load per implement')}` : ''}
    </p>}
    {row.unitInferred && row.mode !== 'cardio' && <p className="small muted">{t('Historical unit unavailable; shown in {0}.', row.unit)}</p>}
  </article>
}

// Clone once on opening: live deletion/sync may update the records, but neither switching
// the active slot nor editing its routine may retarget an already open history sheet.
export function exerciseHistoryContext(state, entryIdx) {
  const entry = state.active?.entries?.[entryIdx]
  if (!entry) return null
  return {
    entry: structuredClone(entry),
    active: { id: state.active.id, routineId: state.active.routineId },
    name: entry.name || exOr(entry.id).n
  }
}

export function ExerciseSessionHistorySheet({ context, close, returnFocus }) {
  const workouts = useStore(store => store.S.workouts)
  const routines = useStore(store => store.S.routines)
  const unit = useStore(store => store.S.unit)
  const rows = useMemo(() => recentExerciseSessions({ workouts, routines, unit, active: context.active }, context.entry),
    [workouts, routines, unit, context])
  const titleId = useId()
  const dialog = useRef(null)
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const container = dialog.current
    const previousFocus = returnFocus || document.activeElement
    const controls = () => [...container.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')]
      .filter(node => node.getClientRects().length > 0)
    ;(controls()[0] || container).focus()
    const onKey = event => {
      if ([...document.querySelectorAll('[role="dialog"]')].at(-1) !== container) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeRef.current(); return
      }
      if (event.key !== 'Tab') return
      const nodes = controls(), first = nodes[0], last = nodes.at(-1)
      if (!nodes.length) { event.preventDefault(); container.focus(); return }
      if (event.shiftKey && (!container.contains(document.activeElement) || document.activeElement === first || document.activeElement === container)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (!container.contains(document.activeElement) || document.activeElement === last || document.activeElement === container)) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      queueMicrotask(() => {
        // StrictMode cleanup/setup leaves the node connected; restoring then would
        // move focus behind the still-open sheet. Restore only after a real unmount.
        if (container.isConnected || document.querySelector('[role="dialog"]')) return
        if (previousFocus?.isConnected) previousFocus.focus()
        else document.querySelector('[data-session-history-trigger]')?.focus()
      })
    }
  }, [returnFocus])
  return <section ref={dialog} className="session-history-dialog" role="dialog" aria-modal="true"
    aria-labelledby={titleId} tabIndex={-1} data-session-history-dialog>
    <div className="session-history-heading">
      <h2 id={titleId}>{t('Recent sessions — {0}', context.name)}</h2>
      <button type="button" className="btn session-history-close" onClick={close}>{t('Close')}</button>
    </div>
    <p className="small muted">{t('Up to four previous sessions for this progression.')}</p>
    {rows.length ? <div className="session-history-cards">
      {rows.map(row => <ExerciseSessionCard key={row.workoutId} row={row} />)}
    </div> : <p className="session-history-empty">{t('No previous sessions for this progression')}</p>}
  </section>
}

export default function ExerciseSessionHistory({ entryIdx }) {
  const entry = useStore(store => store.S.active?.entries?.[entryIdx])
  const workouts = useStore(store => store.S.workouts)
  const routines = useStore(store => store.S.routines)
  const unit = useStore(store => store.S.unit)
  const activeId = useStore(store => store.S.active?.id)
  const routineId = useStore(store => store.S.active?.routineId)
  const preview = useMemo(() => recentExerciseSessions({ workouts, routines, unit,
    active: { id: activeId, routineId } }, entry, { limit: 1 })[0],
    [workouts, routines, unit, activeId, routineId, entry])
  if (!entry) return null
  const open = event => {
    const context = exerciseHistoryContext(useStore.getState().S, entryIdx)
    if (!context) return
    const trigger = event.currentTarget
    useUI.getState().openSheet(close => <ExerciseSessionHistorySheet context={context} close={close} returnFocus={trigger} />)
  }
  return <button type="button" className="session-history-trigger" onClick={open}
    aria-haspopup="dialog" data-session-history-trigger>
    <span><strong>{t('Recent history')}</strong><span>{preview
      ? `${t('Last time')} (${workoutChronologyParts(preview.workout)[0] || t('Unknown date')}): ${preview.entry.sets?.filter(set => set?.done).map(set => sessionSetLabel(preview, set)).join(' / ') || t('No recorded sets')}`
      : t('Last four sessions')}</span></span>
    <span aria-hidden="true">›</span>
  </button>
}
