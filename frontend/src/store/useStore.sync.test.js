import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountStateKey, createStateEnvelope, markLocalMutation } from '../lib/sync-state.js'

const apiMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/api.js', () => ({ api: apiMock }))

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]))
  return {
    getItem: vi.fn(key => values.has(key) ? values.get(key) : null),
    setItem: vi.fn((key, value) => { values.set(key, String(value)) }),
    removeItem: vi.fn(key => values.delete(key)),
    clear: vi.fn(() => values.clear()),
    values
  }
}

function browserHarness(storage, { online = true } = {}) {
  const windowListeners = new Map()
  const documentListeners = new Map()
  let uuid = 0

  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { onLine: online, userAgent: 'Vitest' })
  vi.stubGlobal('crypto', { randomUUID: () => `test-uuid-${++uuid}` })
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn((name, listener) => {
      const listeners = documentListeners.get(name) || []
      listeners.push(listener)
      documentListeners.set(name, listeners)
    })
  })
  vi.stubGlobal('window', {
    addEventListener: vi.fn((name, listener) => {
      const listeners = windowListeners.get(name) || []
      listeners.push(listener)
      windowListeners.set(name, listeners)
    })
  })

  return { windowListeners, documentListeners }
}

async function loadStore({
  storage = memoryStorage(),
  user = { id: 'account-a', name: 'Alice' },
  online = true
} = {}) {
  if (user) storage.setItem('gym_user', JSON.stringify(user))
  const browser = browserHarness(storage, { online })
  const module = await import('./useStore.js')
  return { ...module, storage, browser }
}

async function establishBaseline(useStore, remote = {}, revision = 1) {
  apiMock.mockResolvedValueOnce({ state: remote, revision, syncProtocol: 1 })
  await expect(useStore.getState().pullState()).resolves.toBe(true)
  apiMock.mockClear()
}

function persistedEnvelope(storage, accountId = 'account-a') {
  const raw = storage.values.get(accountStateKey(accountId))
  expect(raw).toEqual(expect.any(String))
  return JSON.parse(raw)
}

