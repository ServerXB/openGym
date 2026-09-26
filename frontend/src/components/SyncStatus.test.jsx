import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const harness = vi.hoisted(() => ({ state: null }))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector(harness.state)
}))
vi.mock('../lib/i18n.js', () => ({
  dateLocale: () => 'en-GB',
  t: (text, ...args) => args.reduce((out, arg, index) => out.replaceAll(`{${index}}`, arg), text)
}))

import SyncStatus from './SyncStatus.jsx'

beforeEach(() => {
  harness.state = {
    user: { id: 'u1' },
    S: { active: null },
    sync: { status: 'pending', pendingCount: 2 },
    syncNow: vi.fn(),
    resolveSyncConflict: vi.fn()
  }
})

describe('SyncStatus', () => {
  it('explains that pending changes are already local and offers a manual retry', () => {
    const html = renderToStaticMarkup(<SyncStatus />)
    expect(html).toContain('2 changes waiting to sync')
    expect(html).toContain('Sync now')
    expect(html).toContain('role="status"')
  })

  it('keeps a conflict compact while a workout is active', () => {
    harness.state.S.active = { id: 'active' }
    harness.state.sync = { status: 'conflict', conflict: { conflicts: [{ path: '/unit' }] } }
    const html = renderToStaticMarkup(<SyncStatus />)
    expect(html).toContain('Finish the workout before resolving this conflict.')
    expect(html).not.toContain('>Review<')
    expect(html).not.toContain('Use server')
  })

  it('does not render sync controls for guest profiles', () => {
    harness.state.user = null
    expect(renderToStaticMarkup(<SyncStatus />)).toBe('')
  })
})
