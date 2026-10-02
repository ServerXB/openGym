import { describe, expect, it, vi } from 'vitest'
import { createTimerNotifier, REST_NOTIFICATION_ID } from './timer-notifications.js'

const NOW = 1_800_000_000_000
const rest = (overrides = {}) => ({
  timerId: 'rest-a', revision: 1, accountId: 'account-a', kind: 'rest',
  status: 'running', deadlineAt: NOW + 90_499, ...overrides
})
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const nativePlugin = () => ({
  cancel: vi.fn().mockResolvedValue(undefined),
  checkPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
  requestPermissions: vi.fn(),
  schedule: vi.fn().mockResolvedValue(undefined)
})

describe('native rest notifications', () => {
  it('uses the timer absolute deadline and a reserved id distinct from weekly reminders', async () => {
    const native = nativePlugin()
    const notify = createTimerNotifier({ mobile: true, loadNative: async () => ({ LocalNotifications: native }), wallNow: () => NOW })

    expect(await notify(rest())).toBe(true)
    expect(native.cancel).toHaveBeenCalledWith({ notifications: [{ id: REST_NOTIFICATION_ID }] })
    expect(native.schedule).toHaveBeenCalledExactlyOnceWith({ notifications: [{
      id: 200, title: 'Rest timer', body: 'Rest over — next set!',
      schedule: { at: new Date(NOW + 90_499), allowWhileIdle: true }
    }] })
    expect(native.requestPermissions).not.toHaveBeenCalled()
  })

  it.each(['prompt', 'prompt-with-rationale', 'denied'])('leaves the timer usable when permission is %s', async display => {
    const native = nativePlugin()
    native.checkPermissions.mockResolvedValue({ display })
    const notify = createTimerNotifier({ mobile: true, loadNative: async () => native, wallNow: () => NOW })

    expect(await notify(rest())).toBe(false)
    expect(native.cancel).toHaveBeenCalledOnce()
    expect(native.schedule).not.toHaveBeenCalled()
    expect(native.requestPermissions).not.toHaveBeenCalled()
  })

  it.each([null, rest({ kind: 'work' }), rest({ status: 'completed' }), rest({ status: 'cancelled' }), rest({ deadlineAt: NOW }), rest({ deadlineAt: NaN })])(
    'cancels the rest alert without scheduling work or terminal records: %j', async record => {
      const native = nativePlugin()
      const notify = createTimerNotifier({ mobile: true, loadNative: async () => native, wallNow: () => NOW })

      expect(await notify(record)).toBe(true)
      expect(native.cancel).toHaveBeenCalledExactlyOnceWith({ notifications: [{ id: 200 }] })
      expect(native.checkPermissions).not.toHaveBeenCalled()
      expect(native.schedule).not.toHaveBeenCalled()
    }
  )

  it('suppresses scheduling if cancel arrives during the permission check', async () => {
    const native = nativePlugin()
    const checking = deferred()
    const permission = deferred()
    native.checkPermissions.mockImplementation(() => { checking.resolve(); return permission.promise })
    const notify = createTimerNotifier({ mobile: true, loadNative: async () => native, wallNow: () => NOW })

    const starting = notify(rest())
    await checking.promise
    const cancelling = notify(null)
    permission.resolve({ display: 'granted' })

    expect(await starting).toBe(false)
    expect(await cancelling).toBe(true)
    expect(native.schedule).not.toHaveBeenCalled()
    expect(native.cancel).toHaveBeenCalledTimes(2)
  })

  it('suppresses obsolete import continuations when a newer timer replaces the old one', async () => {
    const native = nativePlugin()
    const importing = deferred()
    const imported = deferred()
    const loadNative = vi.fn().mockImplementationOnce(() => { importing.resolve(); return imported.promise }).mockResolvedValue(native)
    const notify = createTimerNotifier({ mobile: true, loadNative, wallNow: () => NOW })

    const first = notify(rest())
    await importing.promise
    const replacement = notify(rest({ timerId: 'rest-b', deadlineAt: NOW + 120_000 }))
    imported.resolve(native)

    expect(await first).toBe(false)
    expect(await replacement).toBe(true)
    expect(native.schedule).toHaveBeenCalledOnce()
    expect(native.schedule.mock.calls[0][0].notifications[0].schedule.at).toEqual(new Date(NOW + 120_000))
  })

  it('cancels a schedule already in flight before finishing a newer cancellation', async () => {
    const native = nativePlugin()
    const scheduling = deferred()
    const scheduled = deferred()
    native.schedule.mockImplementation(() => { scheduling.resolve(); return scheduled.promise })
    const notify = createTimerNotifier({ mobile: true, loadNative: async () => native, wallNow: () => NOW })

    const first = notify(rest())
    await scheduling.promise
    const cancelled = notify(null)
    expect(native.cancel).toHaveBeenCalledTimes(1)
    scheduled.resolve()

    await first
    expect(await cancelled).toBe(true)
    expect(native.cancel).toHaveBeenCalledTimes(2)
    expect(native.cancel.mock.invocationCallOrder[1]).toBeGreaterThan(native.schedule.mock.invocationCallOrder[0])
  })

  it('does not schedule a deadline that expires while permissions are being checked', async () => {
    const native = nativePlugin()
    let wall = NOW
    native.checkPermissions.mockImplementation(async () => { wall = NOW + 100_000; return { display: 'granted' } })
    const notify = createTimerNotifier({ mobile: true, loadNative: async () => native, wallNow: () => wall })

    expect(await notify(rest())).toBe(true)
    expect(native.schedule).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'checkPermissions', 'schedule'])('handles native %s failures without rejecting the caller', async method => {
    const native = nativePlugin()
    native[method].mockRejectedValueOnce(new Error('native unavailable'))
    const notify = createTimerNotifier({ mobile: true, loadNative: async () => native, wallNow: () => NOW })

    expect(await notify(rest())).toBe(false)
    expect(await notify(rest({ revision: 2 }))).toBe(true)
  })

  it('recovers after a plugin import fails', async () => {
    const native = nativePlugin()
    const loadNative = vi.fn().mockRejectedValueOnce(new Error('missing plugin')).mockResolvedValue(native)
    const notify = createTimerNotifier({ mobile: true, loadNative, wallNow: () => NOW })

    expect(await notify(rest())).toBe(false)
    expect(await notify(rest())).toBe(true)
  })
})

