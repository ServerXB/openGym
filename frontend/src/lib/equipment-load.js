import { isPureBodyweight } from './exercise-load-mode.js'

export const EQUIPMENT_SCHEMA_VERSION = 1

export const EQUIPMENT_KIND = Object.freeze({
  SYMMETRIC_BAR: 'symmetric_bar',
  LOADABLE_DUMBBELL: 'loadable_dumbbell',
  FIXED_WEIGHT: 'fixed_weight',
  MACHINE_STACK: 'machine_stack',
  PLATE_LOADED_MACHINE: 'plate_loaded_machine',
  CUSTOM: 'custom'
})

export const EQUIPMENT_KINDS = Object.freeze(Object.values(EQUIPMENT_KIND))

/**
 * Cable is a catalog category, not a load formula. These values identify the two
 * cable presets supported by the editor while deliberately reusing the existing
 * machine kinds (and therefore the existing snapshot/solver format).
 */
export const CABLE_LOADING_MECHANISM = Object.freeze({
  SELECTOR_STACK: 'selector_stack',
  PLATE_LOADED: 'plate_loaded'
})

export const LOAD_SEMANTICS = Object.freeze({
  TOTAL: 'total',
  PER_IMPLEMENT: 'per_implement',
  MANUAL: 'manual'
})

export const defaultCatalogEquipment = kind => {
  if (kind === EQUIPMENT_KIND.SYMMETRIC_BAR) return 'barbell'
  if (kind === EQUIPMENT_KIND.LOADABLE_DUMBBELL || kind === EQUIPMENT_KIND.FIXED_WEIGHT) {
    return 'dumbbell'
  }
  return ''
}

const VALID_UNITS = new Set(['kg', 'lb'])
const VALID_KINDS = new Set(EQUIPMENT_KINDS)
const VALID_SEMANTICS = new Set(Object.values(LOAD_SEMANTICS))
const MAX_INVENTORY_COUNT = 200
const MAX_IMPLEMENT_COUNT = 20
const MAX_DP_STATES = 250000

const text = value => typeof value === 'string' && value.trim() ? value.trim() : ''
const roundWeight = value => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0
    ? Math.round((n + Number.EPSILON) * 100) / 100
    : 0
}
const positiveInt = (value, fallback = 1, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
    ? Math.min(max, Math.max(1, Math.round(n)))
    : fallback
}
const weightUnits = value => Math.round(roundWeight(value) * 100)
const fromWeightUnits = value => Math.round(value) / 100

/**
 * Return the cable loading mechanism only when both the catalog category and the
 * physical equipment kind make it explicit. In particular, never infer a stack
 * or a plate-loaded machine from an exercise being categorised as `cable` alone.
 */
export function cableLoadingMechanism(item = {}) {
  if (text(item?.catalogEquipment).toLowerCase() !== 'cable') return null
  if (item?.kind === EQUIPMENT_KIND.MACHINE_STACK) return CABLE_LOADING_MECHANISM.SELECTOR_STACK
  if (item?.kind === EQUIPMENT_KIND.PLATE_LOADED_MACHINE) return CABLE_LOADING_MECHANISM.PLATE_LOADED
  return null
}

export const defaultLoadSemantics = kind => {
  if (kind === EQUIPMENT_KIND.LOADABLE_DUMBBELL || kind === EQUIPMENT_KIND.FIXED_WEIGHT) {
    return LOAD_SEMANTICS.PER_IMPLEMENT
  }
  if (kind === EQUIPMENT_KIND.CUSTOM) return LOAD_SEMANTICS.MANUAL
  return LOAD_SEMANTICS.TOTAL
}

function normalizeDenominations(list) {
  const merged = new Map()
  ;(Array.isArray(list) ? list : []).forEach(raw => {
    const weight = roundWeight(raw?.weight)
    if (!(weight > 0)) return
    const parsedCount = raw?.count == null ? 1 : Number(raw.count)
    const count = Number.isFinite(parsedCount)
      ? Math.min(MAX_INVENTORY_COUNT, Math.max(0, Math.round(parsedCount)))
      : 0
    if (!count) return
    const key = weight.toFixed(2)
    const current = merged.get(key)
    if (current) current.count = Math.min(MAX_INVENTORY_COUNT, current.count + count)
    else merged.set(key, { weight, count })
  })
  return [...merged.values()].sort((a, b) => b.weight - a.weight)
}

