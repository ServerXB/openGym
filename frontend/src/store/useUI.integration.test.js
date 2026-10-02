import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ state: null, listeners: new Set(), records: new Map(),
  queue: Promise.resolve(), storageFail: false, domainFail: false, wall: 100000, mono: 0,
  notify: vi.fn(), beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('./useStore.js', () => ({ useStore: {
  getState: () => h.state,
  subscribe: fn => { h.listeners.add(fn); return () => h.listeners.delete(fn) }
} }))
vi.mock('../lib/sound.js', () => ({ beep: h.beep, vibrate: h.vibrate }))
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/timer-notifications.js', () => ({ createTimerNotifier: () => h.notify }))
vi.mock('../lib/local-timer-storage.js', () => ({ TIMER_SIGNAL_KEY: 'gym_timer_signal_v1', createTimerStorage: () => ({
  async read(account) { await h.queue; if (h.storageFail) throw Error('storage unavailable'); return structuredClone(h.records.get(account) || null) },
  transact(account, updater) {
    const action = h.queue.then(() => {
      if (h.storageFail) throw Error('storage unavailable')
      const previous = structuredClone(h.records.get(account) || null), record = updater(previous)
      const changed = JSON.stringify(previous) !== JSON.stringify(record)
      if (changed) h.records.set(account, structuredClone(record))
      return { previous, record, changed }
    })
    h.queue = action.catch(() => {})
    return action
  }
}) }))

