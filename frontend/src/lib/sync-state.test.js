import { describe, expect, it, vi } from 'vitest'
import {
  DEVICE_ID_KEY,
  LEGACY_OWNER_KEY,
  SYNC_STATUS,
  SyncStorageError,
  accountStateKey,
  acknowledgeSync,
  acknowledgeRecordedSyncAttempt,
  adoptRemoteSync,
  canonicalizeSyncState,
  createStateEnvelope,
  getOrCreateDeviceId,
  loadAccountEnvelope,
  markLocalMutation,
  matchesRecordedSyncAttempt,
  recordSyncAttempt,
  sameSyncState,
  saveAccountEnvelope,
  setSyncConflict,
  setSyncStatus
} from './sync-state.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: vi.fn(key => values.has(key) ? values.get(key) : null),
    setItem: vi.fn((key, value) => { values.set(key, String(value)) }),
    removeItem: vi.fn(key => values.delete(key)),
    values
  }
}

describe('sync state canonicalization', () => {
  it('removes only top-level local and transport fields', () => {
    const canonical = canonicalizeSyncState({
      z: 1,
      active: { id: 'in-progress' },
      _ts: 123,
      __syncQueue: ['request'],
      syncMeta: { revision: 8 },
      routines: [{ id: 'a', active: true, _ts: 456 }]
    })

    expect(canonical).toEqual({ routines: [{ _ts: 456, active: true, id: 'a' }], z: 1 })
    expect(Object.keys(canonical)).toEqual(['routines', 'z'])
  })

  it('compares equivalent snapshots independently of object insertion order', () => {
    expect(sameSyncState(
      { unit: 'kg', routines: [{ id: 'a', sets: 3 }], active: { id: 'local-a' } },
      { routines: [{ sets: 3, id: 'a' }], unit: 'kg', _ts: 999 }
    )).toBe(true)
  })
})

