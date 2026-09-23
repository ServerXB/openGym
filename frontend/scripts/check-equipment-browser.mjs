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
  `document.querySelector('.sheet')?.innerText.includes('Plate inventory (optional)') === true`,
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
await evaluate(`document.querySelector('.sheet button[aria-label="Remove inventory row"]')?.click()`)
await waitFor(
  `document.querySelectorAll('.sheet button[aria-label="Remove inventory row"]').length === 1`,
  'first inventory row removal'
)
await evaluate(`document.querySelector('.sheet button[aria-label="Remove inventory row"]')?.click()`)
await waitFor(
  `document.querySelectorAll('.sheet button[aria-label="Remove inventory row"]').length === 0`,
  'second inventory row removal'
)
await evaluate(`(() => {
  const save = [...document.querySelectorAll('.sheet button')]
    .find(button => button.textContent.trim() === 'Save')
  if (!save) throw new Error('Equipment save button not found')
  save.click()
})()`)
await waitFor(`document.querySelector('.sheet') === null`, 'equipment item editor save')
await waitFor(
  `JSON.parse(localStorage.getItem('gym_state_v1')).equipmentProfiles[0].items[0].denominations.length === 0`,
  'empty inventory persistence'
)
const profileAfterEditor = await evaluate(
  `JSON.parse(localStorage.getItem('gym_state_v1')).equipmentProfiles[0]`
)

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

const manualSnapshot = JSON.parse(JSON.stringify(profileAfterEditor))
manualSnapshot.workoutUnit = 'kg'
manualSnapshot.items[0].label = 'Bilanciere Decathlon'
manualSnapshot.items[0].tareWeight = 9.75
manualSnapshot.items[0].denominations = []
state.lang = 'it'
state.theme = 'dark'
state.active.equipmentSnapshot = manualSnapshot
state.active.entries[0].equipmentUse.label = 'Bilanciere Decathlon'
state.active.entries[0].sets[0].w = 116.75
await saveState()
await navigate('/?audit=workout-manual#/workout')
await waitFor(
  `document.querySelector('.equipment-guide.success')?.innerText.includes('Componi il carico manualmente') === true`,
  'manual per-side workout guide'
)
const manualWorkout = await evaluate(`(() => {
  const guide = document.querySelector('.equipment-guide.success')
  return {
    text: guide?.innerText || '',
    role: guide?.getAttribute('role') || '',
    live: guide?.getAttribute('aria-live') || '',
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }
})()`)

const cableSnapshot = {
  schemaVersion: 1,
  id: 'equipment-profile:cables',
  name: 'Palestra cavi',
  unit: 'kg',
  workoutUnit: 'kg',
  items: [{
    id: 'cable-stack', label: 'Cavo Technogym', kind: 'machine_stack',
    catalogEquipment: 'cable', tareWeight: 0, implementCount: 1, sideCount: 1,
    denominations: [{ weight: 60, count: 1 }]
  }, {
    id: 'cable-plates', label: 'Cavo Garage', kind: 'plate_loaded_machine',
    catalogEquipment: 'cable', tareWeight: 10, implementCount: 1, sideCount: 2,
    denominations: []
  }]
}
state.equipmentProfiles = [cableSnapshot]
state.activeEquipmentProfileId = cableSnapshot.id
state.active = null
await saveState()
await navigate('/?audit=cable-profile#/settings/equipment/equipment-profile%3Acables')
await waitFor(
  `document.body.innerText.includes('Cavo Technogym')
    && document.body.innerText.includes('Cavo Garage')
    && document.body.innerText.includes('Pacco pesi')
    && document.body.innerText.includes('Dischi · 2 punti di carico')`,
  'cable equipment profile'
)
const cableProfile = await evaluate(`(() => ({
  text: document.body.innerText,
  viewport: innerWidth,
  scrollWidth: document.documentElement.scrollWidth
}))()`)

