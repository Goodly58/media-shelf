/* =====================================================================
   Shelf — features layer                                 assets/features.js
   Loaded AFTER assets/site.js, deferred, on every page.

   What this module adds (all additive, all optional, all defensive):
     1. Deep links          #open=<encoded title> opens that item's modal,
                            plus a "Copy link" action inside the modal.
     2. Compare tray        up to 4 items, docked, session-persistent,
                            with a side-by-side comparison dialog.
     3. Sort / view memory  per page, in localStorage, never overriding a
                            URL hash.
     4. Back to top         appears on scroll, keyboard reachable.
     5. Zero-result help    one-click "clear filters" plus the nearest
                            useful relaxation of the current filters.
     6. Export              CSV of the current view, behind a "⋯" menu.
     7. Played / Read       a per-item status with a chip to filter by it.
     8. Coach mark          one-time, dismissible ⌘K hint.

   ---------------------------------------------------------------------
   How it attaches without touching the pages
   ---------------------------------------------------------------------
   The catalogue pages declare their state with top-level `const`/`let`
   in an INLINE classic script. Those bindings live in the shared global
   lexical environment, so a later classic script (this one) can read —
   and, for `let`, write — them by name. They are NOT on `window`, hence
   every access goes through a `typeof`-guarded accessor below.

   Function declarations (`render`, `passes`, `openModal`, `renderBatch`)
   DO land on `window`, so we can wrap them. Wrapping is co-operative:
   we always call through to whatever was there before and mark the
   wrapper, so a second module can wrap us and nothing is lost.
   ===================================================================== */
