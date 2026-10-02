import { create } from 'zustand'
import { uid } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { useStore } from './useStore.js'
import { createTimerStorage, TIMER_SIGNAL_KEY } from '../lib/local-timer-storage.js'
import { createTimerRuntime } from '../lib/local-timer-runtime.js'
import { timerToken } from '../lib/local-timer.js'
import { applyTimedSetCompletion } from '../lib/timed-set-completion.js'
import { createTimerNotifier } from '../lib/timer-notifications.js'

let toastTm, channel
const legacyCallbacks = new Map()
const scope = () => {
  const state = useStore.getState()
  return state.ready && state.S.active?.id
    ? { accountId: state.getAccountId(), workoutId: state.S.active.id } : null
}
const signal = accountId => {
  channel?.postMessage({ accountId })
  try { localStorage.setItem(TIMER_SIGNAL_KEY, JSON.stringify({ accountId, nonce: uid() })) } catch { /* BroadcastChannel still works */ }
}
const notify = createTimerNotifier({ mobile: MOBILE, user: () => useStore.getState().user, api })
const ring = () => {
  const snd = useStore.getState().S.sound
  beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
  vibrate([200, 100, 200])
}
const runtime = createTimerRuntime({
  storage: createTimerStorage({ signal }),
  clock: { wallNow: () => Date.now(), monoNow: () => performance.now() },
  getScope: scope, id: uid,
  onChange: value => {
    const ui = useUI.getState(), previous = ui.work || ui.timer
    if (value && previous?.timerId === value.timerId && previous.revision === value.revision && previous.left === value.left) return
    if (value && previous?.timerId === value.timerId && value.left < previous.left && value.left > 0 && value.left <= 3) beep(useStore.getState().S.sound, 660, 0.1)
    useUI.setState({ timer: value?.kind === 'rest' ? value : null, work: value?.kind === 'work' ? value : null })
  },
  onError: () => useUI.setState({ timerError: true }),
  onMutation: record => {
    if (record.status === 'running') legacyCallbacks.clear()
    else if (record.status === 'cancelled') legacyCallbacks.delete(record.timerId)
    useUI.setState({ timerError: false }); notify(record)
  },
  onComplete: (record, elapsed) => {
    if (record.kind === 'rest') { ring(); useUI.getState().toast(t('Rest over — next set!')); return true }
    // Keep the pre-existing callback API for live callers. Real workout rows always use the
    // durable binding below; an ephemeral callback is never guessed/replayed after reload.
    const callback = legacyCallbacks.get(record.timerId)
    if (callback) { legacyCallbacks.delete(record.timerId); ring(); callback(elapsed); return true }
    let result
    const saved = useStore.getState().updateActiveWorkout(record.workoutId,
      state => { result = applyTimedSetCompletion(state, record, elapsed) })
    if (saved === false) { useUI.setState({ timerError: true }); return false }
    useUI.setState({ timerError: false })
    if (!result) return true // removed/already checked set or replaced workout: never credit a different row
    ring()
    useUI.setState({ timerCompletion: { ...result, workoutId: record.workoutId, timerId: record.timerId } })
    useUI.getState().toast(t('Hold logged'))
    if (result.restSeconds > 0) useUI.getState().startRest(result.restSeconds)
    return true
  }
})
const expectedToken = (value, current) => value?.timerId ? value : timerToken(current)

export const useUI = create((set, get) => ({
  sheets: [], toastMsg: '', timer: null, work: null, timerError: false, timerCompletion: null,
  openSheet(render, { kind = 'sheet', locked = false } = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, locked }] }))
    const close = () => get().closeSheet(id)
    return { id, close, lock: v => set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, locked: v } : x) })) }
  },
  closeSheet(id) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  closeAll() { set({ sheets: [] }) },
  toast(msg) {
    set({ toastMsg: msg }); clearTimeout(toastTm)
    toastTm = setTimeout(() => set({ toastMsg: '' }), 2200)
  },
  clearTimerCompletion() { set({ timerCompletion: null }) },
  startRest(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return get().stopRest()
    if (sec > 86400) { set({ timerError: true }); return Promise.resolve(false) }
    return runtime.command('start', { kind: 'rest', durationMs: sec * 1000 })
  },
  addRest(sec, expected) {
    const tm = get().timer
    if (!tm || !Number.isFinite(sec) || tm.total + sec > 86400) return Promise.resolve(false)
    return runtime.command('extend', { deltaMs: sec * 1000 }, expectedToken(expected, tm))
  },
  stopRest(expected) {
    const tm = get().timer
    return tm ? runtime.command('cancel', {}, expectedToken(expected, tm)) : Promise.resolve(false)
  },
  async startWork(sec, label, onDone, binding = null) {
    const total = Math.max(1, Math.round(sec) || 1)
    if (binding && scope()?.workoutId !== binding.workoutId) return false
    if (!binding && typeof onDone !== 'function') return false
    const started = await runtime.command('start', { kind: 'work', durationMs: total * 1000, label,
      binding: binding ? { entryId: binding.entryId, setId: binding.setId }
        : { entryId: 'callback:' + uid(), setId: 'callback:' + uid() } })
    if (started && typeof onDone === 'function') legacyCallbacks.set(runtime.token().timerId, onDone)
    return started
  },
  finishWorkEarly(expected) {
    const wk = get().work
    return wk ? runtime.command('finish', {}, expectedToken(expected, wk)) : Promise.resolve(false)
  },
  stopWork(expected) {
    const wk = get().work
    return wk ? runtime.command('cancel', {}, expectedToken(expected, wk)) : Promise.resolve(false)
  }
}))

// One mounted Shell owns the interval/listeners. StrictMode cleanup never cancels a persisted timer.
export function initializeTimers() {
  let previousScope = scope()
  const refresh = () => runtime.restore()
  const unsubscribe = useStore.subscribe(() => {
    const next = scope()
    if (JSON.stringify(next) !== JSON.stringify(previousScope)) {
      const departed = previousScope, token = runtime.token()
      previousScope = next
      runtime.clearView()
      legacyCallbacks.clear()
      useUI.setState({ timerCompletion: null, timerError: false })
      if (departed) runtime.cancelScope(departed, token)
      refresh()
    } else {
      const work = useUI.getState().work
      if (work?.binding && !work.binding.entryId.startsWith('callback:')) {
        const entry = useStore.getState().S.active?.entries?.find(e => e.localTimerEntryId === work.binding.entryId)
        const row = entry?.sets?.find(s => s.localTimerSetId === work.binding.setId)
        if (!row || row.done) useUI.getState().stopWork(timerToken(work))
      }
    }
  })
  const storage = event => { if (event.key === TIMER_SIGNAL_KEY) refresh() }
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('opengym-local-timers-v1')
    channel.addEventListener('message', refresh)
  }
  window.addEventListener('storage', storage)
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refresh)
  const interval = setInterval(() => runtime.tick(), 250)
  refresh()
  return () => {
    clearInterval(interval); unsubscribe()
    window.removeEventListener('storage', storage); window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', refresh)
    channel?.close(); channel = null
  }
}