describe('account-scoped sync storage', () => {
  const defaults = { unit: 'kg', routines: [], workouts: [], active: null }

  it('uses an encoded, account-specific key and keeps accounts isolated', () => {
    expect(accountStateKey('person/a@example.test')).toBe('gym_profile_v2:person%2Fa%40example.test')
    expect(accountStateKey(null)).toBe('gym_profile_v2:guest')

    const storage = memoryStorage()
    saveAccountEnvelope(storage, createStateEnvelope({
      accountId: 'a', state: { routines: [{ id: 'only-a' }] }
    }))
    saveAccountEnvelope(storage, createStateEnvelope({
      accountId: 'b', state: { routines: [{ id: 'only-b' }] }
    }))

    expect(loadAccountEnvelope(storage, { accountId: 'a', defaults }).envelope.state.routines[0].id)
      .toBe('only-a')
    expect(loadAccountEnvelope(storage, { accountId: 'b', defaults }).envelope.state.routines[0].id)
      .toBe('only-b')
  })

  it('creates one stable installation id outside every account envelope', () => {
    const storage = memoryStorage()
    const createId = vi.fn(() => 'device-a')

    expect(getOrCreateDeviceId(storage, { createId })).toBe('device-a')
    expect(getOrCreateDeviceId(storage, { createId: () => 'device-b' })).toBe('device-a')
    expect(storage.values.get(DEVICE_ID_KEY)).toBe('device-a')
    expect(createId).toHaveBeenCalledOnce()

    expect(() => getOrCreateDeviceId({
      getItem: () => { throw new Error('private mode') }
    })).toThrow(SyncStorageError)
    expect(() => getOrCreateDeviceId(null)).toThrow(SyncStorageError)
  })

  it('migrates legacy state once, preserves dirty intent and claims it for one account', () => {
    const storage = memoryStorage({
      gym_state_v1: JSON.stringify({ unit: 'lb', routines: [{ id: 'legacy' }] }),
      gym_dirty: '1'
    })
    const prepare = vi.fn(state => { state.prepared = true })

    const first = loadAccountEnvelope(storage, { accountId: 'account-a', defaults, prepare })
    expect(first).toMatchObject({ source: 'legacy', migrated: true, storageError: null })
    expect(first.envelope.state).toMatchObject({ unit: 'lb', prepared: true })
    expect(first.envelope.sync).toMatchObject({
      pending: true, localGeneration: 1, acknowledgedGeneration: 0,
      status: SYNC_STATUS.PENDING
    })
    expect(first.envelope.sync.mutationId).toEqual(expect.any(String))
    expect(storage.values.get(LEGACY_OWNER_KEY)).toBe('account-a')

    const secondAccount = loadAccountEnvelope(storage, { accountId: 'account-b', defaults })
    expect(secondAccount).toMatchObject({ source: 'default', migrated: false, storageError: null })
    expect(secondAccount.envelope.state.routines).toEqual([])
  })

  it('loads a scoped envelope before legacy data and overlays new defaults', () => {
    const storage = memoryStorage({
      [accountStateKey('a')]: JSON.stringify(createStateEnvelope({
        accountId: 'a', state: { routines: [{ id: 'scoped' }] },
        sync: { revision: 4, base: { routines: [] } }
      })),
      gym_state_v1: JSON.stringify({ routines: [{ id: 'legacy' }] })
    })

    const loaded = loadAccountEnvelope(storage, {
      accountId: 'a', defaults: { routines: [], newPreference: true }
    })
    expect(loaded).toMatchObject({ source: 'account', migrated: false, storageError: null })
    expect(loaded.envelope.state).toMatchObject({
      routines: [{ id: 'scoped' }], newPreference: true
    })
    expect(loaded.envelope.sync.revision).toBe(4)
  })

  it('surfaces corrupt or unreadable storage rather than presenting it as a valid save', () => {
    const corrupt = memoryStorage({ [accountStateKey('a')]: '{bad json' })
    const parsed = loadAccountEnvelope(corrupt, { accountId: 'a', defaults })
    expect(parsed.source).toBe('default')
    expect(parsed.storageError).toMatchObject({ code: 'SYNC_STORAGE_ERROR', operation: 'parse' })

    const denied = loadAccountEnvelope({
      getItem: () => { throw new Error('access denied') }
    }, { accountId: 'a', defaults })
    expect(denied.storageError).toMatchObject({ operation: 'read' })
  })

  it('throws if the authoritative envelope cannot be saved but tolerates mirror failure', () => {
    const envelope = createStateEnvelope({ accountId: 'a', state: defaults })
    expect(() => saveAccountEnvelope({
      setItem: () => { throw new Error('QuotaExceededError') }
    }, envelope)).toThrow(SyncStorageError)
    expect(() => saveAccountEnvelope(null, envelope)).toThrow(SyncStorageError)

    let calls = 0
    const result = saveAccountEnvelope({
      setItem: () => {
        calls += 1
        if (calls === 2) throw new Error('legacy mirror denied')
      }
    }, envelope, { legacyMirrorKey: 'gym_state_v1' })
    expect(result.mirrorError).toMatchObject({ operation: 'mirror', key: 'gym_state_v1' })
  })
})

