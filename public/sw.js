/**
 * Service worker for the MiniRoos Sub Planner.
 *
 * Hard requirement: the app is used on a football field with NO WIFI. It must
 * open, every time, with no network at all. That is non-negotiable and is why
 * everything the app fetches is cached on the way past (cache-on-fetch) rather
 * than from a hardcoded file list.
 *
 * The problem this version fixes (Session 15): the previous worker answered
 * every request from the cache and never went to the network again, and its
 * cache name was hardcoded so the activate-cleanup could never clear it. Once a
 * browser had loaded the app it kept that exact build permanently — a pushed
 * update could never reach the iPad, and a bad cached state could not heal.
 *
 * Strategy now:
 *   - Page loads: network-first with a short timeout, falling back to cache.
 *     No network at the field means fetch fails (or times out) in a couple of
 *     seconds and the cached app is served exactly as before.
 *   - Everything else: stale-while-revalidate. Instant from cache, refreshed in
 *     the background for next time.
 *
 * NOTE: this only ever touches cached FILES. Season data lives in localStorage
 * (`teamsheet_season`) and is never read, written or cleared by this worker.
 * Clearing these caches does not lose a single game.
 */

const CACHE = 'team-sheet-v2';

// Bump when changing this file. Lets a page confirm which worker is actually
// running — "is the browser still on the old worker?" is otherwise unanswerable,
// and it is the first question worth asking when caching misbehaves.
const SW_VERSION = '2026-07-29.1';

self.addEventListener('message', (event) => {
  if (event.data === 'sw:version' && event.source) {
    event.source.postMessage({ swVersion: SW_VERSION, cache: CACHE });
  }
});

// How long to wait for the network on a page load before giving up and serving
// the cached app. A dead network usually rejects immediately, but a weak signal
// or a captive portal at a ground can hang — the coach cannot wait, so cap it.
const NETWORK_TIMEOUT_MS = 2500;

self.addEventListener('install', () => {
  // Don't sit in "waiting" behind the old worker — a new build should take over
  // on the next load, not whenever every tab happens to be closed.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // The bumped cache name means this finally clears the stale v1 cache that
    // was pinning old builds on already-installed devices.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function timeout(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('network timeout')), ms);
  });
}

/**
 * Store a response.
 *
 * ⚠️ `copy` must be a clone taken SYNCHRONOUSLY at the call site, before anyone
 * reads the body. Cloning in here — after `await caches.open()` — loses the race
 * against the page calling .text()/.json() on the original, the put silently
 * fails, and nothing ends up cached. That breaks offline, which is the whole
 * point of this worker. Caught by testing; do not "tidy" the clone back inside.
 */
async function putInCache(request, copy) {
  // Only cache complete, successful, same-origin GETs. Caching an error page is
  // how a device ends up permanently serving a blank screen.
  if (!copy || !copy.ok || copy.type === 'opaque') return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, copy);
  } catch (_) {
    // Quota or an uncacheable request — not worth failing the page over.
  }
}

/**
 * Keep the worker alive until the cache write finishes.
 *
 * ⚠️ Without `event.waitUntil`, the browser is free to shut the worker down as
 * soon as respondWith() settles — which cancels the pending put and leaves the
 * cache empty. The app then has nothing to fall back on at the field. Also
 * caught by testing; the write must always be registered on the event.
 */
function cacheInBackground(event, response) {
  event.waitUntil(putInCache(event.request, response.clone())); // clone now — see putInCache
}

// Page loads: fresh if we can get it quickly, cached if we can't.
async function networkFirst(event) {
  const request = event.request;
  try {
    const response = await Promise.race([fetch(request), timeout(NETWORK_TIMEOUT_MS)]);
    if (response && response.ok) {
      cacheInBackground(event, response);
      return response;
    }
    throw new Error(`bad response ${response && response.status}`);
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Last resort for a navigation whose exact URL was never cached.
    const fallback = await caches.match('index.html', { ignoreSearch: true })
      || await caches.match('./', { ignoreSearch: true });
    if (fallback) return fallback;
    throw err;
  }
}

// Everything else: instant from cache, quietly refreshed for next time.
async function staleWhileRevalidate(event) {
  const request = event.request;
  const cached = await caches.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then(response => {
      if (response && response.ok) cacheInBackground(event, response);
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network); // refresh for next time without blocking this load
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  throw new Error('offline and uncached');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Leave anything we shouldn't be touching to the browser.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isPageLoad = request.mode === 'navigate' || request.destination === 'document';
  event.respondWith(isPageLoad ? networkFirst(event) : staleWhileRevalidate(event));
});
