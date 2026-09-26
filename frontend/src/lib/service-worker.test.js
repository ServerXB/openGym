import { describe, expect, it, vi } from 'vitest'
import { registerAppServiceWorker, shouldRegisterServiceWorker } from './service-worker.js'

const navigatorWithWorker = register => ({ serviceWorker: { register } })
const where = (protocol, hostname) => ({ protocol, hostname })

describe('service-worker registration policy', () => {
  it('registers in an HTTPS secure context', () => {
    expect(shouldRegisterServiceWorker({
      navigatorRef: navigatorWithWorker(() => {}),
      locationRef: where('https:', 'gym.example'),
      secureContext: true
    })).toBe(true)
  })

  it.each(['localhost', 'open-gym.localhost', '127.0.0.1', '[::1]'])(
    'allows the trustworthy HTTP loopback host %s', hostname => {
      expect(shouldRegisterServiceWorker({
        navigatorRef: navigatorWithWorker(() => {}),
        locationRef: where('http:', hostname),
        secureContext: false
      })).toBe(true)
    }
  )

  it('rejects an insecure remote origin, an unsupported browser and the native shell', () => {
    expect(shouldRegisterServiceWorker({
      navigatorRef: navigatorWithWorker(() => {}),
      locationRef: where('http:', 'gym.example'),
      secureContext: false
    })).toBe(false)
    expect(shouldRegisterServiceWorker({
      navigatorRef: {}, locationRef: where('https:', 'gym.example'), secureContext: true
    })).toBe(false)
    expect(shouldRegisterServiceWorker({
      mobile: true,
      navigatorRef: navigatorWithWorker(() => {}),
      locationRef: where('https:', 'gym.example'),
      secureContext: true
    })).toBe(false)
  })

  it('registers relative to the application and bypasses the HTTP cache for updates', async () => {
    const registration = { active: true }
    const register = vi.fn().mockResolvedValue(registration)
    await expect(registerAppServiceWorker({
      navigatorRef: navigatorWithWorker(register),
      locationRef: where('https:', 'gym.example'),
      secureContext: true
    })).resolves.toBe(registration)
    expect(register).toHaveBeenCalledWith('sw.js', { scope: './', updateViaCache: 'none' })
  })

  it('does not make application startup fail when registration fails', async () => {
    const register = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(registerAppServiceWorker({
      navigatorRef: navigatorWithWorker(register),
      locationRef: where('https:', 'gym.example'),
      secureContext: true
    })).resolves.toBeNull()
  })
})