export function normalizeEquipmentItem(raw = {}, fallbackId = '') {
  const kind = VALID_KINDS.has(raw.kind) ? raw.kind : EQUIPMENT_KIND.CUSTOM
  const id = text(raw.id) || text(fallbackId)
  if (!id) return null
  const sideCount = kind === EQUIPMENT_KIND.PLATE_LOADED_MACHINE
    ? (Number(raw.sideCount) === 1 ? 1 : 2)
    : (kind === EQUIPMENT_KIND.SYMMETRIC_BAR || kind === EQUIPMENT_KIND.LOADABLE_DUMBBELL ? 2 : 1)
  return {
    id,
    kind,
    label: text(raw.label) || id,
    ...(text(raw.catalogEquipment) ? { catalogEquipment: text(raw.catalogEquipment).toLowerCase() } : {}),
    tareWeight: roundWeight(raw.tareWeight),
    implementCount: positiveInt(raw.implementCount, 1, MAX_IMPLEMENT_COUNT),
    sideCount,
    denominations: normalizeDenominations(raw.denominations),
    ...(text(raw.instructions) ? { instructions: text(raw.instructions) } : {})
  }
}

/**
 * Build a normalized cable preset without adding a new persisted kind. The
 * caller supplies the local id (and normally a user-facing label) in `overrides`.
 * Unknown fields such as a speculative pulley ratio are intentionally discarded
 * by normalization: 7A reports physical plate mass and performs no resistance
 * conversion.
 */
export function createCableEquipmentPreset(mechanism, overrides = {}) {
  const kind = mechanism === CABLE_LOADING_MECHANISM.SELECTOR_STACK
    ? EQUIPMENT_KIND.MACHINE_STACK
    : mechanism === CABLE_LOADING_MECHANISM.PLATE_LOADED
      ? EQUIPMENT_KIND.PLATE_LOADED_MACHINE
      : null
  if (!kind) return null
  return normalizeEquipmentItem({
    ...overrides,
    kind,
    catalogEquipment: 'cable',
    ...(kind === EQUIPMENT_KIND.MACHINE_STACK
      ? { tareWeight: 0, sideCount: 1 }
      : { sideCount: Number(overrides.sideCount) === 1 ? 1 : 2 })
  })
}

export function normalizeEquipmentProfile(raw = {}) {
  const id = text(raw.id)
  if (!id) return null
  const seen = new Set()
  const items = []
  ;(Array.isArray(raw.items) ? raw.items : []).forEach((item, index) => {
    const normalized = normalizeEquipmentItem(item, `${id}-item-${index + 1}`)
    if (!normalized || seen.has(normalized.id)) return
    seen.add(normalized.id)
    items.push(normalized)
  })
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id,
    name: text(raw.name) || id,
    unit: VALID_UNITS.has(raw.unit) ? raw.unit : 'kg',
    items,
    ...(VALID_UNITS.has(raw.workoutUnit) ? { workoutUnit: raw.workoutUnit } : {})
  }
}

export function snapshotActiveEquipmentProfile(state = {}) {
  const activeId = text(state.activeEquipmentProfileId)
  if (!activeId) return null
  const raw = (Array.isArray(state.equipmentProfiles) ? state.equipmentProfiles : [])
    .find(profile => profile?.id === activeId)
  const profile = normalizeEquipmentProfile(raw)
  if (!profile) return null
  return {
    ...profile,
    // openGym intentionally does not convert values when the global unit changes. Freezing
    // the label used at workout start makes a later mismatch explicit and auditable.
    workoutUnit: VALID_UNITS.has(state.unit) ? state.unit : 'kg'
  }
}

export function normalizeEquipmentUse(raw = {}) {
  const mode = raw?.mode === 'none' ? 'none' : raw?.mode === 'item' ? 'item' : 'auto'
  if (mode === 'none') return { mode }
  const loadSemantics = VALID_SEMANTICS.has(raw?.loadSemantics) ? raw.loadSemantics : null
  return {
    mode,
    ...(text(raw?.profileId) ? { profileId: text(raw.profileId) } : {}),
    ...(text(raw?.itemId) ? { itemId: text(raw.itemId) } : {}),
    ...(text(raw?.catalogEquipment) ? { catalogEquipment: text(raw.catalogEquipment).toLowerCase() } : {}),
    ...(loadSemantics ? { loadSemantics } : {}),
    implementCount: positiveInt(raw?.implementCount, 1, MAX_IMPLEMENT_COUNT)
  }
}

