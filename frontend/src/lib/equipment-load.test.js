import { describe, expect, it } from 'vitest'
import {
  EQUIPMENT_KIND,
  LOAD_SEMANTICS,
  calculateLoadingGuide,
  defaultCatalogEquipment,
  equipmentGuideForEntry,
  normalizeEquipmentProfile,
  portableEquipmentUse,
  resolveEquipmentUse,
  snapshotActiveEquipmentProfile,
  solveBoundedLoad
} from './equipment-load.js'

const bar = (overrides = {}) => ({
  id: 'bar-20', label: 'Olympic bar', kind: EQUIPMENT_KIND.SYMMETRIC_BAR,
  catalogEquipment: 'barbell', tareWeight: 20,
  denominations: [
    { weight: 20, count: 2 }, { weight: 10, count: 2 },
    { weight: 5, count: 2 }, { weight: 2.5, count: 2 }, { weight: 1.25, count: 2 }
  ],
  ...overrides
})

const profile = (items = [bar()], overrides = {}) => ({
  id: 'gym', name: 'Gym', unit: 'kg', items, ...overrides
})

const resolved = (item, overrides = {}) => ({
  status: 'resolved', profileId: 'gym', itemId: item.id, kind: item.kind,
  label: item.label, loadSemantics: item.kind === EQUIPMENT_KIND.LOADABLE_DUMBBELL
    || item.kind === EQUIPMENT_KIND.FIXED_WEIGHT
    ? LOAD_SEMANTICS.PER_IMPLEMENT
    : LOAD_SEMANTICS.TOTAL,
  implementCount: 1, source: 'slot_override', ...overrides
})

describe('equipment profile normalization', () => {
  it('uses a coherent catalog suggestion when the equipment kind changes', () => {
    expect(defaultCatalogEquipment(EQUIPMENT_KIND.SYMMETRIC_BAR)).toBe('barbell')
    expect(defaultCatalogEquipment(EQUIPMENT_KIND.LOADABLE_DUMBBELL)).toBe('dumbbell')
    expect(defaultCatalogEquipment(EQUIPMENT_KIND.FIXED_WEIGHT)).toBe('dumbbell')
    expect(defaultCatalogEquipment(EQUIPMENT_KIND.MACHINE_STACK)).toBe('')
  })

  it('normalizes decimals, merges duplicate denominations and never mutates input', () => {
    const raw = profile([bar({
      tareWeight: 19.999,
      denominations: [
        { weight: 1.251, count: 2 }, { weight: 1.25, count: 2 },
        { weight: -5, count: 3 }, { weight: 5, count: 0 }, { weight: 10, count: 'bad' }
      ]
    })])
    const before = structuredClone(raw)

    const normalized = normalizeEquipmentProfile(raw)

    expect(normalized).toMatchObject({ schemaVersion: 1, id: 'gym', unit: 'kg' })
    expect(normalized.items[0]).toMatchObject({ tareWeight: 20, sideCount: 2 })
    expect(normalized.items[0].denominations).toEqual([{ weight: 1.25, count: 4 }])
    expect(raw).toEqual(before)
  })

  it('drops duplicate item ids and degrades unknown kinds to manual custom equipment', () => {
    const normalized = normalizeEquipmentProfile(profile([
      bar(), bar({ label: 'Duplicate' }), { id: 'odd', kind: 'future_kind', label: 'Odd' }
    ]))
    expect(normalized.items).toHaveLength(2)
    expect(normalized.items[1]).toMatchObject({ id: 'odd', kind: EQUIPMENT_KIND.CUSTOM })
  })

  it('snapshots only the explicitly active profile and freezes the workout unit', () => {
    const state = { unit: 'lb', activeEquipmentProfileId: 'gym', equipmentProfiles: [profile()] }
    const snapshot = snapshotActiveEquipmentProfile(state)
    state.equipmentProfiles[0].items[0].tareWeight = 15
    expect(snapshot).toMatchObject({ id: 'gym', unit: 'kg', workoutUnit: 'lb' })
    expect(snapshot.items[0].tareWeight).toBe(20)
    expect(snapshotActiveEquipmentProfile({ equipmentProfiles: [profile()] })).toBeNull()
  })
})