(function () {
  'use strict';

  var PAGE = (document.body && document.body.getAttribute('data-page')) || '';

  /* =====================================================================
     Utilities
     ===================================================================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function on(el, ev, fn, opt) { if (el && el.addEventListener) el.addEventListener(ev, fn, opt); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function reduceMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function fire(el, type) {
    if (!el) return;
    try { el.dispatchEvent(new Event(type, { bubbles: true })); }
    catch (e) { var ev = document.createEvent('Event'); ev.initEvent(type, true, false); el.dispatchEvent(ev); }
  }

  /* Storage never throws here: private mode / disabled storage degrades to
     "the feature works, it just doesn't remember". */
  function jget(store, k, dflt) {
    try { var v = store.getItem(k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; }
  }
  function jset(store, k, v) { try { store.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function jdel(store, k) { try { store.removeItem(k); } catch (e) {} }

  /* A Set is iterable but NOT array-like, so [].slice.call(set) silently
     yields an empty array. Always go through here. */
  function setToArray(set) {
    if (!set) return [];
    if (typeof Array.from === 'function') return Array.from(set);
    var out = [];
    set.forEach(function (v) { out.push(v); });
    return out;
  }

  var fallbackToast;
  function toast(msg, ok) {
    if (window.Shelf && typeof window.Shelf.toast === 'function') { window.Shelf.toast(msg, ok); return; }
    // site.js should always be there; this is belt-and-braces.
    if (!fallbackToast) { fallbackToast = document.createElement('div'); document.body.appendChild(fallbackToast); }
    fallbackToast.className = 'sh-toast show';
    fallbackToast.textContent = msg;
    clearTimeout(fallbackToast._t);
    fallbackToast._t = setTimeout(function () { fallbackToast.className = 'sh-toast'; }, 2600);
  }

  /* Local icon set (Lucide geometry, ISC). Kept here rather than relying on
     Shelf.icon() because the names we need are not all in site.js. */
  var IC = {
    up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    columns: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>',
    dots: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    copy: '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>'
  };
  function svg(name, cls) {
    var p = IC[name];
    if (!p) return '';
    return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + p + '</svg>';
  }

  function fmtCount(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(n);
  }
  function fmtYear(y) {
    if (typeof y !== 'number') return String(y == null ? '—' : y);
    return y < 0 ? Math.abs(y) + ' BC' : String(y);
  }

  /* Clipboard with a synchronous fallback for non-secure contexts. */
  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { resolve(true); },
          function () { resolve(legacyCopy(text)); }
        );
      } else resolve(legacyCopy(text));
    });
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* Fixed-position UI is mounted right after the shared nav: it keeps the
     tab order sane (top-of-page affordances come before the huge grid)
     while position:fixed makes DOM order visually irrelevant. */
  function mount(node) {
    var nav = document.querySelector('.sitenav');
    if (nav && nav.parentNode === document.body && nav.nextSibling) document.body.insertBefore(node, nav.nextSibling);
    else if (nav && nav.parentNode === document.body) document.body.appendChild(node);
    else document.body.insertBefore(node, document.body.firstChild);
  }

  /* =====================================================================
     Page specification
     ===================================================================== */
  var SPEC = null;

  if (PAGE === 'games') {
    SPEC = {
      thing: 'game', things: 'games',
      statusDone: 'Played', statusVerb: 'Mark as played', statusChip: 'Played',
      coverSel: '.cover', titleSel: '.ttl',
      minSel: '#minmc', minName: 'minimum score',
      fallbackKey: function (o) { return o.title + '|' + o.year; },
      fields: [
        { label: 'Metacritic', val: function (o) { return o.metacritic == null ? '—' : o.metacritic; }, num: function (o) { return typeof o.metacritic === 'number' ? o.metacritic : null; }, better: 'high' },
        { label: 'IGN', val: function (o) { return o.ign == null ? '—' : (+o.ign).toFixed(1); }, num: function (o) { return o.ign == null ? null : +o.ign; }, better: 'high' },
        { label: 'User score', val: function (o) { return o.userScore == null ? '—' : (+o.userScore).toFixed(1); }, num: function (o) { return o.userScore == null ? null : +o.userScore; }, better: 'high' },
        { label: 'Year', val: function (o) { return fmtYear(o.year); } },
        { label: 'Genre', val: function (o) { return o.genre || '—'; } },
        { label: 'Verified', val: function (o) { return o.verified ? 'Yes' : 'No'; }, num: function (o) { return o.verified ? 1 : 0; }, better: 'high' },
        { label: 'Played', val: function (o) { return hasStatus(o) ? 'Yes' : 'No'; } },
        { label: 'Favourite', val: function (o) { return isFav(o) ? 'Yes' : 'No'; } }
      ],
      csv: [
        ['Title', function (o) { return o.title; }],
        ['Year', function (o) { return o.year; }],
        ['Genre', function (o) { return o.genre; }],
        ['Metacritic', function (o) { return o.metacritic; }],
        ['IGN', function (o) { return o.ign; }],
        ['User score', function (o) { return o.userScore; }],
        ['Verified', function (o) { return o.verified ? 'yes' : 'no'; }],
        ['Steam app id', function (o) { return o.steamAppId; }],
        ['Played', function (o) { return hasStatus(o) ? 'yes' : 'no'; }],
        ['Favourite', function (o) { return isFav(o) ? 'yes' : 'no'; }],
        ['Blurb', function (o) { return o.blurb; }]
      ]
    };
  } else if (PAGE === 'books') {
    SPEC = {
      thing: 'book', things: 'books',
      statusDone: 'Read', statusVerb: 'Mark as read', statusChip: 'Read',
      coverSel: '.coverwrap', titleSel: '.bt',
      minSel: '#minrate', minName: 'minimum rating',
      fallbackKey: function (o) { return o.title + '|' + o.author; },
      fields: [
        { label: 'Rating', val: function (o) { return o.rating == null ? '—' : (+o.rating).toFixed(2); }, num: function (o) { return typeof o.rating === 'number' ? o.rating : null; }, better: 'high' },
        { label: 'Ratings', val: function (o) { return fmtCount(o.ratingsCount); }, num: function (o) { return o.ratingsCount == null ? null : +o.ratingsCount; }, better: 'high' },
        { label: 'Author', val: function (o) { return o.author || '—'; } },
        { label: 'Year', val: function (o) { return fmtYear(o.year); } },
        { label: 'Genre', val: function (o) { return o.genre || '—'; } },
        { label: 'Read', val: function (o) { return hasStatus(o) ? 'Yes' : 'No'; } },
        { label: 'Favourite', val: function (o) { return isFav(o) ? 'Yes' : 'No'; } }
      ],
      csv: [
        ['Title', function (o) { return o.title; }],
        ['Author', function (o) { return o.author; }],
        ['Year', function (o) { return o.year; }],
        ['Genre', function (o) { return o.genre; }],
        ['Rating', function (o) { return o.rating; }],
        ['Ratings count', function (o) { return o.ratingsCount; }],
        ['ISBN', function (o) { return o.isbn; }],
        ['Read', function (o) { return hasStatus(o) ? 'yes' : 'no'; }],
        ['Favourite', function (o) { return isFav(o) ? 'yes' : 'no'; }],
        ['Blurb', function (o) { return o.blurb; }]
      ]
    };
  }

  /* =====================================================================
     Guarded access to the inline page globals
     ===================================================================== */
  function pageData() {
    try { if (PAGE === 'games' && typeof GAMES !== 'undefined' && Array.isArray(GAMES)) return GAMES; } catch (e) {}
    try { if (PAGE === 'books' && typeof BOOKS !== 'undefined' && Array.isArray(BOOKS)) return BOOKS; } catch (e) {}
    return null;
  }
  function curList() {
    try { if (typeof currentList !== 'undefined' && Array.isArray(currentList)) return currentList; } catch (e) {}
    return pageData() || [];
  }
  function favSet() {
    try { if (typeof favs !== 'undefined' && favs instanceof Set) return favs; } catch (e) {}
    return null;
  }
  function genreSet() {
    try { if (typeof activeGenres !== 'undefined' && activeGenres instanceof Set) return activeGenres; } catch (e) {}
    return null;
  }
  function keyOf(o) {
    if (!o) return '';
    try { if (typeof favKey === 'function') return favKey(o); } catch (e) {}
    return SPEC ? SPEC.fallbackKey(o) : String(o.title || '');
  }
  function isFav(o) { var s = favSet(); return !!(s && s.has(keyOf(o))); }
  function doRender() { if (typeof window.render === 'function') { try { window.render(); } catch (e) {} } }

  /* key -> item and lowercased title -> item, built once, refreshed if the
     dataset length changes (a curator edit, say). */
  var _maps = null, _mapsLen = -1;
  function maps() {
    var d = pageData();
    if (!d) return { byKey: new Map(), byTitle: new Map() };
    if (_maps && _mapsLen === d.length) return _maps;
    var byKey = new Map(), byTitle = new Map();
    for (var i = 0; i < d.length; i++) {
      var it = d[i];
      byKey.set(keyOf(it), it);
      var t = String(it.title || '').trim().toLowerCase();
      if (!byTitle.has(t)) byTitle.set(t, it);
    }
    _maps = { byKey: byKey, byTitle: byTitle };
    _mapsLen = d.length;
    return _maps;
  }

  /* =====================================================================
     Played / Read status
     ===================================================================== */
  var STATUS_KEY = 'shelf_status_' + (PAGE || 'page');
  var statusSet = new Set(jget(localStorage, STATUS_KEY, []) || []);
  var statusOnly = false;
  var chipEl = null;

  function hasStatus(o) { return statusSet.has(keyOf(o)); }
  function saveStatus() { jset(localStorage, STATUS_KEY, setToArray(statusSet)); }

  function toggleStatus(item) {
    var k = keyOf(item);
    if (!k) return;
    if (statusSet.has(k)) statusSet.delete(k); else statusSet.add(k);
    saveStatus();
    updateChip();
    refreshCards();                                   // repaint the toggles
    if (statusOnly) {                                 // list membership changed
      if (passesHooked) doRender();
      else applyHideMode();
    }
  }

  function buildChip() {
    var chips = $('#chips');
    if (!chips || !SPEC) return;
    chipEl = document.createElement('div');
    chipEl.className = 'chip fx-chip';
    chipEl.setAttribute('role', 'button');
    chipEl.setAttribute('tabindex', '0');
    chipEl.innerHTML = svg('check') + '<span>' + esc(SPEC.statusChip) + '</span><span class="n">0</span>';
    chips.insertBefore(chipEl, chips.firstChild);
    on(chipEl, 'click', function () { setStatusOnly(!statusOnly); });
    on(chipEl, 'keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); setStatusOnly(!statusOnly); }
    });
    updateChip();
  }
  function updateChip() {
    if (!chipEl || !SPEC) return;
    var n = statusSet.size;
    chipEl.querySelector('.n').textContent = n;
    chipEl.classList.toggle('on', statusOnly);
    chipEl.setAttribute('aria-pressed', statusOnly ? 'true' : 'false');
    // Stay out of the way until the user has actually marked something.
    chipEl.hidden = (n === 0 && !statusOnly);
    chipEl.title = (statusOnly ? 'Showing only ' : 'Show only ') + SPEC.statusChip.toLowerCase() + ' ' + SPEC.things;
  }
  function setStatusOnly(v) {
    if (statusOnly === !!v) return;
    statusOnly = !!v;
    updateChip();
    if (passesHooked) doRender();
    else { doRender(); applyHideMode(); }   // re-render clean, then hide/recount
  }

  /* Fallback path: if the page's passes() could not be wrapped we filter by
     hiding cards and correcting the counters ourselves. */
  function applyHideMode() {
    var grid = $('#grid');
    if (!grid) return;
    var kids = grid.children, i, c;
    for (i = 0; i < kids.length; i++) {
      c = kids[i];
      if (!c.classList || !c.classList.contains('card')) continue;
      c.classList.toggle('fx-hidden', !!(statusOnly && c._fxItem && !hasStatus(c._fxItem)));
    }
    if (!statusOnly) { updateZero(); return; }
    var list = curList(), total = 0;
    for (i = 0; i < list.length; i++) if (hasStatus(list[i])) total++;
    var sh = $('#shown');
    if (sh) { sh.textContent = total.toLocaleString(); if (sh.parentElement) sh.parentElement.style.display = ''; }
    var em = $('#empty');
    if (em) em.style.display = total ? 'none' : 'block';
    updateZero(total);
  }

  /* =====================================================================
     Compare tray + dialog
     ===================================================================== */
  var CMP_KEY = 'shelf_cmp_' + (PAGE || 'page');
  var CMP_MAX = 4;
  var cmpKeys = (jget(sessionStorage, CMP_KEY, []) || []).slice(0, CMP_MAX);
  var trayEl = null, trayItemsEl = null, trayGoEl = null;

  function saveCmp() { jset(sessionStorage, CMP_KEY, cmpKeys); }
  function inCompare(o) { return cmpKeys.indexOf(keyOf(o)) !== -1; }
  function cmpItems() {
    var m = maps().byKey, out = [];
    for (var i = 0; i < cmpKeys.length; i++) { var it = m.get(cmpKeys[i]); if (it) out.push(it); }
    return out;
  }
  function toggleCompare(item) {
    var k = keyOf(item);
    if (!k) return;
    var i = cmpKeys.indexOf(k);
    if (i !== -1) cmpKeys.splice(i, 1);
    else if (cmpKeys.length >= CMP_MAX) { toast('Compare holds ' + CMP_MAX + ' at a time — remove one first'); return; }
    else cmpKeys.push(k);
    saveCmp(); updateTray(); refreshCards();
  }
  function clearCompare() { cmpKeys = []; saveCmp(); updateTray(); refreshCards(); }

  function buildTray() {
    if (!SPEC) return;
    trayEl = document.createElement('div');
    trayEl.className = 'fx-tray';
    trayEl.setAttribute('role', 'region');
    trayEl.setAttribute('aria-label', 'Compare tray');
    trayEl.innerHTML =
      '<div class="fx-tray-in">' +
        '<span class="fx-tray-lbl">Compare</span>' +
        '<div class="fx-tray-items"></div>' +
        '<button type="button" class="fx-tgo"></button>' +
        '<button type="button" class="fx-tclose" aria-label="Close compare tray" title="Clear and close">' + svg('x') + '</button>' +
      '</div>';
    mount(trayEl);
    trayItemsEl = trayEl.querySelector('.fx-tray-items');
    trayGoEl = trayEl.querySelector('.fx-tgo');
    on(trayGoEl, 'click', openCompare);
    on(trayEl.querySelector('.fx-tclose'), 'click', clearCompare);
    on(trayItemsEl, 'click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.fx-tx') : null;
      if (!b) return;
      var k = b.getAttribute('data-k');
      var i = cmpKeys.indexOf(k);
      if (i !== -1) { cmpKeys.splice(i, 1); saveCmp(); updateTray(); refreshCards(); }
    });
    updateTray();
  }

  function updateTray() {
    if (!trayEl) return;
    var items = cmpItems();
    // Drop keys that no longer resolve (dataset changed under us). Only when
    // the dataset is actually available — never wipe a session over a miss.
    if (pageData() && items.length !== cmpKeys.length) {
      cmpKeys = items.map(keyOf);
      saveCmp();
    }
    var openState = items.length > 0;
    trayEl.classList.toggle('on', openState);
    document.body.classList.toggle('fx-tray-open', openState);
    trayEl.setAttribute('aria-hidden', openState ? 'false' : 'true');

    trayItemsEl.innerHTML = items.map(function (it) {
      var k = keyOf(it);
      return '<span class="fx-tchip">' +
        (it._fxCover ? '<img src="' + esc(it._fxCover) + '" alt="" loading="lazy">' : '') +
        '<span class="fx-tt">' + esc(it.title) + '</span>' +
        '<button type="button" class="fx-tx" data-k="' + esc(k) + '" aria-label="Remove ' + esc(it.title) + ' from compare" title="Remove">' + svg('x') + '</button>' +
        '</span>';
    }).join('');

    trayGoEl.textContent = items.length < 2 ? 'Pick 2+' : 'Compare (' + items.length + ')';
    trayGoEl.disabled = items.length < 2;
    trayGoEl.title = items.length < 2 ? 'Add at least two ' + SPEC.things + ' to compare' : 'Open the comparison';
  }

  /* ---- comparison dialog ---- */
  var cmpOv = null, cmpPrevFocus = null, cmpPrevOverflow = '';

  function ensureCmpOverlay() {
    if (cmpOv) return cmpOv;
    cmpOv = document.createElement('div');
    cmpOv.className = 'fx-ov';
    cmpOv.id = 'fxCmpOv';
    cmpOv.setAttribute('role', 'dialog');
    cmpOv.setAttribute('aria-modal', 'true');
    cmpOv.setAttribute('aria-label', 'Compare');
    cmpOv.innerHTML = '<div class="fx-md"></div>';
    document.body.appendChild(cmpOv);
    on(cmpOv, 'click', function (e) { if (e.target === cmpOv) closeCompare(); });
    on(cmpOv, 'keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeCompare(); return; }
      if (e.key !== 'Tab') return;
      var f = [].slice.call(cmpOv.querySelectorAll('button:not(:disabled)'));
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    return cmpOv;
  }

  function openCompare() {
    var items = cmpItems();
    if (items.length < 2) { toast('Add at least two ' + SPEC.things + ' to compare'); return; }
    var ov = ensureCmpOverlay();
    var md = ov.querySelector('.fx-md');

    var head = '<tr><th class="fx-corner" scope="col"><span class="fx-vh">Attribute</span></th>' +
      items.map(function (it) {
        return '<th class="fx-ith" scope="col"><div class="fx-ith-in">' +
          (it._fxCover ? '<img src="' + esc(it._fxCover) + '" alt="" loading="lazy">' : '') +
          '<span class="fx-ith-t">' + esc(it.title) + '</span></div></th>';
      }).join('') + '</tr>';

    var body = SPEC.fields.map(function (f) {
      var vals = items.map(function (it) { return f.val(it); });
      var best = -1;
      if (f.better === 'high' && typeof f.num === 'function') {
        var nums = items.map(function (it) { var n = f.num(it); return (typeof n === 'number' && !isNaN(n)) ? n : null; });
        var defined = nums.filter(function (n) { return n !== null; });
        // Only highlight when there is a genuine winner — never when tied.
        if (defined.length >= 2 && Math.max.apply(null, defined) !== Math.min.apply(null, defined)) best = Math.max.apply(null, defined);
        else if (defined.length === 1 && nums.length > 1) best = defined[0];
      }
      var cells = items.map(function (it, i) {
        var n = (typeof f.num === 'function') ? f.num(it) : null;
        var win = best !== -1 && typeof n === 'number' && n === best;
        return '<td' + (win ? ' class="fx-best"' : '') + '>' + esc(vals[i]) + '</td>';
      }).join('');
      return '<tr><th scope="row">' + esc(f.label) + '</th>' + cells + '</tr>';
    }).join('');

    md.innerHTML =
      '<div class="fx-md-h">' +
        '<div><h3>Compare</h3><div class="fx-sub">' + items.length + ' ' + SPEC.things + ' side by side</div></div>' +
        '<button type="button" class="fx-tclose" data-act="close" aria-label="Close">' + svg('x') + '</button>' +
      '</div>' +
      '<div class="fx-tblwrap"><table class="fx-tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="fx-md-f">' +
        '<span class="fx-note">Highlighted cells are the best value in that row.</span>' +
        '<button type="button" class="fx-zbtn" data-act="csv">' + svg('download') + 'CSV of these ' + SPEC.things + '</button>' +
        '<button type="button" class="fx-zbtn" data-act="clear">' + svg('undo') + 'Clear</button>' +
      '</div>';

    md.onclick = function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'close') closeCompare();
      else if (act === 'clear') { clearCompare(); closeCompare(); }
      else if (act === 'csv') exportCSV(cmpItems(), 'compare');
    };

    cmpPrevFocus = document.activeElement;
    cmpPrevOverflow = document.body.style.overflow;
    ov.classList.add('show');
    document.body.style.overflow = 'hidden';
    var c = md.querySelector('[data-act="close"]');
    if (c) setTimeout(function () { try { c.focus(); } catch (e) {} }, 20);
  }

  function closeCompare() {
    if (!cmpOv || !cmpOv.classList.contains('show')) return;
    cmpOv.classList.remove('show');
    document.body.style.overflow = cmpPrevOverflow || '';
    if (cmpPrevFocus && cmpPrevFocus.focus) { try { cmpPrevFocus.focus(); } catch (e) {} }
    cmpPrevFocus = null;
  }

  /* =====================================================================
     Card decoration
     ===================================================================== */
  function resolveItem(cardEl, idx, list) {
    var t = cardEl.querySelector(SPEC.titleSel);
    var txt = t ? t.textContent.trim() : '';
    var cand = list && list[idx];
    if (cand && String(cand.title || '').trim() === txt) return cand;
    if (txt) { var m = maps().byTitle.get(txt.toLowerCase()); if (m) return m; }
    return cand || null;
  }

  function decorateAll() {
    var grid = $('#grid');
    if (!grid || !SPEC) return;
    var list = curList(), kids = grid.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (!c.classList || !c.classList.contains('card')) continue;
      if (c._fxItem) continue;
      var item = resolveItem(c, i, list);
      if (!item) continue;
      c._fxItem = item;
      // Reuse the cover the page already requested — no extra network work.
      if (!item._fxCover) {
        var img = c.querySelector('img');
        var src = img && img.getAttribute('src');
        if (src) item._fxCover = src;
      }
      injectActions(c, item);
    }
  }

  function injectActions(cardEl, item) {
    var host = cardEl.querySelector(SPEC.coverSel) || cardEl;
    if (host.querySelector('.fx-actions')) return;
    var st = hasStatus(item), cm = inCompare(item);
    var box = document.createElement('div');
    box.className = 'fx-actions' + ((st || cm) ? ' fx-live' : '');
    box.innerHTML =
      '<button type="button" class="fx-btn' + (st ? ' on' : '') + '" data-fx="status" aria-pressed="' + (st ? 'true' : 'false') + '"' +
        ' title="' + esc(st ? SPEC.statusDone : SPEC.statusVerb) + '"' +
        ' aria-label="' + esc(SPEC.statusVerb + ': ' + item.title) + '">' + svg('check') + '</button>' +
      '<button type="button" class="fx-btn' + (cm ? ' on' : '') + '" data-fx="cmp" aria-pressed="' + (cm ? 'true' : 'false') + '"' +
        ' title="' + (cm ? 'In compare tray' : 'Add to compare') + '"' +
        ' aria-label="Add to compare: ' + esc(item.title) + '">' + svg('columns') + '</button>';
    host.appendChild(box);
    cardEl.classList.toggle('fx-done', st);
  }

  /* Repaint the toggles without rebuilding the grid. */
  function refreshCards() {
    var grid = $('#grid');
    if (!grid || !SPEC) return;
    var kids = grid.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i], item = c._fxItem;
      if (!item) continue;
      var box = c.querySelector('.fx-actions');
      if (!box) continue;
      var st = hasStatus(item), cm = inCompare(item);
      var sb = box.querySelector('[data-fx="status"]'), cb = box.querySelector('[data-fx="cmp"]');
      if (sb) {
        sb.classList.toggle('on', st);
        sb.setAttribute('aria-pressed', st ? 'true' : 'false');
        sb.title = st ? SPEC.statusDone : SPEC.statusVerb;
      }
      if (cb) {
        cb.classList.toggle('on', cm);
        cb.setAttribute('aria-pressed', cm ? 'true' : 'false');
        cb.title = cm ? 'In compare tray' : 'Add to compare';
      }
      box.classList.toggle('fx-live', st || cm);
      c.classList.toggle('fx-done', st);
    }
  }

  /* Click handling is delegated on #grid in the CAPTURE phase: the cards
     carry their own bubbling "open the modal" listener, and stopping
     propagation on the way down is the only way to beat it. */
  function wireGridClicks() {
    var grid = $('#grid');
    if (!grid) return;
    on(grid, 'click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.fx-btn') : null;
      if (!btn || !grid.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      var cardEl = btn.closest('.card');
      var item = cardEl && cardEl._fxItem;
      if (!item) return;
      if (btn.getAttribute('data-fx') === 'status') toggleStatus(item);
      else toggleCompare(item);
    }, true);
  }

  /* =====================================================================
     Hooks into the page's own functions
     ===================================================================== */
  var passesHooked = false;
  var afterHooks = [];
  var rafPending = false;
  var trailTimer = null;

  /* Wrapping window.render only catches the call sites that resolve the
     identifier at call time (chips, sliders, reset, favourites…). The search
     / sort / min-score inputs were wired as
         el.addEventListener('input', render)
     which captured the ORIGINAL function object, so those renders bypass the
     wrapper entirely. That is why afterRender is driven from three
     independent signals — the wrapper, a MutationObserver on #grid (the
     ground truth: every render empties and refills it) and a trailing pass
     after the filter controls change (which covers a 0-results view being
     replaced by another 0-results view, where the grid never mutates). */
  function hookRender() {
    if (typeof window.render !== 'function') return false;
    var orig = window.render;
    if (orig.__fx) return true;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      scheduleAfterRender();
      return r;
    };
    wrapped.__fx = true;
    wrapped.__fxOrig = orig;
    window.render = wrapped;
    return true;
  }
  function scheduleAfterRender(delay) {
    if (delay) {
      clearTimeout(trailTimer);
      trailTimer = setTimeout(function () { trailTimer = null; afterRender(); }, delay);
      return;
    }
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; afterRender(); });
  }

  /* The page's own debounce on books is 110ms, so the trailing pass waits
     comfortably past it. afterRender is idempotent, so extra passes are free. */
  function wireRenderSignals() {
    ['#search', '#sort', '#minmc', '#minrate', '#yrmin', '#yrmax'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      on(el, 'input', function () { scheduleAfterRender(240); });
      on(el, 'change', function () { scheduleAfterRender(240); });
    });
    ['#chips', '#favBtn', '#resetBtn'].forEach(function (sel) {
      on($(sel), 'click', function () { scheduleAfterRender(240); });
    });
  }
  function afterRender() {
    decorateAll();
    if (!passesHooked && statusOnly) applyHideMode();
    else updateZero();
    updateTray();
    for (var i = 0; i < afterHooks.length; i++) { try { afterHooks[i](); } catch (e) {} }
    try {
      document.dispatchEvent(new CustomEvent('shelf:render', { detail: { page: PAGE, count: curList().length } }));
    } catch (e) {}
  }

  function hookPasses() {
    if (typeof window.passes !== 'function') return false;
    var orig = window.passes;
    if (orig.__fx) { passesHooked = true; return true; }
    var wrapped = function (item) {
      if (!orig.apply(this, arguments)) return false;
      if (statusOnly && !hasStatus(item)) return false;
      return true;
    };
    wrapped.__fx = true;
    wrapped.__fxOrig = orig;
    window.passes = wrapped;
    passesHooked = true;
    return true;
  }

  function hookModal() {
    if (typeof window.openModal !== 'function') return false;
    var orig = window.openModal;
    if (orig.__fx) return true;
    var wrapped = function (item) {
      var r = orig.apply(this, arguments);
      try { decorateModal(item); } catch (e) {}
      return r;
    };
    wrapped.__fx = true;
    wrapped.__fxOrig = orig;
    window.openModal = wrapped;
    return true;
  }

  function decorateModal(item) {
    var md = $('#modal');
    if (!md || !item || !SPEC) return;
    var host = md.querySelector('.mactions');
    if (!host) {
      host = document.createElement('div');
      host.className = 'mactions';
      (md.querySelector('.mbody') || md).appendChild(host);
    }
    if (host.querySelector('.fx-mbtn')) return;

    var st = hasStatus(item);
    var sb = document.createElement('button');
    sb.type = 'button';
    sb.className = 'mbtn fx-mbtn' + (st ? ' on' : '');
    sb.innerHTML = svg('check') + '<span>' + esc(st ? SPEC.statusDone : SPEC.statusVerb) + '</span>';
    sb.setAttribute('aria-pressed', st ? 'true' : 'false');
    on(sb, 'click', function (e) {
      e.stopPropagation();
      toggleStatus(item);
      var now = hasStatus(item);
      sb.classList.toggle('on', now);
      sb.setAttribute('aria-pressed', now ? 'true' : 'false');
      sb.querySelector('span').textContent = now ? SPEC.statusDone : SPEC.statusVerb;
    });
    host.appendChild(sb);

    var lb = document.createElement('button');
    lb.type = 'button';
    lb.className = 'mbtn fx-mbtn';
    lb.innerHTML = svg('link') + '<span>Copy link</span>';
    on(lb, 'click', function (e) {
      e.stopPropagation();
      var url = linkFor(item);
      copyText(url).then(function (ok) {
        if (ok) {
          lb.querySelector('span').textContent = 'Link copied';
          toast('Link copied — it opens ' + item.title + ' directly', true);
          setTimeout(function () { if (lb.isConnected) lb.querySelector('span').textContent = 'Copy link'; }, 2200);
        } else {
          window.prompt('Copy this link:', url);
        }
      });
    });
    host.appendChild(lb);
  }

  /* =====================================================================
     Deep links  —  #open=<encoded title>
     ===================================================================== */
  function hashParams() {
    var out = {};
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return out;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i <= 0) return;
      try { out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); }
      catch (e) { out[kv.slice(0, i)] = kv.slice(i + 1); }
    });
    return out;
  }
  function baseUrl() { return location.href.split('#')[0]; }
  function linkFor(item) { return baseUrl() + '#open=' + encodeURIComponent(String(item && item.title || '')); }

  function findItem(token) {
    if (!token) return null;
    var m = maps();
    // Accept the full "Title|Year" style key too, so other modules can be
    // unambiguous when two items share a title.
    if (token.indexOf('|') !== -1 && m.byKey.has(token)) return m.byKey.get(token);
    return m.byTitle.get(String(token).trim().toLowerCase()) || null;
  }

  var lastOpened = null;
  function openFromHash(force) {
    if (!SPEC) return false;
    var p = hashParams();
    if (!p.open) { lastOpened = null; return false; }
    if (!force && p.open === lastOpened) return false;
    var item = findItem(p.open);
    if (!item) { lastOpened = p.open; return false; }
    if (typeof window.openModal !== 'function') return false;
    lastOpened = p.open;
    try { window.openModal(item); } catch (e) { return false; }
    return true;
  }
  function openTitle(title) {
    var item = findItem(title);
    if (!item || typeof window.openModal !== 'function') return false;
    try { window.openModal(item); } catch (e) { return false; }
    return true;
  }

  /* =====================================================================
     Zero results — clear + nearest relaxation
     ===================================================================== */
  function ensureZero() {
    var em = $('#empty');
    if (!em) return null;
    var z = em.querySelector('.fx-zero');
    if (!z) { z = document.createElement('div'); z.className = 'fx-zero'; em.appendChild(z); }
    return z;
  }

  /* Count how many items would pass if `mutate` were applied. `mutate`
     returns its own undo function. We reuse the PAGE's own passes(), which
     reads straight from the DOM, so the answer is always exactly right —
     and nothing re-renders because we never dispatch events. */
  function countWith(mutate) {
    var data = pageData(), p = window.passes;
    if (!data || typeof p !== 'function' || typeof mutate !== 'function') return -1;
    var undo;
    try { undo = mutate(); } catch (e) { return -1; }
    if (!undo) return -1;
    var n = 0;
    try { for (var i = 0; i < data.length; i++) if (p(data[i])) n++; }
    catch (e) { n = -1; }
    finally { try { undo(); } catch (e2) {} }
    return n;
  }

  function mutSearch() {
    var el = $('#search');
    var prev = el ? el.value : null;
    var hadQ = false, prevQ;
    try { if (typeof _q !== 'undefined') { prevQ = _q; hadQ = true; } } catch (e) {}
    if (el) el.value = '';
    if (hadQ) { try { _q = ''; } catch (e) {} }
    return function () {
      if (el) el.value = prev;
      if (hadQ) { try { _q = prevQ; } catch (e) {} }
    };
  }
  function mutMin(value) {
    var el = $(SPEC.minSel);
    if (!el) return null;
    var prev = el.value;
    el.value = value;
    return function () { el.value = prev; };
  }
  function mutYears() {
    var a = $('#yrmin'), b = $('#yrmax');
    if (!a || !b) return null;
    var pa = a.value, pb = b.value;
    a.value = a.min; b.value = b.max;
    return function () { a.value = pa; b.value = pb; };
  }
  function mutGenres() {
    var s = genreSet();
    if (!s || !s.size) return null;
    var prev = setToArray(s);
    s.clear();
    return function () { prev.forEach(function (g) { s.add(g); }); };
  }
  function mutFav() {
    var ok = false, prev;
    try { if (typeof favOnly !== 'undefined') { prev = favOnly; favOnly = false; ok = true; } } catch (e) {}
    return ok ? function () { try { favOnly = prev; } catch (e) {} } : null;
  }
  function mutStatus() {
    var prev = statusOnly;
    statusOnly = false;
    return function () { statusOnly = prev; };
  }

  function suggestions() {
    var out = [];
    if (!SPEC || typeof window.passes !== 'function') return out;

    // 1. Minimum score / rating — the most common cause of an empty grid.
    var minEl = $(SPEC.minSel);
    if (minEl && parseFloat(minEl.value) > 0) {
      var opts = [].slice.call(minEl.options)
        .filter(function (o) { return parseFloat(o.value) < parseFloat(minEl.value); })
        .sort(function (a, b) { return parseFloat(b.value) - parseFloat(a.value); });
      for (var i = 0; i < opts.length; i++) {
        (function (opt) {
          if (out.length && out[0].kind === 'min') return;
          var n = countWith(function () { return mutMin(opt.value); });
          if (n > 0) {
            var label = parseFloat(opt.value) > 0 ? (opt.text || opt.value) : 'any';
            out.push({
              kind: 'min', count: n,
              label: 'Lower the ' + SPEC.minName + ' to ' + label,
              apply: function () { minEl.value = opt.value; fire(minEl, 'input'); fire(minEl, 'change'); }
            });
          }
        })(opts[i]);
        if (out.length) break;
      }
    }

    // 2. Year range.
    var a = $('#yrmin'), b = $('#yrmax');
    if (a && b && (String(a.value) !== String(a.min) || String(b.value) !== String(b.max))) {
      var ny = countWith(mutYears);
      if (ny > 0) out.push({
        kind: 'years', count: ny,
        label: 'Widen the years to ' + fmtYear(+a.min) + '–' + fmtYear(+b.max),
        apply: function () { a.value = a.min; b.value = b.max; fire(a, 'input'); fire(b, 'input'); }
      });
    }

    // 3. Genre chips.
    var gs = genreSet();
    if (gs && gs.size) {
      var ng = countWith(mutGenres);
      if (ng > 0) out.push({
        kind: 'genres', count: ng,
        label: 'Clear ' + gs.size + ' genre filter' + (gs.size > 1 ? 's' : ''),
        apply: function () {
          gs.clear();
          var chips = $('#chips');
          if (chips) [].slice.call(chips.querySelectorAll('.chip.on[data-g]')).forEach(function (c) { c.classList.remove('on'); });
          doRender();
        }
      });
    }

    // 4. Our own status filter.
    if (statusOnly) {
      var ns = countWith(mutStatus);
      if (ns > 0) out.push({
        kind: 'status', count: ns,
        label: 'Include everything, not just ' + SPEC.statusChip.toLowerCase(),
        apply: function () { setStatusOnly(false); }
      });
    }

    // 5. Favourites-only.
    var favBtn = $('#favBtn');
    if (favBtn && favBtn.classList.contains('on')) {
      var nf = countWith(mutFav);
      if (nf > 0) out.push({
        kind: 'fav', count: nf,
        label: 'Look beyond your favourites',
        apply: function () { favBtn.click(); }
      });
    }

    // 6. The search box, last: it is usually what the user meant to keep.
    var sEl = $('#search');
    if (sEl && sEl.value.trim()) {
      var nq = countWith(mutSearch);
      if (nq > 0) out.push({
        kind: 'search', count: nq,
        label: 'Clear the search for “' + sEl.value.trim() + '”',
        apply: function () { sEl.value = ''; fire(sEl, 'input'); fire(sEl, 'change'); }
      });
    }
    return out;
  }

  function updateZero(forcedCount) {
    if (!SPEC) return;
    var z = ensureZero();
    if (!z) return;
    var count = (typeof forcedCount === 'number') ? forcedCount : curList().length;
    if (count > 0) { z.innerHTML = ''; z.onclick = null; return; }

    var sugg = suggestions().slice(0, 2);
    var html = '<div class="fx-zero-row">';
    sugg.forEach(function (s, i) {
      html += '<button type="button" class="fx-zbtn' + (i === 0 ? ' primary' : '') + '" data-i="' + i + '">' +
        svg('sparkles') + esc(s.label) + '<span class="fx-zn">' + s.count + '</span></button>';
    });
    if ($('#resetBtn')) {
      html += '<button type="button" class="fx-zbtn" data-clear="1">' + svg('undo') + 'Clear all filters</button>';
    }
    html += '</div>';
    z.innerHTML = html;
    z.onclick = function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      if (b.hasAttribute('data-clear')) {
        setStatusOnly(false);
        var r = $('#resetBtn');
        if (r) r.click();
        return;
      }
      var s = sugg[+b.getAttribute('data-i')];
      if (s) { try { s.apply(); } catch (err) {} }
    };
  }

  /* =====================================================================
     Toolbar "⋯" menu + CSV export
     ===================================================================== */
  var menuEl = null, menuBtn = null;

  function buildMore() {
    var row = document.querySelector('.toolbar .row');
    if (!row || !SPEC) return;
    var wrap = document.createElement('div');
    wrap.className = 'fx-more';
    wrap.innerHTML =
      '<button type="button" class="btn fx-more-btn" aria-haspopup="true" aria-expanded="false" aria-label="More actions" title="More actions">' + svg('dots') + '</button>' +
      '<div class="fx-menu" role="menu" hidden>' +
        '<button type="button" role="menuitem" data-act="csv">' + svg('download') + '<span>Download this view as CSV</span></button>' +
        '<button type="button" role="menuitem" data-act="titles">' + svg('copy') + '<span>Copy the titles in this view</span></button>' +
        '<div class="fx-sep"></div>' +
        '<button type="button" role="menuitem" data-act="forget">' + svg('undo') + '<span>Forget saved sort &amp; view</span></button>' +
      '</div>';
    row.appendChild(wrap);
    menuBtn = wrap.querySelector('.fx-more-btn');
    menuEl = wrap.querySelector('.fx-menu');

    on(menuBtn, 'click', function (e) { e.stopPropagation(); toggleMenu(); });
    on(menuBtn, 'keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); toggleMenu(true);
        var f = menuEl.querySelector('button'); if (f) f.focus();
      } else if (e.key === 'Escape' && !menuEl.hidden) {
        e.preventDefault(); toggleMenu(false);
      }
    });
    on(menuEl, 'click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      e.stopPropagation();
      runMenu(b.getAttribute('data-act'));
      toggleMenu(false);
      if (menuBtn) menuBtn.focus();
    });
    on(menuEl, 'keydown', function (e) {
      var items = [].slice.call(menuEl.querySelectorAll('[data-act]'));
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[(i + 1) % items.length] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[(i - 1 + items.length) % items.length] || items[0]).focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); toggleMenu(false); if (menuBtn) menuBtn.focus(); }
      else if (e.key === 'Tab') { toggleMenu(false); }
    });
    on(document, 'click', function (e) {
      if (!menuEl || menuEl.hidden) return;
      if (wrap.contains(e.target)) return;
      toggleMenu(false);
    });
    // Escape anywhere closes it — the page's own Escape handler only knows
    // about its detail modal, so this has to be independent.
    on(document, 'keydown', function (e) {
      if (e.key !== 'Escape' || !menuEl || menuEl.hidden) return;
      toggleMenu(false);
      if (menuBtn) menuBtn.focus();
    });
  }

  function toggleMenu(force) {
    if (!menuEl) return;
    var openIt = (typeof force === 'boolean') ? force : menuEl.hidden;
    menuEl.hidden = !openIt;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', openIt ? 'true' : 'false');
  }

  function runMenu(act) {
    if (act === 'csv') exportCSV();
    else if (act === 'titles') {
      var list = visibleList();
      if (!list.length) { toast('Nothing in this view to copy'); return; }
      copyText(list.map(function (o) { return o.title; }).join('\n')).then(function (ok) {
        toast(ok ? list.length + ' title' + (list.length > 1 ? 's' : '') + ' copied' : 'Could not reach the clipboard', ok);
      });
    } else if (act === 'forget') {
      jdel(localStorage, PREF_KEY);
      toast('Saved sort and view forgotten');
    }
  }

  /* The current view, honouring our own status filter in fallback mode. */
  function visibleList() {
    var list = curList();
    if (statusOnly && !passesHooked) list = list.filter(hasStatus);
    return list;
  }

  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    // Neutralise spreadsheet formula injection without mangling numbers.
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function buildCSV(list) {
    var cols = SPEC.csv;
    var lines = [cols.map(function (c) { return csvCell(c[0]); }).join(',')];
    for (var i = 0; i < list.length; i++) {
      var row = [];
      for (var j = 0; j < cols.length; j++) {
        var v;
        try { v = cols[j][1](list[i]); } catch (e) { v = ''; }
        row.push(csvCell(v));
      }
      lines.push(row.join(','));
    }
    return lines.join('\r\n');
  }
  function exportCSV(listArg, tag) {
    if (!SPEC) return;
    var list = listArg || visibleList();
    if (!list.length) { toast('Nothing in this view to export'); return; }
    var d = new Date();
    var stamp = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    var name = 'shelf-' + PAGE + (tag ? '-' + tag : '') + '-' + stamp + '.csv';
    try {
      // The BOM makes Excel open UTF-8 correctly; Numbers and Sheets ignore it.
      var blob = new Blob(['﻿' + buildCSV(list)], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 4000);
      toast(list.length.toLocaleString() + ' ' + SPEC.things + ' exported', true);
    } catch (e) {
      toast('Your browser blocked the download');
    }
  }

  /* =====================================================================
     Sort + view memory
     ===================================================================== */
  var PREF_KEY = 'shelf_prefs_' + (PAGE || 'page');

  function savePref(patch) {
    var p = jget(localStorage, PREF_KEY, {}) || {};
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) p[k] = patch[k];
    jset(localStorage, PREF_KEY, p);
  }
  function restorePrefs() {
    var p = jget(localStorage, PREF_KEY, null);
    if (!p) return;
    var h = hashParams();

    var sortEl = $('#sort');
    if (sortEl && p.sort && h.sort == null) {
      var ok = false;
      for (var i = 0; i < sortEl.options.length; i++) if (sortEl.options[i].value === p.sort) ok = true;
      if (ok && sortEl.value !== p.sort) { sortEl.value = p.sort; fire(sortEl, 'input'); fire(sortEl, 'change'); }
    }
    if (h.view == null) {
      var want = p.view === 'list' ? $('#listBtn') : (p.view === 'grid' ? $('#gridBtn') : null);
      if (want && !want.classList.contains('on')) want.click();
    }
  }
  function wirePrefs() {
    var sortEl = $('#sort');
    if (sortEl) on(sortEl, 'change', function () { savePref({ sort: sortEl.value }); });
    on($('#gridBtn'), 'click', function () { savePref({ view: 'grid' }); });
    on($('#listBtn'), 'click', function () { savePref({ view: 'list' }); });
  }

  /* =====================================================================
     Back to top
     ===================================================================== */
  function buildTop() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fx-top';
    b.title = 'Back to top';
    b.setAttribute('aria-label', 'Back to top');
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = svg('up');
    mount(b);

    on(b, 'click', function () {
      // Move focus first (without scrolling), then animate — keyboard users
      // land at the top of the page, not back in the middle of the grid.
      var target = document.querySelector('.sitenav a.sn-home') || document.querySelector('.sitenav a') || null;
      if (target && target.focus) { try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (e2) {} } }
      try { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); }
      catch (e) { window.scrollTo(0, 0); }
    });

    var ticking = false;
    function upd() {
      ticking = false;
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      var show = y > 620;
      b.classList.toggle('on', show);
      b.setAttribute('aria-hidden', show ? 'false' : 'true');
    }
    on(window, 'scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(upd);
    }, { passive: true });
    upd();
  }

  /* =====================================================================
     Coach mark  (⌘K / Ctrl K) — once per page, forever
     ===================================================================== */
  var COACH_KEY = 'shelf_coach_cmdk_' + (PAGE || 'page');

  function initCoach() {
    if (window.__shelfNoCoach) return;                       // opt-out for the orchestrator
    if (jget(localStorage, COACH_KEY, 0)) return;            // already seen
    var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
    var el = document.createElement('div');
    el.className = 'fx-coach';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div><div class="fx-coach-b">Jump straight to anything</div>' +
      '<span class="fx-coach-s">Press <kbd>' + (isMac ? '⌘' : 'Ctrl') + '</kbd><kbd>K</kbd> to search every shelf without lifting your hands.</span></div>' +
      '<button type="button" class="fx-tx" aria-label="Dismiss tip" title="Dismiss">' + svg('x') + '</button>';
    mount(el);

    var hideTimer;
    function seen() { jset(localStorage, COACH_KEY, 1); }
    function hide() { el.classList.remove('on'); clearTimeout(hideTimer); seen(); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400); }
    on(el.querySelector('.fx-tx'), 'click', hide);
    // Dismiss the moment the user actually uses the shortcut.
    on(document, 'keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) hide();
    });

    /* Never interrupt: if a dialog is genuinely on screen or the compare tray
       is docked, wait and try again. Crucially we do NOT burn the
       once-per-page flag while waiting — a tip the user never saw must not
       count as shown. (vocab.html, for instance, can have #overlay.show up
       at load time.) */
    function blocked() {
      if (document.body.classList.contains('fx-tray-open')) return true;
      var ovs = document.querySelectorAll('.overlay.show, .sh-ov.show, .fx-ov.show');
      for (var i = 0; i < ovs.length; i++) {
        var s;
        try { s = getComputedStyle(ovs[i]); } catch (e) { continue; }
        if (s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05) return true;
      }
      return false;
    }
    var attempts = 0;
    function tryShow() {
      if (!el.parentNode) return;
      attempts++;
      if (blocked()) {
        if (attempts < 4) setTimeout(tryShow, 2500);
        return;
      }
      el.classList.add('on');
      seen();                                                // shown once, counted once
      hideTimer = setTimeout(hide, 11000);
    }
    setTimeout(tryShow, 1500);
  }

  /* =====================================================================
     Boot
     ===================================================================== */
  function init() {
    buildTop();
    initCoach();

    // Sort/view memory is useful on any page that has those controls.
    restorePrefs();
    wirePrefs();

    if (SPEC) {
      hookRender();
      hookPasses();
      hookModal();

      buildChip();
      buildMore();
      buildTray();
      wireGridClicks();

      var grid = $('#grid');
      if (grid && window.MutationObserver) {
        // childList only: our own buttons live one level deeper (inside the
        // cover element), so this can never re-trigger itself.
        new MutationObserver(function () { scheduleAfterRender(); }).observe(grid, { childList: true });
      }
      wireRenderSignals();

      // Reset must also drop OUR filter. Capture phase, so our state is
      // already clean by the time the page's own handler re-renders.
      on($('#resetBtn'), 'click', function () {
        if (statusOnly) { statusOnly = false; updateChip(); }
      }, true);

      decorateAll();
      updateTray();
      updateZero();

      // site.js applies its hash state ~60ms in and re-renders; open after.
      setTimeout(function () { openFromHash(true); }, 260);
      on(window, 'hashchange', function () { openFromHash(false); });
    }

    window.ShelfFeatures = {
      version: '1.0.0',
      page: PAGE,
      /* deep links — the agreed key is "open" */
      linkFor: linkFor,
      openTitle: openTitle,
      openFromHash: function () { return openFromHash(true); },
      find: findItem,
      /* data out */
      exportCSV: function () { exportCSV(); },
      currentView: visibleList,
      /* compare */
      compare: {
        add: function (item) { if (item && !inCompare(item)) toggleCompare(item); },
        remove: function (item) { if (item && inCompare(item)) toggleCompare(item); },
        toggle: toggleCompare,
        clear: clearCompare,
        list: cmpItems,
        open: openCompare,
        max: CMP_MAX
      },
      /* played / read */
      status: {
        has: hasStatus,
        toggle: toggleStatus,
        keys: function () { return setToArray(statusSet); },
        filtering: function () { return statusOnly; },
        setFilter: setStatusOnly
      },
      /* let other modules run after every re-render */
      onAfterRender: function (fn) { if (typeof fn === 'function') afterHooks.push(fn); }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
