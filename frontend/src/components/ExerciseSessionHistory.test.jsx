import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ExerciseSessionHistory, {
  ExerciseSessionCard, ExerciseSessionHistorySheet, exerciseHistoryContext,
  sessionOutcomeLabel, sessionSetLabel, sessionTargetLabel
} from './ExerciseSessionHistory.jsx'
import { recentExerciseSessions } from '../lib/exercise-session-history.js'
import { LOAD_MODE } from '../lib/exercise-load-mode.js'

const fixture = vi.hoisted(() => ({ state: null, openSheet: vi.fn() }))
vi.mock('../store/useStore.js', () => {
  const getState = () => ({ S: fixture.state })
  return { useStore: Object.assign(selector => selector(getState()), { getState }) }
})
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ openSheet: fixture.openSheet }) } }))

const config = { id: 'history-ui-lift', progressionId: 'p', routineExerciseId: 'slot', mode: 'reps',
  prog: 'confirmed_rep_range', sets: 4, reps: 8, minReps: 8, maxReps: 10, weight: 70,
  inc: 2, restSeconds: 120, maxRestSeconds: 180 }
const entry = (overrides = {}) => ({ id: config.id, name: 'Historical lift', progressionId: 'p', routineExerciseId: 'slot',
  target: { ...config, targetReps: 10, restBaseSeconds: 120, topRangeStreak: 0 },
  sets: Array.from({ length: 4 }, () => ({ w: 70, r: 10, done: true })), ...overrides })
const workout = (n, historicalEntry = entry()) => ({ id: `w${n}`, d: `2026-09-${String(n).padStart(2, '0')}`,
  routineId: 'r', name: 'Historical Monday', unit: 'kg', entries: [historicalEntry] })
const rowWith = ({ target = {}, sets, ...overrides } = {}) => {
  const historicalEntry = entry()
  Object.assign(historicalEntry.target, target)
  if (sets) historicalEntry.sets = sets
  return { workoutId: 'w1', workout: workout(1, historicalEntry), entry: historicalEntry,
    target: historicalEntry.target, mode: historicalEntry.target.mode, loadMode: LOAD_MODE.EXTERNAL,
    unit: 'kg', outcome: 'unknown', scopeKind: 'exact', ...overrides }
}
const card = row => renderToStaticMarkup(<ExerciseSessionCard row={row} />)
const sheet = context => renderToStaticMarkup(<ExerciseSessionHistorySheet context={context} close={() => {}} />)
const freeze = value => {
  Object.freeze(value)
  Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child) })
  return value
}

beforeEach(() => {
  fixture.openSheet.mockClear()
  fixture.state = { unit: 'kg', routines: [{ id: 'r', name: 'Current routine', ex: [{ ...config }] }],
    workouts: [], active: { id: 'active', routineId: 'r', entries: [entry()] } }
})