describe('deterministic bounded load solver', () => {
  it('finds a non-greedy exact solution', () => {
    const result = solveBoundedLoad([
      { weight: 4, count: 1 }, { weight: 3, count: 2 }
    ], 600)
    expect(result.exact).toEqual({ units: 600, composition: [{ weight: 3, count: 2 }] })
  })

  it('prefers fewer plates, then heavier plates, independently of input order', () => {
    const a = [{ weight: 5, count: 2 }, { weight: 6, count: 1 }, { weight: 4, count: 1 }]
    const b = [...a].reverse()
    expect(solveBoundedLoad(a, 1000).exact.composition).toEqual([
      { weight: 6, count: 1 }, { weight: 4, count: 1 }
    ])
    expect(solveBoundedLoad(b, 1000).exact.composition)
      .toEqual(solveBoundedLoad(a, 1000).exact.composition)
  })

  it('returns closest lower and upper solutions at hundredth precision', () => {
    const result = solveBoundedLoad([
      { weight: 1.25, count: 4 }, { weight: 0.5, count: 2 }
    ], 180)
    expect(result.exact).toBeNull()
    expect(result.lower.units).toBe(175)
    expect(result.upper.units).toBe(225)
  })

  it('fails explicitly instead of returning a partial result when the safety limit is reached', () => {
    const result = solveBoundedLoad([
      { weight: 4, count: 2 }, { weight: 3, count: 2 }
    ], 600, { maxStates: 2 })
    expect(result).toEqual({ exact: null, lower: null, upper: null, limited: true })
  })

  it('normalizes an invalid inventory divisor instead of creating unbounded counts', () => {
    expect(solveBoundedLoad([{ weight: 3, count: 2 }], 600, { inventoryDivisor: 0 }).exact)
      .toEqual({ units: 600, composition: [{ weight: 3, count: 2 }] })
  })
})

describe('equipment binding resolution', () => {
  it('gives a valid slot override priority over catalog matching', () => {
    const items = [bar(), bar({ id: 'special', label: 'Special bar', catalogEquipment: 'other' })]
    const result = resolveEquipmentUse({
      profile: profile(items), catalogEquipment: 'barbell',
      config: { id: 'bench', equipmentUse: { mode: 'item', profileId: 'gym', itemId: 'special' } }
    })
    expect(result).toMatchObject({ status: 'resolved', itemId: 'special', source: 'slot_override' })
  })

  it('auto-maps only one exact catalog match and reports ambiguity', () => {
    const one = resolveEquipmentUse({ profile: profile(), catalogEquipment: 'barbell', config: { id: 'bench' } })
    expect(one).toMatchObject({ status: 'resolved', itemId: 'bar-20', source: 'catalog_match' })

    const two = resolveEquipmentUse({
      profile: profile([bar(), bar({ id: 'bar-15', tareWeight: 15 })]),
      catalogEquipment: 'barbell', config: { id: 'bench' }
    })
    expect(two).toMatchObject({ status: 'ambiguous', catalogEquipment: 'barbell' })
  })

  it('does not silently replace a deleted override in the same profile', () => {
    const result = resolveEquipmentUse({
      profile: profile(), catalogEquipment: 'barbell',
      config: { id: 'bench', equipmentUse: { mode: 'item', profileId: 'gym', itemId: 'gone' } }
    })
    expect(result).toMatchObject({ status: 'missing_item', itemId: 'gone' })
  })

  it('falls back to the exact catalog mapping after switching profiles', () => {
    const result = resolveEquipmentUse({
      profile: profile([bar({ id: 'home-bar', tareWeight: 15 })], { id: 'home' }),
      catalogEquipment: 'barbell',
      config: {
        id: 'bench',
        equipmentUse: { mode: 'item', profileId: 'gym', itemId: 'bar-20', catalogEquipment: 'barbell' }
      }
    })
    expect(result).toMatchObject({ status: 'resolved', profileId: 'home', itemId: 'home-bar', source: 'catalog_match' })
  })

  it('never maps pure bodyweight implicitly', () => {
    expect(resolveEquipmentUse({
      profile: profile(), catalogEquipment: 'barbell',
      config: { id: 'push-up', bodyweight: true, weight: 0 }
    })).toEqual({ status: 'bodyweight' })
  })
})

