import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'
import { normalizeProgressionScopes } from '../lib/progression-scope.js'
import {
  SYNC_PROTOCOL_VERSION,
  SYNC_STATUS,
  accountStateKey,
  acknowledgeRecordedSyncAttempt,
  acknowledgeSync,
  adoptRemoteSync,
  canonicalizeSyncState,
  clearSyncAttempt,
  createStateEnvelope,
  createMutationId,
  getOrCreateDeviceId,
  loadAccountEnvelope,
  markLocalMutation,
  matchesRecordedSyncAttempt,
  recordSyncAttempt,
  sameSyncState,
  saveAccountEnvelope,
  setSyncConflict,
  setSyncStatus
} from '../lib/sync-state.js'
import { resolveThreeWayMerge, threeWayMerge } from '../lib/sync-merge.js'
import { isTransientSyncError, syncErrorKind, syncRetryDelay } from '../lib/sync-runtime.js'

const KEY = 'gym_state_v1'
const GUEST_ACCOUNT = 'guest'
export const DEF = {
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  // Preserve the historical start flow for profiles/backups created before this preference.
  askBodyweightBeforeWorkout: true,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, progressionWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // User-defined bars, dumbbells, plates and machines. Profiles are ordinary synced state;
  // a normalized deep copy is frozen into each workout so later gym changes are not retroactive.
  equipmentProfiles: [], activeEquipmentProfileId: null,
  // Optional per-exercise controls that change how history is interpreted without rewriting
  // finished workouts. Missing in legacy profiles/backups and therefore always defaulted.
  progressionControls: {},
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose still falls back to the historical `showRir` boolean.
  reminder: { on: false, time: '08:00', tz: null }, effort: null
}

const clone = value => JSON.parse(JSON.stringify(value))

function normalizeDomainState(value) {
  const state = Object.assign(clone(DEF), clone(value || {}))
  registerCustom(state.customEx)
  normalizeProgressionScopes(state)
  return state
}

function readCachedUser() {
  try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null }
}

function loadEnvelope(accountId) {
  return loadAccountEnvelope(localStorage, {
    accountId,
    defaults: DEF,
    prepare: state => registerCustom(state.customEx),
    normalize: state => { normalizeProgressionScopes(state); return state }
  })
}

const cachedUser = readCachedUser()
let currentAccountId = cachedUser?.id || GUEST_ACCOUNT
const initialLoad = loadEnvelope(currentAccountId)
let currentEnvelope = initialLoad.envelope

// Any domain difference matters, including preferences-only profiles. active/_ts are excluded by
// canonicalization, so an unfinished workout alone never causes a profile overwrite.
export const hasData = state => !sameSyncState(normalizeDomainState(state), DEF)

function stateFromCanonical(canonical, active = null) {
  const state = normalizeDomainState(canonical)
  state.active = active || null
  state._ts = Date.now()
  return state
}

function publicSync(sync, runtimeStatus = null) {
  let status = runtimeStatus || sync.status
  if (!runtimeStatus && !sync.pending && !sync.conflict && !sync.lastSyncAt) status = 'local'
  return {
    status,
    pendingCount: Math.max(0, sync.localGeneration - sync.acknowledgedGeneration),
    revision: sync.revision,
    lastSyncAt: sync.lastSyncAt,
    lastError: sync.lastError,
    conflict: sync.conflict
  }
}

