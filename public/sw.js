/*
  The service worker.

  Deliberately small, and deliberately does less than a service worker usually
  does. Two jobs:

    1. Serve `/_next/static/*` from cache, so the app shell loads on a venue
       network that has gone from bad to absent.
    2. Show a readable page instead of the browser's dinosaur when a navigation
       fails while offline.

  ## What it does NOT cache, and why

  **HTML is never cached.** Not the dashboard, not the check-in screen, not
  anything under `/app`. Every one of those pages is rendered for one signed-in
  person and contains other people's names, emails and phone numbers, and a
  service worker cache is a plain unencrypted store on the disk of whatever
  laptop the volunteer borrowed. Caching authenticated HTML is how a product
  ends up serving one organisation's delegate list to the next person who opens
  the browser.

  **`/api/*` is never touched at all.** A cached API response is a stale answer
  presented as a live one, which is precisely the failure mode the offline queue
  exists to avoid. Requests to the API either reach it or fail, and `apiFetch`
  turns the failure into `code: 0`, which is what the queue keys on. A service
  worker that answered from cache here would break the queue by hiding the
  failure it needs to see.

  That leaves hashed static assets, which are immutable by construction — the
  hash is in the filename, so a cached copy can never be the wrong copy.

  ## Updating

  The browser reinstalls this worker when the **bytes of this file** change, and
  not when the application is redeployed. So `CACHE_VERSION` is the update
  trigger: bumping it is what makes `UpdatePrompt` appear in every open tab.
  Bump it whenever the caching rules here change. Leaving it alone between
  deploys is safe, because every URL cached below is content-hashed and a stale
  entry is simply never requested again.
*/

const CACHE_VERSION = 'v1'
const STATIC_CACHE = `mun-ops-static-${CACHE_VERSION}`
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      // `reload` bypasses the HTTP cache, so a redeployed offline page is
      // actually fetched rather than re-cached from a stale copy.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith('mun-ops-static-') && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

/*
  The page asks for the update rather than the worker taking it.

  `skipWaiting()` on install would swap the running code under an operator
  mid-check-in. The prompt is a question, and this is the answer to it.
*/
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/auth/')) return

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkThenOfflinePage(request))
  }
})

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit

  try {
    const response = await fetch(request)
    // Only a clean 200 from our own origin goes in. Caching an opaque or
    // partial response here would poison the shell until the version is bumped.
    if (response.ok && response.status === 200) {
      void cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    // Nothing cached and nothing reachable. Let the browser report it rather
    // than inventing a response for a script tag.
    throw error
  }
}

async function networkThenOfflinePage(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(STATIC_CACHE)
    const fallback = await cache.match(OFFLINE_URL)
    return (
      fallback ??
      new Response('You are offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    )
  }
}
