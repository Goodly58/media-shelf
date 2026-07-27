/* ============================================================================
   Shelf — service worker
   ----------------------------------------------------------------------------
   Loaded two ways, both supported:
     1. via the one-line root shim  /shelf/sw.js  ->  importScripts('assets/sw.js?v=…')
        (this is the normal case: the shim lives at the site root so the worker
         gets root scope — GitHub Pages cannot send a Service-Worker-Allowed
         header, so a worker registered directly from /assets/ could only ever
         control /assets/)
     2. directly as /shelf/assets/sw.js (degraded fallback — assets stay
        offline-capable, page navigations are not intercepted)

   Nothing below hard-codes a leading "/": every path is resolved against the
   registration scope, so the site works from "/", "/shelf/" or any depth.
   ========================================================================== */
'use strict';

/* ---------------------------------------------------------------- version --
   pwa.js registers the worker as `sw.js?v=<SW_VERSION>`; the shim forwards the
   same query string to this file. That gives us ONE source of truth for the
   version (pwa.js) and guarantees the browser re-fetches the imported script
   whenever the version changes — imported scripts are otherwise allowed to be
   served from the HTTP cache. */
var VERSION = (function () {
  try {
    var v = new URL(self.location.href).searchParams.get('v');
    return v && /^[\w.\-]{1,40}$/.test(v) ? v : 'dev';
  } catch (e) { return 'dev'; }
})();

var SHELL_CACHE = 'shelf-shell-' + VERSION;  // app shell, re-primed every version
var IMG_CACHE   = 'shelf-img-v1';            // remote cover art, survives updates
var FONT_CACHE  = 'shelf-font-v1';           // Google Fonts CSS + woff2
var KEEP        = [SHELL_CACHE, IMG_CACHE, FONT_CACHE];

var IMG_MAX  = 180;  // max cached cover images (opaque entries are quota-padded,
                     // so keep this modest rather than "as many as possible")
var FONT_MAX = 24;

/* ------------------------------------------------------------- site root --
   registration.scope is ".../shelf/" with the shim, ".../shelf/assets/" in the
   degraded fallback. Normalise to the site root either way. */
var ROOT = (function () {
  try {
    var u = new URL(self.registration.scope);
    var p = u.pathname;
    if (p.charAt(p.length - 1) !== '/') p += '/';
    p = p.replace(/(^|\/)assets\/$/, '$1'); // registered from assets/ -> step up
    return new URL(p, u.origin).href;
  } catch (e) {
    return new URL('./', self.location.href).href;
  }
})();

var abs = function (rel) { return new URL(rel, ROOT).href; };

/* The app shell. Kept deliberately small and tolerant: every entry is fetched
   independently and a failure (a page that does not exist yet, a module file
   another author has not shipped) never fails the install. Additional CSS/JS
   that other modules add is picked up two ways: the runtime
   stale-while-revalidate handler, and the CACHE_URLS message pwa.js sends with
   the real <link>/<script> URLs of each page it renders. */
var SHELL = [
  '',                       // the directory index (".../shelf/")
  'index.html',
  'games.html',
  'books.html',
  'vocab.html',
  'manifest.webmanifest',
  /* Shared chrome */
  'assets/site.css',
  'assets/site.js',
  /* Enhancement layers. These are part of the shell, not extras — without them
     an offline load renders an unstyled, unthemed, non-interactive page. */
  'assets/theme.css',
  'assets/palette.css',
  'assets/features.css',
  'assets/motion.css',
  'assets/polish.css',
  'assets/a11y.css',
  'assets/theme-patch.css',
  'assets/theme.js',
  'assets/motion.js',
  'assets/palette.js',
  'assets/features.js',
  'assets/a11y.js',
  'assets/pwa.js',
  'assets/stats.json',
  'assets/icon.svg',
  'assets/icon-mono.svg',
  'assets/icon-games.svg',
  'assets/icon-books.svg',
  'assets/icon-words.svg'
].map(abs);

/* Remote cover art — cache-first with a cap. */
var IMG_HOSTS = [
  'cdn.cloudflare.steamstatic.com',
  'shared.cloudflare.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'covers.openlibrary.org'
];

/* Web fonts — cache-first, they are immutable and tiny in number. */
var FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* Never touched: live lookups must not be answered from a cache, and an
   offline failure here is meaningful to the page's own error handling. */
var NETWORK_ONLY_HOSTS = ['api.dictionaryapi.dev', 'api.ipify.org'];

function noop() {}

/* ============================================================== install == */

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) {
        return Promise.all(SHELL.map(function (url) {
          // `cache: 'reload'` bypasses the HTTP cache so an install always
          // captures the just-deployed bytes.
          return fetch(url, { cache: 'reload', credentials: 'same-origin' })
            .then(function (res) {
              if (!res || !res.ok || res.type === 'opaque') return; // never cache errors
              return cache.put(url, res);
            })
            .catch(noop); // a missing optional file must not fail the install
        }));
      })
      .catch(noop)
      .then(function () { return self.skipWaiting(); })
      .catch(noop)
  );
});

