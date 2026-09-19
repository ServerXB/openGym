import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const harness = vi.hoisted(() => ({
  state: null,
  update: vi.fn(),
  toast: vi.fn(),
  replaceState: vi.fn()
}))

vi.mock('../store/useStore.js', () => {
  const DEF = { reminder: { on: false, time: '08:00', tz: null } }
  const api = () => ({
    S: harness.state,
    user: null,
    update: harness.update,
    replaceState: harness.replaceState,
    setUser: vi.fn(),
    pullState: vi.fn(),
    pushState: vi.fn(),
    signOut: vi.fn(),
    signOutAll: vi.fn(),
    resetDemo: vi.fn()
  })
  const useStore = selector => selector ? selector(api()) : api()
  useStore.getState = api
  return { useStore, DEF, hasData: () => false }
})

vi.mock('../store/useUI.js', () => {
  const api = () => ({ toast: harness.toast, openSheet: vi.fn() })
  const useUI = selector => selector(api())
  useUI.getState = api
  return { useUI }
})

vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false,
  passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false
}))
vi.mock('../lib/push.js', () => ({
  pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn()
}))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: '#' }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn()
}))

import Settings from './Settings.jsx'

const renderSettings = preference => {
  harness.state = {
    unit: 'kg', lang: 'en', restSec: 90, sound: true, keepAwake: true,
    theme: 'dark', accent: 'lime', body: 'male', effort: 'none',
    equipmentProfiles: [], activeEquipmentProfileId: null,
    ...(preference === undefined ? {} : { askBodyweightBeforeWorkout: preference })
  }
  return renderToStaticMarkup(<MemoryRouter><Settings /></MemoryRouter>)
}

beforeEach(() => {
  harness.update.mockReset()
  harness.toast.mockReset()
  harness.replaceState.mockReset()
})

describe('workout-start settings', () => {
  it('renders the body-weight preference enabled for legacy state with an accessible name', () => {
    const html = renderSettings(undefined)

    expect(html).toContain('Workout start')
    expect(html).toContain('Show the quick check-in before every new workout. Manual logging stays available.')
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Ask for body weight"/)
  })

  it('renders an explicit opt-out as disabled', () => {
    const html = renderSettings(false)

    expect(html).toMatch(/role="switch" aria-checked="false" aria-label="Ask for body weight"/)
  })
})
