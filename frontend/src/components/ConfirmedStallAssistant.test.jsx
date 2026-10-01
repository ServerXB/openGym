import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ConfirmedStallAssistant, { ConfirmedExerciseReview, StallEvidence, confirmedStallContext, commitStallDecision } from './ConfirmedStallAssistant.jsx'
import italian from '../locales/it.js'

const fixture = vi.hoisted(() => ({ state: null, toast: vi.fn(), openSheet: vi.fn() }))
vi.mock('../store/useStore.js', () => {
  const getState = () => ({ S: fixture.state, update: mut => {
    const draft = structuredClone(fixture.state); mut(draft); fixture.state = draft
  } })
  return { useStore: Object.assign(selector => selector(getState()), { getState }) }
})
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: fixture.toast, openSheet: fixture.openSheet }) } }))

const cfg = { id: 'ui-lift', routineExerciseId: 'slot', progressionId: 'p', mode: 'reps',
  prog: 'confirmed_rep_range', sets: 4, minReps: 8, maxReps: 10, weight: 70, inc: 2,
  restSeconds: 120, maxRestSeconds: 120 }
beforeEach(() => {
  fixture.toast.mockClear(); fixture.openSheet.mockClear()
  const target = { ...cfg, reps: 10, targetReps: 10, rangeStep: 1, stallDetectionVersion: 1, restBaseSeconds: 120 }
  const entry = { id: cfg.id, progressionId: 'p', routineExerciseId: 'slot', target,
    sets: Array.from({ length: 4 }, () => ({ w: 70, r: 9, done: true })) }
  fixture.state = { unit: 'kg', restSec: 120, routines: [{ id: 'r', name: 'Monday', ex: [{ ...cfg }] }],
    workouts: [1, 2, 3].map(n => ({ id: `w${n}`, d: new Date(Date.now() - (4 - n) * 86400000).toISOString(),
      routineId: 'r', entries: [structuredClone(entry)] })),
    active: { id: 'active', routineId: 'r', entries: [{ ...structuredClone(entry), sets: entry.sets.map(s => ({ ...s, done: false })) }] },
    progressionControls: {}, progressionWeights: { p: { w: 70 } }
  }
})

