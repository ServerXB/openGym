import { useEffect, useId, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { nextPrescription } from '../lib/progression.js'
import { progressionIdOf } from '../lib/progression-scope.js'
import { assessConfirmedStall, applyConfirmedStall, dismissConfirmedStall } from '../lib/confirmedRepRangeStall.js'
import { fmtLoad, uid } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { Button } from './ui.jsx'

const TECHNIQUES = { clean: 'Clean', degraded: 'Compromised', unknown: 'Not assessed' }
const FAILURE_REASONS = {
  performance: 'Performance', technique: 'Technique', pain: 'Pain or feeling unwell',
  equipment: 'Equipment problem', time: 'Not enough time'
}
const techniqueLabel = value => t(TECHNIQUES[value] || TECHNIQUES.unknown)
// Imported illness is shown with the combined UI option, but retained unless the
// user explicitly edits that option. Editing technique must not clear an interruption.
const failureReasonForUI = value => value === 'illness' ? 'pain' : FAILURE_REASONS[value] ? value : ''
const failureLabel = value => FAILURE_REASONS[failureReasonForUI(value)] ? t(FAILURE_REASONS[failureReasonForUI(value)]) : null

// A pending workout keeps its immutable prescription. Suggestions instead describe a future
// prescription from the current saved slot; never follow a slot whose progression has changed.
export function confirmedStallContext(state, entryIdx) {
  const active = state?.active
  const entry = active?.entries?.[entryIdx]
  if (entry?.target?.prog !== 'confirmed_rep_range' || ['pain', 'illness'].includes(entry.review?.failureReason)) return null
  const routine = (state.routines || []).find(candidate => candidate.id === active.routineId)
  const saved = routine?.ex?.find(candidate => candidate.routineExerciseId === entry.routineExerciseId)
  if (saved && progressionIdOf(saved) !== progressionIdOf(entry)) return null
  // Deleted routines/slots are not a destination for new persistent controls. Freestyle
  // entries have no routine and intentionally retain their own frozen progression scope.
  if (active.routineId && !saved) return null
  const cfg = saved || { ...entry.target, id: entry.id, progressionId: progressionIdOf(entry) }
  const plan = nextPrescription(state, cfg, saved ? routine : null)
  if (plan.policy !== 'confirmed_rep_range') return null
  return { cfg, plan, entry, activeId: active.id, assessment: assessConfirmedStall(state, cfg, plan) }
}

// Store.update accepts a draft mutator, not a reducer return value. Compare the immutable
// result first so stale confirmations do not report success or replace unrelated live data.
export function commitStallDecision(entryIdx, activeId, assessment, decision) {
  let changed = false
  useStore.getState().update(draft => {
    const context = confirmedStallContext(draft, entryIdx)
    if (!context || context.activeId !== activeId) return
    const result = decision === 'accept'
      ? applyConfirmedStall(draft, context.cfg, assessment, { epochId: `load:${uid()}` })
      : dismissConfirmedStall(draft, context.cfg, assessment, { snooze: decision === 'snooze' })
    if (result !== draft) {
      Object.assign(draft, result)
      changed = true
    }
  })
  useUI.getState().toast(changed
    ? t(decision === 'accept' ? 'Load reduction saved for future workouts only.' : 'Your choice has been saved.')
    : t('This suggestion has changed. Open the updated details before deciding.'))
  return changed
}

const titleFor = assessment => t(assessment.status === 'technique_warning'
  ? 'Review your technique'
  : assessment.status === 'observe' ? 'Progress to watch' : 'Possible stall')

// The shared sheet supplies overlay/scroll locking. This dialog owns its keyboard
// interaction so these new decisions remain usable without changing older sheets.
function StallDialog({ children, close }) {
  const ref = useRef(null)
  const returnFocus = useRef(null)
  useEffect(() => {
    if (!returnFocus.current) returnFocus.current = document.activeElement
    const container = ref.current
    const controls = () => [...container.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
      .filter(node => node.getClientRects().length > 0)
    ;(controls()[0] || container).focus()
    const onKey = event => {
      if ([...document.querySelectorAll('[data-stall-dialog]')].at(-1) !== container) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
      if (event.key !== 'Tab') return
      const nodes = controls(), first = nodes[0], last = nodes.at(-1)
      if (!nodes.length) { event.preventDefault(); container.focus(); return }
      if (event.shiftKey && (!container.contains(document.activeElement) || document.activeElement === first)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (!container.contains(document.activeElement) || document.activeElement === last)) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      queueMicrotask(() => {
        // StrictMode runs setup/cleanup/setup without removing the dialog. Only
        // restore on a real unmount, or the deferred cleanup steals its new focus.
        if (container.isConnected || document.querySelector('[data-stall-dialog]')) return
        if (returnFocus.current?.isConnected) returnFocus.current.focus()
        else (document.querySelector('.stall-card button') || document.querySelector('.exercise-review summary'))?.focus()
      })
    }
  }, [])
  return <div ref={ref} role="dialog" aria-modal="true" aria-label={t('Progression assistant')}
    tabIndex={-1} data-stall-dialog>{children}</div>
}

export function StallEvidence({ assessment, unit }) {
  return <div className="stall-details">
    <h3>{titleFor(assessment)}</h3>
    <p className="small muted">{t('Only completed previous workouts are used. Your current sets are not evidence for this suggestion.')}</p>
    <ol className="stall-evidence" aria-label={t('Sessions used for this suggestion')}>
      {(assessment.evidence || []).map((row, index) => <li key={`${row.workoutId}:${index}`}>
        <strong>{row.date != null ? new Date(row.date).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : t('Unknown date')}{row.routineName ? ` · ${row.routineName}` : ''}</strong>
        <span>{(row.reps || []).join(' / ')} {t('Reps')}{row.weight > 0 ? ` · ${fmtLoad(row.weight)} ${unit}` : ''}</span>
        <span>{t('Target: {0} reps · recovery: {1}s', row.goal, row.restSeconds)}</span>
        <span>{t('Technique: {0}', techniqueLabel(row.technique))}{failureLabel(row.failureReason) ? ` · ${failureLabel(row.failureReason)}` : ''}</span>
      </li>)}
    </ol>
    <p className="small muted">{assessment.reason === 'post_increase_failure'
      ? t('The minimum was missed twice after a load increase. Returning to a previously successful load is a suggestion, not an automatic change.')
      : t('The assistant watches for three comparable sessions without improvement, or two with compromised technique. These thresholds are product policy, not a scientifically validated diagnosis.')}</p>
    <p className="small muted">{t('Recovery changes, progress and non-comparable sessions restart observation. Unknown technique does not mean clean technique.')}</p>
    {assessment.canApply && <p>{t('Suggested future load: {0} {1} · {2} reps', fmtLoad(assessment.proposedWeight), unit, assessment.minReps)}<br />
      <span className="small muted">{t('Actual reduction: {0}%. When no prior successful load is suitable, the 7.5% guideline is rounded down to an available load, by at least one increment. This is product policy, not a universal prescription.', fmtLoad(assessment.effectiveReductionPercent))}</span>
    </p>}
    {assessment.status === 'manual_review' && <p>{t('Review the exercise or equipment manually. For bodyweight work, consider an easier variation or assistance; no negative load is prescribed.')}</p>}
    <SharedProgressionNotice assessment={assessment} />
  </div>
}

function SharedProgressionNotice({ assessment }) {
  return assessment.sharedRoutineNames?.length > 1
    ? <p className="small stall-disclosure">{t('This progression is shared. The future change applies to: {0}.', assessment.sharedRoutineNames.join(', '))}</p>
    : null
}

function StallConfirmation({ assessment, unit, onConfirm, close }) {
  return <StallDialog close={close}><div className="stall-details">
    <h3>{t('Apply this load from the next workout?')}</h3>
    <p>{t('{0} → {1} {2} · restart at {3} reps', fmtLoad(assessment.fromWeight), fmtLoad(assessment.proposedWeight), unit, assessment.minReps)}</p>
    <p>{t('Your current workout and previous records stay unchanged. Recovery, set count and increment stay unchanged. Maximum confirmations restart at the new load.')}</p>
    <SharedProgressionNotice assessment={assessment} />
    <div className="stall-actions">
      <Button variant="primary" onClick={() => { onConfirm(); close() }}>{t('Confirm future load reduction')}</Button>
      <Button variant="ghost" onClick={close}>{t('Cancel')}</Button>
    </div>
  </div></StallDialog>
}

export default function ConfirmedStallAssistant({ entryIdx }) {
  const state = useStore(store => store.S)
  const context = confirmedStallContext(state, entryIdx)
  if (!context) return null
  const { assessment, activeId } = context
  if (!assessment || ['none', 'dismissed', 'snoozed'].includes(assessment.status)) return null
  const decide = decision => commitStallDecision(entryIdx, activeId, assessment, decision)
  const askAccept = () => useUI.getState().openSheet(close => <StallConfirmation
    assessment={assessment} unit={state.unit} close={close} onConfirm={() => decide('accept')} />)
  const details = () => useUI.getState().openSheet(close => <StallDialog close={close}>
    <StallEvidence assessment={assessment} unit={state.unit} />
    <div className="stall-actions">
      {assessment.canApply && <Button variant="primary" onClick={() => { close(); askAccept() }}>{t('Apply from the next workout')}</Button>}
      <Button onClick={close}>{t('Close')}</Button>
    </div>
  </StallDialog>)
  return <section className="stall-card" aria-label={t('Progression assistant')}>
    <strong>{titleFor(assessment)}</strong>
    <p>{assessment.reason === 'technique_stall' || assessment.status === 'technique_warning'
      ? t('{0} comparable sessions with compromised technique.', assessment.count)
      : t('{0} comparable sessions without improvement.', assessment.count)}</p>
    {assessment.canApply && <p>{t('Suggested future load: {0} {1} · {2} reps', fmtLoad(assessment.proposedWeight), state.unit, assessment.minReps)}</p>}
    {assessment.status === 'manual_review' && <p>{t('Review the exercise or equipment manually; no load change is applied.')}</p>}
    <div className="stall-actions">
      {assessment.canApply && <Button size="sm" onClick={askAccept}>{t('Apply from the next workout')}</Button>}
      <Button size="sm" variant="ghost" onClick={details}>{t('Details')}</Button>
      <Button size="sm" variant="ghost" onClick={() => decide('dismiss')}>{t('Keep this load')}</Button>
      <Button size="sm" variant="ghost" onClick={() => decide('snooze')}>{t('Remind me later')}</Button>
    </div>
  </section>
}

// Optional, editable once per exercise. It is available before completion as well, so an
// interrupted exercise or pure bodyweight work does not depend on the top-weight sheet.
export function ConfirmedExerciseReview({ entryIdx, expanded = false }) {
  const state = useStore(store => store.S)
  const entry = state.active?.entries?.[entryIdx]
  const fieldId = useId()
  if (entry?.target?.prog !== 'confirmed_rep_range') return null
  const technique = TECHNIQUES[entry.review?.technique] ? entry.review.technique : 'unknown'
  const failureReason = failureReasonForUI(entry.review?.failureReason)
  const activeId = state.active.id
  const change = (field, value) => useStore.getState().update(draft => {
    if (draft.active?.id !== activeId) return
    const current = draft.active.entries?.[entryIdx]
    if (!current || current.routineExerciseId !== entry.routineExerciseId || current.id !== entry.id) return
    current.review = {
      technique: TECHNIQUES[current.review?.technique] ? current.review.technique : 'unknown',
      failureReason: failureReasonForUI(current.review?.failureReason) ? current.review.failureReason : null,
      [field]: value || null
    }
  })
  const content = <>
    <p className="small muted">{t('Optional exercise review. No assessment is assumed when you leave it unanswered.')}</p>
    <fieldset className="review-options">
      <legend>{t('Quality of the repetitions')}</legend>
      {Object.entries(TECHNIQUES).map(([value, label]) => <label key={value}>
        <input type="radio" name={`${fieldId}-technique`} value={value} checked={technique === value}
          onChange={() => change('technique', value)} />
        <span>{t(label)}</span>
      </label>)}
    </fieldset>
    <label className="review-reason" htmlFor={`${fieldId}-reason`}>{t('What limited this exercise? (optional)')}</label>
    <select id={`${fieldId}-reason`} value={failureReason} onChange={event => change('failureReason', event.target.value)}>
      <option value="">{t('Not specified')}</option>
      {Object.entries(FAILURE_REASONS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
    </select>
    {(technique === 'degraded' || failureReason === 'technique') && <p className="small muted">{t('Compromised technique does not validate a Confirmed progression, even when the target reps were reached.')}</p>}
    {failureReason === 'pain' && <p className="review-pain" role="status">{t('If you feel pain or unwell, stop the exercise and seek appropriate professional advice. The app does not diagnose the cause or prescribe a reduced load.')}</p>}
  </>
  return expanded
    ? <section className="exercise-review" aria-label={t('Exercise review')}>{content}</section>
    : <details className="exercise-review"><summary>{t('Exercise review')} · {techniqueLabel(technique)}</summary>{content}</details>
}