await evaluate(`(() => {
  const row = [...document.querySelectorAll('.lrow')]
    .find(node => node.innerText.includes('Cavo Garage'))
  if (!row) throw new Error('Plate-loaded cable row not found')
  row.click()
})()`)
await waitFor(
  `document.querySelector('.sheet')?.innerText.includes('Come si carica questo cavo?') === true`,
  'plate-loaded cable editor'
)
const cableEditor = await evaluate(`(() => {
  const sheet = document.querySelector('.sheet')
  return {
    text: sheet?.innerText || '',
    clientWidth: sheet?.clientWidth || 0,
    scrollWidth: sheet?.scrollWidth || 0,
    labels: [...sheet.querySelectorAll('label,.stp-l,.equipment-label')]
      .map(node => node.textContent.trim()).filter(Boolean)
  }
})()`)

await evaluate(`(() => {
  const button = [...document.querySelectorAll('.sheet button')]
    .find(node => node.textContent.trim() === 'Pacco pesi')
  if (!button) throw new Error('Cable weight-stack option not found')
  button.click()
})()`)
await waitFor(
  `document.querySelector('.sheet')?.innerText.includes('Inserisci ogni valore indicato sul pacco pesi di questo cavo') === true`,
  'switch cable to weight stack'
)
const cableStackEditorText = await evaluate(`document.querySelector('.sheet')?.innerText || ''`)
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.sheet button')]
    .find(node => node.textContent.trim() === 'Dischi sui perni')
  if (!button) throw new Error('Plate-loaded cable option not found')
  button.click()
})()`)
await waitFor(
  `document.querySelector('.sheet')?.innerText.includes('Punti da caricare') === true`,
  'switch cable back to plate loading'
)
const cablePlateEditorText = await evaluate(`document.querySelector('.sheet')?.innerText || ''`)

const cableWorkout = (snapshot, itemId, label, kind, weight) => ({
  id: `browser-audit-${itemId}`, d: '2026-09-22', start: Date.now(), routineId: null,
  name: 'Cable browser audit', bw: null, cur: 0, equipmentSnapshot: snapshot,
  entries: [{
    id: '0007', target: { id: '0007', sets: 1, reps: 10, weight },
    plan: { kind: 'off' },
    equipmentUse: {
      status: 'resolved', profileId: snapshot.id, itemId, kind, label,
      catalogEquipment: 'cable', loadSemantics: 'total', implementCount: 1,
      source: 'slot_override'
    },
    sets: [{ w: weight, r: 10, done: false }]
  }]
})

state.active = cableWorkout(cableSnapshot, 'cable-plates', 'Cavo Garage', 'plate_loaded_machine', 60)
await saveState()
await navigate('/?audit=cable-two-points#/workout')
await waitFor(
  `document.querySelector('.equipment-guide.success')?.innerText.includes('Carica 25 kg su ciascun lato') === true`,
  'two-point plate-loaded cable guide'
)
const cableTwoPoints = await evaluate(`(() => {
  const guide = document.querySelector('.equipment-guide.success')
  return {
    text: guide?.innerText || '',
    role: guide?.getAttribute('role') || '',
    live: guide?.getAttribute('aria-live') || '',
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }
})()`)

const onePointCableSnapshot = structuredClone(cableSnapshot)
onePointCableSnapshot.items.find(item => item.id === 'cable-plates').sideCount = 1
state.active = cableWorkout(onePointCableSnapshot, 'cable-plates', 'Cavo Garage', 'plate_loaded_machine', 60)
await saveState()
await navigate('/?audit=cable-one-point#/workout')
await waitFor(
  `document.querySelector('.equipment-guide.success')?.innerText.includes('Carica 50 kg sul perno') === true`,
  'one-point plate-loaded cable guide'
)
const cableOnePoint = await evaluate(`document.querySelector('.equipment-guide.success')?.innerText || ''`)

state.active = cableWorkout(cableSnapshot, 'cable-stack', 'Cavo Technogym', 'machine_stack', 60)
await saveState()
await navigate('/?audit=cable-stack#/workout')
await waitFor(
  `document.querySelector('.equipment-guide.success')?.innerText.includes('Seleziona 60 kg sul pacco pesi') === true`,
  'selectorized cable guide'
)
const cableStack = await evaluate(`document.querySelector('.equipment-guide.success')?.innerText || ''`)

const checks = {
  profileListVisible: profileList.text.includes('Palestra')
    && profileList.text.includes('Active equipment profile'),
  profileListNoHorizontalOverflow: profileList.scrollWidth <= profileList.viewport,
  profileEditorVisible: profileEditor.text.includes('Bilanciere olimpico')
    && profileEditor.text.includes('empty 20 kg'),
  profileEditorNoHorizontalOverflow: profileEditor.scrollWidth <= profileEditor.viewport,
  profileEditorLabelsReadable: profileEditor.labels.includes('Name'),
  itemEditorVisible: itemEditor.name === 'Bilanciere olimpico'
    && itemEditor.text.includes('Plate inventory (optional)')
    && itemEditor.text.includes('Leave the plate inventory empty'),
  editorSavedEmptyInventory: profileAfterEditor.items[0].denominations.length === 0,
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
  lightGuideStillVisible: lightWorkout.text.includes('20 kg + 5 kg per side'),
  manualPerSideGuide: manualWorkout.text.includes('Obiettivo 116,75 kg · Bilanciere Decathlon')
    && manualWorkout.text.includes('53,5 kg di dischi per lato')
    && manualWorkout.text.includes('Componi il carico manualmente'),
  manualGuideAccessible: manualWorkout.role === 'status' && manualWorkout.live === 'polite',
  manualGuideNoHorizontalOverflow: manualWorkout.scrollWidth <= manualWorkout.viewport,
  cableProfileDistinguishesMechanisms: cableProfile.text.includes('Pacco pesi')
    && cableProfile.text.includes('Dischi · 2 punti di carico'),
  cableProfileNoHorizontalOverflow: cableProfile.scrollWidth <= cableProfile.viewport,
  cableEditorExplainsConvention: cableEditor.text.includes('Come si carica questo cavo?')
    && cableEditor.text.includes('Il peso registrato è il totale della macchina')
    && cableEditor.text.includes('Il rapporto delle pulegge non viene applicato')
    && cableEditor.text.includes('non i pezzi per punto di carico')
    && cableEditor.text.includes('carico per punto di carico'),
  cableEditorFieldsReadable: ['Resistenza del cavo a vuoto', 'Punti da caricare']
    .every(label => cableEditor.labels.includes(label)),
  cableEditorNoHorizontalOverflow: cableEditor.scrollWidth <= cableEditor.clientWidth,
  cableMechanismSwitchWorks: cableStackEditorText.includes('pacco pesi di questo cavo')
    && !cableStackEditorText.includes('Punti da caricare')
    && cablePlateEditorText.includes('Punti da caricare')
    && cablePlateEditorText.includes('Il rapporto delle pulegge non viene applicato'),
  cableTwoPointGuide: cableTwoPoints.text.includes('Obiettivo 60 kg · Cavo Garage')
    && cableTwoPoints.text.includes('Cavo caricato a dischi · 2 punti di carico')
    && cableTwoPoints.text.includes('Carica 25 kg su ciascun lato')
    && cableTwoPoints.text.includes('Totale dischi: 50 kg')
    && cableTwoPoints.text.includes('Il rapporto delle pulegge non viene applicato'),
  cableTwoPointGuideAccessible: cableTwoPoints.role === 'status' && cableTwoPoints.live === 'polite',
  cableTwoPointNoHorizontalOverflow: cableTwoPoints.scrollWidth <= cableTwoPoints.viewport,
  cableOnePointGuide: cableOnePoint.includes('Cavo caricato a dischi · un punto di carico')
    && cableOnePoint.includes('Carica 50 kg sul perno')
    && !cableOnePoint.includes('su ciascun lato'),
  cableStackGuide: cableStack.includes('Cavo · pacco pesi')
    && cableStack.includes('Seleziona 60 kg sul pacco pesi')
    && !cableStack.includes('su ciascun lato')
}

console.log(JSON.stringify({
  checks, profileList, profileEditor, itemEditor, darkWorkout, lightWorkout, manualWorkout,
  cableProfile, cableEditor, cableStackEditorText, cablePlateEditorText,
  cableTwoPoints, cableOnePoint, cableStack
}, null, 2))
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