describe('Confirmed stall workout UI', () => {
  it('shows an explicitly optional future proposal without an automatic dialog', () => {
    const html = renderToStaticMarkup(<ConfirmedStallAssistant entryIdx={0} />)
    expect(html).toContain('Possible stall')
    expect(html).toContain('64 kg')
    expect(html).toContain('Apply from the next workout')
    expect(html).toContain('Keep this load')
    expect(html).toContain('Remind me later')
    expect(html).not.toContain('role="dialog"')
    expect(fixture.openSheet).not.toHaveBeenCalled()
  })

  it('details disclose scoped evidence and the limits of the scientific claim', () => {
    fixture.state.routines.push({ id: 'r2', name: 'Thursday', ex: [{ ...cfg, routineExerciseId: 'slot2' }] })
    const { assessment } = confirmedStallContext(fixture.state, 0)
    const html = renderToStaticMarkup(<StallEvidence assessment={assessment} unit="kg" />)
    expect(html.match(/<li/g)).toHaveLength(3)
    expect(html).toContain('9 / 9 / 9 / 9')
    expect(html).toContain('not a scientifically validated diagnosis')
    expect(html).toContain('Unknown technique does not mean clean technique')
    expect(html).toContain('Monday, Thursday')
    expect(html).toContain('8.57%')
    expect(html).not.toContain('Invalid Date')
  })

  it('persists explicit acceptance via a draft mutator without changing active or historical data', () => {
    const { assessment } = confirmedStallContext(fixture.state, 0)
    const before = structuredClone(fixture.state)
    expect(commitStallDecision(0, 'active', assessment, 'accept')).toBe(true)
    expect(fixture.state.progressionControls.p.confirmedRepRangeLoad.baselineWeight).toBe(64)
    expect(fixture.state.active).toEqual(before.active)
    expect(fixture.state.workouts).toEqual(before.workouts)
    expect(fixture.state.progressionWeights).toEqual(before.progressionWeights)
    expect(fixture.toast).toHaveBeenCalledWith('Load reduction saved for future workouts only.')
  })

  it.each(['dismiss', 'snooze'])('%s saves a choice, not a load change', decision => {
    const { assessment } = confirmedStallContext(fixture.state, 0)
    expect(commitStallDecision(0, 'active', assessment, decision)).toBe(true)
    expect(fixture.state.progressionControls.p.confirmedRepRangeStall.status).toBe(decision === 'dismiss' ? 'dismissed' : 'snoozed')
    expect(fixture.state.progressionControls.p.confirmedRepRangeLoad).toBeUndefined()
    expect(renderToStaticMarkup(<ConfirmedStallAssistant entryIdx={0} />)).toBe('')
  })

  it.each(['active_changed', 'scope_changed', 'slot_deleted', 'pain', 'new_success'])('stale confirmation is refused: %s', event => {
    const { assessment } = confirmedStallContext(fixture.state, 0)
    if (event === 'active_changed') fixture.state.active.id = 'other'
    if (event === 'scope_changed') fixture.state.routines[0].ex[0].progressionId = 'other'
    if (event === 'slot_deleted') fixture.state.routines[0].ex = []
    if (event === 'pain') fixture.state.active.entries[0].review = { failureReason: 'pain' }
    if (event === 'new_success') {
      const w = structuredClone(fixture.state.workouts[2]); w.id = 'w4'
      w.entries[0].sets.forEach(set => { set.r = 10 })
      fixture.state.workouts.push(w)
    }
    expect(commitStallDecision(0, 'active', assessment, 'accept')).toBe(false)
    expect(fixture.state.progressionControls).toEqual({})
    expect(fixture.toast).toHaveBeenCalledWith('This suggestion has changed. Open the updated details before deciding.')
  })

  it('supports inherited Confirmed policy and excludes a later policy change', () => {
    delete fixture.state.routines[0].ex[0].prog
    fixture.state.routines[0].prog = 'confirmed_rep_range'
    expect(confirmedStallContext(fixture.state, 0).assessment.canApply).toBe(true)
    fixture.state.routines[0].prog = 'linear'
    expect(confirmedStallContext(fixture.state, 0)).toBeNull()
  })

  it('optional review defaults to unknown and is also available before exercise completion', () => {
    const html = renderToStaticMarkup(<ConfirmedExerciseReview entryIdx={0} />)
    expect(html).toContain('<details')
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="unknown"/)
    expect(html).toContain('<fieldset')
    expect(html).toContain('Quality of the repetitions')
    expect(fixture.state.active.entries[0].review).toBeUndefined()
  })

  it('pain gives non-diagnostic stop advice and suppresses the historical reduction card', () => {
    fixture.state.active.entries[0].review = { technique: 'unknown', failureReason: 'pain' }
    const html = renderToStaticMarkup(<ConfirmedExerciseReview entryIdx={0} expanded />)
    expect(html).toContain('role="status"')
    expect(html).toContain('stop the exercise')
    expect(html).toContain('does not diagnose')
    expect(renderToStaticMarkup(<ConfirmedStallAssistant entryIdx={0} />)).toBe('')
  })

  it('other policies do not acquire a technique-review form', () => {
    fixture.state.active.entries[0].target.prog = 'linear'
    expect(renderToStaticMarkup(<ConfirmedExerciseReview entryIdx={0} />)).toBe('')
  })

  it('imported illness displays the combined stop option without rewriting stored data', () => {
    fixture.state.active.entries[0].review = { technique: 'unknown', failureReason: 'illness' }
    const before = structuredClone(fixture.state)
    const html = renderToStaticMarkup(<ConfirmedExerciseReview entryIdx={0} expanded />)
    expect(html).toContain('<option value="pain" selected="">')
    expect(html).toContain('stop the exercise')
    expect(renderToStaticMarkup(<ConfirmedStallAssistant entryIdx={0} />)).toBe('')
    expect(fixture.state).toEqual(before)
  })

  it('Italian copy translates the actions and explains the product-policy uncertainty', () => {
    expect(italian['Possible stall']).toBe('Possibile stallo')
    expect(italian['Apply from the next workout']).toBe('Applica dal prossimo allenamento')
    expect(italian['Confirm future load reduction']).toBe('Conferma riduzione futura del carico')
    expect(italian['Technique was marked as compromised — weight and target stay unchanged.']).toContain('tecnica compromessa')
  })
})
