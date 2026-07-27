/* =====================================================================
   Shelf — Command palette  (⌘K / Ctrl K)

   Additive layer: it never touches page markup, page globals or existing
   handlers. Actions are performed by clicking the page's own controls
   (#surpriseBtn, #resetBtn, …) so behaviour can never drift out of sync
   with the pages themselves.

   Load order note: this file is deferred and runs AFTER each page's inline
   script and after site.js, so page data (GAMES / BOOKS) and window.Shelf
   are already present — but every single read of them is still guarded,
   because index.html and vocab.html have no dataset at all and a module
   may be missing entirely.

   Exports: window.ShelfPalette = { open, close, toggle, isOpen, reindex }
   ===================================================================== */
(function () {
  'use strict';

  if (window.ShelfPalette) return;                 // never double-install
  if (!document.body) return;                      // defensive; deferred => always false

  /* =================================================================== */
  /*  config                                                             */
  /* =================================================================== */

  var PAGE        = document.body.getAttribute('data-page') || '';
  var GROUP_CAP   = 6;      // rows shown per group (headers still show real totals)
  var DEBOUNCE    = 90;     // ms — input is debounced, empty input is instant
  var RECENT_KEY  = 'shelf_palette_recent';
  var RECENT_KEEP = 8;      // how many we persist
  var RECENT_SHOW = 5;      // how many we display

  var IS_MAC = /mac|iphone|ipad|ipod/i.test(
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform || navigator.userAgent || ''
  );
  var MOD_LABEL = IS_MAC ? '⌘K' : 'Ctrl K';   // ⌘K / Ctrl K

  /* =================================================================== */
  /*  icons — Lucide paths, inlined so the palette is standalone.        */
  /*  Shelf.icon() is preferred when site.js is present (identical set), */
  /*  these are the fallback plus the few icons site.js does not ship.   */
  /* =================================================================== */

  var LOCAL_ICONS = {
    'search'         : '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'gamepad-2'      : '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
    'book-open'      : '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    'notebook-pen'   : '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
    'library'        : '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    'dice-5'         : '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 8h.01"/><path d="M8 8h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/><path d="M12 12h.01"/>',
    'star'           : '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 20.99a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.774a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    'layout-grid'    : '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    'list'           : '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    'rotate-ccw'     : '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    'keyboard'       : '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    'user'           : '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'link-2'         : '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
    'graduation-cap' : '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    'download'       : '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    'upload'         : '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    'plus'           : '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'arrow-right'    : '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    /* not in site.js — palette-local */
    'sun-moon'       : '<path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
    'arrow-up'       : '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'
  };

  function svgWrap(path) {
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + path + '</svg>';
  }
  /* Prefer site.js's set (identical paths, one source of truth); fall back
     to the local copies so the palette still renders if site.js is absent. */
  function iconHTML(name) {
    if (!name) return '';
    var s = '';
    try { if (window.Shelf && typeof Shelf.icon === 'function') s = Shelf.icon(name) || ''; } catch (e) { s = ''; }
    if (!s) s = svgWrap(LOCAL_ICONS[name] || LOCAL_ICONS['arrow-right']);
    return s;
  }

  /* =================================================================== */
  /*  defensive access to page globals                                   */
  /*  GAMES/BOOKS are top-level `const` in an inline script: they live in */
  /*  the global lexical scope, NOT on window — hence typeof guards.      */
  /* =================================================================== */

  function getGames() {
    try { if (typeof GAMES !== 'undefined' && GAMES && GAMES.length) return GAMES; } catch (e) {}
    return (window.GAMES && window.GAMES.length) ? window.GAMES : [];
  }
  function getBooks() {
    try { if (typeof BOOKS !== 'undefined' && BOOKS && BOOKS.length) return BOOKS; } catch (e) {}
    return (window.BOOKS && window.BOOKS.length) ? window.BOOKS : [];
  }
  function getMovies() {
    try { if (typeof MOVIES !== 'undefined' && MOVIES && MOVIES.length) return MOVIES; } catch (e) {}
    return (window.MOVIES && window.MOVIES.length) ? window.MOVIES : [];
  }
  function getShows() {
    try { if (typeof SHOWS !== 'undefined' && SHOWS && SHOWS.length) return SHOWS; } catch (e) {}
    return (window.SHOWS && window.SHOWS.length) ? window.SHOWS : [];
  }
  function getOpenModal() {
    try { if (typeof openModal === 'function') return openModal; } catch (e) {}
    return (typeof window.openModal === 'function') ? window.openModal : null;
  }
  function byId(id) { return document.getElementById(id); }
  function clickEl(id) { var e = byId(id); if (e) { e.click(); return true; } return false; }
  function toast(msg, ok) {
    try { if (window.Shelf && typeof Shelf.toast === 'function') Shelf.toast(msg, !!ok); } catch (e) {}
  }
  function fire(el, types) {
    (types || ['input', 'change']).forEach(function (t) {
      try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {}
    });
  }

  /* =================================================================== */
  /*  fuzzy matcher                                                      */
  /*                                                                     */
  /*  Subsequence match with a two-pass placement (forward greedy to      */
  /*  prove a match and find its end, then a backward pass from that end  */
  /*  to pack the characters as tightly as possible), scored for prefix,  */
  /*  word-boundary and contiguity. A cheap 27-bit character bitmask      */
  /*  rejects ~95% of the 4,700 items before any string work happens.     */
  /* =================================================================== */

  var DIACRITICS = new RegExp("["+String.fromCharCode(0x300)+"-"+String.fromCharCode(0x36F)+"]", "g");

  /* Strip accents so "pokemon" finds "Pokémon". */
  function foldStr(s) {
    if (!s) return '';
    if (!String.prototype.normalize) return s;
    try { return s.normalize('NFD').replace(DIACRITICS, ''); } catch (e) { return s; }
  }

  /* Build the lowercase haystack for an item. Folding is only kept when it
     preserves length, so highlight offsets always map back 1:1 onto the
     original text we render. */
  function hayOf(raw) {
    var s = String(raw == null ? '' : raw);
    var low = s.toLowerCase();
    var f = foldStr(low);
    if (f.length === s.length) return f;
    return low;                     // exotic script: matching still works
  }

  /* 27-bit presence mask: a–z plus one bit for "contains a digit". */
  function maskOf(s) {
    var m = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 97 && c <= 122) m |= 1 << (c - 97);
      else if (c >= 48 && c <= 57) m |= 1 << 26;
    }
    return m;
  }

  function isAlnum(c) {
    return (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || (c >= 65 && c <= 90);
  }

  /* Score one placement. Rewards, in order of weight: word-start runs
     (acronyms such as "rdr" -> Red Dead Redemption), contiguity, prefixes
     and matches that begin early in a short field. */
  function scorePos(hay, end, pos) {
    var ql = pos.length, score = 0, prev = -2, streak = 0, allBoundary = true, i, p, c;
    for (i = 0; i < ql; i++) {
      p = pos[i];
      score += 16;                                        // base per matched char
      if (p === prev + 1) {                               // adjacency
        streak++;
        score += 12 + Math.min(streak, 4) * 4;
      } else {
        streak = 0;
        if (i > 0) score -= Math.min((p - prev - 1) * 4, 26);   // gap penalty
      }
      if (p === 0) score += 34;                           // very start of the field
      else {
        c = hay.charCodeAt(p - 1);
        if (!isAlnum(c)) score += 24;                     // start of a word
        else allBoundary = false;
      }
      prev = p;
    }
    /* every character landed on a word start => initialism */
    if (allBoundary && ql > 1) score += 14 * ql;
    score -= Math.min(pos[0] * 1.2, 24);                  // prefer early matches
    score -= Math.min(end, 70) * 0.18;                    // prefer short fields
    if (pos[ql - 1] - pos[0] === ql - 1) {                // fully contiguous
      score += 26;
      if (pos[0] === 0) score += 26;                      // prefix
      if (ql === end) score += 30;                        // exact
    }
    return score;
  }

  /* Placement A — greedy forward to prove the match and find its end, then
     a backward pass from that end to pack the characters as tightly as
     possible. Restricted to hay[0, end), starting no earlier than `start`. */
  function matchFrom(q, hay, end, start) {
    var ql = q.length, hi = start, i, idx;
    for (i = 0; i < ql; i++) {
      idx = hay.indexOf(q.charAt(i), hi);
      if (idx < 0 || idx >= end) return null;
      hi = idx + 1;
    }
    var pos = new Array(ql), h = hi - 1;
    for (i = ql - 1; i >= 0; i--) {
      idx = hay.lastIndexOf(q.charAt(i), h);
      if (idx < 0) return null;             // cannot happen, but stay safe
      pos[i] = idx;
      h = idx - 1;
    }
    return { score: scorePos(hay, end, pos), pos: pos };
  }

  /* Next occurrence of `ch` that sits on a word boundary, at or after `from`. */
  function nextBoundary(hay, ch, from, end) {
    var i = from;
    while (i < end) {
      var idx = hay.indexOf(ch, i);
      if (idx < 0 || idx >= end) return -1;
      if (idx === 0 || !isAlnum(hay.charCodeAt(idx - 1))) return idx;
      i = idx + 1;
    }
    return -1;
  }

  /* Placement B — take the next word-start occurrence of each character
     when one exists. Tight packing alone would match "rdr" inside
     "Re(d) Dea(d) (R)edemption"; this finds R-D-R instead. */
  function matchBoundaryFirst(q, hay, end) {
    var ql = q.length, pos = new Array(ql), hi = 0, i, b, p;
    for (i = 0; i < ql; i++) {
      p = hay.indexOf(q.charAt(i), hi);
      if (p < 0 || p >= end) return null;
      b = nextBoundary(hay, q.charAt(i), hi, end);
      pos[i] = b >= 0 ? b : p;
      hi = pos[i] + 1;
    }
    return { score: scorePos(hay, end, pos), pos: pos };
  }

  /* Best of several placements: tight-packed, word-start-first, and up to
     three tight placements restarted at later word boundaries — so "ring"
     prefers "Elden Ring" over "bRINGing". */
  function bestMatch(q, hay, end) {
    var best = matchFrom(q, hay, end, 0);
    if (!best) return null;                 // no subsequence at all
    var r = matchBoundaryFirst(q, hay, end);
    if (r && r.score > best.score) best = r;
    var start = 0, tries = 0;
    while (tries < 3) {
      var nx = nextBoundary(hay, q.charAt(0), start + 1, end);
      if (nx < 0) break;
      r = matchFrom(q, hay, end, nx);
      if (!r) break;
      if (r.score > best.score) best = r;
      start = nx;
      tries++;
    }
    return best;
  }

  /* Title first (clean highlights), whole haystack second at a penalty. */
  function matchItem(q, it) {
    var r = bestMatch(q, it.hay, it.tl);
    if (r) { r.score += it.pop * 14; return r; }
    r = bestMatch(q, it.hay, it.hay.length);
    if (r) { r.score = r.score * 0.62 + it.pop * 14; return r; }
    return null;
  }

  /* A plain subsequence match is very permissive — "zelda" is a subsequence
     of dozens of unrelated titles. Anything that does not average a decent
     score per query character is noise, so it is dropped entirely rather
     than padding the list with junk. Short queries are exempt: with one or
     two characters there is nothing to be confident about. */
  function scoreFloor(ql) { return ql <= 2 ? 0 : 22 * ql; }

  /* Keep only the best `cap` hits, but count every hit for the header. */
  function rank(items, q, qmask, cap) {
    var best = [], total = 0, floor = scoreFloor(q.length), i, it, r, j;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if ((qmask & ~it.mask) !== 0) continue;          // bitmask prefilter
      r = matchItem(q, it);
      if (!r || r.score < floor) continue;
      total++;
      if (best.length < cap) {
        best.push({ it: it, score: r.score, pos: r.pos });
      } else if (r.score > best[best.length - 1].score) {
        best[best.length - 1] = { it: it, score: r.score, pos: r.pos };
      } else {
        continue;
      }
      /* insertion-sort the tail upward — cheaper than sorting thousands */
      for (j = best.length - 1; j > 0 && best[j].score > best[j - 1].score; j--) {
        var t = best[j]; best[j] = best[j - 1]; best[j - 1] = t;
      }
    }
    return { hits: best, total: total };
  }

  /* =================================================================== */
  /*  item index (built lazily on first open, then cached)               */
  /* =================================================================== */

  var INDEX = null;

  function mkDataItem(kind, label, sub, obj, pop, right, icon, rid) {
    var raw = sub ? (label + ' ' + sub) : label;
    return {
      kind: kind, label: label, sub: sub, obj: obj, right: right || '',
      icon: icon, pop: pop, rid: rid,
      hay: hayOf(raw), tl: String(label).length, mask: 0
    };
  }

  function trimNum(n) {
    var v = Math.round(n * 100) / 100;
    return String(v);
  }

  function buildIndex() {
    var games = [], books = [], movies = [], shows = [], i, o, sub, item;

    var G = getGames();
    for (i = 0; i < G.length; i++) {
      o = G[i];
      if (!o || !o.title) continue;
      sub = [o.genre, o.year].filter(Boolean).join(' · ');
      item = mkDataItem(
        'game', String(o.title), sub, o,
        Math.max(0, Math.min(1, (+o.metacritic || 0) / 100)),
        (o.metacritic != null ? String(o.metacritic) : ''),
        'gamepad-2', String(o.title) + '|' + (o.year == null ? '' : o.year)
      );
      item.mask = maskOf(item.hay);
      games.push(item);
    }

    var B = getBooks();
    for (i = 0; i < B.length; i++) {
      o = B[i];
      if (!o || !o.title) continue;
      sub = [o.author, o.genre, o.year].filter(Boolean).join(' · ');
      item = mkDataItem(
        'book', String(o.title), sub, o,
        Math.max(0, Math.min(1, (+o.rating || 0) / 5)),
        (o.rating != null ? '★ ' + trimNum(+o.rating) : ''),
        'book-open', String(o.title) + '|' + (o.author || '')
      );
      item.mask = maskOf(item.hay);
      books.push(item);
    }

    /* Films and series carry three possible scores; rank on whichever exists so
       a title with only an IMDb rating is still ordered sensibly. */
    var best = function (o) {
      return o.metacritic != null ? o.metacritic
           : o.imdb != null ? Math.round(o.imdb * 10)
           : o.rt != null ? o.rt : 0;
    };
    var M = getMovies();
    for (i = 0; i < M.length; i++) {
      o = M[i];
      if (!o || !o.title) continue;
      sub = [o.creator, o.genre, o.year].filter(Boolean).join(' · ');
      item = mkDataItem(
        'movie', String(o.title), sub, o,
        Math.max(0, Math.min(1, best(o) / 100)),
        (o.metacritic != null ? String(o.metacritic) : (o.imdb != null ? '★ ' + trimNum(+o.imdb) : '')),
        'clapperboard', String(o.title) + '|' + (o.year == null ? '' : o.year)
      );
      item.mask = maskOf(item.hay);
      movies.push(item);
    }
    var S = getShows();
    for (i = 0; i < S.length; i++) {
      o = S[i];
      if (!o || !o.title) continue;
      sub = [o.creator, o.genre, o.year].filter(Boolean).join(' · ');
      item = mkDataItem(
        'show', String(o.title), sub, o,
        Math.max(0, Math.min(1, best(o) / 100)),
        (o.metacritic != null ? String(o.metacritic) : (o.imdb != null ? '★ ' + trimNum(+o.imdb) : '')),
        'tv', String(o.title) + '|' + (o.year == null ? '' : o.year)
      );
      item.mask = maskOf(item.hay);
      shows.push(item);
    }

    INDEX = { games: games, books: books, movies: movies, shows: shows };
    return INDEX;
  }
  function ensureIndex() { return INDEX || buildIndex(); }

  /* =================================================================== */
  /*  actions                                                            */
  /*                                                                     */
  /*  Each action is only added when the control it drives exists on the  */
  /*  current page, so a dead entry can never be shown, and it runs by    */
  /*  clicking that control rather than reimplementing its behaviour.     */
  /* =================================================================== */

  function gridIsList() {
    var g = byId('grid');
    return !!(g && g.classList.contains('list'));
  }

  /* A theme module may or may not exist. Prefer its API, then its button,
     then fall back to a documented, forward-compatible attribute flip. */
  function themeTarget() {
    try {
      if (window.ShelfTheme && typeof window.ShelfTheme.toggle === 'function') return 'api';
    } catch (e) {}
    if (byId('shTheme') || document.querySelector('[data-shelf-theme-toggle]')) return 'btn';
    return null;
  }
  function runTheme() {
    var t = themeTarget();
    if (t === 'api') { try { window.ShelfTheme.toggle(); return; } catch (e) {} }
    if (t === 'btn') {
      var b = byId('shTheme') || document.querySelector('[data-shelf-theme-toggle]');
      if (b) { b.click(); return; }
    }
    var root = document.documentElement;
    var cur = root.getAttribute('data-theme');
    if (!cur) {
      cur = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    var next = cur === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    root.classList.toggle('shelf-light', next === 'light');
    try { localStorage.setItem('shelf_theme', next); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('shelf:theme', { detail: { theme: next } })); } catch (e) {}
    toast(next === 'light' ? 'Light appearance' : 'Dark appearance', true);
  }

  var PAGE_LINKS = [
    { id: 'go-home',  href: 'index.html', label: 'Home',  page: 'home',  icon: 'library',       sub: 'Shelf overview',            kw: 'index start front' },
    { id: 'go-games', href: 'games.html', label: 'Games', page: 'games', icon: 'gamepad-2',     sub: 'Browse the game index',     kw: 'pc metacritic ign steam play' },
    { id: 'go-books', href: 'books.html', label: 'Books', page: 'books', icon: 'book-open',     sub: 'Browse the book shelf',     kw: 'read author goodreads library' },
    { id: 'go-movies', href: 'movies.html', label: 'Films', page: 'movies', icon: 'clapperboard', sub: 'Browse the film index',    kw: 'movie cinema imdb rotten tomatoes watch' },
    { id: 'go-shows', href: 'shows.html', label: 'Series', page: 'shows', icon: 'tv',            sub: 'Browse the series index',  kw: 'tv show television binge episodes' },
    { id: 'go-vocab', href: 'vocab.html', label: 'Words', page: 'vocab', icon: 'notebook-pen',  sub: 'Your vocabulary vault',     kw: 'vocabulary vocab dictionary study' }
  ];

  /* Built fresh on every search so labels track live page state
     (grid/list, favourites on/off, signed in or not). ~14 entries. */
  function buildActions() {
    var actions = [], nav = [];

    function add(a) { (a.group === 'nav' ? nav : actions).push(a); }

    /* --- page controls ------------------------------------------------ */
    if (byId('search')) {
      add({
        id: 'focus-search', label: 'Focus search', icon: 'search', w: .9, takesFocus: true,
        sub: PAGE === 'vocab' ? 'Filter your words' : 'Filter what is on this page',
        kw: 'find filter type query',
        run: function () { var s = byId('search'); if (s) { s.focus(); if (s.select) s.select(); } }
      });
    }
    if (byId('gridBtn') && byId('listBtn')) {
      var toList = !gridIsList();
      add({
        id: 'toggle-view', label: toList ? 'Switch to list view' : 'Switch to grid view',
        icon: toList ? 'list' : 'layout-grid', w: .75,
        sub: 'Change how results are laid out', kw: 'grid list layout view compact cards',
        run: function () { clickEl(gridIsList() ? 'gridBtn' : 'listBtn'); }
      });
    }
    if (byId('surpriseBtn')) {
      add({
        id: 'surprise', label: 'Surprise me', icon: 'dice-5', w: .8,
        sub: 'Jump to a random highly-rated pick', kw: 'random shuffle roll lucky dice',
        run: function () { clickEl('surpriseBtn'); }
      });
    }
    if (byId('favBtn')) {
      var favOn = byId('favBtn').classList.contains('on');
      add({
        id: 'toggle-favs', label: favOn ? 'Show everything' : 'Show favourites only',
        icon: 'star', w: .7, sub: favOn ? 'Clear the favourites filter' : 'Filter down to your saved items',
        kw: 'favorites favourites saved starred shelf',
        run: function () { clickEl('favBtn'); }
      });
    }
    if (byId('resetBtn')) {
      add({
        id: 'reset', label: 'Reset filters', icon: 'rotate-ccw', w: .65,
        sub: 'Clear search, genres, scores and years', kw: 'clear all default start over',
        run: function () { clickEl('resetBtn'); }
      });
    }

    /* --- vocab-only --------------------------------------------------- */
    if (byId('studyBtn')) {
      add({
        id: 'study', label: 'Start a study session', icon: 'graduation-cap', w: .85,
        sub: 'Flashcards from your vault', kw: 'flashcards revise practice quiz learn',
        run: function () { clickEl('studyBtn'); }
      });
    }
    if (byId('wordIn')) {
      add({
        id: 'add-word', label: 'Add a word', icon: 'plus', w: .8, takesFocus: true,
        sub: 'Save a new entry to your vault', kw: 'new create vocabulary entry',
        run: function () { var i = byId('wordIn'); if (i) { i.focus(); if (i.select) i.select(); } }
      });
    }
    if (byId('exportBtn')) {
      add({
        id: 'export', label: 'Export words', icon: 'download', w: .5,
        sub: 'Download your vault as JSON', kw: 'backup save download json',
        run: function () { clickEl('exportBtn'); }
      });
    }
    if (byId('importBtn')) {
      add({
        id: 'import', label: 'Import words', icon: 'upload', w: .45,
        sub: 'Restore a vault from a JSON file', kw: 'restore upload load json',
        run: function () { clickEl('importBtn'); }
      });
    }

    /* --- shared chrome ------------------------------------------------ */
    add({
      id: 'theme', label: 'Toggle theme', icon: 'sun-moon', w: .6,
      sub: 'Switch between light and dark', kw: 'dark light mode appearance colour color',
      run: runTheme
    });
    if (byId('shShare')) {
      add({
        id: 'share', label: 'Share this view', icon: 'link-2', w: .55,
        sub: 'Copy a link that reopens these exact filters', kw: 'copy url link permalink send',
        run: function () { clickEl('shShare'); }
      });
    }
    if (byId('shHelp')) {
      add({
        id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', w: .5,
        sub: 'Everything you can do without a mouse', kw: 'help keys hotkeys bindings',
        run: function () { clickEl('shHelp'); }
      });
    }
    (function () {
      var signedIn = false, who = '';
      try {
        if (window.Shelf && typeof Shelf.profile === 'function') {
          var p = Shelf.profile();
          if (p && p.name) { signedIn = true; who = p.name; }
        }
      } catch (e) {}
      add({
        id: 'account', label: signedIn ? 'Your profile' : 'Sign in', icon: 'user', w: .45,
        sub: signedIn ? ('Signed in as ' + who) : 'Optional — everything works as a guest',
        kw: 'account login profile curator name register',
        run: function () {
          try {
            if (window.Shelf && typeof Shelf.openAuth === 'function') { Shelf.openAuth(); return; }
          } catch (e) {}
          clickEl('shAcct');
        }
      });
    })();
    add({
      id: 'top', label: 'Back to top', icon: 'arrow-up', w: .3,
      sub: 'Scroll to the top of the page', kw: 'scroll up start beginning',
      run: function () {
        var smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        try { window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' }); }
        catch (e) { window.scrollTo(0, 0); }
      }
    });

    /* --- navigation --------------------------------------------------- */
    PAGE_LINKS.forEach(function (l) {
      if (l.page === PAGE) return;                    // never "go to" where we are
      add({
        group: 'nav', id: l.id, label: l.label, icon: l.icon, sub: l.sub, kw: l.kw, w: .5,
        run: function () { location.href = l.href; }
      });
    });

    return { actions: actions.map(actionItem), nav: nav.map(actionItem) };
  }

  function actionItem(a) {
    var sub = a.sub || '';
    var raw = a.label + (sub ? ' ' + sub : '') + (a.kw ? ' ' + a.kw : '');
    var it = {
      kind: a.group === 'nav' ? 'nav' : 'action',
      action: a, label: a.label, sub: sub, icon: a.icon, right: '',
      pop: (a.w == null ? .5 : a.w),
      hay: hayOf(raw), tl: String(a.label).length, mask: 0, rid: a.id
    };
    it.mask = maskOf(it.hay);
    return it;
  }

  /* Synthetic "search elsewhere" entries: on pages where a dataset is not
     loaded we can still hand the query over via the hash format that
     site.js already understands (#search=…). */
  function crossSearchItems(qRaw) {
    var out = [];
    if (!qRaw) return out;
    var targets = [
      { page: 'games', href: 'games.html', label: 'Games', has: function () { return getGames().length > 0; } },
      { page: 'books', href: 'books.html', label: 'Books', has: function () { return getBooks().length > 0; } },
      { page: 'movies', href: 'movies.html', label: 'Films', has: function () { return getMovies().length > 0; } },
      { page: 'shows', href: 'shows.html', label: 'Series', has: function () { return getShows().length > 0; } },
      { page: 'vocab', href: 'vocab.html', label: 'Words', has: function () { return PAGE === 'vocab'; } }
    ];
    targets.forEach(function (t) {
      if (t.page === PAGE || t.has()) return;         // searchable right here already
      var it = actionItem({
        group: 'nav', id: 'xs-' + t.page,
        label: 'Search “' + qRaw + '” in ' + t.label,
        sub: 'Opens ' + t.label + ' filtered to this term',
        icon: 'search', w: .4,
        run: function () { location.href = t.href + '#search=' + encodeURIComponent(qRaw); }
      });
      it.always = true;                                // never filtered out
      out.push(it);
    });
    return out;
  }

  function findActionById(id) {
    var A = buildActions(), i;
    for (i = 0; i < A.actions.length; i++) if (A.actions[i].rid === id) return A.actions[i];
    for (i = 0; i < A.nav.length; i++) if (A.nav[i].rid === id) return A.nav[i];
    return null;
  }

  /* =================================================================== */
  /*  recents                                                            */
  /* =================================================================== */

  function readRecent() {
    try {
      var a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (e) { return e && e.k && e.id; }) : [];
    } catch (e) { return []; }
  }
  function writeRecent(a) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, RECENT_KEEP))); } catch (e) {}
  }
  function pushRecent(entry) {
    var a = readRecent().filter(function (e) { return !(e.k === entry.k && e.id === entry.id); });
    a.unshift(entry);
    writeRecent(a);
  }

  /* Re-hydrate a stored entry against the current page's data so that a
     recent game opens its modal directly when we happen to be on games. */
  function resolveRecent(e) {
    var list = e.k === 'game' ? getGames() : e.k === 'book' ? getBooks() : null;
    if (!list || !list.length) return null;
    var t = String(e.t || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (String(o.title).toLowerCase() !== t) continue;
      if (e.k === 'game' && e.y != null && o.year != null && String(o.year) !== String(e.y)) continue;
      if (e.k === 'book' && e.a && o.author && String(o.author) !== String(e.a)) continue;
      return o;
    }
    return null;
  }

  function recentItems() {
    var raw = readRecent(), out = [], i;
    for (i = 0; i < raw.length && out.length < RECENT_SHOW; i++) {
      var e = raw[i];
      if (e.k === 'game' || e.k === 'book') {
        var obj = resolveRecent(e);
        var it = mkDataItem(
          e.k, String(e.t || ''), String(e.s || ''), obj, 0,
          e.k === 'game'
            ? (obj && obj.metacritic != null ? String(obj.metacritic) : '')
            : (obj && obj.rating != null ? '★ ' + trimNum(+obj.rating) : ''),
          e.k === 'game' ? 'gamepad-2' : 'book-open',
          e.id
        );
        it.recent = e;
        out.push(it);
      } else {
        var a = findActionById(e.id);
        if (a) out.push(a);
      }
    }
    return out;
  }

  /* =================================================================== */
  /*  search                                                             */
  /* =================================================================== */

  function normQuery(s) {
    return foldStr(String(s == null ? '' : s).toLowerCase())
      .replace(/\s+/g, ' ')
      .replace(/^ +| +$/g, '');
  }

  function computeResults(rawInput) {
    var display = String(rawInput == null ? '' : rawInput).replace(/\s+/g, ' ').replace(/^ +| +$/g, '');
    var q = normQuery(rawInput);
    var groups = [];

    if (!q) {
      var rec = recentItems();
      if (rec.length) groups.push({ key: 'recent', label: 'Recent', items: rec, total: rec.length });
      var A0 = buildActions();
      if (A0.actions.length) {
        groups.push({ key: 'actions', label: 'Actions', items: A0.actions.slice(0, GROUP_CAP), total: A0.actions.length });
      }
      if (A0.nav.length) {
        groups.push({ key: 'nav', label: 'Navigation', items: A0.nav.slice(0, GROUP_CAP), total: A0.nav.length });
      }
      return { groups: groups, q: '', display: '' };
    }

    var qm = maskOf(q);
    var A = buildActions();
    var idx = ensureIndex();

    function pack(key, label, pool, cap) {
      var r = rank(pool, q, qm, cap);
      if (!r.hits.length) return;
      groups.push({
        key: key, label: label, total: r.total,
        items: r.hits.map(function (h) { var o = Object.create(h.it); o.pos = h.pos; return o; })
      });
    }

    pack('actions', 'Actions', A.actions, GROUP_CAP);
    pack('games', 'Games', idx.games, GROUP_CAP);
    pack('books', 'Books', idx.books, GROUP_CAP);
    pack('movies', 'Films', idx.movies, GROUP_CAP);
    pack('shows', 'Series', idx.shows, GROUP_CAP);

    /* Navigation = matched nav entries + always-on cross-page search */
    var navRanked = rank(A.nav, q, qm, GROUP_CAP);
    var navItems = navRanked.hits.map(function (h) { var o = Object.create(h.it); o.pos = h.pos; return o; });
    var cross = crossSearchItems(display);
    /* nothing on this page matched — the only rows are hand-offs to another
       page, so say so rather than letting them look like real results */
    var noLocal = groups.length === 0 && navItems.length === 0 && cross.length > 0;
    var navAll = navItems.concat(cross);
    if (navAll.length) {
      groups.push({
        key: 'nav', label: 'Navigation',
        items: navAll.slice(0, GROUP_CAP),
        total: navRanked.total + cross.length
      });
    }

    return { groups: groups, q: q, display: display, noLocal: noLocal };
  }

  /* =================================================================== */
  /*  DOM                                                                */
  /* =================================================================== */

  var ov = null, input = null, listEl = null, countEl = null;
  var flat = [], groupStarts = [], sel = 0, isOpen = false;
  var lastFocus = null, debTimer = 0, padSaved = '', mouseArmed = false, downOnBackdrop = false;
  var searchPending = false;   // true only while a debounced search is queued

  function elem(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function build() {
    if (ov) return ov;

    ov = elem('div', 'shp-ov');
    ov.id = 'shPaletteOv';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Command palette');
    ov.setAttribute('aria-hidden', 'true');

    var panel = elem('div', 'shp-panel');

    var top = elem('div', 'shp-top');
    var si = elem('span', 'shp-si');
    si.innerHTML = iconHTML('search');
    input = document.createElement('input');
    input.className = 'shp-input';
    input.id = 'shpInput';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('enterkeyhint', 'go');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'shpList');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-label', 'Search Shelf');
    input.placeholder = placeholderFor();
    var esc = elem('button', 'shp-esc', 'Esc');
    esc.type = 'button';
    esc.setAttribute('aria-label', 'Close command palette');
    top.appendChild(si); top.appendChild(input); top.appendChild(esc);

    listEl = elem('div', 'shp-results');
    listEl.id = 'shpList';
    listEl.setAttribute('role', 'listbox');
    listEl.setAttribute('aria-label', 'Results');

    var foot = elem('div', 'shp-foot');
    var hints = elem('div', 'shp-hints');
    [
      ['↑↓', 'navigate'],
      ['↵', 'open'],
      ['Tab', 'group'],
      ['Esc', 'close']
    ].forEach(function (h) {
      var w = elem('span', 'shp-hint');
      w.appendChild(elem('kbd', 'shp-k', h[0]));
      w.appendChild(elem('span', null, h[1]));
      hints.appendChild(w);
    });
    countEl = elem('span', 'shp-count', '');
    foot.appendChild(hints); foot.appendChild(countEl);

    panel.appendChild(top); panel.appendChild(listEl); panel.appendChild(foot);
    ov.appendChild(panel);
    document.body.appendChild(ov);

    /* --- wiring --- */
    esc.addEventListener('click', function () { close(); });

    input.addEventListener('input', scheduleSearch);

    ov.addEventListener('mousedown', function (e) { downOnBackdrop = (e.target === ov); });
    ov.addEventListener('click', function (e) {
      if (e.target === ov && downOnBackdrop) close();
      downOnBackdrop = false;
    });

    /* mousemove (not mouseover) so a re-render under a still cursor
       never yanks the selection away from the keyboard user */
    listEl.addEventListener('mousemove', function (e) {
      if (!mouseArmed) { mouseArmed = true; return; }
      var row = e.target && e.target.closest ? e.target.closest('.shp-row') : null;
      if (!row) return;
      var i = +row.getAttribute('data-i');
      if (i === sel || isNaN(i)) return;
      setSel(i, false);
    });
    listEl.addEventListener('click', function (e) {
      var row = e.target && e.target.closest ? e.target.closest('.shp-row') : null;
      if (!row) return;
      var i = +row.getAttribute('data-i');
      if (isNaN(i)) return;
      setSel(i, false);
      runSelected();
    });

    return ov;
  }

  function placeholderFor() {
    if (PAGE === 'games') return 'Search games, actions, pages…';
    if (PAGE === 'books') return 'Search books, actions, pages…';
    if (PAGE === 'vocab') return 'Search actions and pages…';
    return 'Search games, books, actions…';
  }

  /* Build a fragment of `text` with the matched characters wrapped in
     <mark>. `from`/`to` map the rendered string onto the haystack. */
  function highlight(text, pos, from, to) {
    var frag = document.createDocumentFragment();
    var s = String(text == null ? '' : text);
    if (!s) return frag;
    var rel = [], i, p;
    if (pos && pos.length) {
      for (i = 0; i < pos.length; i++) {
        p = pos[i] - from;
        if (p >= 0 && p < (to - from) && p < s.length) rel.push(p);
      }
    }
    if (!rel.length) { frag.appendChild(document.createTextNode(s)); return frag; }

    var idx = 0, k = 0;
    while (idx < s.length) {
      if (k < rel.length && rel[k] === idx) {
        var st = idx;
        while (k < rel.length && rel[k] === idx) { idx++; k++; }
        var m = document.createElement('mark');
        m.textContent = s.slice(st, idx);
        frag.appendChild(m);
      } else {
        var st2 = idx;
        while (idx < s.length && !(k < rel.length && rel[k] === idx)) idx++;
        frag.appendChild(document.createTextNode(s.slice(st2, idx)));
      }
    }
    return frag;
  }

  function rowNode(it, i) {
    var row = elem('div', 'shp-row');
    row.setAttribute('role', 'option');
    row.setAttribute('data-i', String(i));
    row.id = 'shp-o-' + i;
    row.setAttribute('aria-selected', 'false');

    var ic = elem('span', 'shp-ic');
    ic.innerHTML = iconHTML(it.icon || (it.kind === 'game' ? 'gamepad-2' : it.kind === 'book' ? 'book-open' : 'arrow-right'));
    row.appendChild(ic);

    var txt = elem('span', 'shp-txt');
    var lbl = elem('span', 'shp-lbl');
    lbl.appendChild(highlight(it.label, it.pos, 0, it.tl));
    txt.appendChild(lbl);
    if (it.sub) {
      var sub = elem('span', 'shp-sub');
      sub.appendChild(highlight(it.sub, it.pos, it.tl + 1, it.tl + 1 + String(it.sub).length));
      txt.appendChild(sub);
    }
    row.appendChild(txt);

    if (it.right) row.appendChild(elem('span', 'shp-meta', it.right));
    row.appendChild(elem('span', 'shp-go', '↵'));
    return row;
  }

  function renderResults(res) {
    listEl.innerHTML = '';
    flat = [];
    groupStarts = [];

    if (!res.groups.length) {
      var empty = elem('div', 'shp-empty');
      var eic = elem('div', 'shp-eic');
      eic.innerHTML = iconHTML('search');
      empty.appendChild(eic);
      empty.appendChild(elem('div', 'shp-et', res.display ? 'No matches for “' + res.display + '”' : 'Nothing to show'));
      empty.appendChild(elem('div', 'shp-es', hasData()
        ? 'Try fewer characters, a genre, an author or a year.'
        : 'Games and books are searchable from their own pages — press Esc, then pick one from the nav.'));
      listEl.appendChild(empty);
      countEl.textContent = '';
      input.removeAttribute('aria-activedescendant');
      sel = -1;
      return;
    }

    if (res.noLocal) {
      var note = elem('div', 'shp-note');
      note.appendChild(elem('span', null, 'No matches for '));
      note.appendChild(elem('b', null, '“' + res.display + '”'));
      note.appendChild(elem('span', null, ' here — try another page:'));
      listEl.appendChild(note);
    }

    var total = 0;
    res.groups.forEach(function (g) {
      var wrap = elem('div', 'shp-group');
      var head = elem('div', 'shp-gh');
      head.appendChild(elem('span', 'shp-gt', g.label));
      var n = g.total > g.items.length
        ? (g.items.length + ' of ' + g.total.toLocaleString())
        : String(g.total);
      head.appendChild(elem('span', 'shp-n', n));
      wrap.appendChild(head);

      var rows = elem('div', 'shp-rows');
      groupStarts.push(flat.length);
      g.items.forEach(function (it) {
        var i = flat.length;
        flat.push(it);
        rows.appendChild(rowNode(it, i));
      });
      wrap.appendChild(rows);
      listEl.appendChild(wrap);
      total += g.total;
    });

    countEl.textContent = total === 1 ? '1 result' : total.toLocaleString() + ' results';
    setSel(0, true);
  }

  function hasData() { return getGames().length > 0 || getBooks().length > 0; }

  function setSel(i, scroll) {
    if (!flat.length) { sel = -1; return; }
    if (i < 0) i = 0;
    if (i > flat.length - 1) i = flat.length - 1;
    var prev = listEl.querySelector('.shp-row.is-sel');
    if (prev) { prev.classList.remove('is-sel'); prev.setAttribute('aria-selected', 'false'); }
    sel = i;
    var row = listEl.querySelector('.shp-row[data-i="' + i + '"]');
    if (!row) return;
    row.classList.add('is-sel');
    row.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', row.id);
    if (scroll !== false) {
      try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { row.scrollIntoView(false); }
    }
  }

  function move(delta) {
    if (!flat.length) return;
    var n = flat.length;
    var i = sel < 0 ? 0 : (sel + delta) % n;
    if (i < 0) i += n;
    /* page-jumps clamp instead of wrapping, single steps wrap */
    if (Math.abs(delta) > 1) i = Math.max(0, Math.min(n - 1, sel + delta));
    setSel(i, true);
  }

  function cycleGroup(dir) {
    if (!groupStarts.length) return;
    var cur = 0, i;
    for (i = 0; i < groupStarts.length; i++) if (groupStarts[i] <= sel) cur = i;
    var next = (cur + dir) % groupStarts.length;
    if (next < 0) next += groupStarts.length;
    setSel(groupStarts[next], true);
  }

  /* =================================================================== */
  /*  running a result                                                   */
  /* =================================================================== */

  function runSelected() {
    if (sel < 0 || sel >= flat.length) return;
    var it = flat[sel];
    var takesFocus = !!(it.action && it.action.takesFocus);
    close({ restore: !takesFocus });
    /* Defer by a task so the overlay is gone first: focus moves and page
       scrolling then behave exactly as if the user had clicked the control
       themselves. A timeout rather than rAF — rAF does not fire in a
       backgrounded or non-compositing tab, which would strand the action. */
    setTimeout(function () {
      try { execute(it); }
      catch (err) {
        if (window.console && console.error) console.error('[ShelfPalette] action failed:', err);
      }
    }, 0);
  }

  function execute(it) {
    if (it.kind === 'action' || it.kind === 'nav') {
      if (it.action && !it.always) {
        pushRecent({ k: it.kind, id: it.action.id, t: it.label, s: it.sub });
      }
      if (it.action && typeof it.action.run === 'function') it.action.run();
      return;
    }

    var target = it.kind === 'game' ? 'games' : 'books';
    var obj = it.obj || null;
    pushRecent({
      k: it.kind,
      id: it.rid || it.label,
      t: it.label,
      s: it.sub,
      y: obj ? obj.year : (it.recent ? it.recent.y : undefined),
      a: obj ? obj.author : (it.recent ? it.recent.a : undefined)
    });

    if (PAGE === target) {
      if (!obj) obj = resolveRecent({ k: it.kind, t: it.label, y: it.recent && it.recent.y, a: it.recent && it.recent.a });
      var om = getOpenModal();
      if (om && obj) { om(obj); return; }
      /* modal unavailable: degrade to filtering the page to that title */
      var s = byId('search');
      if (s) { s.value = it.label; fire(s); toast('Filtered to “' + it.label + '”'); return; }
    }
    location.href = target + '.html#open=' + encodeURIComponent(it.label);
  }

  /* =================================================================== */
  /*  open / close                                                       */
  /* =================================================================== */

  function lockScroll(on) {
    var root = document.documentElement;
    if (on) {
      var sw = window.innerWidth - root.clientWidth;
      padSaved = document.body.style.paddingRight;
      if (sw > 0) {
        var cur = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
        document.body.style.paddingRight = (cur + sw) + 'px';
      }
      root.classList.add('shp-lock');
    } else {
      root.classList.remove('shp-lock');
      document.body.style.paddingRight = padSaved;
      padSaved = '';
    }
  }

  function open(prefill) {
    build();
    if (isOpen) { input.focus(); if (input.select) input.select(); return; }
    lastFocus = (document.activeElement && document.activeElement !== document.body) ? document.activeElement : null;
    isOpen = true;
    mouseArmed = false;
    lockScroll(true);
    ov.classList.add('shp-open');
    ov.setAttribute('aria-hidden', 'false');
    input.placeholder = placeholderFor();
    input.value = (typeof prefill === 'string') ? prefill : '';
    runSearch();
    /* focus after the class flip so the entrance transition actually runs
       (and so iOS raises the keyboard against a laid-out element) */
    setTimeout(function () {
      if (!isOpen) return;
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      if (input.select) input.select();
    }, 16);
  }

  function close(opts) {
    if (!isOpen || !ov) return;
    isOpen = false;
    clearTimeout(debTimer);
    ov.classList.remove('shp-open');
    ov.setAttribute('aria-hidden', 'true');
    lockScroll(false);
    input.value = '';
    input.removeAttribute('aria-activedescendant');
    try { input.blur(); } catch (e) {}
    if (!opts || opts.restore !== false) {
      try {
        if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
      } catch (e) {}
    }
    lastFocus = null;
  }

  function toggle() { isOpen ? close() : open(); }

  /* =================================================================== */
  /*  input handling                                                     */
  /* =================================================================== */

  function scheduleSearch() {
    clearTimeout(debTimer);
    if (!input.value || !input.value.trim()) { runSearch(); return; }   // instant when cleared
    searchPending = true;
    debTimer = setTimeout(runSearch, DEBOUNCE);
  }
  function runSearch() {
    clearTimeout(debTimer);
    searchPending = false;
    if (!ov) return;
    renderResults(computeResults(input.value));
  }

  /* Single capture-phase listener on document:
     - it is the earliest place we can intercept ⌘K / Ctrl K
     - while the palette is open it stops propagation, so page-level
       hotkeys (/, g, l, r, ?, Esc) never fire underneath us. Stopping
       propagation does not suppress the default text-insertion, so typing
       keeps working normally. */
  function onKeyCapture(e) {
    if (!e || e.defaultPrevented) return;
    var k = e.key;
    if (!k) return;

    if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === 'k' || k === 'K')) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }
    if (!isOpen) return;
    if (e.isComposing || e.keyCode === 229) return;      // IME in progress

    var inside = ov && ov.contains(e.target);

    /* emacs-style navigation, common in palettes */
    if (e.ctrlKey && !e.metaKey && !e.altKey && (k === 'n' || k === 'p' || k === 'N' || k === 'P')) {
      e.preventDefault(); e.stopPropagation();
      move((k === 'n' || k === 'N') ? 1 : -1);
      return;
    }

    switch (k) {
      case 'Escape':
        e.preventDefault(); e.stopPropagation(); close(); return;
      case 'ArrowDown':
        e.preventDefault(); e.stopPropagation(); move(1); return;
      case 'ArrowUp':
        e.preventDefault(); e.stopPropagation(); move(-1); return;
      case 'PageDown':
        e.preventDefault(); e.stopPropagation(); move(5); return;
      case 'PageUp':
        e.preventDefault(); e.stopPropagation(); move(-5); return;
      case 'Tab':
        e.preventDefault(); e.stopPropagation(); cycleGroup(e.shiftKey ? -1 : 1); return;
      case 'Enter':
        if (e.metaKey || e.ctrlKey || e.altKey) break;
        e.preventDefault(); e.stopPropagation();
        /* Only flush a debounce that is genuinely still queued — an
           unconditional re-render here would reset the selection and open
           the wrong row for anyone who had arrowed down first. */
        if (searchPending) runSearch();
        runSelected();
        return;
    }

    if (inside) e.stopPropagation();                     // shield the page's hotkeys
  }

  /* =================================================================== */
  /*  nav button + help row                                              */
  /* =================================================================== */

  function mountNavButton() {
    if (byId('shPaletteBtn')) return true;
    var right = document.querySelector('.sitenav .sn-right');
    if (!right) return false;
    var b = document.createElement('button');
    b.id = 'shPaletteBtn';
    b.type = 'button';
    b.className = 'sn-btn shp-navbtn';
    b.title = 'Search everything (' + MOD_LABEL + ')';
    b.setAttribute('aria-label', 'Open command palette');
    b.setAttribute('aria-keyshortcuts', IS_MAC ? 'Meta+K' : 'Control+K');
    b.innerHTML = iconHTML('search') +
      '<span class="lbl">Search</span>' +
      '<kbd class="shp-kbd">' + MOD_LABEL + '</kbd>';
    right.insertBefore(b, right.firstChild);
    b.addEventListener('click', function () { open(); });
    return true;
  }

  /* Add the palette to site.js's shortcuts dialog so the two agree. */
  function mountHelpRow() {
    var md = document.querySelector('#shHelpOv .sh-md');
    if (!md) return false;
    if (md.querySelector('[data-shp-help]')) return true;    // idempotent, like mountNavButton
    var closeBtn = md.querySelector('#shHelpClose');
    var row = document.createElement('div');
    row.className = 'sh-row';
    row.setAttribute('data-shp-help', '1');
    row.innerHTML = '<span>Command palette — search everything</span><kbd>' + MOD_LABEL + '</kbd>';
    if (closeBtn) md.insertBefore(row, closeBtn); else md.appendChild(row);
    return true;
  }

  /* The shared chrome is injected by site.js at DOMContentLoaded, which may
     be before or after this file executes — so watch for it, briefly. */
  function mountChrome() {
    var doneBtn = mountNavButton();
    var doneHelp = mountHelpRow();
    if (doneBtn && doneHelp) return true;
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () {
        if (mountNavButton() && mountHelpRow()) { mo.disconnect(); clearTimeout(stop); }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      var stop = setTimeout(function () { mo.disconnect(); }, 10000);
    } else {
      var tries = 0;
      var iv = setInterval(function () {
        if ((mountNavButton() && mountHelpRow()) || ++tries > 40) clearInterval(iv);
      }, 250);
    }
    return false;
  }

  /* =================================================================== */
  /*  #open= bootstrap                                                   */
  /*                                                                     */
  /*  Selecting a game/book from another page navigates to               */
  /*  games.html#open=<title>. site.js's own hash reader ignores unknown  */
  /*  keys, so the two coexist; we strip only our key afterwards.        */
  /* =================================================================== */

  function bootstrapOpenHash() {
    if (PAGE !== 'games' && PAGE !== 'books') return;
    var h = location.hash.replace(/^#/, '');
    if (!h || h.indexOf('open=') < 0) return;

    var keep = [], want = null;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      var key = i > 0 ? kv.slice(0, i) : kv;
      var dec;
      try { dec = decodeURIComponent(key); } catch (e) { dec = key; }
      if (dec === 'open' && i > 0) {
        try { want = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); }
        catch (e) { want = kv.slice(i + 1); }
      } else if (kv) {
        keep.push(kv);
      }
    });
    if (want == null) return;

    /* strip our key either way so a refresh does not re-open the modal */
    try {
      history.replaceState(null, '', location.pathname + location.search + (keep.length ? '#' + keep.join('&') : ''));
    } catch (e) {}

    var list = PAGE === 'games' ? getGames() : getBooks();
    var lw = String(want).toLowerCase(), hit = null, i;
    for (i = 0; i < list.length; i++) {
      if (String(list[i].title).toLowerCase() === lw) { hit = list[i]; break; }
    }
    if (!hit) {                                        // forgiving fallback
      for (i = 0; i < list.length; i++) {
        if (String(list[i].title).toLowerCase().indexOf(lw) === 0) { hit = list[i]; break; }
      }
    }
    if (!hit) { toast('Couldn’t find “' + want + '” here'); return; }

    var om = getOpenModal();
    if (om) { try { om(hit); return; } catch (e) {} }
    var s = byId('search');
    if (s) { s.value = hit.title; fire(s); }
  }

  /* =================================================================== */
  /*  boot                                                               */
  /* =================================================================== */

  document.addEventListener('keydown', onKeyCapture, true);

  window.addEventListener('hashchange', function () {
    if (location.hash.indexOf('open=') >= 0) bootstrapOpenHash();
  });

  /* Build the search index while the browser is idle so the first ⌘K is
     instantaneous even with ~4,700 items. */
  function prewarm() {
    var run = function () { try { ensureIndex(); } catch (e) {} };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 1200);
  }

  function boot() {
    mountChrome();
    /* run after site.js's applyStateFromHash (60ms) so shared filter links
       and #open= links can be combined without fighting each other */
    setTimeout(bootstrapOpenHash, 140);
    if (document.readyState === 'complete') prewarm();
    else window.addEventListener('load', prewarm);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* =================================================================== */
  /*  public API                                                         */
  /* =================================================================== */

  window.ShelfPalette = {
    open: function (prefill) { open(prefill); },
    close: function () { close(); },
    toggle: function () { toggle(); },
    isOpen: function () { return isOpen; },
    reindex: function () { INDEX = null; if (isOpen) runSearch(); }
  };
})();
