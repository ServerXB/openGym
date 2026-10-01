#!/usr/bin/env node
// Requirement 17 smoke. ONLY use a disposable Chromium profile: this seeds guest test data.
// Vite :4173 + Chromium remote debugging :9222; environment overrides supported below.
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
const pending = new Map()
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data)
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
const clickText = (scope, text) => evaluate(`(() => {
  const node = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find(n => n.textContent.trim() === ${JSON.stringify(text)})
  if (!node) throw new Error('Button not found: ' + ${JSON.stringify(text)})
  node.focus(); node.click()
})()`)
const readState = () => evaluate(`(async () => (await import('/src/store/useStore.js')).useStore.getState().S)()`)
async function seed() {
  await evaluate(`(async () => {
    const { DEF } = await import('/src/store/useStore.js')
    const { normalizeProgressionScopes } = await import('/src/lib/progression-scope.js')
    const { buildScopedWorkoutEntry } = await import('/src/lib/workout-scope.js')
    const { accountStateKey, createStateEnvelope } = await import('/src/lib/sync-state.js')
    const config = { id: '0025', mode: 'reps', sets: 4, reps: 8, minReps: 8, maxReps: 10,
      weight: 70, inc: 2, restSeconds: 120, maxRestSeconds: 180, prog: 'confirmed_rep_range',
      restReductionStrategy: 'auto_after_successes' }
    const S = { ...structuredClone(DEF), lang: 'it', sound: false, theme: 'dark', workouts: [],
      routines: [{ id: 'monday', name: 'Lunedì — routine di verifica', ex: [{ ...config }] },
        { id: 'thursday', name: 'Giovedì — progressione condivisa', ex: [{ ...config }] }] }
    normalizeProgressionScopes(S)
    const routine = S.routines[0], cfg = routine.ex[0]
    for (let i = 0; i < 3; i++) {
      const e = buildScopedWorkoutEntry(S, cfg, routine)
      e.target = { ...e.target, reps: 10, targetReps: 10, weight: 70 }
      e.sets = Array.from({ length: 4 }, () => ({ w: 70, r: 9, done: true }))
      const date = new Date(Date.now() - (3 - i) * 86400000).toISOString().slice(0, 10)
      S.workouts.push({ id: 'evidence-' + i, d: date, name: routine.name, routineId: routine.id, entries: [e] })
    }
    S.active = { id: 'stall-browser-active', d: new Date().toISOString().slice(0, 10),
      name: routine.name, start: Date.now(), cur: 0, routineId: routine.id,
      entries: [buildScopedWorkoutEntry(S, cfg, routine)] }
    localStorage.removeItem('gym_user'); localStorage.setItem('gym_guest', '1')
    localStorage.setItem(accountStateKey('guest'), JSON.stringify(createStateEnvelope({ accountId: 'guest', state: S })))
  })()`)
  await send('Page.navigate', { url: `${appUrl}/?stallAudit=${Date.now()}#/workout` })
  await waitFor(`document.querySelector('.stall-card')?.textContent.includes('Possibile stallo')`)
}

