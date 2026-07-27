/* ============================================================================
   Shelf — PWA layer
   ----------------------------------------------------------------------------
   Additive, self-contained, and silent when unsupported. It:
     • registers the service worker (relative paths, any subpath, root scope via
       the one-line /sw.js shim, with a graceful fallback to assets/sw.js)
     • captures beforeinstallprompt and offers a small, permanently dismissible
       "Install" chip in the shared nav (.sn-right)
     • tells the freshly-updated worker to reload, via a quiet toast + action
     • shows an unobtrusive offline indicator
   It never assumes site.js, Shelf.*, or any other module exists.
   ========================================================================== */
(function () {
  'use strict';

  /* Bump on every deploy. This is the single source of truth for the worker
     version: it is appended to the worker URL, which (a) forces the browser to
     see a byte-different registration and (b) is forwarded by the root shim to
     assets/sw.js, where it names the cache. */
  var SW_VERSION = '4783fc750f';

  var LS_DISMISS = 'shelf.pwa.install-dismissed';
  var UPDATE_CHECK_MS = 30 * 60 * 1000;   // re-check for a new worker at most this often
  var CHIP_WAIT_MS = 8000;                // how long to wait for site.js to build the nav

  var doc = document;
  var win = window;

  function noop() {}
  function lsGet(k) { try { return win.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { win.localStorage.setItem(k, v); } catch (e) {} }

  /* ------------------------------------------------------------- base URLs --
     Derived from this script's own <script src>, so the site works from "/",
     "/shelf/", or any other subpath without configuration. */
  var ASSETS = (function () {
    var src = '';
    try {
      if (doc.currentScript && doc.currentScript.src) src = doc.currentScript.src;
      if (!src) {
        var tags = doc.getElementsByTagName('script');
        for (var i = tags.length - 1; i >= 0; i--) {
          if (tags[i].src && /\/pwa\.js(\?|#|$)/.test(tags[i].src)) { src = tags[i].src; break; }
        }
      }
    } catch (e) {}
    try {
      if (src) return src.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
      return new URL('assets/', location.href).href;
    } catch (e) { return 'assets/'; }
  })();

  var ROOT = (function () {
    try { return new URL('../', ASSETS).href; } catch (e) { return './'; }
  })();

  function toast(msg, ok) {
    try {
      if (win.Shelf && typeof win.Shelf.toast === 'function') { win.Shelf.toast(msg, ok); return true; }
      if (typeof win.shelfToast === 'function') { win.shelfToast(msg, ok); return true; }
    } catch (e) {}
    return false;
  }

  /* Prefer the shared icon set; fall back to an inline copy so the chip still
     looks right if site.js is absent or has not run yet. */
  function ico(name, fallback) {
    try {
      if (win.Shelf && typeof win.Shelf.icon === 'function') {
        var s = win.Shelf.icon(name);
        if (s) return s;
      }
    } catch (e) {}
    return fallback;
  }
  var SVG_OPEN = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var IC_DOWNLOAD = SVG_OPEN + '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
                    '<path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>';

  function isStandalone() {
    try {
      if (win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) return true;
      if (win.matchMedia && win.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
      if (win.navigator && win.navigator.standalone === true) return true;  // iOS
    } catch (e) {}
    return false;
  }

  /* ================================================================ styles == */

  function injectStyles() {
    if (doc.getElementById('shelfPwaCss')) return;
    var css = [
      /* install chip — sits in .sn-right and borrows the nav button metrics */
      '.pwa-chip{display:inline-flex;align-items:center;gap:2px}',
      '.pwa-chip.in{animation:pwaIn .22s ease-out both}',
      '.pwa-btn{display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-family:inherit;',
      'font-size:13px;font-weight:650;color:#fff;border-radius:9px;padding:7px 12px;white-space:nowrap;',
      'border:1px solid var(--acc,#4f8cff);background:var(--accSoft,rgba(79,140,255,.14));',
      'transition:background .15s,border-color .15s,transform .15s}',
      '.pwa-btn:hover{background:var(--acc,#4f8cff);color:#0a1016}',
      '.pwa-btn:active{transform:translateY(1px)}',
      '.pwa-btn .ic{width:16px;height:16px}',
      '.pwa-x{display:inline-grid;place-items:center;width:24px;height:24px;padding:0;cursor:pointer;',
      'font-family:inherit;font-size:15px;line-height:1;color:rgba(255,255,255,.45);background:none;',
      'border:0;border-radius:7px;transition:color .15s,background .15s}',
      '.pwa-x:hover{color:#fff;background:rgba(255,255,255,.09)}',
      '.pwa-chip.pwa-float{position:fixed;top:12px;right:12px;z-index:180;',
      'background:rgba(12,15,21,.92);border:1px solid rgba(255,255,255,.12);border-radius:11px;padding:4px 4px 4px 6px}',

      /* bottom-left stack: offline pill + update card */
      '.pwa-stack{position:fixed;left:16px;bottom:20px;z-index:190;display:flex;flex-direction:column-reverse;',
      'gap:10px;align-items:flex-start;pointer-events:none;max-width:min(340px,calc(100vw - 32px));',
      'font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
      '.pwa-stack > *{pointer-events:auto;animation:pwaUp .24s ease-out both}',
      '.pwa-pill{display:inline-flex;align-items:center;gap:9px;font-size:12.5px;font-weight:650;',
      'color:#c3cbd9;background:rgba(18,22,29,.94);border:1px solid #2b3543;border-radius:999px;',
      'padding:7px 14px 7px 12px;box-shadow:0 14px 34px -18px rgba(0,0,0,.9);backdrop-filter:blur(8px)}',
      '.pwa-pill .dot{width:7px;height:7px;border-radius:50%;background:#f0b34a;flex:0 0 auto;',
      'box-shadow:0 0 0 3px rgba(240,179,74,.14)}',
      '.pwa-pill.ok .dot{background:#34d399;box-shadow:0 0 0 3px rgba(52,211,153,.14)}',
      '.pwa-card{background:rgba(18,22,29,.97);border:1px solid #2b3543;border-radius:14px;padding:14px 15px;',
      'color:#eef1f7;box-shadow:0 22px 50px -20px rgba(0,0,0,.9);backdrop-filter:blur(8px);max-width:100%}',
      '.pwa-card b{display:block;font-size:13.5px;font-weight:750;margin-bottom:4px}',
      '.pwa-card p{margin:0 0 12px;font-size:12.6px;line-height:1.55;color:#8b94a8}',
      '.pwa-card ol{margin:0 0 12px;padding-left:18px;font-size:12.6px;line-height:1.7;color:#8b94a8}',
      '.pwa-card .row{display:flex;gap:8px}',
      '.pwa-card button{cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;border-radius:9px;',
      'padding:8px 14px;border:1px solid transparent;transition:filter .15s,border-color .15s,color .15s}',
      '.pwa-card button.go{color:#0a1016;border:0;background:linear-gradient(135deg,var(--acc,#4f8cff),var(--acc2,#8b5cff))}',
      '.pwa-card button.go:hover{filter:brightness(1.08)}',
      '.pwa-card button.ghost{color:#8b94a8;background:transparent;border-color:#2f3947}',
      '.pwa-card button.ghost:hover{color:#eef1f7;border-color:#465264}',

      '@keyframes pwaIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
      '@keyframes pwaUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',

      /* keep clear of the shared bottom-centre toast on small screens */
      '@media(max-width:560px){.pwa-stack{left:12px;right:12px;bottom:76px;max-width:none}',
      '.pwa-card,.pwa-pill{width:100%}.pwa-pill{justify-content:center}}',

      '@media(prefers-reduced-motion:reduce){.pwa-chip.in,.pwa-stack > *{animation:none}',
      '.pwa-btn,.pwa-x,.pwa-card button{transition:none}}'
    ].join('');

    try {
      var st = doc.createElement('style');
      st.id = 'shelfPwaCss';
      st.textContent = css;
      (doc.head || doc.documentElement).appendChild(st);
    } catch (e) {}
  }

  /* ================================================================= stack == */

  var stackEl = null;
  function stack() {
    if (stackEl && stackEl.parentNode) return stackEl;
    stackEl = doc.createElement('div');
    stackEl.className = 'pwa-stack';
    try { (doc.body || doc.documentElement).appendChild(stackEl); } catch (e) { return null; }
    return stackEl;
  }

  /* ========================================================= install chip == */

  var deferredPrompt = null;
  var chipEl = null;

  /* site.js builds .sn-right at DOMContentLoaded. This script is deferred and
     loaded after it, so the node is normally already there — but we never rely
     on that: watch for it, and fall back to a floating chip. */
  function whenNavRight(cb) {
    var found = doc.querySelector('.sn-right');
    if (found) { cb(found); return; }

    var done = false, mo = null, timer = null;
    function finish(el) {
      if (done) return;
      done = true;
      if (mo) { try { mo.disconnect(); } catch (e) {} }
      clearTimeout(timer);
      cb(el);
    }
    try {
      mo = new MutationObserver(function () {
        var el = doc.querySelector('.sn-right');
        if (el) finish(el);
      });
      mo.observe(doc.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    timer = setTimeout(function () { finish(doc.querySelector('.sn-right')); }, CHIP_WAIT_MS);
  }

  function removeChip() {
    if (chipEl && chipEl.parentNode) chipEl.parentNode.removeChild(chipEl);
    chipEl = null;
  }

  function showInstallChip(mode) {
    if (chipEl) return;
    if (isStandalone()) return;
    if (lsGet(LS_DISMISS)) return;

    whenNavRight(function (host) {
      if (chipEl || lsGet(LS_DISMISS) || isStandalone()) return;
      if (mode === 'prompt' && !deferredPrompt) return;   // event was consumed meanwhile

      injectStyles();

      var wrap = doc.createElement('div');
      wrap.className = 'pwa-chip in' + (host ? '' : ' pwa-float');

      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'pwa-btn' + (host ? ' sn-btn' : '');
      btn.title = mode === 'ios' ? 'How to add Shelf to your home screen' : 'Install Shelf as an app';
      btn.innerHTML = ico('download', IC_DOWNLOAD) + '<span class="lbl">Install</span>';

      var x = doc.createElement('button');
      x.type = 'button';
      x.className = 'pwa-x';
      x.setAttribute('aria-label', 'Do not offer to install Shelf again');
      x.title = 'Not now — do not ask again';
      x.textContent = '×';

      wrap.appendChild(btn);
      wrap.appendChild(x);
      chipEl = wrap;

      try {
        if (host) host.insertBefore(wrap, host.firstChild);
        else (doc.body || doc.documentElement).appendChild(wrap);
      } catch (e) { chipEl = null; return; }

      x.addEventListener('click', function (ev) {
        ev.preventDefault();
        lsSet(LS_DISMISS, '1');
        removeChip();
      });

      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (mode === 'ios') { showIosHelp(); return; }
        var p = deferredPrompt;
        if (!p) { removeChip(); return; }
        deferredPrompt = null;         // a captured prompt can only be used once
        removeChip();
        try {
          p.prompt();
          var choice = p.userChoice;
          if (choice && typeof choice.then === 'function') {
            choice.then(function (res) {
              if (res && res.outcome === 'accepted') lsSet(LS_DISMISS, 'installed');
              // If the user backed out we simply stop nagging for this visit;
              // the browser may fire beforeinstallprompt again later.
            }).catch(noop);
          }
        } catch (e) { /* prompt() can throw if already used — nothing to do */ }
      });
    });
  }

  function showIosHelp() {
    var host = stack();
    if (!host || doc.getElementById('pwaIosCard')) return;
    injectStyles();
    var card = doc.createElement('div');
    card.className = 'pwa-card';
    card.id = 'pwaIosCard';
    card.innerHTML =
      '<b>Add Shelf to your Home Screen</b>' +
      '<ol><li>Tap the Share button in Safari.</li>' +
      '<li>Choose <b style="display:inline">Add to Home Screen</b>.</li></ol>' +
      '<div class="row"><button type="button" class="go">Got it</button></div>';
    host.appendChild(card);
    var close = card.querySelector('button');
    if (close) close.addEventListener('click', function () {
      if (card.parentNode) card.parentNode.removeChild(card);
    });
  }

  /* ======================================================= online / offline == */

  var offlinePill = null;
  var wasOffline = false;

  function paintConnection(initial) {
    var offline = (typeof navigator.onLine === 'boolean') ? !navigator.onLine : false;

    if (offline) {
      wasOffline = true;
      if (offlinePill) return;
      var host = stack();
      if (!host) return;
      injectStyles();
      offlinePill = doc.createElement('div');
      offlinePill.className = 'pwa-pill';
      offlinePill.setAttribute('role', 'status');
      offlinePill.innerHTML = '<span class="dot"></span><span>Offline — showing saved pages</span>';
      host.appendChild(offlinePill);
      return;
    }

    if (offlinePill) {
      offlinePill.className = 'pwa-pill ok';
      offlinePill.innerHTML = '<span class="dot"></span><span>Back online</span>';
      var el = offlinePill;
      offlinePill = null;
      setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 2200);
    }
    if (wasOffline && !initial) toast('Back online', true);
    wasOffline = false;
  }

  /* ========================================================= sw + updating == */

  var reloading = false;
  var updateShown = false;
  var lastUpdateCheck = 0;

  function showUpdateCard(reg) {
    if (updateShown || reloading) return;
    updateShown = true;

    toast('Shelf has been updated');   // quiet, informational

    var host = stack();
    if (!host) return;
    injectStyles();

    var card = doc.createElement('div');
    card.className = 'pwa-card';
    card.setAttribute('role', 'status');
    card.innerHTML =
      '<b>A new version of Shelf is ready</b>' +
      '<p>Reload to pick up the latest catalogue and fixes.</p>' +
      '<div class="row"><button type="button" class="go">Reload</button>' +
      '<button type="button" class="ghost">Later</button></div>';
    host.appendChild(card);

    var btns = card.getElementsByTagName('button');
    btns[0].addEventListener('click', function () {
      reloading = true;
      // If a worker is still waiting (older browsers, or skipWaiting blocked),
      // let it take over before we reload.
      try { if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
      try { location.reload(); } catch (e) {}
    });
    btns[1].addEventListener('click', function () {
      if (card.parentNode) card.parentNode.removeChild(card);
    });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' &&
        location.hostname !== '127.0.0.1' && location.hostname !== '[::1]') return; // needs a secure context

    var q = '?v=' + encodeURIComponent(SW_VERSION);
    var hadController = !!navigator.serviceWorker.controller;

    // Preferred: the root shim, which gives the worker whole-site scope.
    // Fallback: the worker file itself, which can only claim assets/ — still
    // useful (CSS/JS/images go offline) and never throws.
    navigator.serviceWorker.register(ROOT + 'sw.js' + q, { scope: ROOT })
      .catch(function () { return navigator.serviceWorker.register(ASSETS + 'sw.js' + q); })
      .then(function (reg) {
        if (!reg) return;

        if (reg.waiting && navigator.serviceWorker.controller) showUpdateCard(reg);

        reg.addEventListener('updatefound', function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            // "installed" with an existing controller == an update, not a
            // first install.
            if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateCard(reg);
          });
        });

        // Cheap periodic freshness check when the tab comes back into view.
        doc.addEventListener('visibilitychange', function () {
          if (doc.visibilityState !== 'visible') return;
          var now = Date.now();
          if (now - lastUpdateCheck < UPDATE_CHECK_MS) return;
          lastUpdateCheck = now;
          try { reg.update().catch(noop); } catch (e) {}
        });

        primeExtraAssets();
      })
      .catch(noop);

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // First install claims the page — that is not an update, and reloading
      // there would be gratuitous.
      if (!hadController) { hadController = true; primeExtraAssets(); return; }
      showUpdateCard(null);
    });
  }

  /* Tell the worker about the same-origin CSS/JS this page actually loaded, so
     modules whose filenames the worker cannot know still work offline after one
     online visit. */
  var primed = false;
  function primeExtraAssets() {
    if (primed) return;
    primed = true;
    var send = function () {
      try {
        var ctrl = navigator.serviceWorker.controller;
        if (!ctrl) { primed = false; return; }
        var urls = [], i, el;
        var links = doc.querySelectorAll('link[rel~="stylesheet"][href], link[rel="manifest"][href]');
        for (i = 0; i < links.length; i++) {
          el = links[i];
          if (el.href && el.href.indexOf(location.origin) === 0) urls.push(el.href);
        }
        var scripts = doc.getElementsByTagName('script');
        for (i = 0; i < scripts.length; i++) {
          el = scripts[i];
          if (el.src && el.src.indexOf(location.origin) === 0) urls.push(el.src);
        }
        if (location.protocol.indexOf('http') === 0) urls.push(location.origin + location.pathname);
        if (urls.length) ctrl.postMessage({ type: 'CACHE_URLS', urls: urls });
      } catch (e) {}
    };
    // Run when the browser is idle so it never competes with first paint.
    try {
      if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(send, { timeout: 4000 });
      else setTimeout(send, 2500);
    } catch (e) { setTimeout(send, 2500); }
  }

  /* ================================================================== boot == */

  // Capture the install prompt as early as possible — it can fire before load.
  try {
    win.addEventListener('beforeinstallprompt', function (e) {
      try { e.preventDefault(); } catch (err) {}
      deferredPrompt = e;
      showInstallChip('prompt');
    });
    win.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      lsSet(LS_DISMISS, 'installed');
      removeChip();
      toast('Shelf installed', true);
    });
  } catch (e) {}

  function boot() {
    try { injectStyles(); } catch (e) {}
    try { paintConnection(true); } catch (e) {}
    try {
      win.addEventListener('online', function () { paintConnection(false); });
      win.addEventListener('offline', function () { paintConnection(false); });
    } catch (e) {}
    try { registerSW(); } catch (e) {}

    // iOS/iPadOS Safari never fires beforeinstallprompt, so offer the manual
    // route there instead (same one-click permanent dismissal).
    try {
      var ua = navigator.userAgent || '';
      var iOS = /iPad|iPhone|iPod/.test(ua) ||
                (/Macintosh/.test(ua) && typeof doc.ontouchend !== 'undefined');
      var safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);
      if (iOS && safari && !isStandalone() && !lsGet(LS_DISMISS)) {
        setTimeout(function () { showInstallChip('ios'); }, 1200);
      }
    } catch (e) {}
  }

  function onReady(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  try {
    // Defer registration until after load so it never competes with the first
    // render of a 600 KB catalogue page.
    onReady(function () {
      if (doc.readyState === 'complete') boot();
      else win.addEventListener('load', boot);
    });
  } catch (e) {}
})();
