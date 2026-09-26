import { describe, expect, it } from 'vitest'
import { MAX_SYNC_RETRY_MS, isTransientSyncError, syncErrorKind, syncRetryDelay } from './sync-runtime.js'

describe('sync retry policy', () => {
  it('backs off exponentially with bounded jitter and a one-minute cap', () => {
    expect(syncRetryDelay(0, () => 0)).toBe(500)
    expect(syncRetryDelay(1, () => 1)).toBe(2_000)
    expect(syncRetryDelay(20, () => 1)).toBe(MAX_SYNC_RETRY_MS)
  })

  it('keeps auth, conflicts and permanent payload failures distinct', () => {
    expect(syncErrorKind({ status: 401 })).toBe('auth_required')
    expect(syncErrorKind({ status: 412 })).toBe('conflict')
    expect(syncErrorKind({ status: 413 })).toBe('error')
    expect(isTransientSyncError({ status: 413 })).toBe(false)
  })

  it('treats timeouts, network failures and server failures as retryable offline states', () => {
    expect(syncErrorKind({ code: 'API_TIMEOUT' })).toBe('offline')
    expect(syncErrorKind(new TypeError('fetch failed'))).toBe('offline')
    expect(syncErrorKind({ status: 503 })).toBe('offline')
    expect(isTransientSyncError({ status: 503 })).toBe(true)
  })
})