try {
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true })
  await send('Page.navigate', { url: appUrl })
  await waitFor(`location.origin === ${JSON.stringify(new URL(appUrl).origin)} && document.readyState === 'complete'`)
  await seed()
  const original = await readState()
  check('card visible without opening a dialog', await evaluate(`!document.querySelector('[role=dialog]') && document.querySelector('.stall-card').textContent.includes('64')`))
  check('320px no horizontal overflow', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
  await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().startRest(180))()`)
  const deadline = await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().timer.endsAt)()`)
  await clickText('.stall-card', 'Dettagli')
  await waitFor(`document.querySelector('.stall-evidence')?.children.length === 3`)
  check('three scoped evidence rows', await evaluate(`document.querySelector('.stall-evidence').textContent.includes('9 / 9 / 9 / 9')`))
  check('dialog semantics and initial focus', await evaluate(`!!document.querySelector('[role=dialog][aria-modal=true]') && document.querySelector('[role=dialog]').contains(document.activeElement)`))
  check('historical dates render correctly', await evaluate(`!document.querySelector('.stall-evidence').textContent.includes('Invalid Date')`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8 })
  check('Shift+Tab wraps inside dialog', await evaluate(`[...document.querySelector('[role=dialog]').querySelectorAll('button')].at(-1) === document.activeElement`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
  check('Tab wraps inside dialog', await evaluate(`document.querySelector('[role=dialog] button') === document.activeElement`))
  await evaluate(`document.documentElement.style.fontSize = '200%'`)
  check('details text reflows at 200 percent', await evaluate(`document.querySelector('.stall-details').scrollWidth <= document.querySelector('.stall-details').clientWidth`))
  await evaluate(`document.documentElement.style.fontSize = ''`)
  check('shared progression disclosed', await evaluate(`document.querySelector('.stall-disclosure')?.textContent.includes('Giovedì')`))
  check('details do not restart rest timer', (await evaluate(`(async () => (await import('/src/store/useUI.js')).useUI.getState().timer.endsAt)()`)) === deadline)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await waitFor(`!document.querySelector('[role=dialog]')`)
  check('keyboard close returns focus', await evaluate(`document.activeElement?.textContent.trim() === 'Dettagli'`))
  await clickText('.stall-card', 'Applica dal prossimo allenamento')
  await waitFor(`document.querySelector('[role=dialog]')?.textContent.includes('64')`)
  check('confirmation does not modify data yet', JSON.stringify((await readState()).progressionControls) === JSON.stringify(original.progressionControls))
  await clickText('[role=dialog]', 'Annulla')
  await clickText('.stall-card', 'Dettagli')
  await clickText('[role=dialog]', 'Applica dal prossimo allenamento')
  await waitFor(`document.querySelector('[role=dialog]')?.textContent.includes('Conferma riduzione futura del carico')`)
  check('details transition leaves only one modal dialog', await evaluate(`document.querySelectorAll('[role=dialog]').length === 1`))
  check('details transition retains focus inside confirmation', await evaluate(`document.querySelector('[role=dialog]').contains(document.activeElement)`))
  await clickText('[role=dialog]', 'Annulla')
  await clickText('.stall-card', 'Applica dal prossimo allenamento')
  await clickText('[role=dialog]', 'Conferma riduzione futura del carico')
  await waitFor(`!document.querySelector('.stall-card')`)
  const accepted = await readState()
  const pid = accepted.routines[0].ex[0].progressionId
  check('explicit acceptance persists baseline', accepted.progressionControls[pid].confirmedRepRangeLoad.baselineWeight === 64)
  check('active workout unchanged', JSON.stringify(accepted.active) === JSON.stringify(original.active))
  check('completed workouts unchanged', JSON.stringify(accepted.workouts) === JSON.stringify(original.workouts))
  check('operational map unchanged until completion', JSON.stringify(accepted.progressionWeights) === JSON.stringify(original.progressionWeights))
  const future = await evaluate(`(async () => {
    const S = (await import('/src/store/useStore.js')).useStore.getState().S
    return (await import('/src/lib/progression.js')).nextPrescription(S, S.routines[0].ex[0], S.routines[0])
  })()`)
  check('next prescription min reps and zero confirmations', future.weight === 64 && future.reps === 8 && future.topRangeStreak === 0 && future.restSeconds === 120)
  await send('Page.reload')
  await waitFor(`document.querySelector('.exercise-review')`)
  check('accepted reset survives refresh', (await readState()).progressionControls[pid].confirmedRepRangeLoad.baselineWeight === 64)
  await evaluate(`document.querySelector('details.exercise-review').open = true; document.querySelector('input[value=degraded]').click()`)
  await waitFor(`document.querySelector('input[value=degraded]')?.checked`)
  check('optional technique review saved', (await readState()).active.entries[0].review.technique === 'degraded')
  await evaluate(`(() => { const select = document.querySelector('.exercise-review select'); select.value = 'pain'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await waitFor(`document.querySelector('.review-pain')`)
  check('pain stop advice has live status', await evaluate(`document.querySelector('.review-pain')?.getAttribute('role') === 'status'`))
  await seed()
  await evaluate(`(async () => (await import('/src/store/useStore.js')).useStore.getState().update(s => {
    s.active.entries[0].review = { technique: 'unknown', failureReason: 'illness' }
  }))()`)
  await waitFor(`document.querySelector('.review-pain') && !document.querySelector('.stall-card')`)
  check('imported illness displays the combined stop option', await evaluate(`document.querySelector('.exercise-review select').value === 'pain'`))
  await evaluate(`document.querySelector('details.exercise-review').open = true; document.querySelector('input[value=clean]').click()`)
  await waitFor(`document.querySelector('input[value=clean]')?.checked`)
  check('editing technique preserves imported illness and suppresses the proposal', (await readState()).active.entries[0].review.failureReason === 'illness'
    && await evaluate(`!!document.querySelector('.review-pain') && !document.querySelector('.stall-card')`))
  await seed()
  await clickText('.stall-card', 'Mantieni questo carico')
  await waitFor(`!document.querySelector('.stall-card')`)
  check('dismissal persists without a load reset', !(await readState()).progressionControls[pid].confirmedRepRangeLoad)
  await send('Page.reload')
  await waitFor(`document.querySelector('.exercise-review')`)
  check('same dismissed evidence stays hidden after refresh', await evaluate(`!document.querySelector('.stall-card')`))
  await seed()
  await evaluate(`(async () => (await import('/src/store/useStore.js')).useStore.getState().update(s => { s.theme = 'light' }, false))()`)
  check('light-theme card has no horizontal overflow', await evaluate(`document.querySelector('.stall-card').scrollWidth <= document.querySelector('.stall-card').clientWidth`))
  await clickText('.stall-card', 'Ricordamelo più avanti')
  await waitFor(`!document.querySelector('.stall-card')`)
  check('snooze persists', (await readState()).progressionControls[pid].confirmedRepRangeStall.status === 'snoozed')
  console.log(JSON.stringify({ passed: checks.length, failed: 0, checks }, null, 2))
} finally {
  socket.send(JSON.stringify({ id: ++id, method: 'Browser.close' }))
  await delay(500); socket.close()
}
