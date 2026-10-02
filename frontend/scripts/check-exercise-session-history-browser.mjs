#!/usr/bin/env node
// Requirement 16. Use ONLY a disposable Chromium profile; this seeds guest test state.
// Vite :4173, browser CDP :9222. The browser is closed in finally.
import assert from 'node:assert/strict'

const appUrl = process.env.OPENGYM_APP_URL || 'http://127.0.0.1:4173'
const cdpUrl = process.env.OPENGYM_CDP_URL || 'http://127.0.0.1:9222'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const targets = await (await fetch(`${cdpUrl}/json`)).json()
const target = targets.find(page => page.type === 'page')
assert.ok(target, 'A dedicated disposable browser page is required')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let id = 0
const pending = new Map(), apiRequests = []
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data)
  if (response.method === 'Network.requestWillBeSent'
    && new URL(response.params.request.url).pathname.startsWith('/api/')) apiRequests.push(response.params.request.url)
  const handler = pending.get(response.id)
  if (!handler) return
  pending.delete(response.id); clearTimeout(handler.timeout)
  if (response.error) handler.reject(new Error(response.error.message))
  else handler.resolve(response.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const callId = ++id
  const timeout = setTimeout(() => { pending.delete(callId); reject(new Error(`Timeout: ${method}`)) }, 15000)
  pending.set(callId, { resolve, reject, timeout })
  socket.send(JSON.stringify({ id: callId, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return
    await delay(100)
  }
  throw new Error(`Condition not reached: ${expression}`)
}
const checks = []
const check = (label, value) => { assert.ok(value, label); checks.push(label) }
const readState = () => evaluate(`(async () => (await import('/src/store/useStore.js')).useStore.getState().S)()`)
const mutate = source => evaluate(`(async () => (await import('/src/store/useStore.js')).useStore.getState().update(s => { ${source} }))()`)
const openHistory = async () => {
  await evaluate(`(() => { const button = document.querySelector('[data-session-history-trigger]'); button.focus(); button.click() })()`)
  await waitFor(`document.querySelector('[data-session-history-dialog]')`)
}
const closeHistory = async () => {
  await evaluate(`document.querySelector('.session-history-close').click()`)
  await waitFor(`!document.querySelector('[data-session-history-dialog]')`)
}
const cardIds = () => evaluate(`[...document.querySelectorAll('[data-session-history-card]')].map(card => card.dataset.workoutId)`)
async function seed({ mode = 'reps', bodyweight = false, weight = 70, empty = false } = {}) {
  await evaluate(`(async () => {
    const { DEF } = await import('/src/store/useStore.js')
    const { normalizeProgressionScopes } = await import('/src/lib/progression-scope.js')
    const { buildScopedWorkoutEntry } = await import('/src/lib/workout-scope.js')
    const { accountStateKey, createStateEnvelope } = await import('/src/lib/sync-state.js')
    const options = ${JSON.stringify({ mode, bodyweight, weight, empty })}
    const config = { id: '0025', mode: options.mode, bodyweight: options.bodyweight,
      sets: 4, reps: 8, minReps: 8, maxReps: 10, weight: options.weight, inc: 2,
      sec: 45, min: 10, speed: 8, restSeconds: 120, maxRestSeconds: 180,
      prog: options.mode === 'reps' ? 'confirmed_rep_range' : options.mode === 'time' ? 'time' : 'off',
      restReductionStrategy: 'auto_after_successes' }
    const S = { ...structuredClone(DEF), lang: 'it', sound: false, theme: 'dark', workouts: [],
      routines: [{ id: 'monday', name: 'Lunedì — nome odierno', ex: [{ ...config }] },
        { id: 'shared', name: 'Giovedì condiviso — nome odierno', ex: [{ ...config }] },
        { id: 'independent', name: 'Giovedì indipendente', ex: [{ ...config, weight: options.weight + 20 }] }] }
    normalizeProgressionScopes(S)
    const routine = S.routines[0], cfg = routine.ex[0]
    if (!options.empty) for (let n = 1; n <= 6; n++) {
      const sourceRoutine = n === 6 ? S.routines[2] : n === 5 ? S.routines[1] : routine
      const e = buildScopedWorkoutEntry(S, sourceRoutine.ex[0], sourceRoutine)
      e.target = { ...e.target, reps: 10, targetReps: 10, restSeconds: n === 4 ? 150 : 120,
        restBaseSeconds: 120, topRangeStreak: n === 3 || n === 4 ? 1 : 0 }
      const realWeight = n === 6 ? 999 : options.weight
      e.sets = Array.from({ length: 4 }, (_, i) => options.mode === 'time'
        ? { w: realWeight, sec: 45 - i, done: true }
        : options.mode === 'cardio' ? { min: 10, speed: 8, done: true }
          : { w: realWeight, r: n === 5 ? 9 : 10, done: true, ...(i === 0 ? { rir: 0 } : i === 1 ? { rpe: 8.5 } : {}) })
      if (n === 5 && options.mode === 'reps') { e.topW = 777; e.sets.push({ w: 5, r: 2, done: false }) }
      e.equipmentUse = { status: 'resolved', profileId: 'old-gym', itemId: 'old-bar', label: 'Bilanciere storico', loadSemantics: 'total' }
      S.workouts.push({ id: 'history-' + n, d: '2026-09-' + String(n).padStart(2, '0'),
        name: n === 5 ? 'Giovedì condiviso — nome storico molto lungo per controllare leggibilità a 320 pixel' : 'Lunedì storico ' + n,
        routineId: sourceRoutine.id, entries: [e], equipmentSnapshot: {
          id: 'old-gym', name: 'Palestra storica', unit: 'kg', workoutUnit: 'kg',
          items: [{ id: 'old-bar', label: 'Bilanciere storico', tareWeight: 9.75 }] } })
    }
    S.active = { id: 'history-active', d: '2026-10-02', name: routine.name, start: Date.now(),
      routineId: routine.id, cur: 0, entries: [buildScopedWorkoutEntry(S, cfg, routine)] }
    localStorage.removeItem('gym_user'); localStorage.setItem('gym_guest', '1')
    localStorage.setItem(accountStateKey('guest'), JSON.stringify(createStateEnvelope({ accountId: 'guest', state: S })))
  })()`)
  await send('Page.navigate', { url: `${appUrl}/?historyAudit=${Date.now()}#/workout` })
  await waitFor(`document.querySelector('[data-session-history-trigger]')?.textContent.includes('Storico recente')`)
  await delay(200)
}

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true })
  await send('Page.navigate', { url: appUrl })
  await waitFor(`location.origin === ${JSON.stringify(new URL(appUrl).origin)} && document.readyState === 'complete'`)
  await seed()
  check('real trigger is at least 44px with readable last-time preview', await evaluate(`(() => {
    const button = document.querySelector('[data-session-history-trigger]'); return button.tagName === 'BUTTON'
      && button.getBoundingClientRect().height >= 44 && button.textContent.toLowerCase().includes('ultima volta') && button.textContent.includes('70')
  })()`))
  await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().startRest(900))()`)
  const timerBefore = await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().timer)()`)
  const before = await readState(), networkBefore = apiRequests.length
  await openHistory()
  check('latest four scoped records exclude the independent Thursday', JSON.stringify(await cardIds()) === JSON.stringify(['history-5', 'history-4', 'history-3', 'history-2']))
  check('historical target and actual loads are distinct from confirmed topW', await evaluate(`(() => {
    const card = document.querySelector('[data-session-history-card]');
    return card.querySelector('.session-history-confirmed').textContent.includes('777')
      && card.querySelector('.session-history-sets').textContent.includes('70') && !card.querySelector('.session-history-sets').textContent.includes('777')
  })()`))
  check('effort zero and optional not-completed rows remain visible', await evaluate(`(() => {
    const card = document.querySelector('[data-session-history-card]'); return card.textContent.includes('RIR 0')
      && card.textContent.includes('RPE 8,5') && card.textContent.includes('Opzionale') && card.textContent.includes('Serie non completata')
  })()`))
  check('shared routine and frozen equipment/tare are disclosed', await evaluate(`(() => {
    const card = document.querySelector('[data-session-history-card]'); return card.textContent.includes('Progressione condivisa')
      && card.textContent.includes('nome storico') && card.textContent.includes('Bilanciere storico') && card.textContent.includes('9,75')
  })()`))
  check('maximum above recovery base does not earn a confirmation', await evaluate(`document.querySelector('[data-workout-id="history-4"] [data-history-outcome]').textContent.includes('0 di 2')`))
  check('two compatible maxima earn a weight increase', await evaluate(`document.querySelector('[data-workout-id="history-3"] [data-history-outcome]').textContent.includes('Aumento peso maturato')`))
  check('dialog has a connected labelled title and focus inside', await evaluate(`(() => {
    const dialog = document.querySelector('[data-session-history-dialog]'); return dialog.getAttribute('role') === 'dialog'
      && dialog.getAttribute('aria-modal') === 'true' && !!document.getElementById(dialog.getAttribute('aria-labelledby')) && dialog.contains(document.activeElement)
  })()`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8 })
  check('Shift+Tab stays inside the dialog', await evaluate(`document.querySelector('[data-session-history-dialog]').contains(document.activeElement)`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
  check('Tab stays inside the dialog', await evaluate(`document.querySelector('[data-session-history-dialog]').contains(document.activeElement)`))
  check('cards scroll vertically without horizontal overflow at 320px', await evaluate(`(() => {
    const sheet = document.querySelector('.sheet'); return sheet.scrollHeight > sheet.clientHeight
      && sheet.scrollWidth <= sheet.clientWidth && document.documentElement.scrollWidth <= innerWidth
  })()`))
  await evaluate(`document.documentElement.style.fontSize = '200%'`)
  check('text reflows at 200 percent without clipped labels', await evaluate(`(() => {
    const dialog = document.querySelector('[data-session-history-dialog]'); return dialog.scrollWidth <= dialog.clientWidth
      && [...dialog.querySelectorAll('p,h2,h3')].every(node => getComputedStyle(node).textOverflow !== 'ellipsis')
  })()`))
  await evaluate(`document.documentElement.style.fontSize = ''`)
  await delay(1200)
  const timerAfter = await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().timer)()`)
  check('rest timer continues with the same deadline', timerAfter.endsAt === timerBefore.endsAt && timerAfter.left < timerBefore.left)
  check('opening/reading does not mutate workout state', JSON.stringify(await readState()) === JSON.stringify(before))
  check('history sends no API requests', apiRequests.length === networkBefore)
  await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().startRest(1))()`)
  await delay(1600)
  check('rest expiration still runs while history remains open', await evaluate(`(async () =>
    !(await import('/src/store/useUI.js')).useUI.getState().timer && !!document.querySelector('[data-session-history-dialog]'))()`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await waitFor(`!document.querySelector('[data-session-history-dialog]')`)
  check('Escape closes and restores trigger focus', await evaluate(`document.activeElement === document.querySelector('[data-session-history-trigger]')`))
  await openHistory()
  await mutate(`s.workouts = s.workouts.filter(w => w.id !== 'history-5')`)
  await waitFor(`document.querySelector('[data-session-history-card]')?.dataset.workoutId === 'history-4'`)
  check('live deletion updates the open sheet', JSON.stringify(await cardIds()) === JSON.stringify(['history-4', 'history-3', 'history-2', 'history-1']))
  await mutate(`s.workouts.find(w => w.id === 'history-2').entries[0].sets[0].r = 8`)
  await waitFor(`document.querySelector('[data-workout-id="history-3"] [data-history-outcome]')?.dataset.historyOutcome === 'maximum_first'`)
  check('correcting the earlier maximum invalidates stale second confirmation', await evaluate(`document.querySelector('[data-workout-id="history-3"] [data-history-outcome]').textContent.includes('1 di 2')`))
  await mutate(`s.active.entries[0].progressionId = 'changed-while-open'; s.routines = []`)
  check('open sheet keeps its frozen progression after active/routine changes', (await cardIds()).length === 4)
  await closeHistory()
  await seed()
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await openHistory()
  check('local history is readable offline', (await cardIds()).length === 4)
  await closeHistory()
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await mutate(`s.theme = 'light'`)
  await openHistory()
  check('light-theme cards remain readable without overflow', await evaluate(`document.querySelector('[data-session-history-dialog]').scrollWidth <= document.querySelector('[data-session-history-dialog]').clientWidth`))
  await closeHistory()
  await send('Page.reload')
  await waitFor(`document.querySelector('[data-session-history-trigger]')`)
  await openHistory()
  check('history remains available after refresh', (await cardIds()).length === 4)
  await closeHistory()
  await seed({ mode: 'time' })
  await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().startWork(900, 'History QA', () => {}))()`)
  const workBefore = await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().work)()`)
  await openHistory(); await delay(1200)
  const workAfter = await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().work)()`)
  check('work timer continues through history with the same deadline', workAfter.endsAt === workBefore.endsAt && workAfter.left < workBefore.left)
  check('timed targets and actual duration appear', await evaluate(`document.querySelector('[data-session-history-card]').textContent.includes('0:45') && document.querySelector('[data-session-history-card]').textContent.includes('0:42')`))
  await evaluate(`(async () => {
    window.__historyQaFinished = 0
    ;(await import('/src/store/useUI.js')).useUI.getState().startWork(1, 'History expiry QA', () => { window.__historyQaFinished++ })
  })()`)
  await delay(1600)
  check('work expiration calls its completion handler exactly once with history open', await evaluate(`(async () =>
    window.__historyQaFinished === 1 && !(await import('/src/store/useUI.js')).useUI.getState().work
      && !!document.querySelector('[data-session-history-dialog]'))()`))
  await closeHistory()
  await seed({ mode: 'cardio' }); await openHistory()
  check('cardio is shown as recorded activity with minutes and speed', await evaluate(`document.querySelector('[data-session-history-card]').textContent.includes('km/h') && document.querySelector('[data-history-outcome]').textContent.includes('Attività registrata')`))
  await closeHistory()
  await seed({ bodyweight: true, weight: 0 }); await openHistory()
  check('pure bodyweight does not display a fictitious zero load', await evaluate(`document.querySelector('.session-history-sets').textContent.includes('Corpo libero') && !document.querySelector('.session-history-sets').textContent.includes('0 kg')`))
  await closeHistory()
  await seed({ bodyweight: true, weight: 10 }); await openHistory()
  check('added bodyweight load has an explicit plus sign', await evaluate(`document.querySelector('.session-history-sets').textContent.includes('+10 kg')`))
  await closeHistory()
  await seed({ empty: true }); await openHistory()
  check('empty history is accessible and explains the missing previous sessions', await evaluate(`!document.querySelector('[data-session-history-card]') && document.querySelector('[data-session-history-dialog]').textContent.includes('Nessuna sessione precedente')`))
  console.log(JSON.stringify({ passed: checks.length, failed: 0, checks }, null, 2))
} finally {
  socket.send(JSON.stringify({ id: ++id, method: 'Browser.close' }))
  await delay(500); socket.close()
}
