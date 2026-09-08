import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('store data detection', () => {
  it('treats equipment-only profiles as syncable user data', async () => {
    const values = new Map()
    vi.stubGlobal('localStorage', {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn()
    })

    const { hasData } = await import('./useStore.js')
    expect(hasData({ equipmentProfiles: [{ id: 'gym', items: [] }] })).toBe(true)
    expect(hasData({ equipmentProfiles: [], routines: [], workouts: [], bodyweight: [] })).toBe(false)
  })
})
