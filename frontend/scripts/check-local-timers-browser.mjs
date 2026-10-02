// Run ONLY with a disposable Chromium profile. Vite :4173, CDP :9223.
// First invocation closes the browser with a pending timer; --verify-restart uses the SAME
// disposable profile in a newly started browser. No production profile/server data is touched.
import assert from 'node:assert/strict'
const appUrl = process.env.OPENGYM_APP_URL || 'http://127.0.0.1:4173'
const cdpUrl = process.env.OPENGYM_CDP_URL || 'http://127.0.0.1:9223'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function connect(targetId) {
  const targets = await (await fetch(cdpUrl + '/json')).json()
  const target = targets.find(t => t.type === 'page' && (!targetId || t.id === targetId))
  assert.ok(target, 'Disposable browser page required')
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map()
  let id = 0
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data), call = pending.get(response.id)
    if (!call) return
    pending.delete(response.id); clearTimeout(call.timeout)
    response.error ? call.reject(Error(response.error.message)) : call.resolve(response.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const call = ++id, timeout = setTimeout(() => { pending.delete(call); reject(Error('Timeout: ' + method)) }, 15000)
    pending.set(call, { resolve, reject, timeout }); socket.send(JSON.stringify({ id: call, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  await send('Page.enable'); await send('Runtime.enable')
  return { send, evaluate, close: () => socket.close() }
}
const primary = await connect(), checks = [], sockets = [primary]
const check = (label, condition) => { assert.ok(condition, label); checks.push(label) }
const ui = expression => `(async () => { const ui = (await import('/src/store/useUI.js')).useUI; ${expression} })()`
const domain = expression => `(async () => { const store = (await import('/src/store/useStore.js')).useStore; ${expression} })()`
const timer = page => page.evaluate(ui('return ui.getState().timer'))
const state = page => page.evaluate(domain('return store.getState().S'))
async function waitFor(page, expression) {
  for (let n = 0; n < 100; n++) { if (await page.evaluate(`(async () => Boolean(await (${expression})))()`)) return; await delay(100) }
  console.error('QA diagnostic:', await page.evaluate(`(async()=>{
    const store=(await import('/src/store/useStore.js')).useStore.getState(), ui=(await import('/src/store/useUI.js')).useUI.getState()
    return {page:document.body.textContent.slice(0,1800),ready:store.ready,account:store.getAccountId(),active:store.S.active,
      timer:ui.timer,work:ui.work,error:ui.timerError,startArgs:window.__timerQaStartArgs,startResult:window.__timerQaStartResult}
  })()`))
  throw Error('Condition not reached: ' + expression)
}
async function navigate(page) {
  const previousOrigin = await page.evaluate('performance.timeOrigin')
  await page.send('Page.navigate', { url: appUrl + '/?timerQa=' + Date.now() + '#/workout' })
  await waitFor(page, `performance.timeOrigin !== ${previousOrigin} && document.querySelector('.setrow')`)
}
async function seed(page) {
  await page.evaluate(`(async () => {
    const { DEF } = await import('/src/store/useStore.js')
    const { accountStateKey, createStateEnvelope } = await import('/src/lib/sync-state.js')
    const S = { ...structuredClone(DEF), lang: 'it', sound: false, workouts: [], routines: [], active: {
      id: 'timer-qa-workout-' + crypto.randomUUID(), name: 'Timer QA', d: '2026-10-02', start: Date.now(), cur: 0,
      entries: [0,1].map(() => ({ id: '0025', target: { mode: 'time', prog: 'time', sec: 15, sets: 2, bodyweight: true },
        plan: { restSeconds: 120 }, sets: [{ sec: 15, w: 0, done: false }, { sec: 15, w: 0, done: false }] })) } }
    localStorage.removeItem('gym_user'); localStorage.setItem('gym_guest', '1')
    localStorage.setItem(accountStateKey('guest'), JSON.stringify(createStateEnvelope({ accountId: 'guest', state: S })))
  })()`)
  await navigate(page)
}
async function startWork(page, setIndex = 0, seconds = 2) {
  return page.evaluate(`(async () => {
    const store = (await import('/src/store/useStore.js')).useStore
    const { bindTimedSet } = await import('/src/lib/timed-set-completion.js')
    const { uid } = await import('/src/lib/format.js')
    let binding
    store.getState().update(s => { binding = bindTimedSet(s, 0, ${setIndex}, uid) }, false)
    return (await import('/src/store/useUI.js')).useUI.getState().startWork(${seconds}, 'Timer QA', null, binding)
  })()`)
}
try {
  await primary.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: true })
  await primary.send('Page.navigate', { url: appUrl })
  await waitFor(primary, `location.origin === ${JSON.stringify(new URL(appUrl).origin)} && document.readyState === 'complete'`)
  if (process.argv.includes('--verify-restart')) {
    await navigate(primary)
    await waitFor(primary, `document.querySelector('#timer .t')`)
    const snapshot = await timer(primary)
    const expected = await primary.evaluate(`JSON.parse(localStorage.getItem('opengym-timer-qa-restart'))`)
    check('timer survives full browser shutdown and restart', snapshot.timerId === expected.timerId && snapshot.deadlineAt === expected.deadlineAt && snapshot.left > 0 && snapshot.left < 900)
    check('reopened timer retains workout and revision identity', snapshot.workoutId === expected.workoutId && snapshot.revision === expected.revision)
    await primary.evaluate(ui('return ui.getState().stopRest()'))
  } else {
    await seed(primary)
    check('IndexedDB is available without relying on Web Locks', await primary.evaluate(`!!indexedDB`))
    await primary.evaluate(`document.querySelector('.setgo').click()`)
    await waitFor(primary, `document.querySelector('#timer.working')`)
    await waitFor(primary, ui('return !!ui.getState().work?.binding?.setId'))
    check('real Start set control creates a durable row binding', !!await primary.evaluate(ui('return ui.getState().work?.binding?.setId')))
    await primary.evaluate(`document.querySelector('#timer.working button').click()`)
    await waitFor(primary, `!document.querySelector('#timer')`)
    check('real Cancel control leaves the timed set unchecked', !(await state(primary)).active.entries[0].sets[0].done)
    await primary.evaluate(ui('return ui.getState().startRest(120)'))
    const original = await timer(primary)
    check('rest timer is scoped and rendered', original.workoutId.startsWith('timer-qa-workout-') && await primary.evaluate(`!!document.querySelector('#timer.rest .t')`))
    await delay(1300); await navigate(primary)
    await waitFor(primary, `document.querySelector('#timer.rest .t')`)
    const refreshed = await timer(primary)
    check('refresh retains identity, revision and original deadline', refreshed.timerId === original.timerId && refreshed.revision === original.revision && refreshed.deadlineAt === original.deadlineAt && refreshed.left < 120)
    const target = await primary.send('Target.createTarget', { url: appUrl + '/#/workout' })
    const second = await connect(target.targetId); sockets.push(second)
    await waitFor(second, `document.querySelector('#timer.rest')`)
    check('second tab restores the same timer', (await timer(second)).timerId === original.timerId)
    await primary.evaluate(`document.querySelectorAll('#timer .acts button')[1].click()`)
    await waitFor(second, ui(`return ui.getState().timer?.revision === ${original.revision + 1}`))
    check('real +15 control propagates revision and deadline across tabs', Math.abs((await timer(second)).deadlineAt - original.deadlineAt - 15000) < 20)
    check('stale cancel cannot remove extended timer', await second.evaluate(ui(`return !(await ui.getState().stopRest(${JSON.stringify({ timerId: original.timerId, revision: original.revision })}))`)))
    await primary.evaluate(`window.__timerQaNow = Date.now; Date.now = () => window.__timerQaNow() + 3600000`)
    const before = (await timer(primary)).left
    await primary.evaluate(`window.dispatchEvent(new Event('focus'))`); await delay(500)
    check('live timer ignores forward wall-clock jump and focus refresh', Math.abs((await timer(primary)).left - before) <= 1)
    await primary.evaluate(`Date.now = () => window.__timerQaNow() - 3600000; document.dispatchEvent(new Event('visibilitychange'))`); await delay(500)
    check('live timer ignores backward wall-clock jump', Math.abs((await timer(primary)).left - before) <= 2)
    await primary.evaluate(`Date.now = window.__timerQaNow`)
    await primary.evaluate(`document.querySelector('#timer .skip').click()`)
    await waitFor(second, `!document.querySelector('#timer')`)
    check('Skip propagates a durable terminal revision to both tabs', !await timer(primary) && !await timer(second))
    const vibrationCounter = `window.__timerQaVibrations = 0; Object.defineProperty(navigator, 'vibrate', {configurable:true,value:()=>{window.__timerQaVibrations++;return true}})`
    for (const page of [primary, second]) {
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: vibrationCounter })
      await page.evaluate(vibrationCounter)
    }
    await primary.evaluate(ui('return ui.getState().startRest(1)')); await delay(1700)
    check('real IndexedDB rest expiration alerts once across two tabs', await primary.evaluate('window.__timerQaVibrations') + await second.evaluate('window.__timerQaVibrations') === 1)
    for (const page of [primary, second]) await page.evaluate(vibrationCounter)
    await startWork(primary, 0, 2)
    const bound = await primary.evaluate(ui('return ui.getState().work'))
    check('work timer has stable entry and set binding', !!bound.binding.entryId && !!bound.binding.setId)
    await navigate(primary)
    // Emulate a suspended tab which has not received the other tab's workout edit yet.
    await primary.evaluate(`window.__timerQaBlockStorage = event => event.stopImmediatePropagation(); window.addEventListener('storage', window.__timerQaBlockStorage, true)`)
    await second.evaluate(domain('return store.getState().update(s => { s.active.entries[1].sets[1].sec = 99 })'))
    await delay(2300)
    const completed = await state(primary)
    await primary.evaluate(`window.removeEventListener('storage', window.__timerQaBlockStorage, true)`)
    check('work timer restored after refresh completes the exact original set', completed.active.entries[0].sets[0].done && completed.active.entries[0].sets[0].sec === 2 && !completed.active.entries[1].sets[0].done)
    check('real IndexedDB work completion alerts once across two tabs and refresh', await primary.evaluate('window.__timerQaVibrations') + await second.evaluate('window.__timerQaVibrations') === 1)
    check('completion preserves an unseen workout edit made by the other tab', completed.active.entries[1].sets[1].sec === 99)
    await waitFor(second, ui('return ui.getState().timer?.kind === "rest"'))
    check('recovery after a restored timed set uses the frozen prescription', (await timer(primary)).total === 120)
    await startWork(primary, 1, 15)
    await primary.evaluate(domain('return store.getState().update(s => { s.active.cur = 1 })'))
    await delay(1500); await primary.evaluate(ui('return ui.getState().finishWorkEarly()')); await delay(500)
    const early = await state(primary)
    check('early finish logs elapsed duration on the original entry despite selection change', early.active.entries[0].sets[1].done && early.active.entries[0].sets[1].sec >= 1 && early.active.entries[0].sets[1].sec < 15 && !early.active.entries[1].sets[1].done)
    await seed(primary); await startWork(primary, 1, 2)
    await primary.evaluate(domain('return store.getState().update(s => { s.active.entries[0].sets.pop(); s.active.entries[0].sets.push({ sec: 30, w: 0, done: false }) })'))
    await delay(2500)
    check('removed and re-added row at same index is not credited', !(await state(primary)).active.entries[0].sets[1].done)
    await startWork(primary, 0, 2)
    await primary.evaluate(domain('return store.getState().update(s => { s.active = { ...s.active, id: "replacement-workout", entries: s.active.entries.map(e => ({...e, sets: e.sets.map(s => ({...s, done: false}))})) } })'))
    await delay(2500)
    check('replacement workout cancels work and cannot inherit its completion', !(await state(primary)).active.entries[0].sets[0].done && !await primary.evaluate(ui('return ui.getState().work')))
    // Corrupt DB record must remain intact; no silent replacement or false success.
    await primary.evaluate(`(async () => {
      const request = indexedDB.open('opengym-local-timers',1)
      await new Promise((resolve,reject) => { request.onsuccess=resolve; request.onerror=reject })
      const db=request.result, tx=db.transaction('timers','readwrite')
      tx.objectStore('timers').put({ accountId:'guest', version:999, marker:'preserve-me' })
      await new Promise((resolve,reject) => { tx.oncomplete=resolve; tx.onabort=reject }); db.close()
      window.dispatchEvent(new Event('focus'))
    })()`)
    await waitFor(primary, `document.querySelector('#timer[role="alert"]')`)
    check('corrupt timer storage produces an explicit localized error', await primary.evaluate(`document.querySelector('#timer').textContent.includes('Impossibile salvare il timer')`))
    check('corrupt record cannot be silently overwritten by a new start', await primary.evaluate(ui('return !(await ui.getState().startRest(120))')))
    await primary.evaluate(`(async () => { const r=indexedDB.open('opengym-local-timers',1); await new Promise(ok=>r.onsuccess=ok); const db=r.result,tx=db.transaction('timers','readwrite'); tx.objectStore('timers').delete('guest'); await new Promise(ok=>tx.oncomplete=ok);db.close() })()`)
    await primary.send('Target.closeTarget', { targetId: target.targetId }); second.close()
    await seed(primary)
    await primary.evaluate(ui('return ui.getState().startRest(900)'))
    const restart = await timer(primary)
    await primary.evaluate(`localStorage.setItem('opengym-timer-qa-restart', ${JSON.stringify(JSON.stringify(restart))})`)
    check('pending restart fixture is persisted in real IndexedDB', restart.status === 'running' && restart.left === 900)
  }
  console.log(JSON.stringify({ passed: checks.length, failed: 0, checks }, null, 2))
} finally {
  primary.send('Browser.close').catch(() => {})
  await delay(700); sockets.forEach(socket => socket.close())
}