/**
 * Resolve a routine-slot choice against one frozen profile.
 *
 * The result itself is safe to put on a workout entry: it contains only the binding and
 * semantics. Tare and inventory live once in the workout-level immutable profile snapshot.
 */
export function resolveEquipmentUse({ profile: rawProfile, config = {}, catalogEquipment = '', loadMode } = {}) {
  const configured = normalizeEquipmentUse(config.equipmentUse)
  if (configured.mode === 'none') return { status: 'disabled' }
  if (loadMode === 'pure_bodyweight' || isPureBodyweight(config)) return { status: 'bodyweight' }

  const profile = normalizeEquipmentProfile(rawProfile)
  const category = text(configured.catalogEquipment || catalogEquipment).toLowerCase()
  if (!profile) return { status: 'no_profile', ...(category ? { catalogEquipment: category } : {}) }

  let item = null
  let source = null
  if (configured.mode === 'item' && configured.profileId === profile.id && configured.itemId) {
    item = profile.items.find(candidate => candidate.id === configured.itemId) || null
    if (!item) {
      return {
        status: 'missing_item', profileId: profile.id, itemId: configured.itemId,
        ...(category ? { catalogEquipment: category } : {})
      }
    }
    source = 'slot_override'
  }

  if (!item) {
    if (!category) return { status: 'unmapped', profileId: profile.id }
    const matches = profile.items.filter(candidate => candidate.catalogEquipment === category)
    if (matches.length > 1) {
      return { status: 'ambiguous', profileId: profile.id, catalogEquipment: category }
    }
    if (!matches.length) {
      return { status: 'unmapped', profileId: profile.id, catalogEquipment: category }
    }
    item = matches[0]
    source = 'catalog_match'
  }

  const semantics = configured.loadSemantics || defaultLoadSemantics(item.kind)
  return {
    status: 'resolved',
    profileId: profile.id,
    itemId: item.id,
    kind: item.kind,
    label: item.label,
    ...(item.catalogEquipment ? { catalogEquipment: item.catalogEquipment } : {}),
    loadSemantics: semantics,
    implementCount: configured.implementCount || item.implementCount || 1,
    source
  }
}

const compositionCount = composition => composition.reduce((sum, part) => sum + part.count, 0)
const betterComposition = (candidate, current, weights) => {
  if (!current) return true
  const candidateCount = compositionCount(candidate)
  const currentCount = compositionCount(current)
  if (candidateCount !== currentCount) return candidateCount < currentCount
  // Both arrays follow descending `weights`; preferring more of the first differing heavier
  // plate is a stable tie-break independent of the inventory input order.
  for (let i = 0; i < weights.length; i++) {
    const a = candidate[i]?.count || 0
    const b = current[i]?.count || 0
    if (a !== b) return a > b
  }
  return false
}

/** Bounded, deterministic subset sum. Values and target are integer hundredths. */
export function solveBoundedLoad(denominations, target, {
  inventoryDivisor = 1,
  maxStates = MAX_DP_STATES
} = {}) {
  const divisor = positiveInt(inventoryDivisor, 1, MAX_IMPLEMENT_COUNT * 2)
  const stateLimit = positiveInt(maxStates, MAX_DP_STATES, MAX_DP_STATES)
  const normalized = normalizeDenominations(denominations)
    .map(part => ({ units: weightUnits(part.weight), weight: part.weight, count: Math.floor(part.count / divisor) }))
    .filter(part => part.units > 0 && part.count > 0)
  if (!normalized.length) return { exact: null, lower: { units: 0, composition: [] }, upper: null }

  const safeTarget = Math.max(0, Number(target) || 0)
  const cap = Math.ceil(safeTarget + normalized[0].units)
  let states = new Map([[0, normalized.map(() => ({ count: 0 }))]])

  for (let index = 0; index < normalized.length; index++) {
    const part = normalized[index]
    const next = new Map(states)
    for (const [sum, composition] of states) {
      for (let count = 1; count <= part.count; count++) {
        const candidateSum = sum + count * part.units
        if (candidateSum > cap) break
        const candidate = composition.map((entry, entryIndex) => ({
          count: entryIndex === index ? entry.count + count : entry.count
        }))
        const current = next.get(candidateSum)
        // Never present a result derived from a partially explored inventory. Real gym
        // inventories stay far below this guard; hostile/accidental combinatorial inputs get
        // an explicit safe failure that the UI can explain instead of a plausible wrong load.
        if (!current && next.size >= stateLimit) {
          return { exact: null, lower: null, upper: null, limited: true }
        }
        if (betterComposition(candidate, current, normalized)) next.set(candidateSum, candidate)
      }
    }
    states = next
  }

  const asResult = sum => sum == null ? null : {
    units: sum,
    composition: states.get(sum).map((entry, index) => ({
      weight: normalized[index].weight,
      count: entry.count
    })).filter(entry => entry.count > 0)
  }
  const sums = [...states.keys()].sort((a, b) => a - b)
  const lowerSum = [...sums].reverse().find(sum => sum <= safeTarget)
  const upperSum = sums.find(sum => sum >= safeTarget)
  return {
    exact: Number.isInteger(safeTarget) && states.has(safeTarget) ? asResult(safeTarget) : null,
    lower: asResult(lowerSum),
    upper: asResult(upperSum)
  }
}

