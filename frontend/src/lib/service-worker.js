function isLoopback(hostname = '') {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
}

export function shouldRegisterServiceWorker({
  mobile = false,
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
  secureContext = globalThis.isSecureContext
} = {}) {
  if (mobile || !navigatorRef?.serviceWorker || !locationRef) return false
  return secureContext === true || locationRef.protocol === 'https:' || isLoopback(locationRef.hostname)
}

export async function registerAppServiceWorker(options = {}) {
  if (!shouldRegisterServiceWorker(options)) return null
  const navigatorRef = options.navigatorRef || globalThis.navigator
  try {
    return await navigatorRef.serviceWorker.register('sw.js', {
      scope: './',
      updateViaCache: 'none'
    })
  } catch {
    // Offline use still works after a previous successful registration. A
    // transient update failure must not prevent the application from booting.
    return null
  }
}