function errorSummary(error) {
  return {
    status: error?.status || null,
    code: error?.code || error?.data?.error || null,
    message: error?.message || 'Sync failed',
    at: Date.now()
  }
}

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null
  let retryTm = null
  let retryAttempt = 0
  let syncPromise = null
  let syncAgain = false
  let forcePullQueued = false
  let runtimeStatus = initialLoad.storageError ? SYNC_STATUS.STORAGE_ERROR : null
  // A read/parse/migration failure is not an empty profile. Keep the original bytes untouched
  // and reject every write until the user/storage layer has been repaired or the account changes.
  let storageBlock = initialLoad.storageError || null
  let deviceId = null

  try { deviceId = getOrCreateDeviceId(localStorage) } catch { runtimeStatus = SYNC_STATUS.STORAGE_ERROR }
  if (initialLoad.migrated) {
    try { localStorage.removeItem(KEY) } catch { /* the scoped migration remains authoritative */ }
  }

  const syncView = () => currentAccountId === GUEST_ACCOUNT
    ? null
    : publicSync(currentEnvelope.sync, runtimeStatus)

  const setRuntimeStatus = status => {
    runtimeStatus = status
    set({ sync: syncView() })
  }

  const saveEnvelope = (next, { updateView = true } = {}) => {
    if (storageBlock) {
      runtimeStatus = SYNC_STATUS.STORAGE_ERROR
      set({ sync: publicSync({ ...currentEnvelope.sync, lastError: storageBlock }, runtimeStatus) })
      return false
    }
    try {
      const saved = saveAccountEnvelope(localStorage, next)
      currentEnvelope = saved.envelope
      try {
        // gym_state_v1 is an import source, not a second continuously-updated profile copy.
        localStorage.removeItem(KEY)
        if (currentEnvelope.sync.pending) localStorage.setItem('gym_dirty', '1')
        else localStorage.removeItem('gym_dirty')
      } catch { /* the authoritative account envelope has already been saved */ }
      if (updateView) set({ S: currentEnvelope.state, sync: syncView() })
      return true
    } catch (error) {
      runtimeStatus = SYNC_STATUS.STORAGE_ERROR
      set({ sync: publicSync({ ...currentEnvelope.sync, lastError: errorSummary(error) }, runtimeStatus) })
      return false
    }
  }

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => {
      saveTm = null
      nativeSave(get().S)
      syncReminder(get().S)
    }, 800)
  }

  const clearRetry = () => {
    clearTimeout(retryTm)
    retryTm = null
  }

  const scheduleRetry = () => {
    if (retryTm || !get().user || !currentEnvelope.sync.pending
      || currentEnvelope.sync.conflict || currentEnvelope.sync.status === SYNC_STATUS.AUTH_REQUIRED) return
    const delay = syncRetryDelay(retryAttempt++)
    retryTm = setTimeout(() => {
      retryTm = null
      get().syncNow()
    }, delay)
    retryTm?.unref?.()
  }

  const schedulePush = (delay = 1_500) => {
    clearTimeout(pushTm)
    pushTm = setTimeout(() => {
      pushTm = null
      get().pushState()
    }, delay)
    pushTm?.unref?.()
  }

  const persist = (input, push = true) => {
    const state = normalizeDomainState(input)
    state._ts = Date.now()
    const syncableChanged = !sameSyncState(currentEnvelope.state, state)
    let next = createStateEnvelope({
      accountId: currentAccountId,
      state,
      sync: currentEnvelope.sync
    })

    if (push && get().user && currentAccountId !== GUEST_ACCOUNT && syncableChanged) {
      next = markLocalMutation(next, state)
      if (next.sync.conflict) {
        const previous = next.sync.conflict
        const merged = threeWayMerge({ base: previous.base, local: state, remote: previous.remote })
        next = setSyncConflict(next, {
          ...previous,
          local: canonicalizeSyncState(state),
          conflicts: merged.conflicts
        })
      }
    }

    if (!saveEnvelope(next)) return false
    if (MOBILE) nativePersist()
    if (push && get().user && syncableChanged) schedulePush()
    return true
  }

  function activateAccount(accountId, { carryGuest = false } = {}) {
    const target = accountId || GUEST_ACCOUNT
    if (target === currentAccountId) return true
    const previousAccount = currentAccountId
    const previous = currentEnvelope
    const loaded = loadEnvelope(target)
    let next = loaded.envelope

    // A guest can deliberately turn the current local profile into a new account. Existing
    // account data is never replaced: if this is a sign-in rather than registration, the first
    // pull performs a safe three-way merge (or exposes a conflict).
    if (carryGuest && previousAccount === GUEST_ACCOUNT && loaded.source === 'default' && hasData(previous.state)) {
      next = createStateEnvelope({ accountId: target, state: previous.state })
      next = markLocalMutation(next, previous.state)
    }

    currentAccountId = target
    currentEnvelope = next
    storageBlock = loaded.storageError || null
    runtimeStatus = loaded.storageError ? SYNC_STATUS.STORAGE_ERROR : null
    registerCustom(next.state.customEx)
    if (storageBlock) {
      set({ S: next.state, sync: syncView() })
      return false
    }
    return saveEnvelope(next)
  }

  function removeCurrentAccountCopy(accountId) {
    try {
      localStorage.removeItem(accountStateKey(accountId))
      localStorage.removeItem('gym_dirty')
      localStorage.removeItem(KEY)
    } catch { /* logout already has a server copy; a stale scoped copy is safer than data loss */ }
  }

  function clearLocalSession(accountId) {
    removeCurrentAccountCopy(accountId)
    try {
      localStorage.removeItem('gym_user')
      localStorage.removeItem('gym_guest')
    } catch { /* UI state below still ends the session */ }
    set({ user: null })
    activateAccount(GUEST_ACCOUNT)
  }

  function storeSyncStatus(status, error = null) {
    const next = setSyncStatus(currentEnvelope, status, { error: error ? errorSummary(error) : null })
    runtimeStatus = null
    saveEnvelope(next)
  }

  function normalizeRemoteState(remote) {
    return canonicalizeSyncState(normalizeDomainState(remote || {}))
  }

  function saveConflict(result, { base, local, remote, revision, kind = 'server', active = currentEnvelope.state.active }) {
    let next = createStateEnvelope({
      accountId: currentAccountId,
      state: stateFromCanonical(result.state, active),
      sync: clearSyncAttempt(currentEnvelope).sync
    })
    next = setSyncConflict(next, {
      kind,
      base,
      local,
      remote,
      conflicts: result.conflicts,
      remoteRevision: revision
    })
    runtimeStatus = null
    saveEnvelope(next)
    return false
  }

  function reconcileRemote(remoteState, revision) {
    const remote = normalizeRemoteState(remoteState)

    // A GET/412 can be the proof that a request committed before its response was lost. Promote
    // exactly that recorded snapshot before comparing a newer local generation against it.
    if (matchesRecordedSyncAttempt(currentEnvelope, remote)) {
      const acknowledged = acknowledgeRecordedSyncAttempt(currentEnvelope, {
        revision,
        serverState: remote
      })
      runtimeStatus = null
      return saveEnvelope(acknowledged)
    }

    const withoutAttempt = clearSyncAttempt(currentEnvelope)
    const local = canonicalizeSyncState(withoutAttempt.state)
    const base = withoutAttempt.sync.base || normalizeRemoteState(null)
    const result = threeWayMerge({ base, local, remote })
    if (!result.clean) return saveConflict(result, { base, local, remote, revision })

    const mergedState = stateFromCanonical(result.state, withoutAttempt.state.active)
    let next = adoptRemoteSync(withoutAttempt, {
      state: mergedState,
      revision,
      serverState: remote
    })
    if (!sameSyncState(result.state, remote)) next = markLocalMutation(next, mergedState)
    runtimeStatus = null
    return saveEnvelope(next)
  }

  async function sendPendingSnapshot() {
    let attempt = currentEnvelope.sync.lastAttempt
    if (!attempt) {
      const snapshot = canonicalizeSyncState(currentEnvelope.state)
      const mutationId = currentEnvelope.sync.mutationId || createMutationId()
      const recorded = recordSyncAttempt(currentEnvelope, {
        mutationId,
        generation: currentEnvelope.sync.localGeneration,
        baseRevision: currentEnvelope.sync.revision,
        snapshot
      })
      if (!saveEnvelope(recorded)) return false
      attempt = currentEnvelope.sync.lastAttempt
    }

    setRuntimeStatus(SYNC_STATUS.SYNCING)
    try {
      const response = await api('/api/data', {
        method: 'PUT',
        body: JSON.stringify({
          syncProtocol: SYNC_PROTOCOL_VERSION,
          baseRevision: attempt.baseRevision,
          clientId: deviceId,
          mutationId: attempt.mutationId,
          state: attempt.snapshot
        })
      })
      const acknowledged = acknowledgeSync(currentEnvelope, {
        revision: response.revision,
        serverState: attempt.snapshot,
        generation: attempt.generation,
        mutationId: attempt.mutationId
      })
      runtimeStatus = null
      if (!saveEnvelope(acknowledged)) return false
      retryAttempt = 0
      return true
    } catch (error) {
      if (error.status === 412 && error.data) {
        return reconcileRemote(error.data.state, error.data.revision)
      }
      if (error.status === 409) {
        // Extremely rare cross-tab/random-id collision: abandon only the rejected transport id,
        // not the pending domain generation, then retry under a fresh id.
        const cleared = clearSyncAttempt(currentEnvelope)
        const fresh = createStateEnvelope({
          accountId: currentAccountId,
          state: cleared.state,
          sync: { ...cleared.sync, mutationId: createMutationId(), status: SYNC_STATUS.PENDING }
        })
        runtimeStatus = null
        return saveEnvelope(fresh)
      }
      throw error
    }
  }

  async function performSync(forcePull = false) {
    if (!get().user || currentAccountId === GUEST_ACCOUNT || currentEnvelope.sync.conflict) return false
    if (!deviceId) {
      storeSyncStatus(SYNC_STATUS.STORAGE_ERROR, { code: 'DEVICE_ID_UNAVAILABLE', message: 'Device id could not be saved' })
      return false
    }
    clearRetry()

    for (let pass = 0; pass < 12; pass += 1) {
      if (currentEnvelope.sync.lastAttempt
        || (currentEnvelope.sync.pending && currentEnvelope.sync.base !== null)) {
        const progressed = await sendPendingSnapshot()
        if (!progressed || currentEnvelope.sync.conflict) return false
        if (currentEnvelope.sync.pending) continue
        if (!forcePull) return true
      }

      setRuntimeStatus(SYNC_STATUS.SYNCING)
      const remote = await api('/api/data')
      if (!reconcileRemote(remote.state, remote.revision)) return false
      forcePull = false
      if (!currentEnvelope.sync.pending) {
        retryAttempt = 0
        return true
      }
    }
    throw Object.assign(new Error('Sync did not converge'), { code: 'SYNC_RETRY_LIMIT' })
  }

  function handleSyncFailure(error) {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
    const kind = syncErrorKind(error, online)
    const status = kind === 'offline'
      ? SYNC_STATUS.OFFLINE_LOCAL
      : kind === 'auth_required'
        ? SYNC_STATUS.AUTH_REQUIRED
        : SYNC_STATUS.PENDING
    storeSyncStatus(status, error)
    if (isTransientSyncError(error)) scheduleRetry()
    return false
  }

  function runSync(forcePull = false) {
    forcePullQueued ||= forcePull
    if (syncPromise) {
      syncAgain = true
      return syncPromise
    }

    syncPromise = (async () => {
      let result = true
      do {
        syncAgain = false
        const pull = forcePullQueued
        forcePullQueued = false
        try { result = await performSync(pull) } catch (error) { return handleSyncFailure(error) }
      } while (syncAgain)
      return result
    })().finally(() => { syncPromise = null })
    return syncPromise
  }

  function mergeExternalEnvelope(external) {
    if (external.accountId !== currentAccountId) return
    if (sameSyncState(external.state, currentEnvelope.state)) {
      if (external.sync.revision > currentEnvelope.sync.revision
        || external.sync.localGeneration > currentEnvelope.sync.localGeneration) {
        currentEnvelope = external
        runtimeStatus = null
        set({ S: external.state, sync: syncView() })
      }
      return
    }

    const base = currentEnvelope.sync.base || external.sync.base || normalizeRemoteState(null)
    const local = canonicalizeSyncState(currentEnvelope.state)
    const remote = canonicalizeSyncState(external.state)
    const merged = threeWayMerge({ base, local, remote })
    const localActive = currentEnvelope.state.active
    const transport = external.sync.revision >= currentEnvelope.sync.revision
      ? external : currentEnvelope
    if (!merged.clean) {
      currentEnvelope = transport
      saveConflict(merged, {
        base, local, remote, revision: transport.sync.revision, kind: 'device', active: localActive
      })
      return
    }

    const state = stateFromCanonical(merged.state, currentEnvelope.state.active)
    currentEnvelope = transport
    let next = createStateEnvelope({ accountId: currentAccountId, state, sync: transport.sync })
    if (!sameSyncState(state, transport.state)) next = markLocalMutation(next, state)
    saveEnvelope(next)
    if (next.sync.pending) schedulePush(0)
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce.
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (MOBILE && saveTm) {
        clearTimeout(saveTm)
        saveTm = null
        nativeSave(get().S)
      }
      if (pushTm) {
        clearTimeout(pushTm)
        pushTm = null
        get().pushState()
      }
    } else if (get().user) get().syncNow(true)
  })

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => get().syncNow(true))
    window.addEventListener('focus', () => { if (get().user) get().syncNow(true) })
    window.addEventListener('storage', event => {
      if (event.key !== accountStateKey(currentAccountId) || !event.newValue) return
      try {
        const loaded = loadEnvelope(currentAccountId)
        if (!loaded.storageError) mergeExternalEnvelope(loaded.envelope)
      } catch { /* a partial/corrupt external write is never adopted */ }
    })
  }

  return {
    S: currentEnvelope.state,
    user: cachedUser,
    sync: cachedUser ? syncView() : null,
    ready: false,

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const state = clone(get().S)
      mut(state)
      return persist(state, push)
    },
    replaceState(state, push = false) { return persist(clone(state), push) },

    isGuest: () => {
      try { return localStorage.getItem('gym_guest') === '1' } catch { return false }
    },
    setGuest(value) {
      try {
        if (value) localStorage.setItem('gym_guest', '1')
        else localStorage.removeItem('gym_guest')
      } catch { /* storage failure is reported by account activation */ }
      if (value) activateAccount(GUEST_ACCOUNT)
      set({})
    },

    setUser(user) {
      if (user) {
        try {
          localStorage.setItem('gym_user', JSON.stringify(user))
          localStorage.removeItem('gym_guest')
        } catch { /* the account envelope will expose a storage error */ }
        activateAccount(user.id, { carryGuest: true })
      } else {
        try { localStorage.removeItem('gym_user') } catch { /* */ }
      }
      set({ user, sync: user ? syncView() : null })
    },

    pushState() { return runSync(false) },
    pullState() { return runSync(true) },
    syncNow(forcePull = true) { return runSync(forcePull) },

    resolveSyncConflict(side) {
      const conflict = currentEnvelope.sync.conflict
      if (!conflict || (side !== 'local' && side !== 'remote')) return false
      const resolved = resolveThreeWayMerge({
        base: conflict.base,
        local: conflict.local,
        remote: conflict.remote
      }, side)
      const state = stateFromCanonical(resolved.state, currentEnvelope.state.active)
      const revision = Number.isSafeInteger(conflict.remoteRevision)
        ? conflict.remoteRevision : currentEnvelope.sync.revision
      let next
      if (conflict.kind === 'device') {
        const transport = clearSyncAttempt(currentEnvelope)
        next = createStateEnvelope({
          accountId: currentAccountId,
          state,
          sync: { ...transport.sync, conflict: null, status: SYNC_STATUS.PENDING }
        })
        next = markLocalMutation(next, state)
      } else {
        next = adoptRemoteSync(clearSyncAttempt(currentEnvelope), {
          state,
          revision,
          serverState: conflict.remote
        })
        if (!sameSyncState(state, conflict.remote)) next = markLocalMutation(next, state)
      }
      if (!saveEnvelope(next)) return false
      schedulePush(0)
      return true
    },

    async signOut() {
      const accountId = currentAccountId
      await runSync(false)
      if (currentEnvelope.sync.pending || currentEnvelope.sync.conflict) {
        throw Object.assign(new Error('Unsynced changes are still stored on this device'), { code: 'SYNC_PENDING' })
      }
      await api('/api/logout', { method: 'POST', body: '{}' })
      clearLocalSession(accountId)
    },

    async signOutAll() {
      const accountId = currentAccountId
      await runSync(false)
      if (currentEnvelope.sync.pending || currentEnvelope.sync.conflict) {
        throw Object.assign(new Error('Unsynced changes are still stored on this device'), { code: 'SYNC_PENDING' })
      }
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession(accountId)
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      try { localStorage.removeItem('gym_dirty') } catch { /* */ }
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: an initialized profile opens from its local replica first, then reconciles online.
    async boot() {
      if (MOBILE) {
        const saved = await nativeLoad()
        const local = get().S
        if (saved && (!hasData(local) || (saved._ts || 0) >= (local._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(local)) nativeSave(local)
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      if (DEMO) {
        try {
          if (!localStorage.getItem(DEMO_SEEDED)) {
            localStorage.setItem(DEMO_SEEDED, '1')
            await get().resetDemo()
          }
        } catch { /* demo still opens the in-memory defaults */ }
        get().setGuest(true)
        set({ ready: true })
        return
      }

      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await runSync(true)
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(state => { state.reminder = { ...state.reminder, tz } })
        }
      } catch (error) {
        // Network/API downtime keeps the cached account usable. A real expired session keeps its
        // replica too and exposes an explicit reauthentication state instead of deleting data.
        if (error.status === 401 && get().user) storeSyncStatus(SYNC_STATUS.AUTH_REQUIRED, error)
        else if (get().user) handleSyncFailure(error)
      }
      set({ ready: true })
    }
  }
})