describe('sync metadata transitions', () => {
  it('increments generations and clears a matching acknowledgement', () => {
    const initial = createStateEnvelope({ accountId: 'a', state: { unit: 'kg' } })
    const pending = markLocalMutation(initial, { unit: 'lb', active: { id: 'local' } }, {
      mutationId: 'mutation-1'
    })
    expect(pending.sync).toMatchObject({
      localGeneration: 1, acknowledgedGeneration: 0, pending: true,
      mutationId: 'mutation-1', status: SYNC_STATUS.PENDING
    })

    const acknowledged = acknowledgeSync(pending, {
      revision: 1,
      serverState: pending.state,
      generation: 1,
      mutationId: 'mutation-1',
      syncedAt: 1234
    })
    expect(acknowledged.sync).toMatchObject({
      revision: 1, localGeneration: 1, acknowledgedGeneration: 1,
      pending: false, mutationId: null, status: SYNC_STATUS.SYNCED,
      lastSyncAt: 1234
    })
    expect(acknowledged.sync.base).toEqual({ unit: 'lb' })
  })

  it('acks only the captured in-flight generation and preserves a newer mutation', () => {
    const first = markLocalMutation(
      createStateEnvelope({ accountId: 'a', state: { value: 0 } }),
      { value: 1 }, { mutationId: 'put-in-flight' }
    )
    const second = markLocalMutation(first, { value: 2 }, { mutationId: 'next-put' })

    const afterOldAck = acknowledgeSync(second, {
      revision: 7,
      serverState: first.state,
      generation: first.sync.localGeneration,
      mutationId: first.sync.mutationId,
      syncedAt: 999
    })

    expect(afterOldAck.state).toEqual({ value: 2 })
    expect(afterOldAck.sync).toMatchObject({
      revision: 7,
      base: { value: 1 },
      localGeneration: 2,
      acknowledgedGeneration: 1,
      pending: true,
      mutationId: 'next-put',
      status: SYNC_STATUS.PENDING
    })
  })

  it('recovers a committed PUT after its response was lost and the app restarted', () => {
    const synced = adoptRemoteSync(
      createStateEnvelope({ accountId: 'a', state: { value: 1 } }),
      { state: { value: 1 }, revision: 1, syncedAt: 10 }
    )
    const first = markLocalMutation(synced, { value: 2 }, { mutationId: 'lost-response' })
    const attempted = recordSyncAttempt(first, {
      mutationId: 'lost-response', generation: 1, baseRevision: 1,
      snapshot: first.state, startedAt: 20
    })

    // Simulate a crash/reload followed by another offline edit before the next pull.
    const reloaded = createStateEnvelope(JSON.parse(JSON.stringify(attempted)))
    const newer = markLocalMutation(reloaded, { value: 3 }, { mutationId: 'newer-edit' })
    expect(newer.sync.lastAttempt).toMatchObject({
      mutationId: 'lost-response', generation: 1, baseRevision: 1,
      snapshot: { value: 2 }
    })
    expect(matchesRecordedSyncAttempt(newer, { value: 2, _ts: 999 })).toBe(true)

    const recovered = acknowledgeRecordedSyncAttempt(newer, {
      revision: 2, serverState: { value: 2 }, syncedAt: 30
    })
    expect(recovered.state).toEqual({ value: 3 })
    expect(recovered.sync).toMatchObject({
      revision: 2, base: { value: 2 }, localGeneration: 2,
      acknowledgedGeneration: 1, pending: true, mutationId: 'newer-edit',
      lastAttempt: null
    })
  })

  it('does not promote a different remote snapshot as a lost acknowledgement', () => {
    const pending = recordSyncAttempt(markLocalMutation(
      createStateEnvelope({ accountId: 'a', state: { value: 1 } }),
      { value: 2 }, { mutationId: 'attempt' }
    ), { snapshot: { value: 2 } })

    expect(matchesRecordedSyncAttempt(pending, { value: 9 })).toBe(false)
    expect(() => acknowledgeRecordedSyncAttempt(pending, {
      revision: 1, serverState: { value: 9 }
    })).toThrow(/does not match/)
  })

  it('rejects impossible or revision-regressing acknowledgements', () => {
    const envelope = createStateEnvelope({
      accountId: 'a', state: {}, sync: { revision: 5, localGeneration: 2 }
    })
    expect(() => acknowledgeSync(envelope, {
      revision: 4, serverState: {}, generation: 1
    })).toThrow(/backwards/)
    expect(() => acknowledgeSync(envelope, {
      revision: 6, serverState: {}, generation: 3
    })).toThrow(/generation/)
  })

  it('can adopt a remote snapshot and later persist conflict/error states', () => {
    const pending = markLocalMutation(
      createStateEnvelope({ accountId: 'a', state: { value: 1 } }),
      { value: 2 }, { mutationId: 'local' }
    )
    const adopted = adoptRemoteSync(pending, {
      state: { value: 3, active: { id: 'preserved-by-caller' } },
      serverState: { value: 3 }, revision: 9, syncedAt: 500
    })
    expect(adopted.sync).toMatchObject({
      revision: 9, base: { value: 3 }, pending: false,
      localGeneration: 1, acknowledgedGeneration: 1, status: SYNC_STATUS.SYNCED
    })

    const conflicted = setSyncConflict(adopted, {
      base: { value: 3 }, local: { value: 4 }, remote: { value: 5 },
      conflicts: [{ path: '/value' }]
    })
    expect(conflicted.sync).toMatchObject({ pending: true, status: SYNC_STATUS.CONFLICT })
    expect(conflicted.sync.conflict.conflicts[0].path).toBe('/value')

    const authRequired = setSyncStatus(adopted, SYNC_STATUS.AUTH_REQUIRED, {
      error: { status: 401 }
    })
    expect(authRequired.sync).toMatchObject({
      status: SYNC_STATUS.AUTH_REQUIRED, lastError: { status: 401 }
    })
  })
})
