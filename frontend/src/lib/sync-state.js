const JSON_VALUE = Symbol('json-value')

export const SYNC_PROTOCOL_VERSION = 1
export const SYNC_ENVELOPE_VERSION = 2
export const DEFAULT_LEGACY_STATE_KEY = 'gym_state_v1'
export const DEFAULT_LEGACY_DIRTY_KEY = 'gym_dirty'
export const LEGACY_OWNER_KEY = 'gym_profile_v2:legacy-owner'
export const DEVICE_ID_KEY = 'gym_sync_device_id'

export const SYNC_STATUS = Object.freeze({
  OFFLINE_LOCAL: 'offline_local',
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  AUTH_REQUIRED: 'auth_required',
  STORAGE_ERROR: 'storage_error'
})

const STATUS_VALUES = new Set(Object.values(SYNC_STATUS))
const LOCAL_ONLY_STATE_KEYS = new Set([
  'active', '_ts', '_sync', '__sync', 'sync', 'syncMeta', 'syncMetadata'
])

function jsonClone(value, fallback = null) {
  if (value === undefined) return fallback
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return fallback
  }
}

function sortedJson(value, marker = JSON_VALUE) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return marker
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => {
      const normalized = sortedJson(item, marker)
      return normalized === marker ? null : normalized
    })
  }
  const result = {}
  for (const key of Object.keys(value).sort()) {
    const normalized = sortedJson(value[key], marker)
    if (normalized !== marker) result[key] = normalized
  }
  return result
}

/**
 * Return the durable domain snapshot sent to the server. In-progress workouts and all
 * transport metadata remain local, while nested properties with the same names are kept.
 */
export function canonicalizeSyncState(state) {
  const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  const syncable = {}
  for (const [key, value] of Object.entries(source)) {
    if (!LOCAL_ONLY_STATE_KEYS.has(key) && !key.startsWith('__sync')) syncable[key] = value
  }
  return sortedJson(syncable)
}

export function stableStringifySyncState(state) {
  return JSON.stringify(canonicalizeSyncState(state))
}

export function sameSyncState(left, right) {
  return stableStringifySyncState(left) === stableStringifySyncState(right)
}

function normalizedAccountId(accountId) {
  if (accountId === null || accountId === undefined || accountId === '') return 'guest'
  return String(accountId)
}

export function accountStateKey(accountId) {
  return `gym_profile_v2:${encodeURIComponent(normalizedAccountId(accountId))}`
}

export function createMutationId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** A browser-installation id shared by account envelopes, never by domain snapshots. */
export function getOrCreateDeviceId(storage, { createId = createMutationId } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new SyncStorageError('access', DEVICE_ID_KEY, new Error('Storage is unavailable'))
  }
  let existing
  try {
    existing = storage?.getItem(DEVICE_ID_KEY)
  } catch (error) {
    throw new SyncStorageError('read', DEVICE_ID_KEY, error)
  }
  if (typeof existing === 'string' && existing.trim()) return existing

  const created = createId()
  if (typeof created !== 'string' || !created.trim()) {
    throw new TypeError('Device id factory must return a non-empty string')
  }
  try {
    storage?.setItem(DEVICE_ID_KEY, created)
    // Re-read to converge when two tabs initialize the installation concurrently.
    return storage?.getItem(DEVICE_ID_KEY) || created
  } catch (error) {
    throw new SyncStorageError('write', DEVICE_ID_KEY, error)
  }
}

export function createSyncMetadata(overrides = {}) {
  const localGeneration = Math.max(0, Number.isSafeInteger(overrides.localGeneration)
    ? overrides.localGeneration : 0)
  const acknowledgedGeneration = Math.min(localGeneration, Math.max(0,
    Number.isSafeInteger(overrides.acknowledgedGeneration) ? overrides.acknowledgedGeneration : 0))
  const pending = overrides.pending === true || localGeneration > acknowledgedGeneration
  const conflict = overrides.conflict ? jsonClone(overrides.conflict) : null
  const requestedStatus = STATUS_VALUES.has(overrides.status) ? overrides.status : null
  const attempted = overrides.lastAttempt
  const lastAttempt = attempted && typeof attempted.mutationId === 'string' && attempted.mutationId
    && Number.isSafeInteger(attempted.generation) && attempted.generation >= 0
    && attempted.generation <= localGeneration
    && Number.isSafeInteger(attempted.baseRevision) && attempted.baseRevision >= 0
    ? {
        mutationId: attempted.mutationId,
        generation: attempted.generation,
        baseRevision: attempted.baseRevision,
        snapshot: canonicalizeSyncState(attempted.snapshot),
        startedAt: Number.isFinite(attempted.startedAt) ? attempted.startedAt : null
      }
    : null

  return {
    protocol: SYNC_PROTOCOL_VERSION,
    revision: Math.max(0, Number.isSafeInteger(overrides.revision) ? overrides.revision : 0),
    base: overrides.base == null ? null : canonicalizeSyncState(overrides.base),
    localGeneration,
    acknowledgedGeneration,
    pending,
    mutationId: pending && typeof overrides.mutationId === 'string' && overrides.mutationId
      ? overrides.mutationId : null,
    status: conflict
      ? SYNC_STATUS.CONFLICT
      : (requestedStatus || (pending ? SYNC_STATUS.PENDING : SYNC_STATUS.SYNCED)),
    lastSyncAt: Number.isFinite(overrides.lastSyncAt) ? overrides.lastSyncAt : null,
    lastError: overrides.lastError ? jsonClone(overrides.lastError) : null,
    lastAttempt,
    conflict
  }
}

