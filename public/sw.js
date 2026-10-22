/**
 * Aweborn Service Worker — Cold-Start Offline App Shell (Card Event Step 4).
 *
 * - Navigation requests (/, /w/<uuid>): network-first so deploys take effect
 *   immediately when online; falls back to the cached app shell (/index.html)
 *   when offline so tapping an NFC card with no signal opens the game.
 * - Immutable Vite bundles (/assets/*) and content-addressed 3D models
 *   (<sha256>.glb): cache-first once fetched.
 */
const SHELL_CACHE = 'aweborn-shell-v1'
const ASSET_CACHE = 'aweborn-assets-v1'
const SHELL_PRECACHE = ['/', '/index.html', '/site.webmanifest', '/favicon.svg', '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

// Warm the current build's hashed JS/CSS right after first registration so
// the very first visit is enough to boot offline on the next card tap.
self.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'WARM_SHELL' && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(ASSET_CACHE).then((cache) =>
        Promise.all(
          data.urls.map((u) =>
            fetch(u, { credentials: 'same-origin' })
              .then((res) => (res.ok ? cache.put(u, res) : undefined))
              .catch(() => {}),
          ),
        ),
      ),
    )
  }
})

function isImmutableAsset(url) {
  if (url.origin === self.location.origin) {
    if (/^\/assets\/.+/.test(url.pathname)) return true
    if (/^\/(icon-\d+\.png|apple-touch-icon\.png|favicon\.(ico|svg)|site\.webmanifest)$/.test(url.pathname)) return true
  }
  if (/\b[a-f0-9]{64}\.(glb|png)$/i.test(url.pathname)) return true
  return false
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return

  // 1. Navigation (/, /w/<uuid>, etc.): network-first -> cached shell fallback
  if (req.mode === 'navigate') {
    const isStandaloneHtml = /\.(html)$/i.test(url.pathname) && url.pathname !== '/index.html'
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !isStandaloneHtml) {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy)).catch(() => {})
          }
          return res
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE)
          if (isStandaloneHtml) {
            const exact = await cache.match(url.pathname)
            if (exact) return exact
          }
          return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error()
        }),
    )
    return
  }

  // 2. Immutable bundles, icons, and content-addressed 3D models: cache-first
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(req)
        if (cached) return cached
        const res = await fetch(req)
        if (res.ok) {
          cache.put(req, res.clone()).catch(() => {})
        }
        return res
      }),
    )
  }
})