/* ============================================================= activate == */

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          // Only ever delete our own caches, and only stale ones.
          if (k.indexOf('shelf-') === 0 && KEEP.indexOf(k) === -1) return caches.delete(k);
          return null;
        }));
      })
      .catch(noop)
      .then(function () { return self.clients.claim(); })
      .catch(noop)
  );
});

/* ================================================================ fetch == */

self.addEventListener('fetch', function (event) {
  var req = event.request;

  if (req.method !== 'GET') return;                       // never cache non-GET
  if (req.headers.has('range')) return;                   // let ranged media stream

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (NETWORK_ONLY_HOSTS.indexOf(url.hostname) !== -1) return; // network-only

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { event.respondWith(handleNavigate(req)); return; }
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  if (IMG_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(req, IMG_CACHE, IMG_MAX));
    return;
  }

  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    // The stylesheet from fonts.googleapis.com can change (new UA -> new
    // woff2 URLs), so refresh it in the background; the font binaries from
    // fonts.gstatic.com are immutable.
    event.respondWith(cacheFirst(req, FONT_CACHE, FONT_MAX, url.hostname === 'fonts.googleapis.com'));
    return;
  }

  // Anything else (steam store links, goodreads, openlibrary pages…) is left
  // entirely to the browser — we neither intercept nor cache it.
});

/* --------------------------------------------------- strategy: SWR (same-origin)
   Cached copy answers instantly; the network copy refreshes the cache for the
   next load. New deployments are picked up because a new worker version
   re-primes the shell cache on install. */
function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var fromNet = fetch(req).then(function (res) {
        if (res && res.ok && res.type !== 'opaque') {
          cache.put(req, res.clone()).catch(noop);
        }
        return res;
      });

      if (hit) {
        fromNet.catch(noop); // background refresh; failure is fine offline
        return hit;
      }
      return fromNet.catch(function () {
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    });
  }).catch(function () { return fetch(req); });
}

/* ------------------------------------------------- strategy: navigations --
   Same stale-while-revalidate shape, plus an offline fallback chain. */
function handleNavigate(req) {
  var key = navKey(req);
  return caches.open(SHELL_CACHE).then(function (cache) {
    return cache.match(key, { ignoreSearch: true }).then(function (hit) {
      var fromNet = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(noop);
        return res;
      });

      if (hit) { fromNet.catch(noop); return hit; }

      return fromNet.catch(function () { return null; }).then(function (res) {
        return res || offlineFallback(cache);
      });
    });
  }).catch(function () {
    return fetch(req).catch(function () { return offlineResponse(); });
  });
}

/* Cache navigations under a query/hash-free key: Shelf encodes its whole
   filter state in the URL hash and share links add query strings, and we do
   not want one cache entry per view. */
function navKey(req) {
  try {
    var u = new URL(req.url);
    return new Request(u.origin + u.pathname, { credentials: 'same-origin' });
  } catch (e) { return req; }
}

function offlineFallback(cache) {
  return cache.match(abs('index.html'), { ignoreSearch: true })
    .then(function (res) { return res || cache.match(abs(''), { ignoreSearch: true }); })
    .then(function (res) {
      if (res) return res;
      // Last resort: any HTML we happen to hold.
      return cache.keys().then(function (keys) {
        for (var i = 0; i < keys.length; i++) {
          if (/\.html?$/i.test(new URL(keys[i].url).pathname)) return cache.match(keys[i]);
        }
        return null;
      });
    })
    .then(function (res) { return res || offlineResponse(); })
    .catch(function () { return offlineResponse(); });
}

/* -------------------------------------------------------- strategy: images
   Cache-first with a hard cap. Cover art is content-addressed (Steam app id /
   ISBN), so a cached copy never goes stale in a way that matters. */
var corsFailed = Object.create(null); // hostname -> true, avoids retrying CORS

function cacheFirst(req, cacheName, max, revalidate) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (hit) {
      if (hit) {
        if (revalidate) fetchAndPut(cache, cacheName, req, max).catch(noop);
        return hit;
      }
      return fetchAndPut(cache, cacheName, req, max).catch(function () {
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    });
  }).catch(function () { return fetch(req); });
}