let ui, cleanup
const entry = () => ({ id: 'plank', target: { mode: 'time', sec: 45 }, sets: [{ sec: 45, done: false }, { sec: 45, done: false }] })
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve() }
const update = mutator => {
  if (h.domainFail) return false
  const next = structuredClone(h.state.S); mutator(next); h.state.S = next
  h.listeners.forEach(fn => fn(h.state)); return true
}
const advance = async ms => { h.wall += ms; h.mono += ms; await vi.advanceTimersByTimeAsync(ms); await flush() }
async function timed(index = 0) {
  const { bindTimedSet } = await import('../lib/timed-set-completion.js')
  let id = 0, binding
  update(s => { binding = bindTimedSet(s, 0, index, () => 'binding-' + ++id) })
  return ui.getState().startWork(45, 'Plank', null, binding)
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  h.records.clear(); h.listeners.clear(); h.queue = Promise.resolve(); h.storageFail = false; h.domainFail = false
  h.wall = 100000; h.mono = 0; h.notify.mockClear(); h.beep.mockClear(); h.vibrate.mockClear()
  h.state = { ready: true, user: null, getAccountId: () => 'guest', update,
    updateActiveWorkout: (_id, mutator) => update(mutator),
    S: { sound: false, restSec: 90, active: { id: 'today', cur: 0, entries: [entry()] }, workouts: [], routines: [] } }
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', new EventTarget())
  vi.stubGlobal('BroadcastChannel', undefined)
  vi.stubGlobal('localStorage', { setItem: vi.fn() })
  vi.spyOn(Date, 'now').mockImplementation(() => h.wall)
  vi.spyOn(performance, 'now').mockImplementation(() => h.mono)
  const module = await import('./useUI.js'); ui = module.useUI; cleanup = module.initializeTimers()
  await flush()
})
afterEach(async () => { cleanup?.(); await flush(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('UI timer integration with workout and account lifecycle', () => {
  it('keeps long local recoveries independent from the legacy push endpoint one-hour cap', async () => {
    expect(await ui.getState().startRest(3601)).toBe(true)
    expect(ui.getState().timer.left).toBe(3601)
  })
  it('preserves the live callback API without replaying into another workout', async () => {
    const done = vi.fn(); await ui.getState().startWork(1, 'Callback', done); await advance(1000)
    expect(done).toHaveBeenCalledExactlyOnceWith(1)
    expect(h.state.S.active.entries[0].sets[0].done).toBe(false)
  })
  it('starts a durable recovery timer and restores it after remount', async () => {
    await ui.getState().startRest(120); expect(h.records.get('guest').workoutId).toBe('today')
    await advance(35000); expect(ui.getState().timer.left).toBe(85)
    cleanup(); cleanup = (await import('./useUI.js')).initializeTimers(); await flush()
    expect(ui.getState().timer.left).toBe(85)
  })
  it('does not complete 499ms too soon and completes once', async () => {
    await ui.getState().startRest(120); await advance(119501)
    expect(ui.getState().timer.left).toBe(1); expect(ui.getState().toastMsg).toBe('')
    await advance(499); expect(ui.getState().timer).toBeNull(); expect(h.vibrate).toHaveBeenCalledTimes(1)
    await advance(1000); expect(h.vibrate).toHaveBeenCalledTimes(1)
  })
  it.each([3600000, -50000])('keeps live countdown stable across a wall-clock jump %i and focus', async shift => {
    await ui.getState().startRest(120); h.wall += shift
    window.dispatchEvent(new Event('focus')); await flush()
    expect(ui.getState().timer.left).toBe(120)
  })
  it('extends and rejects an obsolete skip token', async () => {
    await ui.getState().startRest(120); const stale = { timerId: ui.getState().timer.timerId, revision: 1 }
    await ui.getState().addRest(15); expect(await ui.getState().stopRest(stale)).toBe(false)
    expect(ui.getState().timer.left).toBe(135)
  })
  it('zero recovery cancels without a false completed notification', async () => {
    await ui.getState().startRest(120); await ui.getState().startRest(0)
    expect(ui.getState().timer).toBeNull(); expect(h.vibrate).not.toHaveBeenCalled()
  })
  it('subtraction exhausting the timer behaves like Skip', async () => {
    await ui.getState().startRest(10); await ui.getState().addRest(-15)
    expect(ui.getState().timer).toBeNull(); expect(h.vibrate).not.toHaveBeenCalled()
  })
  it('work replaces recovery, and recovery replaces work', async () => {
    await ui.getState().startRest(120); await timed()
    expect(ui.getState().timer).toBeNull(); expect(ui.getState().work.left).toBe(45)
    await ui.getState().startRest(120); expect(ui.getState().work).toBeNull()
  })
  it('records actual early duration and starts normal recovery', async () => {
    await timed(); await advance(7350); await ui.getState().finishWorkEarly(); await flush()
    expect(h.state.S.active.entries[0].sets[0]).toMatchObject({ sec: 7, done: true })
    expect(ui.getState().work).toBeNull(); expect(ui.getState().timer.left).toBe(90)
  })
  it('restores work binding after refresh without serializing a callback', async () => {
    await timed(); cleanup(); vi.resetModules()
    const module = await import('./useUI.js'); ui = module.useUI; cleanup = module.initializeTimers(); await flush()
    expect(ui.getState().work.binding).toEqual({ entryId: 'binding-1', setId: 'binding-2' })
    await advance(45000); expect(h.state.S.active.entries[0].sets[0].done).toBe(true)
  })
  it.each(['rest', 'work'])('closing active workout cancels %s and cannot alter a new session', async kind => {
    if (kind === 'rest') await ui.getState().startRest(120); else await timed()
    update(s => { s.active = null }); await flush()
    expect(ui.getState().timer).toBeNull(); expect(ui.getState().work).toBeNull()
    update(s => { s.active = { id: 'tomorrow', entries: [entry()] } }); await advance(120000)
    expect(h.state.S.active.entries[0].sets[0].done).toBe(false)
  })
  it('account transition cannot recover the preceding account timer', async () => {
    await timed(); h.state.getAccountId = () => 'different'; h.listeners.forEach(fn => fn(h.state)); await flush()
    expect(ui.getState().work).toBeNull(); await advance(45000)
    expect(h.state.S.active.entries[0].sets[0].done).toBe(false)
  })
  it('a manually checked timed set cancels instead of logging twice', async () => {
    await timed(); update(s => { s.active.entries[0].sets[0].done = true }); await flush()
    expect(ui.getState().work).toBeNull(); await advance(45000)
    expect(h.state.S.active.entries[0].sets[0].sec).toBe(45); expect(h.vibrate).not.toHaveBeenCalled()
  })
  it('removed and re-added row at the same index is never credited', async () => {
    await timed(1); update(s => { s.active.entries[0].sets.pop(); s.active.entries[0].sets.push({ sec: 30, done: false }) })
    await flush(); await advance(45000)
    expect(h.state.S.active.entries[0].sets[1]).toEqual({ sec: 30, done: false })
  })
  it('moving selection to another identical exercise leaves the original binding intact', async () => {
    update(s => { s.active.entries.push(entry()) }); await timed()
    update(s => { s.active.cur = 1 }); await advance(45000)
    expect(h.state.S.active.entries[0].sets[0].done).toBe(true)
    expect(h.state.S.active.entries[1].sets[0].done).toBe(false)
  })
  it('reports unavailable timer storage without pretending the timer is saved', async () => {
    h.storageFail = true; expect(await ui.getState().startRest(120)).toBe(false)
    expect(ui.getState().timer).toBeNull(); expect(ui.getState().timerError).toBe(true)
  })
  it('retains and retries work completion after workout persistence failure', async () => {
    await timed(); h.domainFail = true; await advance(45000)
    expect(h.records.get('guest').deliveryPending).toBe(true); expect(ui.getState().timerError).toBe(true)
    expect(h.state.S.active.entries[0].sets[0].done).toBe(false)
    h.domainFail = false; window.dispatchEvent(new Event('focus')); await flush()
    expect(h.state.S.active.entries[0].sets[0].done).toBe(true)
  })
})