const candidate = (solution, item, multiplier) => solution && ({
  weight: fromWeightUnits(weightUnits(item.tareWeight) + solution.units * multiplier),
  composition: solution.composition
})

function plateGuide(item, targetUnits, use, sideCount) {
  const tareUnits = weightUnits(item.tareWeight)
  if (targetUnits < tareUnits) return { status: 'below_tare', tareWeight: item.tareWeight }
  const loadingPoints = Math.max(1, sideCount)
  const inventoryDivisor = loadingPoints * (item.kind === EQUIPMENT_KIND.LOADABLE_DUMBBELL ? use.implementCount : 1)
  const residual = targetUnits - tareUnits
  // Plate inventory is optional. With only the empty-equipment weight configured we can still
  // provide exact arithmetic per loading point and let the athlete compose the plates. Once an
  // inventory exists, the bounded solver below retains the detailed exact/nearest guide.
  if (residual === 0) {
    return {
      status: 'exact',
      tareWeight: item.tareWeight,
      sideCount: loadingPoints,
      inventoryDivisor,
      exact: { weight: item.tareWeight, composition: [] }
    }
  }
  if (!item.denominations.length) {
    return {
      status: 'manual_per_side',
      tareWeight: item.tareWeight,
      sideCount: loadingPoints,
      inventoryDivisor,
      perPointWeight: Math.round((residual / (100 * loadingPoints) + Number.EPSILON) * 1000) / 1000
    }
  }
  const perPointTarget = residual / loadingPoints
  const solved = solveBoundedLoad(item.denominations, perPointTarget, { inventoryDivisor })
  if (solved.limited) {
    return {
      status: 'solver_limit',
      tareWeight: item.tareWeight,
      sideCount: loadingPoints,
      inventoryDivisor
    }
  }
  const exact = Number.isInteger(perPointTarget) ? candidate(solved.exact, item, loadingPoints) : null
  return {
    status: exact ? 'exact' : 'nearest',
    tareWeight: item.tareWeight,
    sideCount: loadingPoints,
    inventoryDivisor,
    exact,
    lower: candidate(solved.lower, item, loadingPoints),
    upper: candidate(solved.upper, item, loadingPoints)
  }
}

function selectableGuide(item, targetUnits, use) {
  const choices = item.denominations
    .filter(part => item.kind === EQUIPMENT_KIND.MACHINE_STACK || part.count >= use.implementCount)
    .map(part => weightUnits(part.weight))
    .sort((a, b) => a - b)
  const exactUnits = choices.find(value => value === targetUnits)
  const lowerUnits = [...choices].reverse().find(value => value <= targetUnits)
  const upperUnits = choices.find(value => value >= targetUnits)
  const asChoice = value => value == null ? null : ({ weight: fromWeightUnits(value), composition: [] })
  return {
    status: exactUnits != null ? 'exact' : 'nearest',
    exact: asChoice(exactUnits),
    lower: asChoice(lowerUnits),
    upper: asChoice(upperUnits)
  }
}

