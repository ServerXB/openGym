import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('api', () => {
  it('exposes the response body on HTTP errors so sync can reconcile a 412', async () => {
    vi.stubGlobal('navigator', { userAgent: '' })
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 412,
      json: async () => ({ error: 'revision_conflict', revision: 4, state: { routines: [] } })
    }))
    const { api } = await import('./api.js')

    await expect(api('/api/data')).rejects.toMatchObject({
      status: 412,
      data: { error: 'revision_conflict', revision: 4, state: { routines: [] } }
    })
  })

  it('aborts a stalled request at the explicit timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { userAgent: '' })
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', vi.fn((_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const { api } = await import('./api.js')

    const pending = api('/api/data', { timeout: 25 })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'API_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(25)
    await assertion
  })
})
