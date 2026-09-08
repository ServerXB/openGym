#!/usr/bin/env node
// Browser smoke test for Requirement 7.
// Start Vite on 4173 and a dedicated Chromium/Edge instance with remote debugging on 9222,
// then run this file. It seeds only that temporary browser profile and closes the browser.

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const cdpUrl = process.env.OPENGYM_CDP_URL || 'http://127.0.0.1:9222'
const appUrl = process.env.OPENGYM_APP_URL || 'http://127.0.0.1:4173'
const targets = await (await fetch(`${cdpUrl}/json`)).json()
const target = targets.find(candidate => candidate.type === 'page')
if (!target) throw new Error('No Chromium page target available')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const handlers = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) handlers.reject(new Error(message.error.message))
  else handlers.resolve(message.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
const waitFor = async (expression, label, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const navigate = async suffix => {
  await send('Page.navigate', { url: `${appUrl}${suffix}` })
  await waitFor(
    `location.origin === ${JSON.stringify(new URL(appUrl).origin)} && document.readyState === 'complete'`,
    suffix
  )
}

let failed = false
try {
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 320, height: 900, deviceScaleFactor: 1, mobile: true
})
await navigate('/')

const equipmentSnapshot = {
  schemaVersion: 1,
  id: 'equipment-profile:gym',
  name: 'Palestra',
  unit: 'kg',
  workoutUnit: 'kg',
  items: [{
    id: 'bar-main', label: 'Bilanciere olimpico', kind: 'symmetric_bar',
    catalogEquipment: 'barbell', tareWeight: 20, implementCount: 1, sideCount: 2,
    denominations: [{ weight: 20, count: 2 }, { weight: 5, count: 2 }]
  }]
}
const state = {
  unit: 'kg', lang: 'en', theme: 'dark', accent: 'lime', sound: false,
  routines: [], workouts: [], bodyweight: [], customEx: [],
  equipmentProfiles: [equipmentSnapshot],
  activeEquipmentProfileId: equipmentSnapshot.id,
  active: null
}
const saveState = () => evaluate(
  `localStorage.setItem('gym_guest', '1'); localStorage.setItem('gym_state_v1', ${JSON.stringify(JSON.stringify(state))})`
)
await saveState()

await navigate('/?audit=profiles#/settings/equipment')
await waitFor(`document.body.innerText.includes('Active equipment profile')`, 'equipment profile list')
const profileList = await evaluate(`(() => ({
  text: document.body.innerText,
  viewport: innerWidth,
  scrollWidth: document.documentElement.scrollWidth
}))()`)

await navigate('/?audit=editor#/settings/equipment/equipment-profile%3Agym')
await waitFor(`document.body.innerText.includes('Bilanciere olimpico')`, 'equipment profile editor')
const profileEditor = await evaluate(`(() => ({
  text: document.body.innerText,
  viewport: innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  labels: [...document.querySelectorAll('label,.stp-l')]
    .map(node => node.textContent.trim()).filter(Boolean)
}))()`)

await evaluate(`(() => {
  const row = [...document.querySelectorAll('.lrow')]
    .find(node => node.innerText.includes('Bilanciere olimpico'))
  if (!row) throw new Error('Equipment row not found')
  row.click()
})()`)
await waitFor(
  `document.querySelector('.sheet')?.innerText.includes('Available weights and quantities') === true`,
  'equipment item editor'
)
const itemEditor = await evaluate(`(() => {
  const sheet = document.querySelector('.sheet')
  const labels = [...sheet.querySelectorAll('label,.stp-l,.equipment-label')]
    .map(node => node.textContent.trim()).filter(Boolean)
  return {
    text: sheet.innerText,
    name: sheet.querySelector('#equipment-label')?.value || '',
    viewport: innerWidth,
    clientWidth: sheet.clientWidth,
    scrollWidth: sheet.scrollWidth,
    labels
  }
})()`)
await evaluate(`document.querySelector('.mback')?.click()`)
await waitFor(`document.querySelector('.sheet') === null`, 'equipment item editor close')

state.active = {
  id: 'browser-audit', d: '2026-09-06', start: Date.now(), routineId: null,
  name: 'Browser audit', bw: null, cur: 0, equipmentSnapshot,
  entries: [{
    id: '0025', target: { id: '0025', sets: 1, reps: 8, weight: 70 },
    plan: { kind: 'off' },
    equipmentUse: {
      status: 'resolved', profileId: equipmentSnapshot.id, itemId: 'bar-main',
      kind: 'symmetric_bar', label: 'Bilanciere olimpico', catalogEquipment: 'barbell',
      loadSemantics: 'total', implementCount: 1, source: 'slot_override'
    },
    sets: [{ w: 70, r: 8, done: false }]
  }]
}
await saveState()
await navigate('/?audit=workout-dark#/workout')
await waitFor(`document.querySelector('.equipment-guide.success') !== null`, 'dark workout guide')
const darkWorkout = await evaluate(`(() => {
  const guide = document.querySelector('.equipment-guide.success')
  return {
    text: guide?.innerText || '',
    role: guide?.getAttribute('role') || '',
    live: guide?.getAttribute('aria-live') || '',
    color: guide ? getComputedStyle(guide).color : '',
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }
})()`)

state.theme = 'light'
await saveState()
await navigate('/?audit=workout-light#/workout')
await waitFor(`document.documentElement.dataset.theme === 'light' && document.querySelector('.equipment-guide.success') !== null`, 'light workout guide')
const lightWorkout = await evaluate(`(() => {
  const guide = document.querySelector('.equipment-guide.success')
  return {
    theme: document.documentElement.dataset.theme,
    color: guide ? getComputedStyle(guide).color : '',
    text: guide?.innerText || ''
  }
})()`)

const checks = {
  profileListVisible: profileList.text.includes('Palestra')
    && profileList.text.includes('Active equipment profile'),
  profileListNoHorizontalOverflow: profileList.scrollWidth <= profileList.viewport,
  profileEditorVisible: profileEditor.text.includes('Bilanciere olimpico')
    && profileEditor.text.includes('empty 20 kg'),
  profileEditorNoHorizontalOverflow: profileEditor.scrollWidth <= profileEditor.viewport,
  profileEditorLabelsReadable: profileEditor.labels.includes('Name'),
  itemEditorVisible: itemEditor.name === 'Bilanciere olimpico'
    && itemEditor.text.includes('Available weights and quantities'),
  itemEditorNoHorizontalOverflow: itemEditor.scrollWidth <= itemEditor.clientWidth,
  itemEditorLabelsReadable: ['Name', 'Empty equipment weight', 'Weight', 'Quantity']
    .every(label => itemEditor.labels.includes(label)),
  workoutGuideExact: darkWorkout.text.includes('Target 70 kg · Bilanciere olimpico')
    && darkWorkout.text.includes('20 kg + 5 kg per side'),
  workoutGuideAccessible: darkWorkout.role === 'status' && darkWorkout.live === 'polite',
  workoutNoHorizontalOverflow: darkWorkout.scrollWidth <= darkWorkout.viewport,
  darkSemanticColor: darkWorkout.color === 'rgb(48, 209, 88)',
  lightSemanticColor: lightWorkout.theme === 'light'
    && lightWorkout.color === 'rgb(19, 115, 51)',
  lightGuideStillVisible: lightWorkout.text.includes('20 kg + 5 kg per side')
}

console.log(JSON.stringify({ checks, profileList, profileEditor, itemEditor, darkWorkout, lightWorkout }, null, 2))
failed = Object.values(checks).some(value => !value)
} finally {
  try {
    socket.send(JSON.stringify({ id: nextId++, method: 'Browser.close' }))
    await delay(500)
  } finally {
    socket.close()
  }
}
if (failed) process.exit(1)
