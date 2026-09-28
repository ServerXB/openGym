#!/usr/bin/env node
// Uses ONLY a dedicated disposable Chromium profile, as check-equipment-browser.mjs does.
// Start Vite on 4173 and Chromium remote debugging on 9222, then run this script.
// Validates the actual workout UI at 320 px and closes that browser even on failure.
import assert from 'node:assert/strict'

const appUrl = process.env.OPENGYM_APP_URL || 'http://127.0.0.1:4173'
const cdpUrl = process.env.OPENGYM_CDP_URL || 'http://127.0.0.1:9222'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const targets = await (await fetch(`${cdpUrl}/json`)).json()
const target = targets.find(page => page.type === 'page')
assert.ok(target, 'A dedicated browser page is required')
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
  pending.delete(response.id)
  clearTimeout(handler.timeout)
  if (response.error) handler.reject(new Error(response.error.message))
  else handler.resolve(response.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const callId = ++id
  const timeout = setTimeout(() => {
    pending.delete(callId)
    reject(new Error(`Timed out: ${method}`))
  }, 15000)
  pending.set(callId, { resolve, reject, timeout })
  socket.send(JSON.stringify({ id: callId, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression) {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    if (await evaluate(expression)) return
    await delay(100)
  }
  throw new Error(`Condition not reached: ${expression}`)
}

const cases = [
  { name: 'above-base-1', elevated: 1, base: 0, text: 'progressione è sospesa', extra: '1 / 4', weight: 93.75, rest: 270, streak: 0 },
  { name: 'above-base-2', elevated: 2, base: 0, text: 'progressione è sospesa', extra: '2 / 4', weight: 93.75, rest: 270, streak: 0 },
  { name: 'just-reduced', elevated: 4, base: 0, text: 'due nuove sessioni', extra: 'da 270s a 240s', weight: 93.75, rest: 240, streak: 0 },
  { name: 'base-first', elevated: 4, base: 1, text: 'recupero base: prima conferma', extra: '(1 / 2)', weight: 93.75, rest: 240, streak: 1 },
  { name: 'base-second', elevated: 4, base: 2, text: 'Peso aumentato', extra: '95.75', weight: 95.75, rest: 240, streak: 0 },
  { name: 'manual', elevated: 4, base: 0, manual: true, text: 'progressione è sospesa', extra: 'usa il reset manuale', weight: 93.75, rest: 270, streak: 0 }
]
const results = []
try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true })
  await send('Page.navigate', { url: appUrl })
  await waitFor(`location.origin === ${JSON.stringify(new URL(appUrl).origin)} && document.readyState === 'complete'`)
  for (const scenario of cases) {
    const prescription = await evaluate(`(async () => {
      const { DEF } = await import('/src/store/useStore.js')
      const { nextPrescription, applyPrescription } = await import('/src/lib/progression.js')
      const { buildSets } = await import('/src/lib/history.js')
      const { targetForPrescription } = await import('/src/lib/workout-prescription.js')
      const { accountStateKey, createStateEnvelope } = await import('/src/lib/sync-state.js')
      const scenario = ${JSON.stringify(scenario)}
      const cfg = { id: '0025', sets: 5, reps: 3, minReps: 3, maxReps: 5, weight: 93.75,
        inc: 2, restSeconds: 240, maxRestSeconds: 300, prog: 'confirmed_rep_range',
        restReductionStrategy: scenario.manual ? 'manual' : 'auto_after_successes' }
      const S = { ...structuredClone(DEF), lang: 'it', sound: false, theme: 'dark', workouts: [] }
      for (let i = 0; i < scenario.elevated + scenario.base; i++) {
        S.workouts.push({ d: '2026-09-' + String(i + 1).padStart(2, '0'), entries: [{ id: cfg.id,
          target: { ...cfg, reps: 5, targetReps: 5, restBaseSeconds: 240, restSeconds: i < scenario.elevated ? 270 : 240 },
          sets: Array.from({ length: 5 }, () => ({ w: 93.75, r: 5, done: true })) }] })
      }
      const plan = nextPrescription(S, cfg)
      S.active = { id: 'recovery-browser-audit', name: 'Recovery audit', d: '2026-09-28',
        start: Date.now(), routineId: null, bw: null, cur: 0, entries: [{ id: cfg.id, plan,
          target: targetForPrescription(cfg, plan), sets: applyPrescription(buildSets(S, cfg), plan) }] }
      localStorage.removeItem('gym_user')
      localStorage.setItem('gym_guest', '1')
      localStorage.setItem(accountStateKey('guest'), JSON.stringify(createStateEnvelope({ accountId: 'guest', state: S })))
      return { weight: plan.weight, rest: plan.restSeconds, streak: plan.topRangeStreak }
    })()`)
    assert.deepEqual(prescription, { weight: scenario.weight, rest: scenario.rest, streak: scenario.streak }, scenario.name)
    await send('Page.navigate', { url: `${appUrl}/?recoveryAudit=${scenario.name}#/workout` })
    await waitFor(`document.querySelector('.progline')?.textContent.includes(${JSON.stringify(scenario.text)})`)
    const ui = await evaluate(`({ text: [...document.querySelectorAll('.progline')].map(n => n.innerText).join('\\n'),
      width: innerWidth, scroll: document.documentElement.scrollWidth })`)
    assert.ok(ui.text.includes(scenario.extra), `${scenario.name}: ${ui.text}`)
    assert.ok(ui.scroll <= ui.width, `${scenario.name}: horizontal overflow`)
    if (scenario.rest > 240) assert.ok(!ui.text.includes('1 / 2'), 'Above-base work must not show a confirmation')
    results.push({ name: scenario.name, prescription, ...ui })
  }
  console.log(JSON.stringify({ passed: cases.length, failed: 0, results }, null, 2))
} finally {
  socket.send(JSON.stringify({ id: ++id, method: 'Browser.close' }))
  await delay(500)
  socket.close()
}