describe('legacy server push adapter', () => {
  it('sends an absolute deadline on start or extend and cancels for terminal/work state', async () => {
    const api = vi.fn().mockResolvedValue({ ok: true })
    const notify = createTimerNotifier({ api, user: () => ({ id: 'account-a' }), wallNow: () => NOW })

    await notify(rest())
    await notify(rest({ revision: 2, deadlineAt: NOW + 105_499 }))
    await notify(rest({ status: 'cancelled' }))
    await notify(rest({ kind: 'work' }))
    expect(api.mock.calls).toEqual([
      ['/api/push/rest-timer', { method: 'POST', body: JSON.stringify({ deadlineAt: NOW + 90_499 }) }],
      ['/api/push/rest-timer', { method: 'POST', body: JSON.stringify({ deadlineAt: NOW + 105_499 }) }],
      ['/api/push/rest-timer/cancel', { method: 'POST', body: '{}' }],
      ['/api/push/rest-timer/cancel', { method: 'POST', body: '{}' }]
    ])
  })

  it('does nothing for guests or a record belonging to another account', async () => {
    const api = vi.fn()
    expect(await createTimerNotifier({ api })(rest())).toBe(false)
    const notify = createTimerNotifier({ api, user: () => ({ id: 'account-b' }), wallNow: () => NOW })
    expect(await notify(rest())).toBe(false)
    expect(api).not.toHaveBeenCalled()
  })

  it('does not send a queued old-account request after the account changes', async () => {
    const api = vi.fn()
    let currentUser = { id: 'account-a' }
    const notify = createTimerNotifier({ api, user: () => currentUser, wallNow: () => NOW })
    const request = notify(rest())
    currentUser = { id: 'account-b' }

    expect(await request).toBe(false)
    expect(api).not.toHaveBeenCalled()
  })

  it('serializes cancellation behind a push request already in flight', async () => {
    const sending = deferred()
    const response = deferred()
    const api = vi.fn().mockImplementationOnce(() => { sending.resolve(); return response.promise }).mockResolvedValue({ ok: true })
    const notify = createTimerNotifier({ api, user: () => ({ id: 'account-a' }), wallNow: () => NOW })

    const first = notify(rest())
    await sending.promise
    const cancelled = notify(null)
    expect(api).toHaveBeenCalledTimes(1)
    response.resolve({ ok: true })
    await first
    expect(await cancelled).toBe(true)
    expect(api.mock.calls[1][0]).toBe('/api/push/rest-timer/cancel')
  })

  it('absorbs offline push failures and continues with later cancellation', async () => {
    const api = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true })
    const notify = createTimerNotifier({ api, user: () => ({ id: 'account-a' }), wallNow: () => NOW })

    expect(await notify(rest())).toBe(false)
    expect(await notify(null)).toBe(true)
  })
})
