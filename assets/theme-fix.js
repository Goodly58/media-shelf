/* ==========================================================================
   Shelf — theme apply fix                              assets/theme-fix.js
   --------------------------------------------------------------------------
   Both themes render correctly on a fresh page load. What did NOT work was the
   live swap: flipping data-theme on <html> at runtime left <body> painted with
   the previous theme's background, which on a light→dark switch produced light
   text on a light surface.

   Chasing that through the cascade was not converging, and a half-repainted
   default theme is a much worse outcome than a brief reload. So the theme
   choice is persisted (theme.js already does this, and the inline <head>
   snippet applies it before first paint) and the page is reloaded to apply it.
   The result is always correct, in every mode, on every page.

   If the live swap is ever fixed properly, deleting this file restores the
   instant transition — nothing else depends on it.
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'shelf_theme';
  var root = document.documentElement;

  function currentMode() {
    try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
  }

  // The mode as it was when this page was rendered. Anything that changes it
  // after this point needs a reload to be painted correctly.
  var modeAtLoad = currentMode();
  var reloading = false;

  function applyByReload() {
    if (reloading) return;
    var now = currentMode();
    if (now === modeAtLoad) return;      // nothing actually changed
    reloading = true;
    // Preserve the exact view (filters live in the hash) across the reload.
    location.reload();
  }

  /* The toggle lives in the nav, which site.js injects asynchronously, so bind
     through the document rather than to the button itself. */
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('#shTheme');
    if (!btn) return;
    // Let theme.js run its own click handler and write localStorage first.
    setTimeout(applyByReload, 60);
  }, true);

  /* The palette (and anything else) can change the theme without a click, so
     also watch the attribute theme.js maintains. */
  if (window.MutationObserver) {
    new MutationObserver(function () { setTimeout(applyByReload, 60); })
      .observe(root, { attributes: true, attributeFilter: ['data-theme-mode'] });
  }
})();
