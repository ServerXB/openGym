import { describe, expect, it } from 'vitest'
import { EXDB } from './exercises.js'
import {
  LOAD_MODE,
  entryMatchesExerciseLoadMode,
  exerciseLoadMode,
  hasAddedBodyweightLoad,
  isPureBodyweight,
  workoutEntryLoadMode
} from './exercise-load-mode.js'

const BW = EXDB.find(exercise => exercise.eq === 'body weight').id
const LIFT = EXDB.find(exercise => exercise.bp !== 'cardio' && exercise.eq !== 'body weight').id

describe('exercise load modes', () => {
  it('derives external, pure bodyweight and added bodyweight without persisted migration', () => {
    expect(exerciseLoadMode({ id: LIFT, weight: 0 })).toBe(LOAD_MODE.EXTERNAL)
    expect(exerciseLoadMode({ id: BW, weight: 0 })).toBe(LOAD_MODE.PURE_BODYWEIGHT)
    expect(exerciseLoadMode({ id: BW, weight: 10 })).toBe(LOAD_MODE.ADDED_BODYWEIGHT)
    expect(exerciseLoadMode({ id: LIFT, bodyweight: true, weight: 0 })).toBe(LOAD_MODE.PURE_BODYWEIGHT)
    expect(exerciseLoadMode({ id: LIFT, bodyweight: true, weight: '7.5' })).toBe(LOAD_MODE.ADDED_BODYWEIGHT)
    expect(exerciseLoadMode({ id: BW, bodyweight: false, weight: 10 })).toBe(LOAD_MODE.EXTERNAL)
  })

  it('treats invalid, zero and negative added load as pure bodyweight', () => {
    for (const weight of [undefined, null, '', 0, -5, Infinity, 'not-a-number']) {
      expect(isPureBodyweight({ id: BW, weight }), String(weight)).toBe(true)
      expect(hasAddedBodyweightLoad({ id: BW, weight }), String(weight)).toBe(false)
    }
  })

  it('lets a modern frozen target win over anomalous set values', () => {
    expect(workoutEntryLoadMode({
      id: BW,
      target: { bodyweight: true, weight: 0 },
      sets: [{ w: 20, r: 8, done: true }]
    })).toBe(LOAD_MODE.PURE_BODYWEIGHT)
    expect(workoutEntryLoadMode({
      id: BW,
      target: { bodyweight: true, weight: 10 },
      sets: [{ w: 0, r: 8, done: true }]
    })).toBe(LOAD_MODE.ADDED_BODYWEIGHT)
  })

  it('uses completed rows only when an early target snapshot has no weight field', () => {
    expect(workoutEntryLoadMode({
      id: BW,
      target: { bodyweight: true, sets: 1, reps: 8 },
      sets: [{ w: 10, r: 8, done: true }]
    })).toBe(LOAD_MODE.ADDED_BODYWEIGHT)
    expect(workoutEntryLoadMode({
      id: BW,
      target: { bodyweight: true, sets: 1, reps: 8 },
      sets: [{ w: 10, r: 8, done: false }]
    })).toBe(LOAD_MODE.PURE_BODYWEIGHT)
  })

  it('infers a pre-snapshot bodyweight entry only from completed positive load', () => {
    expect(workoutEntryLoadMode({
      id: BW,
      sets: [{ w: 10, r: 8, done: false }, { w: 0, r: 8, done: true }]
    })).toBe(LOAD_MODE.PURE_BODYWEIGHT)
    expect(workoutEntryLoadMode({
      id: BW,
      sets: [{ w: 10, r: 8, done: true }]
    })).toBe(LOAD_MODE.ADDED_BODYWEIGHT)
    expect(workoutEntryLoadMode({
      id: LIFT,
      sets: [{ w: 0, r: 8, done: true }]
    })).toBe(LOAD_MODE.EXTERNAL)
  })

  it('matches history only inside the same explicit load mode', () => {
    const legacyAdded = { id: BW, sets: [{ w: 10, r: 8, done: true }] }
    expect(entryMatchesExerciseLoadMode(legacyAdded, { id: BW, weight: 10 })).toBe(true)
    expect(entryMatchesExerciseLoadMode(legacyAdded, { id: BW, weight: 0 })).toBe(false)
  })
})
