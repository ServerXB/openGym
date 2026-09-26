import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountStateKey, createStateEnvelope } from '../lib/sync-state.js'

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
  browserHarness(storage, { online })
  const module = await import('./useStore.js')
  return { ...module, storage }
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
