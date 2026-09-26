/* openGym service worker.
 *
 * The two marked constants are replaced after every production build by
 * scripts/build-service-worker.mjs. Their development values deliberately
 * remain valid so that serving public/ directly never produces invalid JS.
 */
const BUILD_ID = /* __OPENGYM_BUILD_ID__ */ 'development'
const PRECACHE_URLS = /* __OPENGYM_PRECACHE__ */ ['./index.html', './manifest.json', './icon-180.png', './icon-512.png']

const SHELL_PREFIX = 'opengym-shell-'
const SHELL_CACHE = `${SHELL_PREFIX}${BUILD_ID}`
const RUNTIME_CACHE = 'opengym-runtime-v2'
const LEGACY_CACHES = new Set(['opengym-rt-v1'])
const APP_SHELL_URL = new URL('index.html', self.registration.scope).href

function scopedPath(name) {
  return new URL(name, self.registration.scope).pathname
}

// API responses can contain authentication and the complete user state. They
// must always go to the network and must never enter Cache Storage, including
// when openGym itself is hosted below a path prefix.
function isApiRequest(url) {
  const rootApi = url.pathname === '/api' || url.pathname.startsWith('/api/')
  const scopedApi = scopedPath('api')
  return rootApi || url.pathname === scopedApi || url.pathname.startsWith(`${scopedApi}/`)
}

function isMediaRequest(url) {
  return url.pathname.includes('/img/') || url.pathname.includes('/gif/')
}

function canCache(response) {
  return !!response && response.ok && response.type !== 'opaque'
}

async function putRuntime(request, response) {
  if (!canCache(response)) return
  const cache = await caches.open(RUNTIME_CACHE)
  await cache.put(request, response.clone())
}

async function navigationResponse(request) {
  try {
    return await fetch(request)
  } catch {
    const shell = await caches.open(SHELL_CACHE)
    return (await shell.match(APP_SHELL_URL)) || Response.error()
  }
}

async function mediaResponse(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (canCache(response)) await cache.put(request, response.clone())
  return response
}

async function staticResponse(request) {
  const shell = await caches.open(SHELL_CACHE)
  const precached = await shell.match(request)
  if (precached) return precached

  try {
    const response = await fetch(request)
    await putRuntime(request, response)
    return response
  } catch {
    const runtime = await caches.open(RUNTIME_CACHE)
    return (await runtime.match(request)) || Response.error()
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    // addAll is intentionally all-or-nothing from the install event's point of
    // view: skipWaiting runs only after the complete app shell is available.
    await cache.addAll(PRECACHE_URLS)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter(key => (key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE) || LEGACY_CACHES.has(key))
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* malformed push: show a generic notification */ }
  event.waitUntil(self.registration.showNotification(data.title || 'openGym', {
    body: data.body || '',
    icon: 'icon-512.png',
    badge: 'icon-180.png',
    tag: data.tag || 'opengym',
    renotify: true
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const client = clients.find(item => 'focus' in item)
    return client ? client.focus() : self.clients.openWindow('./')
  }))
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin || isApiRequest(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
  } else if (isMediaRequest(url)) {
    event.respondWith(mediaResponse(request))
  } else {
    event.respondWith(staticResponse(request))
  }
})