describe('loading guide', () => {
  it('calculates the load per side when plate inventory is intentionally empty', () => {
    const item = bar({ tareWeight: 9.75, denominations: [] })
    const guide = calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 116.75, workoutUnit: 'kg'
    })
    expect(guide).toMatchObject({
      status: 'manual_per_side',
      targetWeight: 116.75,
      tareWeight: 9.75,
      sideCount: 2,
      perPointWeight: 53.5
    })
  })

  it('keeps millimetric per-side arithmetic exact and handles an empty bar without inventory', () => {
    const item = bar({ tareWeight: 9.75, denominations: [] })
    expect(calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 10.76, workoutUnit: 'kg'
    })).toMatchObject({ status: 'manual_per_side', perPointWeight: 0.505 })
    expect(calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 9.75, workoutUnit: 'kg'
    })).toMatchObject({ status: 'exact', exact: { weight: 9.75, composition: [] } })
    expect(calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 9.5, workoutUnit: 'kg'
    })).toMatchObject({ status: 'below_tare', tareWeight: 9.75 })
  })

  it('applies inventory-free arithmetic to loadable dumbbells and plate-loaded machines', () => {
    const dumbbell = {
      id: 'db', label: 'Loadable dumbbell', kind: EQUIPMENT_KIND.LOADABLE_DUMBBELL,
      catalogEquipment: 'dumbbell', tareWeight: 2, denominations: []
    }
    expect(calculateLoadingGuide({
      profile: profile([dumbbell]),
      equipmentUse: resolved(dumbbell, { implementCount: 2 }),
      targetWeight: 20,
      workoutUnit: 'kg'
    })).toMatchObject({
      status: 'manual_per_side', implementCount: 2, sideCount: 2, perPointWeight: 9
    })

    const machine = sideCount => ({
      id: `machine-${sideCount}`, label: 'Plate machine', kind: EQUIPMENT_KIND.PLATE_LOADED_MACHINE,
      tareWeight: 10, sideCount, denominations: []
    })
    for (const [sideCount, perPointWeight] of [[1, 50], [2, 25]]) {
      const item = machine(sideCount)
      expect(calculateLoadingGuide({
        profile: profile([item]), equipmentUse: resolved(item), targetWeight: 60, workoutUnit: 'kg'
      })).toMatchObject({ status: 'manual_per_side', sideCount, perPointWeight })
    }
  })

  it('loads a 70 kg target on a 20 kg bar as 20 + 5 kg per side', () => {
    const item = bar()
    const guide = calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 70, workoutUnit: 'kg'
    })
    expect(guide).toMatchObject({ status: 'exact', targetWeight: 70, tareWeight: 20, sideCount: 2 })
    expect(guide.exact).toEqual({
      weight: 70,
      composition: [{ weight: 20, count: 1 }, { weight: 5, count: 1 }]
    })
  })

  it('respects symmetry and reports insufficient inventory without changing target', () => {
    const item = bar({ denominations: [{ weight: 20, count: 1 }] })
    const guide = calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 60, workoutUnit: 'kg'
    })
    expect(guide.status).toBe('nearest')
    expect(guide.targetWeight).toBe(60)
    expect(guide.lower.weight).toBe(20)
    expect(guide.upper).toBeNull()
  })

  it('distinguishes an impossible hundredth from its closest lower and upper loads', () => {
    const item = bar({ denominations: [{ weight: 20, count: 2 }, { weight: 1.25, count: 4 }] })
    const guide = calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 63.75, workoutUnit: 'kg'
    })
    expect(guide).toMatchObject({ status: 'nearest', targetWeight: 63.75 })
    expect(guide.lower.weight).toBe(62.5)
    expect(guide.upper.weight).toBe(65)
  })

  it('handles tare-only and below-tare targets explicitly', () => {
    const item = bar()
    expect(calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 20, workoutUnit: 'kg'
    })).toMatchObject({ status: 'exact', exact: { weight: 20, composition: [] } })
    expect(calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 15, workoutUnit: 'kg'
    })).toMatchObject({ status: 'below_tare', tareWeight: 20, targetWeight: 15 })
  })

  it('treats a dumbbell target as the weight of one dumbbell and counts implements separately', () => {
    const item = {
      id: 'db', label: 'Loadable dumbbell', kind: EQUIPMENT_KIND.LOADABLE_DUMBBELL,
      catalogEquipment: 'dumbbell', tareWeight: 2,
      denominations: [{ weight: 5, count: 4 }, { weight: 2, count: 4 }]
    }
    const single = calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 20, workoutUnit: 'kg'
    })
    expect(single).toMatchObject({ status: 'exact', implementCount: 1, exact: { weight: 20 } })
    expect(single.exact.composition).toEqual([{ weight: 5, count: 1 }, { weight: 2, count: 2 }])

    const pair = calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item, { implementCount: 2 }),
      targetWeight: 20, workoutUnit: 'kg'
    })
    expect(pair).toMatchObject({ status: 'nearest', implementCount: 2, lower: { weight: 16 } })
    expect(pair.targetWeight).toBe(20)
  })

  it('requires enough fixed implements and treats stack values as selectable loads', () => {
    const fixed = {
      id: 'fixed', label: 'Fixed dumbbells', kind: EQUIPMENT_KIND.FIXED_WEIGHT,
      denominations: [{ weight: 17.5, count: 2 }, { weight: 20, count: 1 }, { weight: 22.5, count: 2 }]
    }
    const fixedGuide = calculateLoadingGuide({
      profile: profile([fixed]), equipmentUse: resolved(fixed, { implementCount: 2 }),
      targetWeight: 20, workoutUnit: 'kg'
    })
    expect(fixedGuide).toMatchObject({
      status: 'nearest', implementCount: 2, lower: { weight: 17.5 }, upper: { weight: 22.5 }
    })

    const stack = {
      id: 'stack', label: 'Cable stack', kind: EQUIPMENT_KIND.MACHINE_STACK,
      denominations: [{ weight: 5, count: 1 }, { weight: 10, count: 1 }]
    }
    expect(calculateLoadingGuide({
      profile: profile([stack]), equipmentUse: resolved(stack), targetWeight: 10, workoutUnit: 'kg'
    })).toMatchObject({ status: 'exact', exact: { weight: 10 } })
  })

  it('supports one- and two-sided plate-loaded machines', () => {
    const machine = sideCount => ({
      id: `machine-${sideCount}`, label: 'Plate machine', kind: EQUIPMENT_KIND.PLATE_LOADED_MACHINE,
      tareWeight: 10, sideCount, denominations: [{ weight: 20, count: 2 }, { weight: 5, count: 2 }]
    })
    const one = machine(1)
    const two = machine(2)
    expect(calculateLoadingGuide({
      profile: profile([one]), equipmentUse: resolved(one), targetWeight: 35, workoutUnit: 'kg'
    })).toMatchObject({ status: 'exact', sideCount: 1, exact: { weight: 35 } })
    expect(calculateLoadingGuide({
      profile: profile([two]), equipmentUse: resolved(two), targetWeight: 60, workoutUnit: 'kg'
    })).toMatchObject({ status: 'exact', sideCount: 2, exact: { weight: 60 } })
  })

  it('never invents a formula for custom equipment and rejects incompatible units or semantics', () => {
    const custom = {
      id: 'band', label: 'Red band', kind: EQUIPMENT_KIND.CUSTOM,
      instructions: 'Use the red band', denominations: []
    }
    expect(calculateLoadingGuide({
      profile: profile([custom]), equipmentUse: resolved(custom, { loadSemantics: LOAD_SEMANTICS.MANUAL }),
      targetWeight: 10, workoutUnit: 'kg'
    })).toMatchObject({ status: 'manual', instructions: 'Use the red band' })

    const item = bar()
    expect(calculateLoadingGuide({
      profile: profile([item]), equipmentUse: resolved(item), targetWeight: 70, workoutUnit: 'lb'
    })).toMatchObject({ status: 'unit_mismatch', profileUnit: 'kg', workoutUnit: 'lb' })
    expect(calculateLoadingGuide({
      profile: profile([item]),
      equipmentUse: resolved(item, { loadSemantics: LOAD_SEMANTICS.PER_IMPLEMENT }),
      targetWeight: 70, workoutUnit: 'kg'
    })).toMatchObject({ status: 'unsupported', reason: 'incompatible_load_semantics' })
  })

  it('follows the next unfinished set and disappears once every set is done', () => {
    const item = bar()
    const snapshot = { ...profile([item]), workoutUnit: 'kg' }
    const entry = {
      equipmentUse: resolved(item),
      sets: [{ w: 60, done: true }, { w: 70, done: false }, { w: 75, done: false }]
    }
    expect(equipmentGuideForEntry(entry, snapshot)).toMatchObject({ targetWeight: 70, status: 'exact' })
    entry.sets[1].w = 75
    expect(equipmentGuideForEntry(entry, snapshot)).toMatchObject({ targetWeight: 75, status: 'exact' })
    entry.sets.forEach(set => { set.done = true })
    expect(equipmentGuideForEntry(entry, snapshot)).toBeNull()
  })

  it('exports only portable semantics, never local profile or item ids', () => {
    expect(portableEquipmentUse({
      mode: 'item', profileId: 'private-gym', itemId: 'private-bar',
      catalogEquipment: 'barbell', loadSemantics: 'total', implementCount: 1
    })).toEqual({ mode: 'auto', catalogEquipment: 'barbell', loadSemantics: 'total' })
    expect(portableEquipmentUse({ mode: 'none', profileId: 'private' })).toEqual({ mode: 'none' })
  })
})