describe('exercise session history summaries', () => {
  it.each([
    [LOAD_MODE.PURE_BODYWEIGHT, 0, 0, '4 × 10 Reps · Bodyweight · 120s recovery', '12 Reps · Bodyweight'],
    [LOAD_MODE.ADDED_BODYWEIGHT, 12.5, 13.75, '4 × 10 Reps · Bodyweight · +12.5 kg · 120s recovery', '12 Reps · Bodyweight · +13.75 kg']
  ])('distinguishes %s from an external zero-load prescription', (loadMode, planned, recorded, targetText, setText) => {
    const row = rowWith({ loadMode, target: { bodyweight: true, weight: planned }, sets: [{ r: 12, w: recorded, done: true }] })
    expect(sessionTargetLabel(row)).toBe(targetText)
    expect(sessionSetLabel(row, row.entry.sets[0])).toBe(setText)
    expect(card(row)).toContain(setText)
    if (loadMode === LOAD_MODE.PURE_BODYWEIGHT) expect(card(row)).not.toContain('0 kg')
  })

  it('keeps frozen bodyweight semantics for malformed pure rows and unknown added-load rows', () => {
    const pure = rowWith({ loadMode: LOAD_MODE.PURE_BODYWEIGHT, target: { bodyweight: true, weight: 0 } })
    expect(sessionSetLabel(pure, { r: 12, w: 99 })).toBe('12 Reps · Bodyweight')
    const added = rowWith({ loadMode: LOAD_MODE.ADDED_BODYWEIGHT, target: { bodyweight: true, weight: 10 } })
    expect(sessionSetLabel(added, { r: 12 })).toBe('12 Reps · Bodyweight · Load not recorded')
    expect(sessionSetLabel(added, { r: 12, w: 0 })).toBe('12 Reps · Bodyweight · +0 kg')
  })

  it.each([
    ['time', { sec: 75, weight: 22.5 }, { sec: 65, w: 20 }, '4 × 1:15 · 22.5 kg · 120s recovery', '1:05 · 20 kg'],
    ['cardio', { min: 20, speed: 8 }, { min: 18.5, speed: 7.5 }, '4 × 20 min · 8 km/h', '18.5 min · 7.5 km/h']
  ])('keeps historical %s targets separate from recorded work', (mode, target, recorded, targetText, setText) => {
    const row = rowWith({ target: { mode, ...target }, sets: [{ ...recorded, done: true }] })
    expect(sessionTargetLabel(row)).toBe(targetText)
    expect(sessionSetLabel(row, row.entry.sets[0])).toBe(setText)
    const html = card(row)
    expect(html).toContain(targetText)
    expect(html).toContain(setText)
    if (mode === 'cardio') {
      expect(html).not.toContain(' kg')
      expect(html).not.toContain(' Reps')
    }
  })

  it('shows unilateral totals and their actual per-side split, including an odd total', () => {
    const row = rowWith({ target: { side: true, targetReps: 18 }, sets: [{ r: 17, w: 70, done: true }] })
    expect(sessionTargetLabel(row)).toContain('18 Reps · 9 per side')
    expect(sessionSetLabel(row, row.entry.sets[0])).toBe('17 Reps · 8.5 per side · 70 kg')
    expect(card(row)).toContain('17 Reps · 8.5 per side')
  })

  it('retains recorded zero reps, load and effort while leaving absent effort undisclosed', () => {
    const row = rowWith()
    expect(sessionSetLabel(row, { r: 0, w: 0, rir: 0, rpe: 0 })).toBe('0 Reps · 0 kg · RIR 0 · RPE 0')
    expect(sessionSetLabel(row, { r: 8, w: 70 })).toBe('8 Reps · 70 kg')
    expect(sessionSetLabel(row, { r: 8, w: 70, rir: '', rpe: null })).toBe('8 Reps · 70 kg')
    expect(sessionSetLabel(row, { r: 8, w: 70, rir: 0, rpe: 8.5 })).toBe('8 Reps · 70 kg · RIR 0 · RPE 8.5')
  })

  it('displays incomplete snapshots as unknown without inventing target, duration, load or effort defaults', () => {
    const row = rowWith({ target: { sets: null, targetReps: null, reps: null, weight: null, restSeconds: null } })
    expect(sessionTargetLabel(row)).toBe('— × — Reps · Load not recorded')
    expect(sessionSetLabel(row, { r: '', w: undefined, rir: false, rpe: NaN })).toBe('— Reps · Load not recorded')
    row.mode = 'time'
    expect(sessionTargetLabel(row)).toBe('— × — · Load not recorded')
    expect(sessionSetLabel(row, {})).toBe('— · Load not recorded')
    row.mode = 'cardio'
    expect(sessionTargetLabel(row)).toBe('— × — min · — km/h')
    expect(sessionSetLabel(row, {})).toBe('— min · — km/h')
  })

  it('keeps an absent historical target unknown despite populated current routine and active targets', () => {
    const historicalEntry = entry({ target: undefined, sets: [{ w: 55, r: 7, done: true }] })
    fixture.state.workouts = [workout(1, historicalEntry)]
    Object.assign(fixture.state.routines[0].ex[0], { weight: 999, sets: 6, reps: 30, restSeconds: 300 })
    const before = structuredClone(fixture.state)
    const html = sheet(exerciseHistoryContext(fixture.state, 0))
    expect(html).toContain('Historical target unavailable')
    expect(html).toContain('7 Reps · 55 kg')
    expect(html).toContain('Outcome not determinable')
    expect(html).not.toContain('999 kg')
    expect(html).not.toContain('70 kg')
    expect(html).not.toContain('300s recovery')
    expect(fixture.state).toEqual(before)
  })

  it('presents confirmed topW separately without replacing the logged or prescribed load', () => {
    const row = rowWith({ sets: [{ r: 9, w: 68.75, done: true }] })
    row.entry.topW = 72.5
    const html = card(row)
    expect(html).toContain('4 × 10 Reps · 70 kg')
    expect(html).toContain('9 Reps · 68.75 kg')
    expect(html).toContain('<p class="session-history-confirmed">Confirmed weight: 72.5 kg</p>')
    expect(sessionSetLabel(row, row.entry.sets[0])).not.toContain('72.5')
    row.entry.topW = 0
    expect(card(row)).toContain('Confirmed weight: 0 kg')
    delete row.entry.topW
    expect(card(row)).not.toContain('Confirmed weight:')
  })
})

