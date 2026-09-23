import { describe, expect, it } from 'vitest'
import {
  CABLE_LOADING_MECHANISM,
  EQUIPMENT_KIND,
  calculateLoadingGuide,
  createCableEquipmentPreset,
  equipmentGuideForEntry,
  normalizeEquipmentProfile,
  resolveEquipmentUse,
  snapshotActiveEquipmentProfile
} from './equipment-load.js'
import { buildScopedWorkoutEntry, completedWorkoutEntries } from './workout-scope.js'

const CABLE_EXERCISE_ID = '0007'

const stack = (overrides = {}) => createCableEquipmentPreset(
  CABLE_LOADING_MECHANISM.SELECTOR_STACK,
  {
    id: 'cable-stack',
    label: 'Cavo a pacco pesi',
    denominations: [{ weight: 50, count: 1 }, { weight: 60, count: 1 }],
    ...overrides
  }
)

const plates = (overrides = {}) => createCableEquipmentPreset(
  CABLE_LOADING_MECHANISM.PLATE_LOADED,
  {
    id: 'cable-plates',
    label: 'Cavo caricato a dischi',
    tareWeight: 0,
    sideCount: 2,
    denominations: [],
    ...overrides
  }
)

const profile = (items, overrides = {}) => ({
  id: 'gym', name: 'Palestra', unit: 'kg', workoutUnit: 'kg', items, ...overrides
})

const explicitUse = item => ({
  mode: 'item',
  profileId: 'gym',
  itemId: item.id,
  catalogEquipment: 'cable',
  loadSemantics: 'total'
})

const state = () => ({
  unit: 'kg',
  restSec: 90,
  workouts: [],
  exWeights: {},
  progressionWeights: {},
  progressionControls: {}
})

