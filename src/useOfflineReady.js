import { useEffect, useState } from 'react';

/**
 * "Is a working copy of this app stored on the device right now?"
 *
 * Session 18. The app failed to open at a game because the service worker's
 * cache was empty and nothing on screen said so — the coach had no way to know
 * before leaving the house, and neither did I without instrumenting the live
 * site. This answers the question directly, from the cache itself rather than
 * from the worker's opinion of itself.
 *
 * Returns one of:
 *   'ready'   — the app shell is cached; it will open with no network.
 *   'pending' — no cached copy yet. Stay on wifi until this flips.
 *   'n/a'     — no service worker / CacheStorage (dev server, or a browser
 *               without support). Nothing useful to say, so say nothing.
 */
export default function useOfflineReady() {
  const [state, setState] = useState('n/a');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
    // index.html deliberately unregisters workers on localhost, so there is
    // never anything to report there.
    if (isLocal || !('serviceWorker' in navigator) || !('caches' in window)) {
      setState('n/a');
      return;
    }

    let alive = true;
    let timer = null;

    const check = async () => {
      let ready = false;
      try {
        ready = !!(await caches.match('./', { ignoreSearch: true }));
      } catch (_) { /* treat as not ready */ }
      if (!alive) return;
      setState(ready ? 'ready' : 'pending');
      // Stop polling once it's cached — it cannot un-cache itself while the
      // page is open, and a permanent timer is exactly the sort of thing that
      // has no business running during a match.
      if (!ready) timer = setTimeout(check, 3000);
    };

    check();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  return state;
}