function staleRevision(state, revision) {
  return Object.assign(new Error('STALE_REVISION'), {
    status: 412,
    data: { error: 'STALE_REVISION', state, revision, syncProtocol: 1 }
  })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

async function flushUntil(predicate, message = 'condition was not reached') {
  for (let pass = 0; pass < 25; pass += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error(message)
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
  apiMock.mockReset()
})

describe('offline-first store integration', () => {
  it('durably records an offline mutation as pending and restores it after reload', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    const { useStore } = await loadStore({ storage, online: false })
    apiMock.mockRejectedValue(new TypeError('fetch failed'))

    expect(useStore.getState().update(state => { state.restSec = 135 })).toBe(true)
    await expect(useStore.getState().pushState()).resolves.toBe(false)

    expect(useStore.getState().sync).toMatchObject({
      status: 'offline_local', pendingCount: 1, revision: 0
    })
    expect(persistedEnvelope(storage)).toMatchObject({
      accountId: 'account-a',
      state: { restSec: 135 },
      sync: { pending: true, localGeneration: 1, acknowledgedGeneration: 0 }
    })

    vi.resetModules()
    const reloaded = await import('./useStore.js')
    expect(reloaded.useStore.getState().S.restSec).toBe(135)
    expect(reloaded.useStore.getState().sync).toMatchObject({
      status: 'offline_local', pendingCount: 1
    })
  })

  it('reconciles with GET, uploads the local snapshot with CAS and acknowledges it', async () => {
    vi.useFakeTimers()
    const { useStore } = await loadStore()
    apiMock
      .mockResolvedValueOnce({ state: {}, revision: 0, syncProtocol: 1 })
      .mockResolvedValueOnce({ ok: true, revision: 1, syncProtocol: 1 })

    useStore.getState().update(state => { state.restSec = 120 })
    await expect(useStore.getState().pushState()).resolves.toBe(true)

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(apiMock.mock.calls[0]).toEqual(['/api/data'])
    const request = JSON.parse(apiMock.mock.calls[1][1].body)
    expect(apiMock.mock.calls[1][1].method).toBe('PUT')
    expect(request).toMatchObject({
      syncProtocol: 1,
      baseRevision: 0,
      clientId: 'test-uuid-1',
      state: { restSec: 120 }
    })
    expect(request.mutationId).toEqual(expect.any(String))
    expect(useStore.getState().sync).toMatchObject({
      status: 'synced', pendingCount: 0, revision: 1
    })
  })

  it('merges non-overlapping local and server changes after a CAS 412, then retries', async () => {
    vi.useFakeTimers()
    const { useStore } = await loadStore()
    await establishBaseline(useStore)

    const writes = []
    apiMock.mockImplementation(async (path, options = {}) => {
      expect(path).toBe('/api/data')
      expect(options.method).toBe('PUT')
      writes.push(JSON.parse(options.body))
      if (writes.length === 1) throw staleRevision({ sound: false }, 2)
      return { ok: true, revision: 3, syncProtocol: 1 }
    })

    useStore.getState().update(state => { state.restSec = 120 })
    await expect(useStore.getState().pushState()).resolves.toBe(true)

    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({ baseRevision: 1, state: { restSec: 120, sound: true } })
    expect(writes[1]).toMatchObject({ baseRevision: 2, state: { restSec: 120, sound: false } })
    expect(useStore.getState().S).toMatchObject({ restSec: 120, sound: false })
    expect(useStore.getState().sync).toMatchObject({
      status: 'synced', pendingCount: 0, revision: 3, conflict: null
    })
  })

  it('exposes a same-field conflict and preserves the clean merge when resolving locally', async () => {
    vi.useFakeTimers()
    const { useStore } = await loadStore()
    await establishBaseline(useStore)

    apiMock
      .mockRejectedValueOnce(staleRevision({ restSec: 75 }, 2))
      .mockResolvedValueOnce({ ok: true, revision: 3, syncProtocol: 1 })

    useStore.getState().update(state => {
      state.restSec = 120
      state.sound = false
    })
    await expect(useStore.getState().pushState()).resolves.toBe(false)

    expect(useStore.getState().sync.status).toBe('conflict')
    expect(useStore.getState().sync.conflict.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/restSec', local: 120, remote: 75 })
    ]))
    // sound changed only locally and must survive whichever side resolves the ambiguous field.
    expect(useStore.getState().resolveSyncConflict('local')).toBe(true)
    expect(useStore.getState().S).toMatchObject({ restSec: 120, sound: false })
    await expect(useStore.getState().pushState()).resolves.toBe(true)

    const resolvedWrite = JSON.parse(apiMock.mock.calls.at(-1)[1].body)
    expect(resolvedWrite).toMatchObject({
      baseRevision: 2,
      state: { restSec: 120, sound: false }
    })
    expect(useStore.getState().sync).toMatchObject({
      status: 'synced', pendingCount: 0, revision: 3, conflict: null
    })
  })

  it('acknowledges only the in-flight generation when another mutation occurs during PUT', async () => {
    vi.useFakeTimers()
    const { useStore } = await loadStore()
    await establishBaseline(useStore)

    const firstResponse = deferred()
    const writes = []
    apiMock.mockImplementation((path, options = {}) => {
      const body = JSON.parse(options.body)
      writes.push(body)
      if (writes.length === 1) return firstResponse.promise
      return Promise.resolve({ ok: true, revision: 3, syncProtocol: 1 })
    })

    useStore.getState().update(state => { state.restSec = 120 })
    const syncing = useStore.getState().pushState()
    await flushUntil(() => writes.length === 1, 'first PUT was not issued')

    useStore.getState().update(state => { state.sound = false })
    expect(useStore.getState().sync.pendingCount).toBe(2)
    firstResponse.resolve({ ok: true, revision: 2, syncProtocol: 1 })
    await expect(syncing).resolves.toBe(true)

    expect(writes).toHaveLength(2)
    expect(writes[0].state).toMatchObject({ restSec: 120, sound: true })
    expect(writes[1]).toMatchObject({
      baseRevision: 2,
      state: { restSec: 120, sound: false }
    })
    expect(writes[1].mutationId).not.toBe(writes[0].mutationId)
    expect(useStore.getState().sync).toMatchObject({
      status: 'synced', pendingCount: 0, revision: 3
    })
  })

  it('reuses the recorded mutation id after a committed PUT response is lost', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)

    const writes = []
    apiMock.mockImplementation(async (path, options = {}) => {
      writes.push(JSON.parse(options.body))
      if (writes.length === 1) throw new TypeError('response connection lost')
      return { ok: true, revision: 2, syncProtocol: 1 }
    })

    useStore.getState().update(state => { state.restSec = 105 })
    await expect(useStore.getState().pushState()).resolves.toBe(false)
    expect(useStore.getState().sync).toMatchObject({ status: 'offline_local', pendingCount: 1 })
    expect(persistedEnvelope(storage).sync.lastAttempt)
      .toMatchObject({ mutationId: writes[0].mutationId, snapshot: { restSec: 105 } })

    await expect(useStore.getState().pushState()).resolves.toBe(true)
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
    expect(useStore.getState().sync).toMatchObject({
      status: 'synced', pendingCount: 0, revision: 2
    })
  })

  it('pulls the current server head after an old idempotent receipt', async () => {
    vi.useFakeTimers()
    const { useStore } = await loadStore()
    await establishBaseline(useStore)

    apiMock.mockRejectedValueOnce(new TypeError('response connection lost'))
    useStore.getState().update(state => { state.restSec = 105 })
    await expect(useStore.getState().pushState()).resolves.toBe(false)

    apiMock
      .mockResolvedValueOnce({ ok: true, revision: 2, idempotent: true, syncProtocol: 1 })
      .mockResolvedValueOnce({ state: { restSec: 105, sound: false }, revision: 3, syncProtocol: 1 })
    await expect(useStore.getState().pushState()).resolves.toBe(true)

    expect(apiMock.mock.calls.at(-1)).toEqual(['/api/data'])
    expect(useStore.getState().S).toMatchObject({ restSec: 105, sound: false })
    expect(useStore.getState().sync).toMatchObject({ status: 'synced', revision: 3 })
  })

  it('keeps the durable attempt pending when the head read after an idempotent receipt fails', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)

    apiMock.mockRejectedValueOnce(new TypeError('PUT response connection lost'))
    useStore.getState().update(state => { state.restSec = 105 })
    await expect(useStore.getState().pushState()).resolves.toBe(false)
    const mutationId = persistedEnvelope(storage).sync.lastAttempt.mutationId

    apiMock
      .mockResolvedValueOnce({ ok: true, revision: 2, idempotent: true, syncProtocol: 1 })
      .mockRejectedValueOnce(new TypeError('head read connection lost'))
    await expect(useStore.getState().pushState()).resolves.toBe(false)

    expect(useStore.getState().sync).toMatchObject({ status: 'offline_local', pendingCount: 1 })
    expect(persistedEnvelope(storage).sync.lastAttempt.mutationId).toBe(mutationId)

    apiMock
      .mockResolvedValueOnce({ ok: true, revision: 2, idempotent: true, syncProtocol: 1 })
      .mockResolvedValueOnce({ state: { restSec: 105 }, revision: 2, syncProtocol: 1 })
    await expect(useStore.getState().pushState()).resolves.toBe(true)

    const writes = apiMock.mock.calls
      .filter(([, options]) => options?.method === 'PUT')
      .map(([, options]) => JSON.parse(options.body))
    expect(writes).toHaveLength(3)
    expect(writes.map(write => write.mutationId)).toEqual([mutationId, mutationId, mutationId])
    expect(useStore.getState().sync).toMatchObject({ status: 'synced', pendingCount: 0, revision: 2 })
  })

  it('uses the acknowledged receipt snapshot as the base for newer local and remote changes', async () => {
    vi.useFakeTimers()
    const { useStore } = await loadStore()
    await establishBaseline(useStore, { restSec: 90, sound: true }, 1)

    apiMock.mockRejectedValueOnce(new TypeError('PUT response connection lost'))
    useStore.getState().update(state => { state.restSec = 105 })
    await expect(useStore.getState().pushState()).resolves.toBe(false)

    // This edit is causally after the lost-but-committed 105 snapshot.
    useStore.getState().update(state => { state.restSec = 120 })
    apiMock
      .mockResolvedValueOnce({ ok: true, revision: 2, idempotent: true, syncProtocol: 1 })
      .mockResolvedValueOnce({
        state: { restSec: 105, sound: false }, revision: 3, syncProtocol: 1
      })
      .mockResolvedValueOnce({ ok: true, revision: 4, syncProtocol: 1 })

    await expect(useStore.getState().pushState()).resolves.toBe(true)

    const writes = apiMock.mock.calls
      .filter(([, options]) => options?.method === 'PUT')
      .map(([, options]) => JSON.parse(options.body))
    expect(writes).toHaveLength(3)
    expect(writes[1].mutationId).toBe(writes[0].mutationId)
    expect(writes[2]).toMatchObject({
      baseRevision: 3,
      state: { restSec: 120, sound: false }
    })
    expect(useStore.getState().S).toMatchObject({ restSec: 120, sound: false })
    expect(useStore.getState().sync).toMatchObject({ status: 'synced', revision: 4 })
  })

  it('blocks logout while a pending mutation cannot be synchronized', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    apiMock.mockRejectedValue(new TypeError('server unreachable'))

    useStore.getState().update(state => { state.restSec = 150 })
    await expect(useStore.getState().signOut()).rejects.toMatchObject({ code: 'SYNC_PENDING' })

    expect(useStore.getState().user).toMatchObject({ id: 'account-a' })
    expect(useStore.getState().S.restSec).toBe(150)
    expect(storage.values.has(accountStateKey('account-a'))).toBe(true)
    expect(apiMock.mock.calls.some(([path]) => path === '/api/logout')).toBe(false)
  })

  it('keeps account replicas isolated when switching between cached users', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage({
      [accountStateKey('account-a')]: JSON.stringify(createStateEnvelope({
        accountId: 'account-a', state: { restSec: 111, routines: [{ id: 'only-a', ex: [] }] }
      })),
      [accountStateKey('account-b')]: JSON.stringify(createStateEnvelope({
        accountId: 'account-b', state: { restSec: 222, routines: [{ id: 'only-b', ex: [] }] }
      }))
    })
    const { useStore } = await loadStore({ storage })

    expect(useStore.getState().S).toMatchObject({ restSec: 111, routines: [{ id: 'only-a' }] })
    useStore.getState().setUser({ id: 'account-b', name: 'Bob' })
    expect(useStore.getState().S).toMatchObject({ restSec: 222, routines: [{ id: 'only-b' }] })
    useStore.getState().update(state => { state.restSec = 223 }, false)

    useStore.getState().setUser({ id: 'account-a', name: 'Alice' })
    expect(useStore.getState().S).toMatchObject({ restSec: 111, routines: [{ id: 'only-a' }] })
    expect(JSON.parse(storage.values.get(accountStateKey('account-b'))).state.restSec).toBe(223)
  })

  it('clears the guest replica after safely transferring it into a new account', async () => {
    const storage = memoryStorage({
      [accountStateKey('guest')]: JSON.stringify(createStateEnvelope({
        accountId: 'guest', state: { restSec: 111 }
      }))
    })
    const { useStore } = await loadStore({ storage, user: null })

    useStore.getState().setUser({ id: 'account-a', name: 'Alice' })

    expect(persistedEnvelope(storage, 'guest').state.restSec).toBe(90)
    expect(persistedEnvelope(storage, 'guest').sync.guestEpoch).toEqual(expect.any(String))
    expect(persistedEnvelope(storage).state.restSec).toBe(111)
    expect(persistedEnvelope(storage).sync.pending).toBe(true)
  })

  it('transfers the latest persisted guest edits before delayed storage events arrive', async () => {
    const storage = memoryStorage({
      [accountStateKey('guest')]: JSON.stringify(createStateEnvelope({
        accountId: 'guest', state: { restSec: 111 }
      }))
    })
    const { useStore } = await loadStore({ storage, user: null })
    const latest = persistedEnvelope(storage, 'guest')
    latest.state.workouts = [{ id: 'new-workout', date: '2026-09-28' }]
    latest.state.active = { id: 'new-active', entries: [] }
    storage.setItem(accountStateKey('guest'), JSON.stringify(latest))

    useStore.getState().setUser({ id: 'account-a', name: 'Alice' })

    expect(persistedEnvelope(storage).state.workouts).toEqual(latest.state.workouts)
    expect(persistedEnvelope(storage).state.active).toEqual(latest.state.active)
    expect(persistedEnvelope(storage, 'guest').state.workouts).toEqual([])
  })

  it('does not transfer an obsolete guest epoch into a second account', async () => {
    const storage = memoryStorage({
      [accountStateKey('guest')]: JSON.stringify(createStateEnvelope({
        accountId: 'guest', state: { workouts: [{ id: 'private-workout' }] }
      }))
    })
    const { useStore, DEF } = await loadStore({ storage, user: null })
    storage.setItem(accountStateKey('guest'), JSON.stringify(createStateEnvelope({
      accountId: 'guest', state: DEF, sync: { guestEpoch: 'already-transferred-to-a' }
    })))

    useStore.getState().setUser({ id: 'account-b', name: 'Bob' })

    expect(persistedEnvelope(storage, 'account-b').state.workouts).toEqual([])
    expect(persistedEnvelope(storage, 'guest').state.workouts).toEqual([])
  })

  it('blocks a guest transfer on corrupt storage without overwriting the original bytes', async () => {
    const storage = memoryStorage({
      [accountStateKey('guest')]: JSON.stringify(createStateEnvelope({
        accountId: 'guest', state: { workouts: [{ id: 'private-workout' }] }
      }))
    })
    const { useStore } = await loadStore({ storage, user: null })
    const corrupt = '{"state":'
    storage.setItem(accountStateKey('guest'), corrupt)

    useStore.getState().setUser({ id: 'account-a', name: 'Alice' })

    expect(useStore.getState().sync.status).toBe('storage_error')
    expect(storage.getItem(accountStateKey('guest'))).toBe(corrupt)
    expect(storage.getItem(accountStateKey('account-a'))).toBeNull()
  })

  it('prevents a stale guest tab from recreating data transferred into an account', async () => {
    const storage = memoryStorage({
      [accountStateKey('guest')]: JSON.stringify(createStateEnvelope({
        accountId: 'guest', state: { restSec: 111, workouts: [{ id: 'private-workout' }] }
      }))
    })
    const { useStore, DEF } = await loadStore({ storage, user: null })
    storage.setItem(accountStateKey('guest'), JSON.stringify(createStateEnvelope({
      accountId: 'guest', state: DEF, sync: { guestEpoch: 'transferred-in-another-tab' }
    })))

    expect(useStore.getState().update(state => { state.sound = false })).toBe(false)

    expect(useStore.getState().S.workouts).toEqual([])
    expect(persistedEnvelope(storage, 'guest').state.workouts).toEqual([])
    expect(useStore.getState().update(state => { state.sound = false })).toBe(true)
    expect(persistedEnvelope(storage, 'guest').state).toMatchObject({ sound: false, workouts: [] })
  })

  it('ignores an old account response that arrives after switching profiles', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage({
      [accountStateKey('account-b')]: JSON.stringify(createStateEnvelope({
        accountId: 'account-b', state: { restSec: 222, routines: [{ id: 'only-b', ex: [] }] }
      }))
    })
    const { useStore } = await loadStore({ storage })
    await establishBaseline(useStore)
    const oldAccountResponse = deferred()
    apiMock.mockReturnValueOnce(oldAccountResponse.promise)

    useStore.getState().update(state => { state.restSec = 111 })
    const oldSync = useStore.getState().pushState()
    await flushUntil(() => apiMock.mock.calls.length === 1, 'old account PUT was not issued')

    useStore.getState().setUser({ id: 'account-b', name: 'Bob' })
    oldAccountResponse.resolve({ ok: true, revision: 2, syncProtocol: 1 })
    await expect(oldSync).resolves.toBe(false)

    expect(useStore.getState().user.id).toBe('account-b')
    expect(useStore.getState().S).toMatchObject({ restSec: 222, routines: [{ id: 'only-b' }] })
    expect(JSON.parse(storage.values.get(accountStateKey('account-b'))).state.restSec).toBe(222)
    expect(JSON.parse(storage.values.get(accountStateKey('account-a'))).sync.pending).toBe(true)
  })

  it('ignores an old account network failure after switching profiles', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage({
      [accountStateKey('account-b')]: JSON.stringify(createStateEnvelope({
        accountId: 'account-b', state: { restSec: 222 }
      }))
    })
    const { useStore } = await loadStore({ storage })
    await establishBaseline(useStore)
    const oldAccountFailure = deferred()
    apiMock.mockReturnValueOnce(oldAccountFailure.promise)

    useStore.getState().update(state => { state.restSec = 111 })
    const oldSync = useStore.getState().pushState()
    await flushUntil(() => apiMock.mock.calls.length === 1, 'old account PUT was not issued')

    useStore.getState().setUser({ id: 'account-b', name: 'Bob' })
    oldAccountFailure.reject(new TypeError('old account went offline'))
    await expect(oldSync).resolves.toBe(false)

    expect(useStore.getState().user.id).toBe('account-b')
    expect(useStore.getState().S.restSec).toBe(222)
    expect(useStore.getState().sync.status).toBe('local')
    expect(JSON.parse(storage.values.get(accountStateKey('account-a'))).sync.pending).toBe(true)
  })

  it('preserves a workout started in another tab when this stale tab changes a setting', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    const external = persistedEnvelope(storage)
    external.state.active = { id: 'active-from-tab-a', entries: [] }
    external.state._ts = Date.now() + 1
    storage.setItem(accountStateKey('account-a'), JSON.stringify(external))

    useStore.getState().update(state => { state.sound = false })

    expect(useStore.getState().S.active).toMatchObject({ id: 'active-from-tab-a' })
    expect(persistedEnvelope(storage).state.active).toMatchObject({ id: 'active-from-tab-a' })
  })

  it('adopts a newer active workout immediately from another tab', async () => {
    vi.useFakeTimers()
    const { useStore, storage, browser } = await loadStore()
    await establishBaseline(useStore)
    const external = persistedEnvelope(storage)
    external.state.active = { id: 'active-from-tab-a', entries: [] }
    external.state._ts = Date.now() + 1
    const raw = JSON.stringify(external)
    storage.setItem(accountStateKey('account-a'), raw)
    const [onStorage] = browser.windowListeners.get('storage')

    onStorage({ key: accountStateKey('account-a'), newValue: raw })

    expect(useStore.getState().S.active).toMatchObject({ id: 'active-from-tab-a' })
    expect(persistedEnvelope(storage).state.active).toMatchObject({ id: 'active-from-tab-a' })
  })

  it('preserves other-tab domain changes even before its storage event is delivered', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    const external = persistedEnvelope(storage)
    const changed = markLocalMutation(external, { ...external.state, sound: false })
    storage.setItem(accountStateKey('account-a'), JSON.stringify(changed))

    useStore.getState().update(state => { state.restSec = 120 })

    expect(useStore.getState().S).toMatchObject({ sound: false, restSec: 120 })
    expect(persistedEnvelope(storage).state).toMatchObject({ sound: false, restSec: 120 })
    expect(persistedEnvelope(storage).sync.pending).toBe(true)
  })

  it('preserves other-tab edits when a stale network response saves transport metadata', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    const response = deferred()
    apiMock.mockReturnValueOnce(response.promise)
    useStore.getState().update(state => { state.restSec = 120 })
    const sync = useStore.getState().pushState()
    await flushUntil(() => apiMock.mock.calls.length === 1)
    const external = persistedEnvelope(storage)
    storage.setItem(accountStateKey('account-a'), JSON.stringify(markLocalMutation(
      external, { ...external.state, sound: false }
    )))
    apiMock.mockResolvedValueOnce({ ok: true, revision: 3, syncProtocol: 1 })

    response.resolve({ ok: true, revision: 2, syncProtocol: 1 })
    await expect(sync).resolves.toBe(true)

    expect(useStore.getState().S).toMatchObject({ sound: false, restSec: 120 })
    expect(JSON.parse(apiMock.mock.calls.at(-1)[1].body).state).toMatchObject({ sound: false, restSec: 120 })
    expect(persistedEnvelope(storage).sync.revision).toBe(3)
  })

  it('preserves active and domain changes arriving together from another tab', async () => {
    vi.useFakeTimers()
    const { useStore, storage, browser } = await loadStore()
    await establishBaseline(useStore)
    const external = persistedEnvelope(storage)
    const changed = markLocalMutation(external, {
      ...external.state, sound: false, active: { id: 'other-tab-workout', entries: [] }
    })
    const raw = JSON.stringify(changed)
    storage.setItem(accountStateKey('account-a'), raw)
    browser.windowListeners.get('storage')[0]({ key: accountStateKey('account-a'), newValue: raw })

    expect(useStore.getState().S).toMatchObject({ sound: false, active: { id: 'other-tab-workout' } })
    expect(persistedEnvelope(storage).state.active).toMatchObject({ id: 'other-tab-workout' })
  })

  it('keeps a same-field conflict when a delayed tab edits it differently', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    const external = persistedEnvelope(storage)
    storage.setItem(accountStateKey('account-a'), JSON.stringify(markLocalMutation(
      external, { ...external.state, restSec: 100 }
    )))

    useStore.getState().update(state => { state.restSec = 120 })

    expect(useStore.getState().sync.status).toBe('conflict')
    expect(useStore.getState().sync.conflict.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/restSec', local: 120, remote: 100 })
    ]))
  })

  it('merges a stale tab from its older server base without reverting newer server fields', async () => {
    vi.useFakeTimers()
    const baseAtRevisionOne = { sound: true, theme: 'dark' }
    const storage = memoryStorage({
      [accountStateKey('account-a')]: JSON.stringify(createStateEnvelope({
        accountId: 'account-a',
        state: { sound: false, theme: 'dark' },
        sync: { revision: 2, base: { sound: false, theme: 'dark' } }
      }))
    })
    const { useStore, browser } = await loadStore({ storage })
    const staleTab = createStateEnvelope({
      accountId: 'account-a',
      state: { sound: true, theme: 'light' },
      sync: {
        revision: 1,
        base: baseAtRevisionOne,
        localGeneration: 1,
        acknowledgedGeneration: 0,
        pending: true,
        mutationId: 'stale-tab-mutation'
      }
    })
    const raw = JSON.stringify(staleTab)
    storage.setItem(accountStateKey('account-a'), raw)
    const [onStorage] = browser.windowListeners.get('storage')

    onStorage({ key: accountStateKey('account-a'), newValue: raw })

    expect(useStore.getState().S).toMatchObject({ sound: false, theme: 'light' })
    expect(useStore.getState().sync).toMatchObject({ revision: 2, status: 'pending' })
    expect(persistedEnvelope(storage).state).toMatchObject({ sound: false, theme: 'light' })
  })

  it('blocks sign-out while a local workout is active even though it is not sync-pending', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    useStore.getState().update(state => {
      state.active = { id: 'workout-in-progress', entries: [] }
    })

    expect(useStore.getState().sync.pendingCount).toBe(0)
    await expect(useStore.getState().signOut()).rejects.toMatchObject({ code: 'ACTIVE_WORKOUT' })

    expect(useStore.getState().user).toMatchObject({ id: 'account-a' })
    expect(persistedEnvelope(storage).state.active).toMatchObject({ id: 'workout-in-progress' })
    expect(apiMock.mock.calls.some(([path]) => path === '/api/logout')).toBe(false)
  })

  it.each(['signOut', 'signOutAll'])('preserves edits made while %s is awaiting its response', async action => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    const logoutResponse = deferred()
    apiMock.mockResolvedValueOnce({ state: {}, revision: 1, syncProtocol: 1 })
      .mockReturnValueOnce(logoutResponse.promise)
    const logout = useStore.getState()[action]()
    await flushUntil(() => apiMock.mock.calls.some(([path]) => path.startsWith('/api/logout')))

    useStore.getState().update(state => { state.restSec = 147 })
    logoutResponse.resolve({ ok: true })
    await expect(logout).rejects.toMatchObject({ code: 'SIGN_OUT_REAUTH_REQUIRED' })

    expect(persistedEnvelope(storage).state.restSec).toBe(147)
    expect(persistedEnvelope(storage).sync.pending).toBe(true)
    expect(useStore.getState().sync.status).toBe('auth_required')
  })

  it('keeps an active workout started during a pending logout response', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    const response = deferred()
    apiMock.mockResolvedValueOnce({ state: {}, revision: 1, syncProtocol: 1 }).mockReturnValueOnce(response.promise)
    const logout = useStore.getState().signOut()
    await flushUntil(() => apiMock.mock.calls.some(([path]) => path === '/api/logout'))
    useStore.getState().update(state => { state.active = { id: 'just-started', entries: [] } })
    response.resolve({ ok: true })

    await expect(logout).rejects.toMatchObject({ code: 'SIGN_OUT_REAUTH_REQUIRED' })
    expect(persistedEnvelope(storage).state.active.id).toBe('just-started')
    expect(useStore.getState().sync.status).toBe('auth_required')
  })

  it('does not clear the new account when an old logout response arrives', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    const response = deferred()
    apiMock.mockResolvedValueOnce({ state: {}, revision: 1, syncProtocol: 1 }).mockReturnValueOnce(response.promise)
    const logout = useStore.getState().signOut()
    await flushUntil(() => apiMock.mock.calls.some(([path]) => path === '/api/logout'))
    useStore.getState().setUser({ id: 'account-b', name: 'Bob' })
    useStore.getState().update(state => { state.restSec = 222 })
    response.resolve({ ok: true })

    await expect(logout).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
    expect(useStore.getState().user.id).toBe('account-b')
    expect(persistedEnvelope(storage, 'account-b').state.restSec).toBe(222)
  })

  it('blocks logout before a stale tab can overwrite pending work from another tab', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    const external = persistedEnvelope(storage)
    const changed = markLocalMutation(external, { ...external.state, sound: false })
    storage.setItem(accountStateKey('account-a'), JSON.stringify(changed))

    await expect(useStore.getState().signOut()).rejects.toMatchObject({ code: 'SYNC_PENDING' })

    expect(persistedEnvelope(storage).state.sound).toBe(false)
    expect(persistedEnvelope(storage).sync.pending).toBe(true)
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('never queues active-only edits and strips active workout data from every PUT', async () => {
    vi.useFakeTimers()
    const { useStore } = await loadStore()
    await establishBaseline(useStore)

    useStore.getState().update(state => {
      state.active = { id: 'local-session', entries: [{ id: 'squat', sets: [8] }] }
    })
    expect(useStore.getState().sync).toMatchObject({ pendingCount: 0, status: 'synced' })
    expect(apiMock).not.toHaveBeenCalled()

    apiMock.mockResolvedValueOnce({ ok: true, revision: 2, syncProtocol: 1 })
    useStore.getState().update(state => {
      state.active = { id: 'newer-local-session', entries: [{ id: 'bench', sets: [10] }] }
      state.restSec = 100
    })
    await expect(useStore.getState().pushState()).resolves.toBe(true)

    const body = JSON.parse(apiMock.mock.calls[0][1].body)
    expect(body.state.restSec).toBe(100)
    expect(body.state).not.toHaveProperty('active')
    expect(body.state).not.toHaveProperty('_ts')
    expect(useStore.getState().S.active.id).toBe('newer-local-session')
  })

  it('fails closed without overwriting a corrupt account envelope', async () => {
    vi.useFakeTimers()
    const key = accountStateKey('account-a')
    const corrupt = '{"schemaVersion":2,"state":'
    const storage = memoryStorage({ [key]: corrupt })
    const { useStore } = await loadStore({ storage })
    apiMock.mockRejectedValue(new TypeError('API offline'))

    await useStore.getState().boot()
    expect(useStore.getState().sync.status).toBe('storage_error')
    expect(storage.values.get(key)).toBe(corrupt)

    expect(useStore.getState().update(state => { state.restSec = 444 })).toBe(false)
    expect(useStore.getState().S.restSec).toBe(90)
    expect(storage.values.get(key)).toBe(corrupt)
  })

  it('keeps pending data and the cached account when authentication expires', async () => {
    vi.useFakeTimers()
    const { useStore, storage } = await loadStore()
    await establishBaseline(useStore)
    apiMock.mockRejectedValue(Object.assign(new Error('not signed in'), { status: 401 }))

    useStore.getState().update(state => { state.restSec = 125 })
    await expect(useStore.getState().pushState()).resolves.toBe(false)

    expect(useStore.getState().user).toMatchObject({ id: 'account-a' })
    expect(useStore.getState().sync).toMatchObject({ status: 'auth_required', pendingCount: 1 })
    expect(persistedEnvelope(storage).state.restSec).toBe(125)
  })
})
