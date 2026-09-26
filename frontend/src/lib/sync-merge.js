import { canonicalizeSyncState } from './sync-state.js'

const MISSING = Symbol('missing')
const IDENTITY_FIELDS = [
  // Slot/snapshot ids describe the entity instance. The catalogue exercise `id` can legitimately
  // change while the routine slot remains the same, so it must not win merely because it exists.
  'routineExerciseId', 'workoutExerciseId', 'entryId', 'progressionScopeId',
  'scopeId', 'id', 'start', 'd', 'date'
]

const isObject = value => value !== MISSING && value !== null
  && typeof value === 'object' && !Array.isArray(value)

function clone(value) {
  if (value === MISSING) return MISSING
  return JSON.parse(JSON.stringify(value))
}

function equal(left, right) {
  if (left === MISSING || right === MISSING) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

function pointerPart(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1')
}

function childPath(path, key) {
  return `${path}/${pointerPart(key)}`
}

function conflictValue(value) {
  return value === MISSING ? undefined : clone(value)
}

function addConflict(context, { path, base, local, remote, reason = 'value' }) {
  if (context.recordConflicts) {
    const conflict = {
      path: path || '/', reason,
      baseExists: base !== MISSING,
      localExists: local !== MISSING,
      remoteExists: remote !== MISSING
    }
    if (base !== MISSING) conflict.base = conflictValue(base)
    if (local !== MISSING) conflict.local = conflictValue(local)
    if (remote !== MISSING) conflict.remote = conflictValue(remote)
    context.conflicts.push(conflict)
  }
  return clone(context.conflictWinner === 'remote' ? remote : local)
}

function identityDescriptor(arrays) {
  const values = arrays.flat().filter(value => value !== MISSING)
  if (!values.length || values.some(value => !isObject(value))) return null

  for (const field of IDENTITY_FIELDS) {
    let valid = true
    for (const array of arrays) {
      const ids = new Set()
      for (const value of array) {
        if (!isObject(value) || value[field] === undefined || value[field] === null
          || value[field] === '') {
          valid = false
          break
        }
        const id = `${typeof value[field]}:${JSON.stringify(value[field])}`
        if (ids.has(id)) {
          valid = false
          break
        }
        ids.add(id)
      }
      if (!valid) break
    }
    if (valid) return { field, key: value => `${typeof value[field]}:${JSON.stringify(value[field])}` }
  }
  return null
}

function sameRelativeBaseOrder(sequence, baseSequence) {
  const baseSet = new Set(baseSequence)
  const actual = sequence.filter(key => baseSet.has(key))
  const actualSet = new Set(actual)
  const expected = baseSequence.filter(key => actualSet.has(key))
  return equal(actual, expected)
}

function edgeList(sequence, baseSet, includeBaseEdges) {
  const edges = []
  for (let index = 1; index < sequence.length; index += 1) {
    const from = sequence[index - 1]
    const to = sequence[index]
    if (includeBaseEdges || !baseSet.has(from) || !baseSet.has(to)) edges.push([from, to])
  }
  return edges
}

function topologicalOrder(nodes, edges) {
  const nodeSet = new Set(nodes)
  const outgoing = new Map(nodes.map(key => [key, new Set()]))
  const incoming = new Map(nodes.map(key => [key, 0]))
  for (const [from, to] of edges) {
    if (from === to || !nodeSet.has(from) || !nodeSet.has(to) || outgoing.get(from).has(to)) continue
    outgoing.get(from).add(to)
    incoming.set(to, incoming.get(to) + 1)
  }

  const ready = nodes.filter(key => incoming.get(key) === 0).sort()
  const result = []
  while (ready.length) {
    const key = ready.shift()
    result.push(key)
    for (const target of [...outgoing.get(key)].sort()) {
      incoming.set(target, incoming.get(target) - 1)
      if (incoming.get(target) === 0) {
        ready.push(target)
        ready.sort()
      }
    }
  }
  return result.length === nodes.length ? result : null
}

function completedSideOrder(sideSequence, finalKeys) {
  const finalSet = new Set(finalKeys)
  const present = sideSequence.filter(key => finalSet.has(key))
  const seen = new Set(present)
  return present.concat(finalKeys.filter(key => !seen.has(key)).sort())
}

function mergeKeyOrder(baseKeys, localKeys, remoteKeys, finalKeys, path, context) {
  const finalSet = new Set(finalKeys)
  const base = baseKeys.filter(key => finalSet.has(key))
  const local = localKeys.filter(key => finalSet.has(key))
  const remote = remoteKeys.filter(key => finalSet.has(key))
  const baseSet = new Set(base)
  const localReordered = !sameRelativeBaseOrder(local, base)
  const remoteReordered = !sameRelativeBaseOrder(remote, base)

  const edges = []
  if (!localReordered && !remoteReordered) {
    edges.push(...edgeList(base, baseSet, true))
    edges.push(...edgeList(local, baseSet, false), ...edgeList(remote, baseSet, false))
  } else if (localReordered && !remoteReordered) {
    edges.push(...edgeList(local, baseSet, true), ...edgeList(remote, baseSet, false))
  } else if (!localReordered && remoteReordered) {
    edges.push(...edgeList(remote, baseSet, true), ...edgeList(local, baseSet, false))
  } else {
    edges.push(...edgeList(local, baseSet, true), ...edgeList(remote, baseSet, true))
  }

  const ordered = topologicalOrder([...finalSet].sort(), edges)
  if (ordered) return ordered

  addConflict(context, {
    path: childPath(path, '$order'), base: baseKeys, local: localKeys, remote: remoteKeys,
    reason: 'array-order'
  })
  return completedSideOrder(context.conflictWinner === 'remote' ? remoteKeys : localKeys, finalKeys)
}

function mergeKeyedArray(base, local, remote, path, context, descriptor) {
  const mapOf = values => new Map(values.map(value => [descriptor.key(value), value]))
  const baseMap = mapOf(base)
  const localMap = mapOf(local)
  const remoteMap = mapOf(remote)
  const allKeys = [...new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()])].sort()
  const merged = new Map()

  for (const key of allKeys) {
    const value = mergeNode(
      baseMap.has(key) ? baseMap.get(key) : MISSING,
      localMap.has(key) ? localMap.get(key) : MISSING,
      remoteMap.has(key) ? remoteMap.get(key) : MISSING,
      childPath(path, `@${descriptor.field}=${key}`),
      context
    )
    if (value !== MISSING) merged.set(key, value)
  }

  const order = mergeKeyOrder(
    base.map(descriptor.key), local.map(descriptor.key), remote.map(descriptor.key),
    [...merged.keys()], path, context
  )
  return order.map(key => merged.get(key))
}