export function createStateEnvelope({ accountId = null, state = {}, sync = {} } = {}) {
  return {
    schemaVersion: SYNC_ENVELOPE_VERSION,
    accountId: normalizedAccountId(accountId),
    state: jsonClone(state, {}),
    sync: createSyncMetadata(sync)
  }
}

function hydrateState(rawState, defaults, { prepare, normalize } = {}) {
  const state = Object.assign(jsonClone(defaults, {}), jsonClone(rawState, {}))
  prepare?.(state)
  const normalized = normalize?.(state)
  return jsonClone(normalized === undefined ? state : normalized, {})
}

function storageFailure(operation, key, cause) {
  return {
    code: 'SYNC_STORAGE_ERROR',
    operation,
    key,
    message: cause?.message || String(cause || 'Storage unavailable')
  }
}

export class SyncStorageError extends Error {
  constructor(operation, key, cause) {
    super(`Unable to ${operation} sync storage key ${key}: ${cause?.message || cause || 'unknown error'}`)
    this.name = 'SyncStorageError'
    this.code = 'SYNC_STORAGE_ERROR'
    this.operation = operation
    this.key = key
    this.cause = cause
  }
}

function readRaw(storage, key) {
  try {
    return { value: storage?.getItem(key) ?? null, error: null }
  } catch (error) {
    return { value: null, error: storageFailure('read', key, error) }
  }
}

/**
 * Load an account-scoped envelope. A legacy value is copied once and claimed by its first
 * account, which prevents a later login on the same browser importing another user's data.
 * Parsing/write failures are returned instead of being mistaken for an empty saved profile.
 */
export function loadAccountEnvelope(storage, {
  accountId = null,
  defaults = {},
  legacyKey = DEFAULT_LEGACY_STATE_KEY,
  legacyDirtyKey = DEFAULT_LEGACY_DIRTY_KEY,
  legacyOwnerKey = LEGACY_OWNER_KEY,
  prepare,
  normalize
} = {}) {
  const id = normalizedAccountId(accountId)
  const key = accountStateKey(id)
  const scoped = readRaw(storage, key)
  if (scoped.error) {
    return {
      envelope: createStateEnvelope({ accountId: id, state: hydrateState({}, defaults, { prepare, normalize }) }),
      source: 'default', migrated: false, storageError: scoped.error
    }
  }

  if (scoped.value) {
    try {
      const parsed = JSON.parse(scoped.value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || !parsed.state || typeof parsed.state !== 'object' || Array.isArray(parsed.state)) {
        throw new Error('Invalid account envelope')
      }
      return {
        envelope: createStateEnvelope({
          accountId: id,
          state: hydrateState(parsed.state, defaults, { prepare, normalize }),
          sync: parsed.sync
        }),
        source: 'account', migrated: false, storageError: null
      }
    } catch (error) {
      return {
        envelope: createStateEnvelope({ accountId: id, state: hydrateState({}, defaults, { prepare, normalize }) }),
        source: 'default', migrated: false,
        storageError: storageFailure('parse', key, error)
      }
    }
  }

  const owner = readRaw(storage, legacyOwnerKey)
  if (owner.error) {
    return {
      envelope: createStateEnvelope({ accountId: id, state: hydrateState({}, defaults, { prepare, normalize }) }),
      source: 'default', migrated: false, storageError: owner.error
    }
  }
  if (owner.value && owner.value !== id) {
    return {
      envelope: createStateEnvelope({ accountId: id, state: hydrateState({}, defaults, { prepare, normalize }) }),
      source: 'default', migrated: false, storageError: null
    }
  }

  const legacy = readRaw(storage, legacyKey)
  if (legacy.error) {
    return {
      envelope: createStateEnvelope({ accountId: id, state: hydrateState({}, defaults, { prepare, normalize }) }),
      source: 'default', migrated: false, storageError: legacy.error
    }
  }
  if (!legacy.value) {
    return {
      envelope: createStateEnvelope({ accountId: id, state: hydrateState({}, defaults, { prepare, normalize }) }),
      source: 'default', migrated: false, storageError: null
    }
  }

  let legacyState
  try {
    legacyState = JSON.parse(legacy.value)
    if (!legacyState || typeof legacyState !== 'object' || Array.isArray(legacyState)) {
      throw new Error('Invalid legacy state')
    }
  } catch (error) {
    return {
      envelope: createStateEnvelope({ accountId: id, state: hydrateState({}, defaults, { prepare, normalize }) }),
      source: 'default', migrated: false,
      storageError: storageFailure('parse', legacyKey, error)
    }
  }

  const dirty = id !== 'guest' && readRaw(storage, legacyDirtyKey).value === '1'
  const envelope = createStateEnvelope({
    accountId: id,
    state: hydrateState(legacyState, defaults, { prepare, normalize }),
    sync: dirty ? {
      localGeneration: 1,
      acknowledgedGeneration: 0,
      pending: true,
      mutationId: createMutationId(),
      status: SYNC_STATUS.PENDING
    } : undefined
  })

  try {
    // Claim before copying: a partial failure can be retried by this account but cannot leak
    // the legacy snapshot into a different account.
    storage?.setItem(legacyOwnerKey, id)
    storage?.setItem(key, JSON.stringify(envelope))
    return { envelope, source: 'legacy', migrated: true, storageError: null }
  } catch (error) {
    return {
      envelope, source: 'legacy', migrated: false,
      storageError: storageFailure('migrate', key, error)
    }
  }
}

