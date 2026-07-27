/* ==========================================================================
   Shelf — light / dark / auto theme controller
   Pairs with assets/theme.css. Loaded with `defer`, AFTER assets/site.js.

   Contract with the CSS
   ---------------------
     <html data-theme="light|dark">        <- RESOLVED theme, what CSS reads
     <html data-theme-mode="light|dark|auto"> <- what the user actually chose

   "auto" is resolved here (and in the optional <head> snippet) so stylesheets
   never have to duplicate rules inside a prefers-color-scheme media query.

   Public API:  window.ShelfTheme = { get, set, cycle, toggle, resolved, MODES }
   Event:       document dispatches 'shelf:theme'
                with detail {mode, resolved, previous}
   ========================================================================== */
(function () {
  'use strict';

  /* Loaded twice (duplicate <script> tags happen) — keep the first instance. */
  if (window.ShelfTheme) return;

  var KEY = 'shelf_theme';
  var MODES = ['light', 'dark', 'auto'];
  var NEXT = { light: 'dark', dark: 'auto', auto: 'light' };
  var LABEL = { light: 'Light', dark: 'Dark', auto: 'Auto' };

  var root = document.documentElement;
  var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  var mode = readMode();      // user's choice
  var applied = '';           // last resolved theme we wrote
  var btn = null;             // the toggle button, once mounted
  var switchTimer = 0;
  var observer = null;

  /* ---------------------------------------------------------------- storage */

  function readMode() {
    try {
      var v = window.localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : 'auto';
    } catch (e) {
      /* private mode / disabled storage — behave as "auto", just don't persist */
      return 'auto';
    }
  }

  function writeMode(m) {
    try { window.localStorage.setItem(KEY, m); } catch (e) {}
  }

  /* ---------------------------------------------------------------- resolve */

  function systemDark() { return !!(mql && mql.matches); }
  function resolve(m) { return m === 'auto' ? (systemDark() ? 'dark' : 'light') : m; }

  /* ------------------------------------------------------------------ icons */
  /* Lucide-style: 24x24, currentColor stroke, width 2, round caps/joins.
     Written out here on purpose — Shelf.icon() may not exist yet (site.js is a
     separate file and load order is not guaranteed), and this must never fail. */

  function svg(body) {
    return '<svg class="ic sth-ic" xmlns="http://www.w3.org/2000/svg" width="24" height="24" ' +
      'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      body + '</svg>';
  }

  var ICONS = {
    light: svg(
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/>' +
      '<path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>' +
      '<path d="M2 12h2"/><path d="M20 12h2"/>' +
      '<path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'
    ),
    dark: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    auto: svg('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>')
  };

  /* ------------------------------------------------------------------ apply */

  function apply(m, animate) {
    var previous = applied;
    var next = resolve(m);
    mode = m;

    /* Only animate when the visible theme actually flips, and never when the
       user asked for reduced motion. */
    if (animate && previous && previous !== next && !(reduce && reduce.matches)) {
      root.classList.add('sth-switching');
      clearTimeout(switchTimer);
      switchTimer = setTimeout(function () { root.classList.remove('sth-switching'); }, 240);
    }

    root.setAttribute('data-theme', next);
    root.setAttribute('data-theme-mode', mode);
    try { root.style.colorScheme = next; } catch (e) {}
    applied = next;

    paint();
    syncSurfaces();

    try {
      document.dispatchEvent(new CustomEvent('shelf:theme', {
        detail: { mode: mode, resolved: next, previous: previous || null }
      }));
    } catch (e) {
      /* very old engines without the CustomEvent constructor — non-fatal */
    }
  }

  /* Mirror the page's --bg onto <html> (overscroll area, and the browser UI
     colour on mobile) so nothing flashes the wrong tone at the edges. */
  function syncSurfaces() {
    var host = document.body || root;
    var bg = '';
    try { bg = getComputedStyle(host).getPropertyValue('--bg').trim(); } catch (e) {}
    if (!bg) bg = applied === 'light' ? '#f5f3ef' : '#0a0c11';

    try { root.style.backgroundColor = bg; } catch (e) {}

    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      (document.head || root).appendChild(meta);
    }
    meta.setAttribute('content', bg);
  }

  /* ------------------------------------------------------------------ button */

  function paint() {
    if (!btn) return;
    var label = LABEL[mode] || 'Auto';
    var hint = mode === 'auto'
      ? 'Theme: Auto (following your system — currently ' + applied + ')'
      : 'Theme: ' + label;
    btn.innerHTML = ICONS[mode] + '<span class="lbl">' + label + '</span>';
    btn.setAttribute('title', hint + ' · click to switch to ' + LABEL[NEXT[mode]]);
    btn.setAttribute('aria-label', hint + '. Activate to switch to ' + LABEL[NEXT[mode]] + ' theme.');
    btn.setAttribute('data-theme-mode', mode);
  }

  function makeButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'shTheme';
    b.className = 'sn-btn sth-toggle';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      cycle();
    });
    return b;
  }

  /* Injects the toggle into the shared nav, immediately before #shAcct.
     Returns true once the button is in the document. */
  function mount() {
    if (btn && btn.isConnected) return true;

    var right = document.querySelector('.sitenav .sn-right') || document.querySelector('.sn-right');
    if (!right) return false;

    var existing = document.getElementById('shTheme');
    if (existing && existing !== btn) existing.parentNode.removeChild(existing);
    if (!btn) btn = makeButton();

    var acct = right.querySelector('#shAcct');
    if (acct) right.insertBefore(btn, acct);
    else right.appendChild(btn);

    btn.classList.remove('sth-float');
    paint();
    return true;
  }

  /* Last resort: no shared nav on the page (site.js absent or failed). The
     user still gets a control rather than being stuck in one theme. */
  function mountFloating() {
    if (btn && btn.isConnected) return;
    if (!document.body) return;
    if (!btn) btn = makeButton();
    btn.classList.add('sth-float');
    document.body.appendChild(btn);
    paint();
  }

  /* site.js builds the nav on DOMContentLoaded; other modules may rebuild it.
     Watch until we get in, then stop — a permanent subtree observer would fire
     on every card batch the catalogue pages render. */
  function watchForNav() {
    if (observer || !window.MutationObserver || !document.body) return;
    observer = new MutationObserver(function () {
      if (mount()) stopWatching();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    /* Give the nav a generous window, then fall back to the floating button. */
    setTimeout(function () {
      stopWatching();
      if (!mount()) mountFloating();
    }, 8000);
  }

  function stopWatching() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  /* --------------------------------------------------------------- public API */

  function set(m) {
    if (MODES.indexOf(m) < 0) return get();
    writeMode(m);
    apply(m, true);
    return m;
  }

  function get() { return mode; }

  function cycle() { return set(NEXT[mode] || 'light'); }

  /* Straight light<->dark flip from whatever is currently on screen. Provided
     for other modules (e.g. a command palette offering "toggle theme"); it
     deliberately leaves "auto" because the user asked for a specific side. */
  function toggle() { return set(resolved() === 'light' ? 'dark' : 'light'); }

  function resolved() { return applied || resolve(mode); }

  window.ShelfTheme = {
    MODES: MODES.slice(),
    get: get,
    set: set,
    cycle: cycle,
    toggle: toggle,
    resolved: resolved
  };

  /* ------------------------------------------------------------------- boot */

  /* Apply straight away. If the <head> snippet already did this the attribute
     values are identical, so nothing repaints; if it is missing this still
     runs before first paint in practice, because the script is deferred. */
  applied = root.getAttribute('data-theme') === 'light' ? 'light'
          : root.getAttribute('data-theme') === 'dark' ? 'dark' : '';
  apply(mode, false);

  function boot() {
    if (!mount()) watchForNav();
    syncSurfaces();   /* body exists now — pick up the page-specific --bg */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* If anything else flips data-theme directly (another module, a devtools
     poke), adopt it instead of letting the button label go stale. Our own
     writes always equal `applied`, so they are ignored here. */
  if (window.MutationObserver) {
    new MutationObserver(function () {
      var v = root.getAttribute('data-theme');
      if (v === applied || (v !== 'light' && v !== 'dark')) return;
      applied = v;
      mode = v;
      root.setAttribute('data-theme-mode', mode);
      try { root.style.colorScheme = v; } catch (e) {}
      paint();
      syncSurfaces();
    }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* Live OS switches while in auto mode. */
  if (mql) {
    var onSystem = function () { if (mode === 'auto') apply('auto', true); };
    if (mql.addEventListener) mql.addEventListener('change', onSystem);
    else if (mql.addListener) mql.addListener(onSystem);   /* Safari < 14 */
  }

  /* Keep tabs (and the other Shelf pages) in sync. */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    var m = readMode();
    if (m !== mode) apply(m, true);
  });

  /* Restored from the back/forward cache: storage or OS theme may have moved. */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    mode = readMode();
    apply(mode, false);
    mount();
  });
})();
