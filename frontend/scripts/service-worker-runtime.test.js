import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workerFile = path.join(scriptDirectory, '..', 'public', 'sw.js')

async function workerHarness({ offline = false, addAllFails = false } = {}) {
  const handlers = {}
  const shellResponse = new Response('<main>offline</main>', {
    headers: { 'content-type': 'text/html' }
  })
  const cache = {
    addAll: addAllFails
      ? vi.fn().mockRejectedValue(new Error('missing asset'))
      : vi.fn().mockResolvedValue(undefined),
    match: vi.fn(async request => String(request).endsWith('/app/index.html') ? shellResponse.clone() : undefined),
    put: vi.fn().mockResolvedValue(undefined)
  }
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(['unrelated-cache', 'opengym-shell-old', 'opengym-rt-v1']),
    delete: vi.fn().mockResolvedValue(true)
  }
  const self = {
    registration: {
      scope: 'https://gym.example/app/',
      showNotification: vi.fn().mockResolvedValue(undefined)
    },
    location: { origin: 'https://gym.example' },
    clients: {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow: vi.fn().mockResolvedValue(undefined)
    },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    addEventListener: (type, handler) => { handlers[type] = handler }
  }
  const fetch = offline
    ? vi.fn().mockRejectedValue(new Error('offline'))
    : vi.fn().mockResolvedValue(new Response('network'))

  const source = await readFile(workerFile, 'utf8')
  vm.runInNewContext(source, { self, caches, fetch, URL, Response, Set, Promise })
  return { handlers, self, caches, cache, fetch }
}

function fetchEvent(url, { method = 'GET', mode = 'cors' } = {}) {
  let response
  return {
    event: {
      request: { url, method, mode },
      respondWith(value) { response = value }
    },
    response: () => response
  }
}

describe('service-worker runtime policy', () => {
  it.each([
    'https://gym.example/api/data',
    'https://gym.example/api',
    'https://gym.example/app/api/data',
    'https://other.example/app.js'
  ])('never intercepts or caches excluded request %s', async url => {
    const { handlers, caches, fetch } = await workerHarness()
    const request = fetchEvent(url)
    handlers.fetch(request.event)
    expect(request.response()).toBeUndefined()
    expect(caches.open).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the precached application shell when an offline navigation fails', async () => {
    const { handlers, cache } = await workerHarness({ offline: true })
    const request = fetchEvent('https://gym.example/app/#/workout', { mode: 'navigate' })
    handlers.fetch(request.event)
    const response = await request.response()

    expect(await response.text()).toContain('offline')
    expect(cache.match).toHaveBeenCalledWith('https://gym.example/app/index.html')
  })

  it('activates only after the complete shell has been cached', async () => {
    const success = await workerHarness()
    let installation
    success.handlers.install({ waitUntil(value) { installation = value } })
    await installation
    expect(success.cache.addAll).toHaveBeenCalledWith([
      './index.html', './manifest.json', './icon-180.png', './icon-512.png'
    ])
    expect(success.self.skipWaiting).toHaveBeenCalledOnce()

    const failure = await workerHarness({ addAllFails: true })
    failure.handlers.install({ waitUntil(value) { installation = value } })
    await expect(installation).rejects.toThrow('missing asset')
    expect(failure.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('deletes only obsolete openGym caches and preserves unrelated origin caches', async () => {
    const { handlers, caches, self } = await workerHarness()
    let activation
    handlers.activate({ waitUntil(value) { activation = value } })
    await activation

    expect(caches.delete).toHaveBeenCalledWith('opengym-shell-old')
    expect(caches.delete).toHaveBeenCalledWith('opengym-rt-v1')
    expect(caches.delete).not.toHaveBeenCalledWith('unrelated-cache')
    expect(self.clients.claim).toHaveBeenCalledOnce()
  })
})
