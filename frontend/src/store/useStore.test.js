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

describe('timer completion against the authoritative local active workout', () => {
  async function setup() {
    const values = new Map()
    vi.stubGlobal('localStorage', {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)
    })
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() })
    const { useStore } = await import('./useStore.js')
    const { accountStateKey } = await import('../lib/sync-state.js')
    useStore.getState().update(s => { s.active = { id: 'today', entries: [{ sets: [{ done: false, sec: 45 }, { done: false, sec: 45 }] }] } }, false)
    return { useStore, values, key: accountStateKey('guest') }
  }
  it('preserves another tab edit that this tab has not received yet', async () => {
    const { useStore, values, key } = await setup()
    const external = JSON.parse(values.get(key)); external.state.active.entries[0].sets[1].sec = 99
    values.set(key, JSON.stringify(external))
    expect(useStore.getState().S.active.entries[0].sets[1].sec).toBe(45)
    expect(useStore.getState().updateActiveWorkout('today', s => { s.active.entries[0].sets[0].done = true })).toBe(true)
    expect(useStore.getState().S.active.entries[0].sets).toEqual([{ done: true, sec: 45 }, { done: false, sec: 99 }])
  })
  it.each([null, { id: 'tomorrow', entries: [] }])('does not resurrect a closed or replaced workout %j', async active => {
    const { useStore, values, key } = await setup()
    const external = JSON.parse(values.get(key)); external.state.active = active
    values.set(key, JSON.stringify(external)); const original = values.get(key), mutate = vi.fn()
    expect(useStore.getState().updateActiveWorkout('today', mutate)).toBe(true)
    expect(mutate).not.toHaveBeenCalled(); expect(values.get(key)).toBe(original)
  })
  it('does not touch a corrupt account envelope', async () => {
    const { useStore, values, key } = await setup(); values.set(key, '{broken')
    expect(useStore.getState().updateActiveWorkout('today', vi.fn())).toBe(false)
    expect(values.get(key)).toBe('{broken')
  })
})