export function calculateLoadingGuide({ profile: rawProfile, equipmentUse = {}, targetWeight, workoutUnit } = {}) {
  const target = Number(targetWeight)
  if (!Number.isFinite(target) || target < 0) return { status: 'invalid' }
  if (equipmentUse.status !== 'resolved') {
    return { status: equipmentUse.status || 'unavailable', reason: equipmentUse.status || 'unavailable' }
  }
  const profile = normalizeEquipmentProfile(rawProfile)
  if (!profile) return { status: 'unavailable', reason: 'no_profile' }
  const unit = VALID_UNITS.has(workoutUnit) ? workoutUnit : profile.workoutUnit || profile.unit
  if (profile.unit !== unit) {
    return { status: 'unit_mismatch', profileUnit: profile.unit, workoutUnit: unit }
  }
  const item = profile.items.find(candidate => candidate.id === equipmentUse.itemId)
  if (!item) return { status: 'unavailable', reason: 'missing_item' }

  const cableMechanism = cableLoadingMechanism(item)
  const plateLoadedCable = cableMechanism === CABLE_LOADING_MECHANISM.PLATE_LOADED

  const base = {
    targetWeight: roundWeight(target), unit, itemId: item.id, itemLabel: item.label,
    kind: item.kind, loadSemantics: equipmentUse.loadSemantics || defaultLoadSemantics(item.kind),
    implementCount: positiveInt(equipmentUse.implementCount, item.implementCount, MAX_IMPLEMENT_COUNT),
    ...(item.catalogEquipment ? { catalogEquipment: item.catalogEquipment } : {}),
    ...(cableMechanism ? { cableLoadingMechanism: cableMechanism } : {}),
    ...(plateLoadedCable ? {
      loadingPointCount: item.sideCount,
      loadConvention: LOAD_SEMANTICS.TOTAL,
      totalAddedWeight: fromWeightUnits(Math.max(0, weightUnits(target) - weightUnits(item.tareWeight))),
      // This guide describes the physical mass put on the loading points. A pulley
      // ratio is machine-specific and must never be guessed from the exercise type.
      pulleyRatioApplied: false
    } : {})
  }
  if (base.loadSemantics !== defaultLoadSemantics(item.kind)) {
    return { ...base, status: 'unsupported', reason: 'incompatible_load_semantics' }
  }
  if (item.kind === EQUIPMENT_KIND.CUSTOM) {
    return { ...base, status: 'manual', instructions: item.instructions || '' }
  }
  if (target === 0) return { ...base, status: 'no_load' }

  const targetUnits = weightUnits(target)
  let solved
  if (item.kind === EQUIPMENT_KIND.SYMMETRIC_BAR) solved = plateGuide(item, targetUnits, base, 2)
  else if (item.kind === EQUIPMENT_KIND.LOADABLE_DUMBBELL) solved = plateGuide(item, targetUnits, base, 2)
  else if (item.kind === EQUIPMENT_KIND.PLATE_LOADED_MACHINE) solved = plateGuide(item, targetUnits, base, item.sideCount)
  else if (item.kind === EQUIPMENT_KIND.FIXED_WEIGHT || item.kind === EQUIPMENT_KIND.MACHINE_STACK) {
    solved = selectableGuide(item, targetUnits, base)
  } else return { ...base, status: 'unsupported' }

  return { ...base, ...solved }
}

export function equipmentGuideForEntry(entry, equipmentSnapshot) {
  if (!entry || !equipmentSnapshot || !entry.equipmentUse) return null
  const sets = Array.isArray(entry.sets) ? entry.sets : []
  const next = sets.find(set => !set?.done)
  if (!next || !Object.prototype.hasOwnProperty.call(next, 'w')) return null
  return calculateLoadingGuide({
    profile: equipmentSnapshot,
    equipmentUse: entry.equipmentUse,
    targetWeight: next.w,
    workoutUnit: equipmentSnapshot.workoutUnit
  })
}

export function portableEquipmentUse(raw = {}) {
  const use = normalizeEquipmentUse(raw)
  if (use.mode === 'none') return use
  if (!use.loadSemantics && !use.catalogEquipment && use.implementCount === 1) return null
  return {
    mode: 'auto',
    ...(use.catalogEquipment ? { catalogEquipment: use.catalogEquipment } : {}),
    ...(use.loadSemantics ? { loadSemantics: use.loadSemantics } : {}),
    ...(use.implementCount !== 1 ? { implementCount: use.implementCount } : {})
  }
}