function fetchAndPut(cache, cacheName, req, max) {
  var host = '';
  try { host = new URL(req.url).hostname; } catch (e) {}

  // Prefer a CORS fetch: it yields an inspectable response (so we can refuse to
  // cache 404s) and avoids the multi-MB quota padding browsers apply to opaque
  // entries. If the host does not allow CORS we remember that and fall back to
  // the request exactly as the page made it.
  var tryCors = req.mode === 'no-cors' && !corsFailed[host];
  var first = tryCors
    ? fetch(req.url, { mode: 'cors', credentials: 'omit', cache: 'default' })
        .then(function (res) {
          if (!res || !res.ok) throw new Error('cors-bad');
          return res;
        })
        .catch(function () { corsFailed[host] = true; return fetch(req); })
    : fetch(req);

  return first.then(function (res) {
    if (!res) throw new Error('no-response');
    // status 0 == opaque (cross-origin, no CORS): unverifiable but usable.
    var storable = res.type === 'opaque' ? true : !!res.ok;
    if (storable) {
      cache.put(req, res.clone())
        .then(function () { return trim(cache, cacheName, max); })
        // A QuotaExceededError means the browser is out of room: trim harder so
        // the next write has somewhere to go.
        .catch(function () { return trim(cache, cacheName, Math.max(8, Math.floor(max / 2)), true); });
    }
    return res;
  });
}

/* Cache.keys() returns entries in insertion order, so slicing off the front
   evicts the oldest. Guarded per cache name so concurrent image loads do not
   stampede (caches.open() may hand back a fresh wrapper object each call, so
   the guard cannot live on the Cache instance). */
var trimming = Object.create(null);
function trim(cache, cacheName, max, force) {
  if (trimming[cacheName] && !force) return Promise.resolve();
  trimming[cacheName] = true;
  return cache.keys().then(function (keys) {
    if (keys.length <= max) return null;
    return Promise.all(keys.slice(0, keys.length - max).map(function (k) {
      return cache.delete(k).catch(noop);
    }));
  }).catch(noop).then(function () { trimming[cacheName] = false; });
}

/* ---------------------------------------------------------- offline page -- */

function offlineResponse() {
  var html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="#080a0f"><title>Shelf — offline</title><style>' +
    'html,body{height:100%}body{margin:0;display:grid;place-items:center;padding:28px;' +
    'background:radial-gradient(900px 500px at 50% -10%,#16243a 0%,transparent 55%),#080a0f;' +
    'color:#eef1f7;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;' +
    '-webkit-font-smoothing:antialiased}' +
    '.c{max-width:420px;text-align:center}' +
    '.d{width:38px;height:38px;margin:0 auto 18px;border-radius:12px;' +
    'background:linear-gradient(135deg,#4f8cff,#8b5cff);opacity:.9}' +
    'h1{margin:0 0 10px;font-size:22px;font-weight:800;letter-spacing:-.4px}' +
    'p{margin:0 0 22px;color:#8b94a8;font-size:14.5px;line-height:1.6}' +
    'button{cursor:pointer;font:inherit;font-size:14px;font-weight:700;color:#0a1016;border:0;' +
    'border-radius:11px;padding:12px 22px;background:linear-gradient(135deg,#4f8cff,#8b5cff)}' +
    'a{display:inline-block;margin-top:18px;color:#8b94a8;font-size:13px;text-decoration:none;' +
    'border-bottom:1px solid #333d4d}' +
    '</style></head><body><div class="c"><div class="d"></div>' +
    '<h1>You are offline</h1>' +
    '<p>This page has not been saved for offline use yet. Pages you have already ' +
    'visited stay available — reconnect and Shelf will catch up on its own.</p>' +
    '<button onclick="location.reload()">Try again</button><br>' +
    '<a href="index.html">Go to the Shelf home page</a>' +
    '</div></body></html>';

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/* ============================================================== messages == */

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting().catch(noop);
    return;
  }

  if (data.type === 'GET_VERSION') {
    var payload = { type: 'VERSION', version: VERSION, root: ROOT, cache: SHELL_CACHE };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
    else if (event.source) event.source.postMessage(payload);
    return;
  }

  /* pwa.js reports the same-origin CSS/JS a page actually loaded, so modules
     shipped by other authors (whose filenames this worker cannot know) end up
     in the shell cache after a single online visit. */
  if (data.type === 'CACHE_URLS' && Array.isArray(data.urls)) {
    event.waitUntil(cacheExtra(data.urls));
  }
});

function cacheExtra(urls) {
  return caches.open(SHELL_CACHE).then(function (cache) {
    var seen = Object.create(null);
    return Promise.all(urls.slice(0, 40).map(function (raw) {
      var u;
      try { u = new URL(raw, ROOT); } catch (e) { return null; }
      if (u.origin !== self.location.origin) return null;   // same-origin only
      if (seen[u.href]) return null;
      seen[u.href] = true;
      return cache.match(u.href).then(function (hit) {
        if (hit) return null;                                // already stored
        return fetch(u.href, { credentials: 'same-origin' }).then(function (res) {
          if (!res || !res.ok || res.type === 'opaque') return null;
          return cache.put(u.href, res);
        });
      }).catch(noop);
    }));
  }).catch(noop);
}