export function saveAccountEnvelope(storage, envelope, { legacyMirrorKey = null } = {}) {
  const normalized = createStateEnvelope(envelope)
  const key = accountStateKey(normalized.accountId)
  if (!storage || typeof storage.setItem !== 'function') {
    throw new SyncStorageError('write', key, new Error('Storage is unavailable'))
  }
  try {
    storage.setItem(key, JSON.stringify(normalized))
  } catch (error) {
    throw new SyncStorageError('write', key, error)
  }

  let mirrorError = null
  if (legacyMirrorKey) {
    try {
      storage?.setItem(legacyMirrorKey, JSON.stringify(normalized.state))
    } catch (error) {
      // The scoped envelope is the authoritative atomic save. A compatibility mirror failure
      // must not turn a successful domain save into a false negative.
      mirrorError = storageFailure('mirror', legacyMirrorKey, error)
    }
  }
  return { envelope: normalized, key, mirrorError }
}

export function markLocalMutation(envelope, state, { mutationId = createMutationId() } = {}) {
  if (!mutationId || typeof mutationId !== 'string') throw new TypeError('mutationId is required')
  const next = createStateEnvelope(envelope)
  const localGeneration = next.sync.localGeneration + 1
  next.state = jsonClone(state, {})
  next.sync = createSyncMetadata({
    ...next.sync,
    localGeneration,
    pending: true,
    mutationId,
    status: next.sync.conflict ? SYNC_STATUS.CONFLICT : SYNC_STATUS.PENDING,
    lastError: null
  })
  return next
}

/** Persist this before issuing PUT so a lost response can be reconciled after a restart. */
export function recordSyncAttempt(envelope, {
  mutationId,
  generation,
  baseRevision,
  snapshot,
  startedAt = Date.now()
} = {}) {
  const next = createStateEnvelope(envelope)
  const attempt = {
    mutationId: mutationId || next.sync.mutationId,
    generation: generation ?? next.sync.localGeneration,
    baseRevision: baseRevision ?? next.sync.revision,
    snapshot: snapshot ?? next.state,
    startedAt
  }
  if (!attempt.mutationId || typeof attempt.mutationId !== 'string') {
    throw new TypeError('A sync attempt requires a mutation id')
  }
  if (!Number.isSafeInteger(attempt.generation) || attempt.generation < 0
    || attempt.generation > next.sync.localGeneration) {
    throw new RangeError('Invalid sync attempt generation')
  }
  if (!Number.isSafeInteger(attempt.baseRevision) || attempt.baseRevision < 0) {
    throw new RangeError('Invalid sync attempt base revision')
  }
  next.sync = createSyncMetadata({
    ...next.sync,
    status: SYNC_STATUS.SYNCING,
    lastError: null,
    lastAttempt: attempt
  })
  return next
}

