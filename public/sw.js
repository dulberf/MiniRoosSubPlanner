/**
 * Service worker for the MiniRoos Sub Planner.
 *
 * Hard requirement: the app is used on a football field with NO WIFI. It must
 * open, every time, with no network at all. Nothing in here may trade that away
 * for anything else — not for faster updates, not for freshness.
 *
 * ── What went wrong before (Session 18) ──────────────────────────────────────
 * The Session 15 worker was network-first with cache-on-fetch and no precache.
 * That combination has a hole, and the coach fell through it at a game:
 *
 *   1. Nothing was stored at install. The cache only ever held things the
 *      worker happened to intercept.
 *   2. The navigation that installs a worker is not controlled by it, so the
 *      FIRST page load after any deploy was never cached.
 *   3. `activate` deleted the previous cache immediately, before anything had
 *      replaced it.
 *
 * So a deploy wiped the working cache and left an empty one, and whether the
 * app survived offline depended on whether a second load happened before the
 * device left the house. Measured on the live site: after a successful first
 * load the cache contained exactly one entry — sw.js. The app itself was not
 * in it. Offline then produced a Safari network-error page.
 *
 * ── The rules now ────────────────────────────────────────────────────────────
 *   · Precache the shell at INSTALL. A working copy exists before any
 *     navigation, not whenever a fetch gets lucky. This is the piece whose
 *     absence caused the failure — do not remove it.
 *   · Page loads are CACHE-FIRST. The app opens from cache with zero network
 *     dependency. A refresh is fetched in the background and applies on the
 *     next open. Updates still land; they are just never on the critical path.
 *   · NEVER delete an old cache until the new one can actually serve the app.
 *   · Every background fetch is abortable and skipped entirely when offline,
 *     so a dead signal cannot leave the radio hunting.
 *   · Cache bookkeeping can never affect what the user gets. Every put and
 *     every waitUntil is wrapped — the old code let a failed waitUntil fall
 *     into the catch block and rethrow, turning a bookkeeping error into an
 *     error page.
 *
 * NOTE: this only ever touches cached FILES. Season data lives in localStorage
 * (`teamsheet_season`) and is never read, written or cleared by this worker.
 * Clearing these caches does not lose a single game.
 */

const CACHE = 'team-sheet-v3';

// Bump when changing this file. Lets a page confirm which worker is actually
// running — "is the browser still on the old worker?" is otherwise unanswerable,
// and it is the first question worth asking when caching misbehaves.
const SW_VERSION = '2026-08-02.1';

// Only used for background refreshes, never for anything the user is waiting on.
const REVALIDATE_TIMEOUT_MS = 8000;

// The app shell. In the deployed build everything is inlined into the page, so
// './' IS the app — the rest is PWA garnish.
const SHELL_REQUIRED = './';
const SHELL_OPTIONAL = ['index.html', 'manifest.json', 'icon.svg'];

function offline() {
  // In a worker `navigator.onLine === false` is a reliable "definitely no
  // network". True is not a promise of connectivity, which is why every
  // network path still has to fail gracefully.
  return self.navigator && self.navigator.onLine === false;
}

/** waitUntil that can never break the response it is attached to. */
function safeWaitUntil(event, promise) {
  if (!promise) return;
  try {
    event.waitUntil(promise.catch(() => {}));
  } catch (_) {
    // Event lifetime already closed. The refresh is best-effort by definition.
  }
}

self.addEventListener('message', (event) => {
  if (event.data !== 'sw:status' || !event.source) return;
  event.waitUntil((async () => {
    let offlineReady = false;
    try {
      offlineReady = !!(await caches.match(SHELL_REQUIRED, { ignoreSearch: true }));
    } catch (_) { /* report not-ready */ }
    event.source.postMessage({ swVersion: SW_VERSION, cache: CACHE, offlineReady });
  })());
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // `cache: 'reload'` so we precache a genuinely fresh copy rather than
    // whatever the HTTP cache is holding. Older Safari has been known to
    // reject that init, and a precache that fails on a technicality is how we
    // got here — so fall back to a plain add rather than lose the shell.
    const store = async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (_) {
        await cache.add(url);
      }
    };

    // If this throws — installing while offline, say — the install FAILS and
    // the browser keeps the existing worker and its populated cache. That is
    // the right outcome: a working old worker beats a new empty one. This is
    // exactly the failure mode that bit us, inverted.
    await store(SHELL_REQUIRED);
    await Promise.all(SHELL_OPTIONAL.map(url => store(url).catch(() => {})));
    // Don't sit in "waiting" behind the old worker — but only after the shell
    // is safely stored.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // ⚠️ Only sweep old caches once THIS cache can actually serve the app.
    // Deleting first is what left devices with nothing to fall back on.
    let shellReady = false;
    try {
      const cache = await caches.open(CACHE);
      shellReady = !!(await cache.match(SHELL_REQUIRED, { ignoreSearch: true }));
    } catch (_) { /* leave old caches alone */ }

    if (shellReady) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    }
    await self.clients.claim();
  })());
});

/**
 * Background refresh. Abortable and time-boxed, so a ground with no signal
 * cannot leave requests running and the radio awake. Never awaited by anything
 * the user can see.
 */
async function revalidate(request) {
  if (offline()) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal, cache: 'reload' });
    if (response && response.ok && response.type !== 'opaque') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
  } catch (_) {
    // Offline, slow, or aborted. The cached copy stays authoritative.
  } finally {
    clearTimeout(timer); // the old code left a timer armed per request
  }
}

/** Only reached when there is genuinely nothing cached to serve. */
async function networkAndStore(event) {
  const response = await fetch(event.request);
  if (response && response.ok && response.type !== 'opaque') {
    const copy = response.clone(); // clone synchronously, before anyone reads it
    safeWaitUntil(event, (async () => {
      const cache = await caches.open(CACHE);
      await cache.put(event.request, copy);
    })());
  }
  return response;
}

/**
 * Cache-first. The app opens from cache with no network on the critical path;
 * the refresh lands on the next open.
 */
async function cacheFirst(event, { isPage }) {
  let cached = null;
  try {
    cached = await caches.match(event.request, { ignoreSearch: true });
    // A navigation to a URL we haven't seen (query string, trailing slash,
    // deep link) still gets the app shell rather than an error page.
    if (!cached && isPage) {
      cached = await caches.match(SHELL_REQUIRED, { ignoreSearch: true });
    }
  } catch (_) { /* fall through to the network */ }

  if (cached) {
    // Refresh only on navigations. The app is one inlined file, so refreshing
    // the page refreshes everything — re-fetching each asset every open would
    // just be extra radio time for nothing.
    if (isPage) safeWaitUntil(event, revalidate(event.request));
    return cached;
  }

  return networkAndStore(event);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Leave anything we shouldn't be touching to the browser.
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  const isPage = request.mode === 'navigate' || request.destination === 'document';
  event.respondWith(cacheFirst(event, { isPage }));
});