describe('exercise session history cards and sheet', () => {
  it('labels optional Confirmed rows and their completion state without downgrading the prescribed outcome', () => {
    const historicalEntry = entry()
    historicalEntry.sets.push({ r: 2, w: 5, done: false }, { r: 3, w: 7, done: true })
    fixture.state.workouts = [workout(1, historicalEntry)]
    const row = recentExerciseSessions(fixture.state, fixture.state.active.entries[0])[0]
    const html = card(row)
    expect(html.match(/<li>/g)).toHaveLength(6)
    expect(html.match(/ · Optional/g)).toHaveLength(2)
    expect(html).toContain('Set not completed · Optional')
    expect(html).toContain('Completed set · Optional')
    expect(html).toContain('2 Reps · 5 kg')
    expect(html).toContain('Maximum reached — confirmation 1 of 2')
    expect(html).not.toContain('Incomplete session')
    row.entry.target.prog = 'linear'
    expect(card(row)).not.toContain(' · Optional')
  })

  it('renders confirmation 0, 1, 2 and unknown from historical evidence', () => {
    fixture.state.workouts = [1, 2, 3, 4].map(n => workout(n))
    fixture.state.workouts[2].entries[0].target.restSeconds = 150
    delete fixture.state.workouts[3].entries[0].target.restBaseSeconds
    const rows = recentExerciseSessions(fixture.state, fixture.state.active.entries[0])
    expect(rows.map(row => row.confirmation)).toEqual([null, 0, 2, 1])
    expect(rows.map(sessionOutcomeLabel)).toEqual([
      'Maximum reached — confirmations not determinable',
      'Maximum reached — confirmation 0 of 2; recovery above base',
      'Weight increase earned — confirmation 2 of 2',
      'Maximum reached — confirmation 1 of 2'
    ])
    const html = sheet(exerciseHistoryContext(fixture.state, 0))
    rows.forEach(row => {
      expect(html).toContain(`data-history-outcome="${row.outcome}"`)
      expect(html).toContain(sessionOutcomeLabel(row))
    })
  })

  it.each([
    ['sets', 'Extra set earned — confirmation 2 of 2'],
    ['variation', 'Harder variation earned — confirmation 2 of 2']
  ])('describes bodyweight progression earned as %s', (progressionEarned, text) => {
    const row = rowWith({ loadMode: LOAD_MODE.PURE_BODYWEIGHT, outcome: 'progression_earned', progressionEarned })
    expect(sessionOutcomeLabel(row)).toBe(text)
    expect(card(row)).toContain(text)
    expect(card(row)).not.toContain('Weight increase earned')
  })

  it('renders saved equipment label, gym, tare and unit instead of the edited current equipment', () => {
    const historicalWorkout = workout(1)
    historicalWorkout.unit = 'lb'
    historicalWorkout.equipmentSnapshot = { id: 'gym', name: 'Old gym', unit: 'lb', workoutUnit: 'lb',
      items: [{ id: 'bar', label: 'Old bar', tareWeight: 45 }] }
    historicalWorkout.entries[0].equipmentUse = { status: 'resolved', profileId: 'gym', itemId: 'bar', loadSemantics: 'per_implement' }
    fixture.state.workouts = [historicalWorkout]
    fixture.state.equipmentProfiles = [{ id: 'gym', name: 'Current gym', unit: 'kg',
      items: [{ id: 'bar', label: 'Current bar', tareWeight: 20 }] }]
    const before = structuredClone(fixture.state)
    const context = exerciseHistoryContext(fixture.state, 0)
    freeze(fixture.state)
    const html = sheet(context)
    expect(html).toContain('<strong>Historical equipment</strong>: Old bar · Old gym · Tare: 45 lb · Load per implement')
    expect(html).toContain('10 Reps · 70 lb')
    expect(html).toContain('Historical Monday')
    expect(html).not.toContain('Current bar')
    expect(html).not.toContain('Current gym')
    expect(html).not.toContain('Tare: 20')
    expect(html).not.toContain('Current routine')
    expect(fixture.state).toEqual(before)
  })

  it('leaves missing historical equipment and routine data explicitly unavailable', () => {
    const historicalWorkout = workout(1)
    delete historicalWorkout.name
    delete historicalWorkout.unit
    historicalWorkout.entries[0].equipmentUse = { profileId: 'gym', itemId: 'bar' }
    fixture.state.workouts = [historicalWorkout]
    fixture.state.equipmentProfiles = [{ id: 'gym', name: 'Current gym', unit: 'kg',
      items: [{ id: 'bar', label: 'Current bar', tareWeight: 20 }] }]
    const html = sheet(exerciseHistoryContext(fixture.state, 0))
    expect(html).toContain('Routine name unavailable')
    expect(html).toContain('Equipment name unavailable')
    expect(html).toContain('Historical unit unavailable; shown in kg.')
    expect(html).not.toContain('Current routine')
    expect(html).not.toContain('Current gym')
    expect(html).not.toContain('Current bar')
    expect(html).not.toContain('Tare:')
  })

  it('keeps the history button available with no rows and renders a labelled empty modal only on demand', () => {
    const html = renderToStaticMarkup(<ExerciseSessionHistory entryIdx={0} />)
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-haspopup="dialog"[^>]*data-session-history-trigger/)
    expect(html).toContain('Recent history')
    expect(html).toContain('Last four sessions')
    expect(html).not.toContain('disabled')
    expect(html).not.toContain('role="dialog"')
    expect(fixture.openSheet).not.toHaveBeenCalled()
    const empty = sheet(exerciseHistoryContext(fixture.state, 0))
    const titleId = empty.match(/aria-labelledby="([^"]+)"/)[1]
    expect(empty).toContain('role="dialog" aria-modal="true"')
    expect(empty).toContain(`id="${titleId}"`)
    expect(empty).toContain('Recent sessions — Historical lift')
    expect(empty).toContain('No previous sessions for this progression')
    expect(empty).toContain('>Close</button>')
    expect(empty).not.toContain('data-session-history-card')
  })

  it('renders unknown chronology and an empty recorded block without an invalid date or invented sets', () => {
    const row = rowWith({ sets: [] })
    row.workout.d = 'invalid-date'
    expect(card(row)).toContain('Unknown date')
    expect(card(row)).toContain('No recorded sets')
    expect(card(row)).not.toContain('Invalid Date')
    expect(card(row)).not.toContain('<li>')
  })

  it('clones the opening context so a changed active slot cannot retarget the already open history', () => {
    fixture.state.active.entries[0].equipmentUse = { profileId: 'gym', itemId: 'bar' }
    fixture.state.workouts = [workout(1)]
    const before = structuredClone(fixture.state.active.entries[0])
    const context = exerciseHistoryContext(fixture.state, 0)
    expect(exerciseHistoryContext(freeze(structuredClone(fixture.state)), 0)).toEqual(context)
    expect(context.entry).toEqual(before)
    expect(context.entry).not.toBe(fixture.state.active.entries[0])
    expect(context.entry.target).not.toBe(fixture.state.active.entries[0].target)
    expect(context.entry.sets).not.toBe(fixture.state.active.entries[0].sets)
    expect(context.entry.equipmentUse).not.toBe(fixture.state.active.entries[0].equipmentUse)
    fixture.state.active.id = 'replacement-active'
    fixture.state.active.routineId = 'replacement-routine'
    Object.assign(fixture.state.active.entries[0], { name: 'Replacement lift', progressionId: 'replacement' })
    fixture.state.active.entries[0].target.weight = 999
    fixture.state.active.entries[0].sets[0].r = 99
    fixture.state.active.entries[0].equipmentUse.itemId = 'replacement-bar'
    fixture.state.routines = []
    expect(context.entry).toEqual(before)
    expect(context.active).toEqual({ id: 'active', routineId: 'r' })
    expect(context.name).toBe('Historical lift')
    const html = sheet(context)
    expect(html).toContain('Recent sessions — Historical lift')
    expect(html).toContain('Historical Monday')
    expect(html).toContain('10 Reps · 70 kg')
    expect(html).not.toContain('Replacement lift')
    expect(html).not.toContain('999 kg')
  })

  it('returns no context or trigger when the requested active slot is missing', () => {
    expect(exerciseHistoryContext(fixture.state, 1)).toBeNull()
    expect(renderToStaticMarkup(<ExerciseSessionHistory entryIdx={1} />)).toBe('')
  })
})
