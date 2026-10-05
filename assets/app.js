/* Shelf · shared by every page: icons, theme, search, favourites, cards. */
(function () {
  'use strict';

  var ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    games: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/>',
    books: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    movies: '<rect x="2" y="2" width="20" height="20" rx="2.2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>',
    shows: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/>',
    logo: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.6l3.8 1-4 15.4-3.8-1z"/>',
    play: '<path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5Z"/>',
    sound: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    mute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    eyeOff: '<path d="M10.7 5.1A10.7 10.7 0 0 1 21.9 11.7a1 1 0 0 1 0 .7 10.7 10.7 0 0 1-1.4 2.5"/><path d="M14.1 14.2a3 3 0 0 1-4.3-4.3"/><path d="M17.5 17.5A10.7 10.7 0 0 1 2.1 12.3a1 1 0 0 1 0-.7 10.7 10.7 0 0 1 4.4-5.1"/><path d="m2 2 20 20"/>',
  };
  function icon(name, cls) {
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  var KINDS = {
    games: { label: 'Games', one: 'game', many: 'games', page: 'games.html' },
    books: { label: 'Books', one: 'book', many: 'books', page: 'books.html' },
    movies: { label: 'Films', one: 'film', many: 'films', page: 'movies.html' },
    shows: { label: 'Series', one: 'series', many: 'series', page: 'shows.html' },
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function compact(n) {
    if (n == null) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  /* ------------------------------------------------------------- images */
  var STEAM = 'https://cdn.cloudflare.steamstatic.com/steam/apps/';
  // A poster file on Wikipedia, as opposed to one of its thumbnails.
  var WIKI_FILE = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/(?:en|commons))\/(\w\/\w\w)\/([^/]+\.jpe?g)$/i;
  function imgUrl(kind, r) {
    if (kind === 'games' && r.img) return r.img;
    if (kind === 'games' && r.steamId) return STEAM + r.steamId + '/library_600x900.jpg';
    if (kind === 'books' && r.cover) return 'https://covers.openlibrary.org/b/id/' + r.cover + '-M.jpg';
    if (!r.img) return null;
    // Wikipedia's 250px thumbnail is the same poster re-encoded, often a fifth of the bytes.
    // PNG thumbnails stay PNG and come out no smaller, so those are left alone.
    var m = WIKI_FILE.exec(r.img);
    return m ? m[1] + '/thumb/' + m[2] + '/' + m[3] + '/250px-' + m[3] : r.img;
  }
  // Loading and failure handlers (Shelf.imgOn, Shelf.imgFail) live in the page head, so
  // they work for images that finish before this script runs.

  /* ------------------------------------------------------------- scores */
  function tone(v100) { return v100 == null ? '' : v100 >= 75 ? 'good' : v100 >= 50 ? 'mid' : 'bad'; }

  var METRICS = {
    imdb: { label: 'IMDb', v: function (r) { return r.imdb; }, badge: function (r) { return r.imdb == null ? '' : '<span class="badge star">' + icon('star') + '<b>' + r.imdb.toFixed(1) + '</b></span>'; } },
    mc: { label: 'Metacritic', v: function (r) { return r.mc; }, badge: function (r) { return r.mc == null ? '' : '<span class="badge ' + tone(r.mc) + '">' + r.mc + '</span>'; } },
    mcu: { label: 'Metacritic users', v: function (r) { return r.mcu; }, badge: function (r) { return r.mcu == null ? '' : '<span class="badge ' + tone(Math.round(r.mcu * 10)) + '">' + r.mcu.toFixed(1) + '</span>'; } },
    rt: { label: 'Rotten Tomatoes', v: function (r) { return r.rt; }, badge: function (r) { return r.rt == null ? '' : '<span class="badge ' + (r.rt >= 60 ? 'good' : 'bad') + '">' + r.rt + '%</span>'; } },
    rta: { label: 'Rotten Tomatoes audience', v: function (r) { return r.rta; }, badge: function (r) { return r.rta == null ? '' : '<span class="badge ' + (r.rta >= 60 ? 'good' : 'bad') + '">' + r.rta + '%</span>'; } },
    steam: { label: 'Steam', v: function (r) { return r.steam; }, badge: function (r) { return r.steam == null ? '' : '<span class="badge ' + tone(r.steam) + '">' + r.steam + '%</span>'; } },
    rating: { label: 'Goodreads', v: function (r) { return r.rating; }, badge: function (r) { return r.rating == null ? '' : '<span class="badge star">' + icon('star') + '<b>' + r.rating.toFixed(2) + '</b></span>'; } },
  };

  /* ---------------------------------------------- saved and hidden titles */
  // Kept in this browser only, as { kind: [id, ...] }, newest first.
  function idStore(key) {
    var data = {}, sets = {};
    try { data = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { data = {}; }
    function set(kind) {
      if (!sets[kind]) { sets[kind] = {}; (data[kind] || []).forEach(function (id) { sets[kind][id] = 1; }); }
      return sets[kind];
    }
    return {
      has: function (kind, id) { return Boolean(set(kind)[id]); },
      toggle: function (kind, id) {
        var list = data[kind] || (data[kind] = []);
        var i = list.indexOf(id);
        if (i >= 0) list.splice(i, 1); else list.unshift(id);
        sets[kind] = null;
        try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
        return i < 0;
      },
      list: function (kind) { return (data[kind] || []).slice(); },
    };
  }
  var Favs = idStore('shelf_favs_v2');
  // Films and series hidden from the trailer feed and from suggestions (More like this, Surprise me).
  var Hidden = idStore('shelf_hidden');

  /* -------------------------------------------------------------- cards */
  function coverHTML(kind, r, opts) {
    opts = opts || {};
    var url = imgUrl(kind, r);
    var sub = r.year || '';
    var html = '<span class="cover" style="--k:var(--k-' + kind + ')">' +
      '<span class="ph" aria-hidden="true"><b>' + esc(r.title) + '</b><span>' + esc(r.author || r.by || sub) + '</span></span>';
    if (url) {
      // Wikimedia sets cookies on every image it serves; an anonymous request keeps them out.
      html += '<img src="' + esc(url) + '" alt=""' + (/\.wikimedia\.org\//.test(url) ? ' crossorigin="anonymous"' : '') +
        ' loading="' + (opts.eager ? 'eager' : 'lazy') + '"' + (opts.high ? ' fetchpriority="high"' : '') + ' decoding="async"' +
        (kind === 'games' && r.steamId ? ' data-steam="' + r.steamId + '"' : '') +
        ' referrerpolicy="no-referrer" onload="Shelf.imgOn(this)" onerror="Shelf.imgFail(this)">';
    }
    if (opts.badge) html += opts.badge;
    if (opts.fav) {
      var on = Favs.has(kind, r.id);
      html += '<span class="fav' + (on ? ' on' : '') + '" aria-hidden="true" data-fav="' + esc(r.id) + '">' + icon('heart') + '</span>';
    }
    return html + '</span>';
  }

  function cardHTML(kind, r, opts) {
    opts = opts || {};
    var meta = [r.year, opts.meta].filter(Boolean).join(' · ');
    var tag = opts.href ? 'a href="' + esc(opts.href) + '"' : 'button type="button"';
    // No aria-label: the card's own text (rating, title, year) is its name.
    return '<' + tag + ' class="card" data-id="' + esc(r.id) + '">' +
      coverHTML(kind, r, opts) +
      '<span class="card-t">' + esc(r.title) + '</span>' +
      (meta ? '<span class="card-m">' + esc(meta) + '</span>' : '') +
      '</' + (opts.href ? 'a' : 'button') + '>';
  }

  /* -------------------------------------------------------------- toast */
  /* A note at the foot of the screen, with at most one action: opts.action = [label, fn].
     Over an open dialog it goes inside that dialog (opts.host, or the one in use), since
     anything outside sits beneath it, out of sight and out of reach. */
  var toastEl, toastT, toastAct;
  function toast(msg, opts) {
    opts = opts || {};
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.addEventListener('click', function (e) {
        if (!toastAct || !e.target.closest('button')) return;
        var f = toastAct;
        toastAct = null;
        toastEl.classList.remove('on');
        f();
      });
    }
    var a = document.activeElement;
    var host = opts.host || (a && a.closest && a.closest('dialog[open]')) || document.body;
    if (toastEl.parentNode !== host) host.appendChild(toastEl);
    toastEl.textContent = msg;
    toastAct = opts.action ? opts.action[1] : null;
    if (opts.action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = opts.action[0];
      toastEl.appendChild(b);
    }
    toastEl.classList.toggle('act', Boolean(opts.action));
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('on'); toastAct = null; }, opts.action ? 5000 : 1800);
  }

  /* -------------------------------------------------------------- theme */
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('shelf_theme', t); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-theme-toggle]');
    if (b) setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  /* ------------------------------------------------------------- search */
  var index = null, indexing = null;
  function fold(s) {
    return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (!indexing) {
      indexing = fetch('data/search.json?v=' + ((document.querySelector('meta[name="shelf-build"]') || {}).content || '')).then(function (r) { return r.json(); }).then(function (j) {
        index = j.items.map(function (x) {
          return { kind: j.kinds[x[0]], id: x[1], title: x[2], year: x[3], score: x[4], sub: x[5] || '', f: fold(x[2]), fs: fold(x[5] || '') };
        });
        return index;
      });
    }
    return indexing;
  }
  function searchIndex(q, limit) {
    var f = fold(q);
    if (!f) return [];
    var words = f.split(' ');
    var out = [];
    for (var i = 0; i < index.length; i++) {
      var it = index[i], s = 0;
      if (it.f === f) s = 100;
      else if (it.f.indexOf(f) === 0) s = 80;
      else if ((' ' + it.f).indexOf(' ' + f) >= 0) s = 64;
      else if (words.every(function (w) { return (' ' + it.f + ' ' + it.fs).indexOf(' ' + w) >= 0; })) s = 46;
      else if (f.length > 3 && it.f.indexOf(f) >= 0) s = 36;
      if (s) out.push([s + (index.length - i) / index.length * 10, it]);
    }
    out.sort(function (a, b) { return b[0] - a[0]; });
    return out.slice(0, limit || 40).map(function (x) { return x[1]; });
  }

  var pal, palInput, palList, palSel = 0, palItems = [];
  function buildPalette() {
    pal = document.createElement('dialog');
    pal.className = 'palette';
    pal.setAttribute('aria-label', 'Search');
    pal.innerHTML = '<div class="sheet"><div class="field">' + icon('search') +
      '<input type="search" placeholder="Search games, books, films and series" autocomplete="off" spellcheck="false" aria-label="Search everything"></div>' +
      '<div class="p-list" role="listbox"></div></div>';
    document.body.appendChild(pal);
    palInput = pal.querySelector('input');
    palList = pal.querySelector('.p-list');
    palInput.addEventListener('input', renderPalette);
    palInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { palSel = Math.min(palSel + 1, palItems.length - 1); paintSel(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { palSel = Math.max(palSel - 1, 0); paintSel(); e.preventDefault(); }
      else if (e.key === 'Enter' && palItems[palSel]) { go(palItems[palSel]); }
    });
    pal.addEventListener('click', function (e) {
      if (e.target === pal) pal.close();
      var a = e.target.closest('.p-item');
      if (a) { e.preventDefault(); go(palItems[Number(a.getAttribute('data-i'))]); }
    });
  }
  function go(it) {
    var here = document.body.getAttribute('data-kind');
    pal.close();
    if (here === it.kind && window.ShelfCatalog) window.ShelfCatalog.open(it.id);
    else location.href = KINDS[it.kind].page + '#' + encodeURIComponent(it.id);
  }
  function scoreText(it) {
    if (it.score == null) return '';
    if (it.kind === 'books') return '★ ' + it.score.toFixed(2);
    if (it.kind === 'movies' || it.kind === 'shows') return '★ ' + it.score.toFixed(1);
    return String(it.score);
  }
  function renderPalette() {
    var q = palInput.value;
    if (!q.trim()) { palList.innerHTML = '<div class="p-hint">Type a title or author</div>'; palItems = []; return; }
    if (!index) { palList.innerHTML = '<div class="p-hint">Loading…</div>'; loadIndex().then(renderPalette); return; }
    palItems = searchIndex(q, 40);
    palSel = 0;
    palList.innerHTML = palItems.length ? palItems.map(function (it, i) {
      return '<a class="p-item" role="option" data-i="' + i + '" href="' + KINDS[it.kind].page + '#' + encodeURIComponent(it.id) + '" style="--k:var(--k-' + it.kind + ')">' +
        '<span class="k">' + icon(it.kind, 'sm') + '</span>' +
        '<span class="t">' + esc(it.title) + '<span class="y">' + esc([it.year, it.sub].filter(Boolean).join(' · ')) + '</span></span>' +
        '<span class="s">' + scoreText(it) + '</span></a>';
    }).join('') : '<div class="p-hint">Nothing matches “' + esc(q) + '”</div>';
    paintSel();
  }
  function paintSel() {
    var els = palList.querySelectorAll('.p-item');
    for (var i = 0; i < els.length; i++) els[i].setAttribute('aria-selected', i === palSel ? 'true' : 'false');
    if (els[palSel]) els[palSel].scrollIntoView({ block: 'nearest' });
  }
  function openSearch(q) {
    if (!pal) buildPalette();
    if (!pal.open) pal.showModal();
    palInput.value = q || '';
    renderPalette();
    palInput.focus();
    loadIndex();
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-search]')) { e.preventDefault(); openSearch(); }
  });
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); openSearch(); }
  });

  /* ------------------------------------------------------------ trailers */
  // A pointer over (or a finger on) a way into the trailers is a hint: connect to YouTube
  // now, and let the page fetch the feed itself, so the first trailer starts sooner.
  var warmed = false;
  function warmTrailers() {
    if (warmed) return;
    warmed = true;
    ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://i.ytimg.com'].forEach(function (h) {
      var l = document.createElement('link');
      l.rel = 'preconnect'; l.href = h;
      document.head.appendChild(l);
    });
    document.dispatchEvent(new CustomEvent('shelf:trailers'));
  }
  ['pointerover', 'touchstart', 'focusin'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (!warmed && e.target.closest && e.target.closest('[data-trailers], #trailerBtn')) warmTrailers();
    }, { passive: true });
  });

  /* ------------------------------------------------------ service worker */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      var b = document.querySelector('meta[name="shelf-build"]');
      navigator.serviceWorker.register('sw.js?v=' + (b ? b.content : 'dev')).catch(function () {});
    });
  }

  var S = window.Shelf || (window.Shelf = {});
  var api = {
    icon: icon, esc: esc, compact: compact, KINDS: KINDS, METRICS: METRICS, tone: tone,
    imgUrl: imgUrl, coverHTML: coverHTML, cardHTML: cardHTML,
    Favs: Favs, Hidden: Hidden, toast: toast, openSearch: openSearch, fold: fold, warmTrailers: warmTrailers,
  };
  for (var k in api) S[k] = api[k];
})();