describe('plate-loaded cable integration', () => {
  it('creates explicit stack and plate presets without inventing a new persisted kind', () => {
    const selector = stack({ tareWeight: 99, sideCount: 2, pulleyRatio: 0.5 })
    const twoPoints = plates({ sideCount: 9, pulleyRatio: 0.5 })
    const onePoint = plates({ id: 'cable-one', sideCount: 1 })

    expect(selector).toMatchObject({
      kind: EQUIPMENT_KIND.MACHINE_STACK,
      catalogEquipment: 'cable',
      tareWeight: 0,
      sideCount: 1
    })
    expect(twoPoints).toMatchObject({
      kind: EQUIPMENT_KIND.PLATE_LOADED_MACHINE,
      catalogEquipment: 'cable',
      sideCount: 2
    })
    expect(onePoint).toMatchObject({
      kind: EQUIPMENT_KIND.PLATE_LOADED_MACHINE,
      catalogEquipment: 'cable',
      sideCount: 1
    })
    expect(selector).not.toHaveProperty('pulleyRatio')
    expect(twoPoints).not.toHaveProperty('pulleyRatio')
    expect(createCableEquipmentPreset('unknown', { id: 'unsafe' })).toBeNull()
  })

  it('requires an explicit slot choice when stack and plates both match cable', () => {
    const selector = stack()
    const plateLoaded = plates()
    const equipmentSnapshot = profile([selector, plateLoaded])

    expect(resolveEquipmentUse({
      profile: equipmentSnapshot,
      config: { id: CABLE_EXERCISE_ID },
      catalogEquipment: 'cable'
    })).toMatchObject({
      status: 'ambiguous',
      profileId: 'gym',
      catalogEquipment: 'cable'
    })

    const chosen = resolveEquipmentUse({
      profile: equipmentSnapshot,
      config: { id: CABLE_EXERCISE_ID, equipmentUse: explicitUse(plateLoaded) },
      catalogEquipment: 'cable'
    })
    expect(chosen).toMatchObject({
      status: 'resolved',
      itemId: 'cable-plates',
      source: 'slot_override'
    })
  })

  it('isolates two routine slots that use the same exercise on different cable mechanisms', () => {
    const selector = stack()
    const plateLoaded = plates()
    const equipmentSnapshot = profile([selector, plateLoaded])
    const monday = {
      id: 'monday',
      ex: [{
        id: CABLE_EXERCISE_ID,
        routineExerciseId: 'monday-cable-slot',
        progressionId: 'monday-cable-progress',
        sets: 1,
        reps: 10,
        weight: 60,
        equipmentUse: explicitUse(selector)
      }]
    }
    const thursday = {
      id: 'thursday',
      ex: [{
        id: CABLE_EXERCISE_ID,
        routineExerciseId: 'thursday-cable-slot',
        progressionId: 'thursday-cable-progress',
        sets: 1,
        reps: 10,
        weight: 60,
        equipmentUse: explicitUse(plateLoaded)
      }]
    }

    const mondayEntry = buildScopedWorkoutEntry(state(), monday.ex[0], monday, equipmentSnapshot)
    const thursdayEntry = buildScopedWorkoutEntry(state(), thursday.ex[0], thursday, equipmentSnapshot)

    expect(mondayEntry).toMatchObject({
      id: CABLE_EXERCISE_ID,
      routineExerciseId: 'monday-cable-slot',
      equipmentUse: { itemId: 'cable-stack' }
    })
    expect(mondayEntry.equipmentUse).not.toHaveProperty('cableLoadingMechanism')
    expect(thursdayEntry).toMatchObject({
      id: CABLE_EXERCISE_ID,
      routineExerciseId: 'thursday-cable-slot',
      equipmentUse: { itemId: 'cable-plates' }
    })

    const mondayGuide = equipmentGuideForEntry(mondayEntry, equipmentSnapshot)
    const thursdayGuide = equipmentGuideForEntry(thursdayEntry, equipmentSnapshot)
    expect(mondayGuide).toMatchObject({
      status: 'exact',
      cableLoadingMechanism: CABLE_LOADING_MECHANISM.SELECTOR_STACK,
      exact: { weight: 60 }
    })
    expect(mondayGuide).not.toHaveProperty('perPointWeight')
    expect(thursdayGuide).toMatchObject({
      status: 'manual_per_side',
      cableLoadingMechanism: CABLE_LOADING_MECHANISM.PLATE_LOADED,
      loadingPointCount: 2,
      perPointWeight: 30
    })

    mondayEntry.sets[0].done = true
    thursdayEntry.sets[0].done = true
    const [finishedMonday, finishedThursday] = completedWorkoutEntries([
      structuredClone(mondayEntry), structuredClone(thursdayEntry)
    ])
    expect(finishedMonday.equipmentUse.itemId).toBe('cable-stack')
    expect(finishedThursday.equipmentUse.itemId).toBe('cable-plates')
  })

  it('freezes tare and loading points for the active/completed workout snapshot', () => {
    const rawState = {
      unit: 'kg',
      activeEquipmentProfileId: 'gym',
      equipmentProfiles: [profile([plates({ tareWeight: 0, sideCount: 2 })])]
    }
    const oldSnapshot = snapshotActiveEquipmentProfile(rawState)
    const equipmentUse = resolveEquipmentUse({
      profile: oldSnapshot,
      config: { id: CABLE_EXERCISE_ID, equipmentUse: explicitUse(oldSnapshot.items[0]) },
      catalogEquipment: 'cable'
    })
    const archivedEntry = {
      id: CABLE_EXERCISE_ID,
      equipmentUse,
      sets: [{ w: 60, r: 10, done: false }]
    }
    const archivedWorkout = JSON.parse(JSON.stringify({
      equipmentSnapshot: oldSnapshot,
      entries: [archivedEntry]
    }))

    rawState.equipmentProfiles[0].items[0].tareWeight = 10
    rawState.equipmentProfiles[0].items[0].sideCount = 1
    const nextSnapshot = snapshotActiveEquipmentProfile(rawState)

    expect(equipmentGuideForEntry(
      archivedWorkout.entries[0], archivedWorkout.equipmentSnapshot
    )).toMatchObject({
      status: 'manual_per_side', tareWeight: 0, loadingPointCount: 2, perPointWeight: 30
    })
    expect(calculateLoadingGuide({
      profile: nextSnapshot,
      equipmentUse: resolveEquipmentUse({
        profile: nextSnapshot,
        config: { id: CABLE_EXERCISE_ID, equipmentUse: explicitUse(nextSnapshot.items[0]) },
        catalogEquipment: 'cable'
      }),
      targetWeight: 60,
      workoutUnit: 'kg'
    })).toMatchObject({
      status: 'manual_per_side', tareWeight: 10, loadingPointCount: 1, perPointWeight: 50
    })
  })

  it('keeps old JSON readable and defaults a legacy plate-loaded cable to two points', () => {
    const legacyJson = JSON.stringify({
      id: 'legacy-gym',
      name: 'Legacy gym',
      unit: 'kg',
      items: [{
        id: 'legacy-cable',
        label: 'Legacy cable',
        kind: 'plate_loaded_machine',
        catalogEquipment: 'cable',
        tareWeight: 10,
        denominations: []
      }]
    })
    const normalized = normalizeEquipmentProfile(JSON.parse(legacyJson))
    const use = resolveEquipmentUse({
      profile: normalized,
      config: {
        id: CABLE_EXERCISE_ID,
        equipmentUse: {
          mode: 'item', profileId: 'legacy-gym', itemId: 'legacy-cable',
          catalogEquipment: 'cable', loadSemantics: 'total'
        }
      },
      catalogEquipment: 'cable'
    })

    expect(normalized).toMatchObject({
      schemaVersion: 1,
      items: [{ id: 'legacy-cable', sideCount: 2 }]
    })
    expect(calculateLoadingGuide({
      profile: normalized,
      equipmentUse: use,
      targetWeight: 60,
      workoutUnit: 'kg'
    })).toMatchObject({
      status: 'manual_per_side',
      loadConvention: 'total',
      loadingPointCount: 2,
      perPointWeight: 25
    })

    expect(equipmentGuideForEntry({
      id: CABLE_EXERCISE_ID,
      sets: [{ w: 60, done: false }]
    }, normalized)).toBeNull()
  })

  it('reports physical plate mass and never applies an undeclared pulley conversion', () => {
    const raw = profile([{
      id: 'ratio-cable',
      label: 'Cavo 2:1',
      kind: 'plate_loaded_machine',
      catalogEquipment: 'cable',
      tareWeight: 10,
      sideCount: 2,
      denominations: [],
      pulleyRatio: 0.5,
      effectiveResistanceFactor: 0.5
    }])
    const normalized = normalizeEquipmentProfile(raw)
    const use = resolveEquipmentUse({
      profile: normalized,
      config: {
        id: CABLE_EXERCISE_ID,
        equipmentUse: {
          mode: 'item', profileId: 'gym', itemId: 'ratio-cable',
          catalogEquipment: 'cable', loadSemantics: 'total'
        }
      },
      catalogEquipment: 'cable'
    })
    const guide = calculateLoadingGuide({
      profile: normalized,
      equipmentUse: use,
      targetWeight: 70,
      workoutUnit: 'kg'
    })

    expect(normalized.items[0]).not.toHaveProperty('pulleyRatio')
    expect(normalized.items[0]).not.toHaveProperty('effectiveResistanceFactor')
    expect(guide).toMatchObject({
      targetWeight: 70,
      tareWeight: 10,
      loadingPointCount: 2,
      perPointWeight: 30,
      loadConvention: 'total',
      pulleyRatioApplied: false
    })
    expect(guide).not.toHaveProperty('effectiveResistance')
  })
})