export function clearSyncAttempt(envelope, { mutationId = null, generation = null } = {}) {
  const next = createStateEnvelope(envelope)
  const attempt = next.sync.lastAttempt
  const matches = attempt && (!mutationId || mutationId === attempt.mutationId)
    && (generation === null || generation === attempt.generation)
  if (!matches) return next
  next.sync = createSyncMetadata({
    ...next.sync,
    status: next.sync.pending ? SYNC_STATUS.PENDING : SYNC_STATUS.SYNCED,
    lastAttempt: null
  })
  return next
}

export function matchesRecordedSyncAttempt(envelope, serverState) {
  const attempt = createStateEnvelope(envelope).sync.lastAttempt
  return !!attempt && sameSyncState(attempt.snapshot, serverState)
}

/**
 * Apply an acknowledgement for the exact snapshot captured by a PUT. Newer local changes stay
 * pending and retain their own mutation id, while revision/base advance to the accepted snapshot.
 */
export function acknowledgeSync(envelope, {
  revision,
  serverState,
  generation,
  mutationId = null,
  syncedAt = Date.now()
} = {}) {
  const next = createStateEnvelope(envelope)
  if (!Number.isSafeInteger(revision) || revision < next.sync.revision) {
    throw new RangeError('Sync revision cannot move backwards')
  }
  if (!Number.isSafeInteger(generation) || generation < 0
    || generation > next.sync.localGeneration) {
    throw new RangeError('Invalid acknowledged generation')
  }
  if (generation === next.sync.localGeneration && mutationId && next.sync.mutationId
    && mutationId !== next.sync.mutationId) {
    throw new Error('Acknowledgement does not match the current mutation')
  }

  const acknowledgedGeneration = Math.max(next.sync.acknowledgedGeneration, generation)
  const pending = next.sync.localGeneration > acknowledgedGeneration
  const currentMutationIsAcknowledged = generation === next.sync.localGeneration
    && (!mutationId || mutationId === next.sync.mutationId)
  const attempted = next.sync.lastAttempt
  const acknowledgedAttempt = attempted && attempted.generation === generation
    && (!mutationId || attempted.mutationId === mutationId)

  next.sync = createSyncMetadata({
    ...next.sync,
    revision,
    base: serverState,
    acknowledgedGeneration,
    pending,
    mutationId: pending || !currentMutationIsAcknowledged ? next.sync.mutationId : null,
    status: pending ? SYNC_STATUS.PENDING : SYNC_STATUS.SYNCED,
    lastSyncAt: syncedAt,
    lastError: null,
    lastAttempt: acknowledgedAttempt ? null : attempted,
    conflict: null
  })
  return next
}

/** Promote a GET/412 snapshot that proves a previously attempted PUT actually committed. */
export function acknowledgeRecordedSyncAttempt(envelope, {
  revision,
  serverState,
  syncedAt = Date.now()
} = {}) {
  const next = createStateEnvelope(envelope)
  const attempt = next.sync.lastAttempt
  if (!attempt || !sameSyncState(attempt.snapshot, serverState)) {
    throw new Error('Server snapshot does not match the recorded sync attempt')
  }
  return acknowledgeSync(next, {
    revision,
    serverState,
    generation: attempt.generation,
    mutationId: attempt.mutationId,
    syncedAt
  })
}

export function adoptRemoteSync(envelope, {
  state,
  revision,
  serverState = state,
  syncedAt = Date.now()
} = {}) {
  const next = createStateEnvelope(envelope)
  if (!Number.isSafeInteger(revision) || revision < next.sync.revision) {
    throw new RangeError('Sync revision cannot move backwards')
  }
  next.state = jsonClone(state, {})
  next.sync = createSyncMetadata({
    ...next.sync,
    revision,
    base: serverState,
    acknowledgedGeneration: next.sync.localGeneration,
    pending: false,
    mutationId: null,
    status: SYNC_STATUS.SYNCED,
    lastSyncAt: syncedAt,
    lastError: null,
    lastAttempt: null,
    conflict: null
  })
  return next
}

export function setSyncConflict(envelope, conflict, { error = null } = {}) {
  const next = createStateEnvelope(envelope)
  next.sync = createSyncMetadata({
    ...next.sync,
    pending: true,
    status: SYNC_STATUS.CONFLICT,
    conflict,
    lastError: error
  })
  return next
}

export function setSyncStatus(envelope, status, { error = null } = {}) {
  if (!STATUS_VALUES.has(status)) throw new TypeError(`Unknown sync status: ${status}`)
  const next = createStateEnvelope(envelope)
  next.sync = createSyncMetadata({ ...next.sync, status, lastError: error })
  return next
}