function mergeNode(base, local, remote, path, context) {
  if (equal(local, remote)) return clone(local)
  if (equal(local, base)) return clone(remote)
  if (equal(remote, base)) return clone(local)

  if (isObject(local) && isObject(remote) && (base === MISSING || isObject(base))) {
    const baseObject = base === MISSING ? {} : base
    const result = {}
    const keys = [...new Set([
      ...Object.keys(baseObject), ...Object.keys(local), ...Object.keys(remote)
    ])].sort()
    for (const key of keys) {
      const value = mergeNode(
        Object.hasOwn(baseObject, key) ? baseObject[key] : MISSING,
        Object.hasOwn(local, key) ? local[key] : MISSING,
        Object.hasOwn(remote, key) ? remote[key] : MISSING,
        childPath(path, key), context
      )
      if (value !== MISSING) result[key] = value
    }
    return result
  }

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const descriptor = identityDescriptor([base, local, remote])
    if (descriptor) return mergeKeyedArray(base, local, remote, path, context, descriptor)
  }

  return addConflict(context, { path, base, local, remote })
}

/**
 * Three-way JSON merge. Object properties and stable-id entity arrays merge independently;
 * unidentifiable arrays are atomic so concurrent set/repetition edits can never be silently
 * interleaved. The provisional value uses the local side for conflicts and lists every choice.
 */
export function threeWayMerge({ base = {}, local = {}, remote = {} } = {}, options = {}) {
  const context = {
    conflicts: [],
    conflictWinner: options.conflictWinner === 'remote' ? 'remote' : 'local',
    recordConflicts: options.recordConflicts !== false
  }
  const state = mergeNode(
    canonicalizeSyncState(base),
    canonicalizeSyncState(local),
    canonicalizeSyncState(remote),
    '', context
  )
  return { state, conflicts: context.conflicts, clean: context.conflicts.length === 0 }
}

/** Resolve only ambiguous nodes in favour of one side; all conflict-free merged changes remain. */
export function resolveThreeWayMerge({ base = {}, local = {}, remote = {} } = {}, side = 'local') {
  if (side !== 'local' && side !== 'remote') throw new TypeError('Resolution side must be local or remote')
  const result = threeWayMerge({ base, local, remote }, {
    conflictWinner: side,
    recordConflicts: false
  })
  return { ...result, resolvedWith: side }
}
