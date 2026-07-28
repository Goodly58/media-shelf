/* ==========================================================================
   Shelf — motion system                                     assets/motion.js
   --------------------------------------------------------------------------
   Loaded with `defer` AFTER assets/site.js on every page.

   This module never owns markup. It only adds and removes .sm-* state classes
   defined in assets/motion.css, so if this file fails to load the pages keep
   working exactly as before (motion.css contains a CSS-only failsafe for the
   one thing it pre-hides: the landing-page reveal sections).

   Because the pages' inline scripts run BEFORE any deferred script, nothing
   here may assume it existed during the first render. Everything is wired up
   from DOMContentLoaded via MutationObserver / IntersectionObserver, and any
   items that were already rendered before we booted are picked up on init.

   Public API:  window.ShelfMotion = {
                  reveal(el), stagger(container), tickNumbers(root),
                  reducedMotion()
                }
   ========================================================================== */
(function () {
  'use strict';

  if (window.ShelfMotion) return;               // never double-install

  var D = document, W = window;

  /* ---------------------------------------------------------------- prefs */

  var mq = W.matchMedia ? W.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = !!(mq && mq.matches);
  if (mq) {
    var onPrefChange = function () { reduced = !!mq.matches; };
    if (mq.addEventListener) mq.addEventListener('change', onPrefChange);
    else if (mq.addListener) mq.addListener(onPrefChange);   // Safari < 14
  }

  var hasMO = typeof W.MutationObserver === 'function';
  var hasIO = typeof W.IntersectionObserver === 'function';
  var raf = W.requestAnimationFrame
    ? W.requestAnimationFrame.bind(W)
    : function (fn) { return setTimeout(function () { fn(now()); }, 16); };

  function now() {
    return (W.performance && W.performance.now) ? W.performance.now() : Date.now();
  }

  /* ------------------------------------------------------------- tiny dom */

  function qs(sel, root) {
    try { return (root || D).querySelector(sel); } catch (e) { return null; }
  }
  function qsa(sel, root) {
    try { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }
    catch (e) { return []; }
  }
  function matchesSel(el, sel) {
    if (!el || el.nodeType !== 1) return false;
    var fn = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
    try { return fn ? fn.call(el, sel) : false; } catch (e) { return false; }
  }
  function toEl(x) {
    if (!x) return null;
    if (typeof x === 'string') return qs(x);
    return x.nodeType === 1 ? x : null;
  }
  function toEls(x) {
    if (!x) return [];
    if (typeof x === 'string') return qsa(x);
    if (x.nodeType === 1) return [x];
    if (typeof x.length === 'number') {
      return Array.prototype.slice.call(x).filter(function (n) { return n && n.nodeType === 1; });
    }
    return [];
  }
  function isConnected(el) {
    if ('isConnected' in el) return el.isConnected;
    return !!(D.body && D.body.contains(el));
  }
  function safe(fn) {                       // observers must never throw
    return function () {
      try { return fn.apply(this, arguments); }
      catch (e) { if (W.console && W.console.warn) W.console.warn('[ShelfMotion]', e); }
    };
  }

  /* Remove a one-shot animation class once it has finished.
     - animationend bubbles, so we check the target is the element itself and
       that it is not a ::before/::after animation (e.g. `.card.flash::after`);
     - a timeout is mandatory: if the animation never runs (element hidden,
       class unsupported) the element must not stay stuck at opacity 0. */
  function settle(el, cls, maxMs, after) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(tid);
      el.removeEventListener('animationend', onEnd);
      el.removeEventListener('animationcancel', onEnd);
      el.classList.remove(cls);
      el.style.removeProperty('--sm-d');
      if (after) { try { after(el); } catch (e) {} }
    }
    function onEnd(e) {
      if (e.target === el && !e.pseudoElement) finish();
    }
    el.addEventListener('animationend', onEnd);
    el.addEventListener('animationcancel', onEnd);
    var tid = setTimeout(finish, maxMs);
  }

  /* ==========================================================================
     Staggered entrance for #grid (.card) and #list (.word)
     ========================================================================== */

  var ITEM_SEL   = '.card, .word';
  var STEP_MS    = 22;    // per-item delay
  var STEP_MOD   = 12;    // delay cycles every 12 items, so batch 60 never waits
  var ITEM_MS    = 380;   // must match --sm-slow in motion.css
  var ITEM_MAX   = 96;    // hard cap on how many items we animate per batch
  var SWAP_MS    = 150;

  function directItems(container) {
    var out = [], kids = container.children;
    for (var i = 0; i < kids.length; i++) {
      if (matchesSel(kids[i], ITEM_SEL)) out.push(kids[i]);
    }
    return out;
  }

  function animateItems(items, force) {
    if (reduced || !items || !items.length) return;
    var n = Math.min(items.length, ITEM_MAX);
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (!el || el.nodeType !== 1) continue;
      if (el.__smSeen && !force) continue;
      el.__smSeen = 1;
      if (i >= n) continue;                       // beyond the cap: show as-is
      el.style.setProperty('--sm-d', (i % STEP_MOD) * STEP_MS + 'ms');
      if (el.classList.contains('sm-item-in')) {  // only on an explicit re-run
        el.classList.remove('sm-item-in');
        void el.offsetWidth;                      // force a restart
      }
      el.classList.add('sm-item-in');
      settle(el, 'sm-item-in', (STEP_MOD - 1) * STEP_MS + ITEM_MS + 400);
    }
  }

  /* Cross-fade the container itself when its contents are swapped wholesale
     (a filter change: the page clears #grid and immediately re-fills it). */
  function swapFlash(container) {
    if (reduced) return;
    container.classList.add('sm-swap');
    clearTimeout(container.__smSwapT);
    container.__smSwapT = setTimeout(function () {
      container.classList.remove('sm-swap');
    }, SWAP_MS + ITEM_MS + (STEP_MOD - 1) * STEP_MS + 60);
  }

  function bindItemContainer(container) {
    if (!container || container.__smBound) return;
    container.__smBound = 1;

    // Items rendered by the page's inline script before this file ran.
    animateItems(directItems(container));

    if (!hasMO) return;
    var mo = new MutationObserver(safe(function (muts) {
      var added = [], removed = 0, i, j, m, node;
      for (i = 0; i < muts.length; i++) {
        m = muts[i];
        removed += m.removedNodes.length;
        for (j = 0; j < m.addedNodes.length; j++) {
          node = m.addedNodes[j];
          if (node.nodeType === 1 && matchesSel(node, ITEM_SEL)) added.push(node);
        }
      }
      if (!added.length) return;
      // A re-render replaces many nodes at once; an infinite-scroll batch only
      // appends. Only the former gets the container cross-fade.
      if (removed >= 2 && added.length >= 2) swapFlash(container);
      animateItems(added);
    }));
    mo.observe(container, { childList: true });
  }

  /* ==========================================================================
     Landing-page scroll reveal (.tool .feat .step .jump on index.html)
     ========================================================================== */

  var RV_SEL = '.tool, .feat, .step, .jump';

  function showReveal(el) {
    if (el.classList.contains('sm-rv-done')) return;
    if (reduced) { finishReveal(el); return; }
    el.classList.add('sm-rv-in');
    settle(el, 'sm-rv-in', 520 + 400 + 400, finishReveal);
  }
  function finishReveal(el) {
    el.classList.add('sm-rv-done');
    el.classList.remove('sm-rv');            // hand the element back to the page
  }

  function initReveal() {
    if (!D.body || D.body.getAttribute('data-page') !== 'home') return;
    var els = qsa(RV_SEL);
    if (!els.length) return;

    // No IntersectionObserver (or the user wants no motion): show immediately
    // instead of waiting for the 2.4s CSS failsafe.
    if (!hasIO || reduced) {
      els.forEach(function (el) { el.classList.add('sm-rv', 'sm-rv-done'); });
      return;
    }

    var io = new IntersectionObserver(safe(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        io.unobserve(entries[i].target);          // once only
        showReveal(entries[i].target);
      }
    }), { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });

    els.forEach(function (el) {
      var parent = el.parentNode;
      if (parent && parent.nodeType === 1) {
        if (typeof parent.__smRvI !== 'number') parent.__smRvI = 0;
        // Small stagger inside each row/section, capped so nothing waits long.
        el.style.setProperty('--sm-d', ((parent.__smRvI++ % 6) * 45) + 'ms');
      }
      el.classList.add('sm-rv');    // cancels the CSS failsafe; JS owns it now
      io.observe(el);
    });

    /* Safety net. Adding .sm-rv above cancels the CSS failsafe animation, so
       from this point the ONLY thing that can un-hide these elements is the
       observer. In a few real situations the observer never delivers an entry
       — a background/prerendered tab, some embedded webviews, or a page that
       is never composited — and the content would stay at opacity:0 forever.
       Content must never be lost to a decorative effect, so after a short
       grace period anything still unrevealed is shown unconditionally. */
    setTimeout(safe(function () {
      els.forEach(function (el) {
        if (!el.classList.contains('sm-rv-in') && !el.classList.contains('sm-rv-done')) {
          try { io.unobserve(el); } catch (_) {}
          finishReveal(el);           // straight to visible, no animation
        }
      });
    }), 1600);
  }

  /* ==========================================================================
     Chip toggle pop  (#chips .chip gaining/losing .on)
     ========================================================================== */

  var booted = false;

  function pop(el) {
    if (reduced) return;
    el.classList.remove('sm-pop');
    void el.offsetWidth;                       // restart the animation
    el.classList.add('sm-pop');
    settle(el, 'sm-pop', 600);
  }

  function watchChips() {
    var chips = qs('#chips');
    if (!chips || !hasMO) return;

    qsa('.chip', chips).forEach(function (c) { c.__smOn = c.classList.contains('on'); });

    var mo = new MutationObserver(safe(function (muts) {
      var i, j, m, t, on, node;
      for (i = 0; i < muts.length; i++) {
        m = muts[i];
        if (m.type === 'attributes') {
          t = m.target;
          if (!matchesSel(t, '.chip')) continue;
          on = t.classList.contains('on');
          // Only react to a real off -> on transition, so adding .sm-pop
          // (which mutates the same attribute) can never loop.
          if (on && !t.__smOn) pop(t);
          t.__smOn = on;
        } else if (booted) {
          // some pages rebuild the whole chip row on every toggle.
          for (j = 0; j < m.addedNodes.length; j++) {
            node = m.addedNodes[j];
            if (node.nodeType !== 1 || !matchesSel(node, '.chip')) continue;
            node.__smOn = node.classList.contains('on');
            if (node.__smOn) pop(node);
          }
        }
      }
    }));
    mo.observe(chips, {
      attributes: true, attributeFilter: ['class'], subtree: true, childList: true
    });
  }

  /* ==========================================================================
     Modal / overlay open transition
     The overlays go display:none -> flex, which kills CSS transitions on the
     box itself; an animation restarted on open works in every browser.
     ========================================================================== */

  var OV_SEL  = '.overlay, .sh-ov';
  var BOX_SEL = '.modal, .sh-md';

  function openBox(ov) {
    if (reduced) return;
    var box = qs(':scope > .modal, :scope > .sh-md', ov) || qs(BOX_SEL, ov);
    if (!box) return;
    box.classList.remove('sm-box-in');
    void box.offsetWidth;
    box.classList.add('sm-box-in');
    settle(box, 'sm-box-in', 600);
  }

  function bindOverlay(ov) {
    if (!ov || ov.__smOv) return;
    ov.__smOv = 1;
    ov.__smShown = ov.classList.contains('show');
    if (ov.__smShown) openBox(ov);
    if (!hasMO) return;
    new MutationObserver(safe(function () {
      var shown = ov.classList.contains('show');
      if (shown && !ov.__smShown) openBox(ov);
      ov.__smShown = shown;
    })).observe(ov, { attributes: true, attributeFilter: ['class'] });
  }

  function watchOverlays() {
    qsa(OV_SEL).forEach(bindOverlay);
    if (!hasMO || !D.body) return;
    // site.js builds #shHelpOv / #shAuthOv lazily and appends them to <body>.
    new MutationObserver(safe(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        for (var j = 0; j < muts[i].addedNodes.length; j++) {
          var n = muts[i].addedNodes[j];
          if (n.nodeType !== 1) continue;
          if (matchesSel(n, OV_SEL)) bindOverlay(n);
          else qsa(OV_SEL, n).forEach(bindOverlay);
        }
      }
    })).observe(D.body, { childList: true });
  }

  /* ==========================================================================
     Number tick-up  (.stat .v, hero counters, anything with [data-tick])
     - first appearance only: the pages rebuild #stats on every favourite
       toggle, so "already ticked" is keyed by a stable signature, not by node;
     - never touches values that are not a plain number: "∞", "—",
       "2010–26", "1.2M" is fine, "12 345" (non-ASCII grouping) is skipped;
     - the exact original string is restored on the final frame, so the
       rendered result is byte-identical to what the page wrote.
     ========================================================================== */

  var TICK_SEL   = '.stat .v, .hn .v, [data-tick]';
  var TICK_ROOTS = '.stats, .heronums, [data-tick-root]';
  var TICK_MS    = 600;
  var NUM_RE     = /^([^0-9]{0,2})(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?([^0-9]{0,2})$/;

  var tickDone   = {};     // signature -> 1
  var activeTicks = 0;

  function tickSig(el, i) {
    var page = (D.body && D.body.getAttribute('data-page')) || '';
    var attr = el.getAttribute && el.getAttribute('data-tick');
    if (attr) return page + '|a:' + attr;
    if (el.getAttribute && el.getAttribute('data-stat')) {
      return page + '|s:' + el.getAttribute('data-stat');
    }
    var label = el.parentNode && el.parentNode.nodeType === 1
      ? qs('.l', el.parentNode) : null;
    if (label && label.textContent.trim()) {
      return page + '|l:' + label.textContent.trim().toLowerCase();
    }
    return page + '|i:' + i;
  }

  function parseNum(text) {
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 24) return null;
    var m = NUM_RE.exec(t);
    if (!m) return null;
    var pre = m[1] || '', intPart = m[2], dec = m[3] || '', suf = m[4] || '';
    if (/[-−]/.test(pre)) return null;              // leave negatives alone
    var value = parseFloat(intPart.replace(/,/g, '') + dec);
    if (!isFinite(value) || value <= 0) return null;     // nothing to count to
    return {
      pre: pre,
      suf: suf,
      value: value,
      dec: dec ? dec.length - 1 : 0,
      grouped: intPart.indexOf(',') >= 0
    };
  }

  function fmtNum(v, dec, grouped) {
    var s = dec > 0 ? v.toFixed(dec) : String(Math.round(v));
    if (grouped) {
      var parts = s.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      s = parts.join('.');
    }
    return s;
  }

  function runTick(el, info, original) {
    var start = 0;
    activeTicks++;
    // Reserve the final width so the layout cannot jitter while digits grow.
    var w = 0;
    try { w = el.getBoundingClientRect().width; } catch (e) {}
    if (w) el.style.minWidth = Math.ceil(w) + 'px';
    el.classList.add('sm-ticking');

    function stop(restore) {
      el.classList.remove('sm-ticking');
      el.style.minWidth = '';
      if (restore && isConnected(el)) el.textContent = original;
      activeTicks--;
      if (activeTicks <= 0) { activeTicks = 0; scheduleTickScan(); }
    }
    function frame(ts) {
      if (!isConnected(el)) { stop(false); return; }     // node was replaced
      if (!start) start = ts || now();
      var p = Math.min(1, ((ts || now()) - start) / TICK_MS);
      var e = 1 - Math.pow(1 - p, 3);                    // ease-out cubic
      if (p < 1) {
        el.textContent = info.pre + fmtNum(info.value * e, info.dec, info.grouped) + info.suf;
        raf(frame);
      } else {
        stop(true);
      }
    }
    /* Never zero the number while the page is hidden. Counting up from 0 needs
       rAF, and a hidden tab pauses rAF *and* throttles setTimeout to roughly
       once a minute — so the element would sit displaying "0", which reads as
       real data rather than an unfinished animation. Nobody can see the
       animation in a hidden tab anyway, so keep the true value and let the
       next scan animate it once the page is actually visible. */
    if (D.hidden) { stop(true); return; }

    el.textContent = info.pre + fmtNum(0, info.dec, info.grouped) + info.suf;
    raf(frame);

    /* Belt and braces for any environment where rAF never delivers a frame:
       a wall-clock timer snaps the real value in if the animation overruns. */
    setTimeout(safe(function () {
      if (el.classList.contains('sm-ticking')) stop(true);
    }), TICK_MS + 1200);
  }

  function tickNumbers(root) {
    var scope = toEl(root) || D;
    var els = qsa(TICK_SEL, scope);
    if (scope !== D && matchesSel(scope, TICK_SEL)) els.unshift(scope);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var sig = tickSig(el, i);
      if (tickDone[sig]) continue;
      var original = el.textContent;
      var info = parseNum(original);
      // Not a number yet (e.g. the hero counters start as "—" and are filled
      // in by a fetch): leave it unmarked so we can pick it up on change.
      if (!info) continue;
      tickDone[sig] = 1;
      if (reduced) continue;                             // value stays as-is
      runTick(el, info, original);
    }
  }

  /* A page loaded in a background tab skips its tick (see runTick). Re-scan
     when it first becomes visible so the animation still happens for real. */
  D.addEventListener('visibilitychange', function () {
    if (!D.hidden) { tickDone = {}; scheduleTickScan(); }
  });

  var scanQueued = false;
  function scheduleTickScan() {
    if (scanQueued || activeTicks > 0) return;           // ignore our own writes
    scanQueued = true;
    raf(function () {
      scanQueued = false;
      try { tickNumbers(D); } catch (e) {}
    });
  }

  function watchTickRoots() {
    if (!hasMO) return;
    qsa(TICK_ROOTS).forEach(function (root) {
      if (root.__smTick) return;
      root.__smTick = 1;
      new MutationObserver(safe(function () { scheduleTickScan(); }))
        .observe(root, { childList: true, subtree: true, characterData: true });
    });
  }

  /* ==========================================================================
     Public API
     ========================================================================== */

  function reveal(el) {
    var list = toEls(el);
    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      if (node.classList.contains('sm-rv')) { showReveal(node); continue; }
      if (reduced) continue;
      node.classList.remove('sm-fade-up');
      void node.offsetWidth;
      node.classList.add('sm-fade-up');
      // Removed on completion so a filling animation can never win over the
      // element's own :hover / .on transforms.
      settle(node, 'sm-fade-up', 900);
    }
    return list.length;
  }

  function stagger(container, items) {
    var host = toEl(container);
    if (!host) return 0;
    var list = items ? toEls(items) : directItems(host);
    animateItems(list, true);                            // explicit call: re-run
    return list.length;
  }

  W.ShelfMotion = {
    version: 1,
    reveal: reveal,
    stagger: stagger,
    tickNumbers: tickNumbers,
    reducedMotion: function () { return reduced; }
  };

  /* ==========================================================================
     Boot
     ========================================================================== */

  function init() {
    try { bindItemContainer(qs('#grid')); } catch (e) {}
    try { bindItemContainer(qs('#list')); } catch (e) {}
    try { initReveal(); }    catch (e) {}
    try { watchChips(); }    catch (e) {}
    try { watchOverlays(); } catch (e) {}
    try { watchTickRoots(); } catch (e) {}
    try { tickNumbers(D); }  catch (e) {}
    // Chips that appear during the first render must not pop on arrival.
    setTimeout(function () { booted = true; }, 700);
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init);
  else init();
})();
