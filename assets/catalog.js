/* Shelf · catalogue pages (games, books, films, series). */
(function () {
  'use strict';
  var S = window.Shelf, icon = S.icon, esc = S.esc;
  var kind = document.body.getAttribute('data-kind');
  var K = S.KINDS[kind];
  var THIS_YEAR = new Date().getFullYear();

  /* Bayesian average: a 9.0 from 12k votes should not outrank an 8.8 from 1M. */
  function weighted(v, n, m, c) { return v == null ? -1 : (n / (n + m)) * v + (m / (n + m)) * c; }
  function runtime(m) { if (!m) return ''; var h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm'; }
  function years(r) { return r.end && r.end !== r.year ? r.year + '–' + r.end : r.year ? r.year + (kind === 'shows' && !r.end && r.year >= THIS_YEAR - 3 ? '–' : '') : ''; }

  var CONFIG = {
    movies: {
      sorts: [['top', 'Top rated'], ['popular', 'Most popular'], ['mc', 'Metascore'], ['rt', 'Rotten Tomatoes'], ['new', 'Newest'], ['old', 'Oldest'], ['az', 'A–Z']],
      badge: { mc: 'mc', rt: 'rt' }, defBadge: 'imdb', avg: 'imdb',
      min: { key: 'imdb', max: 10, step: 0.5, fmt: function (v) { return '★ ' + v.toFixed(1); } },
      fields: function (r) { return [r.title, r.alt, r.by].join(' '); },
      meta: function (r) { return (r.genres || [])[0]; },
      top: function (r, c) { return weighted(r.imdb, r.votes || 0, 25000, c); },
      popular: function (r) { return r.votes || 0; },
    },
    shows: {
      sorts: [['top', 'Top rated'], ['popular', 'Most popular'], ['mc', 'Metascore'], ['rt', 'Rotten Tomatoes'], ['new', 'Newest'], ['old', 'Oldest'], ['az', 'A–Z']],
      badge: { mc: 'mc', rt: 'rt' }, defBadge: 'imdb', avg: 'imdb',
      min: { key: 'imdb', max: 10, step: 0.5, fmt: function (v) { return '★ ' + v.toFixed(1); } },
      fields: function (r) { return [r.title, r.alt, r.by].join(' '); },
      meta: function (r) { return (r.genres || [])[0]; },
      top: function (r, c) { return weighted(r.imdb, r.votes || 0, 15000, c); },
      popular: function (r) { return r.votes || 0; },
    },
    games: {
      sorts: [['top', 'Top rated'], ['steam', 'Steam rating'], ['popular', 'Most reviewed'], ['new', 'Newest'], ['old', 'Oldest'], ['az', 'A–Z']],
      badge: { steam: 'steam', popular: 'steam' }, defBadge: 'mc', avg: 'mc',
      min: { key: 'mc', max: 100, step: 5, fmt: function (v) { return v + '+'; } },
      fields: function (r) { return [r.title].concat(r.tags || []).join(' '); },
      meta: function (r) { return (r.genres || [])[0]; },
      top: function (r) { return r.mc != null ? r.mc + 100 : r.steam != null ? r.steam * 0.9 : -1; },
      popular: function (r) { return r.steamN || 0; },
    },
    books: {
      sorts: [['top', 'Top rated'], ['popular', 'Most rated'], ['new', 'Newest'], ['old', 'Oldest'], ['az', 'A–Z'], ['author', 'Author']],
      badge: {}, defBadge: 'rating', avg: 'rating',
      min: { key: 'rating', max: 5, step: 0.25, fmt: function (v) { return '★ ' + v.toFixed(2); } },
      fields: function (r) { return [r.title, r.author].join(' '); },
      meta: function (r) { return r.author; },
      top: function (r, c) { return weighted(r.rating, r.ratings || 0, 4000, c); },
      popular: function (r) { return r.ratings || 0; },
    },
  }[kind];

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var grid = $('#grid'), metaEl = $('#meta'), activeEl = $('#active'), chipsEl = $('#chips');
  var qEl = $('#q'), sortEl = $('#sort');

  var items = [], byId = {}, idx = {}, genreCount = {}, tagCount = {}, avgTop = 0;
  var results = [], shown = 0, PAGE = 60, loaded = false;
  var state = readURL();
  // Ids of the cards the page was built with (the default list), if they are still on it.
  var pre = [].map.call(grid.querySelectorAll('.card[data-id]'), function (c) { return c.getAttribute('data-id'); });

  function defaults() { return { q: '', sort: 'top', genres: [], tags: [], match: 'all', country: [], from: null, to: null, min: null, len: '', status: '', saved: false, view: '', rsort: 'shuffle' }; }

  /* ------------------------------------------------------------- url state */
  function readURL() {
    var p = new URLSearchParams(location.search);
    var s = defaults();
    s.q = p.get('q') || '';
    if (CONFIG.sorts.some(function (x) { return x[0] === p.get('sort'); })) s.sort = p.get('sort');
    s.genres = (p.get('genre') || '').split(',').filter(Boolean);
    s.tags = (p.get('theme') || '').split(',').filter(Boolean);
    s.match = p.get('match') === 'any' ? 'any' : 'all';
    s.country = (p.get('country') || '').split(',').filter(Boolean);
    var y = (p.get('years') || '').split('-');
    s.from = Number(y[0]) || null; s.to = Number(y[1]) || null;
    s.min = p.get('min') != null ? Number(p.get('min')) : null;
    s.len = p.get('length') || '';
    s.status = p.get('status') || '';
    s.saved = p.get('saved') === '1';
    s.view = p.get('view') === 'trailers' && (kind === 'movies' || kind === 'shows') ? 'trailers' : '';
    if (CONFIG.sorts.some(function (x) { return x[0] === p.get('rsort'); })) s.rsort = p.get('rsort');
    return s;
  }
  function writeURL() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.sort !== 'top') p.set('sort', state.sort);
    if (state.genres.length) p.set('genre', state.genres.join(','));
    if (state.tags.length) p.set('theme', state.tags.join(','));
    if (state.match === 'any' && state.genres.length + state.tags.length) p.set('match', 'any');
    if (state.country.length) p.set('country', state.country.join(','));
    if (state.from || state.to) p.set('years', (state.from || '') + '-' + (state.to || ''));
    if (state.min != null) p.set('min', state.min);
    if (state.len) p.set('length', state.len);
    if (state.status) p.set('status', state.status);
    if (state.saved) p.set('saved', '1');
    if (state.view) p.set('view', state.view);
    if (state.view && state.rsort !== 'shuffle') p.set('rsort', state.rsort);
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  /* --------------------------------------------------------------- loading */
  function skeleton() {
    var s = '';
    for (var i = 0; i < 18; i++) s += '<div class="card skel"><div class="cover"></div><span class="card-t">&nbsp;</span><span class="card-m">&nbsp;</span></div>';
    grid.innerHTML = s;
  }

  function load() {
    if (!pre.length) skeleton();
    qEl.value = state.q;
    qEl.parentNode.classList.toggle('has-value', Boolean(state.q));
    sortEl.value = state.sort;
    // With the first screen already drawn, its posters get the connection first and the full
    // list follows once they are in, after 2.5 s at most, or as soon as someone reaches for a control.
    if (!pre.length || document.readyState === 'complete') return fetchData();
    var started = false;
    var go = function () { if (!started) { started = true; fetchData(); } };
    window.addEventListener('load', go);
    setTimeout(go, 2500);
    ['pointerdown', 'keydown', 'focusin'].forEach(function (t) { document.addEventListener(t, go, { once: true, passive: true }); });
  }
  function fetchData() {
    fetch('data/' + kind + '.json?v=' + ((document.querySelector('meta[name="shelf-build"]') || {}).content || '')).then(function (r) { return r.json(); }).then(function (rows) {
      items = rows;
      var sum = 0, n = 0;
      items.forEach(function (r, i) {
        byId[r.id] = r;
        r._i = i;
        r._f = S.fold(CONFIG.fields(r));
        (r.genres || []).forEach(function (g) { genreCount[g] = (genreCount[g] || 0) + 1; });
        (r.tags || []).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1; });
        var v = S.METRICS[CONFIG.min.key].v(r);
        if (v != null) { sum += v; n++; }
      });
      avgTop = n ? sum / n : 0;
      items.forEach(function (r) { r._top = CONFIG.top(r, avgTop); });
      state = readURL();
      loaded = true;
      apply();
      openFromHash();
      // Panels opened while the data was on its way.
      if (genresDlg.open) layoutPicker();
      if (filtersDlg.open) openFilters();
      if (state.view === 'trailers') openReels();
    }).catch(function () {
      grid.innerHTML = '<div class="empty"><h2>Could not load the catalogue</h2><p>Check your connection and reload.</p></div>';
    });
  }

  /* -------------------------------------------------------------- filtering */
  /* Everything except genres and themes: the pool the genre picker counts within. */
  function matchesBase(r, s) {
    if (s.q) {
      var words = S.fold(s.q).split(' ');
      for (var i = 0; i < words.length; i++) if ((' ' + r._f).indexOf(' ' + words[i]) < 0) return false;
    }
    if (s.from && (!r.year || r.year < s.from)) return false;
    if (s.to && (!r.year || r.year > s.to)) return false;
    if (s.min != null) { var v = S.METRICS[CONFIG.min.key].v(r); if (v == null || v < s.min) return false; }
    if (s.len) {
      var m = r.runtime;
      if (!m) return false;
      if (s.len === 'short' && m >= 90) return false;
      if (s.len === 'mid' && (m < 90 || m > 120)) return false;
      if (s.len === 'long' && m <= 120) return false;
    }
    if (s.status) {
      var mini = Boolean(r.mini);
      if (s.status === 'mini' && !mini) return false;
      if (s.status === 'ongoing' && (mini || r.end)) return false;
      if (s.status === 'ended' && (mini || !r.end)) return false;
    }
    if (s.country.length && !(r.country && s.country.some(function (c) { return r.country.indexOf(c) >= 0; }))) return false;
    if (s.saved && !S.Favs.has(kind, r.id)) return false;
    return true;
  }
  function hasAll(r, s) {
    for (var g = 0; g < s.genres.length; g++) if (!r.genres || r.genres.indexOf(s.genres[g]) < 0) return false;
    for (var t = 0; t < s.tags.length; t++) if (!r.tags || r.tags.indexOf(s.tags[t]) < 0) return false;
    return true;
  }
  function hasAny(r, s) {
    if (!s.genres.length && !s.tags.length) return true;
    for (var g = 0; g < s.genres.length; g++) if (r.genres && r.genres.indexOf(s.genres[g]) >= 0) return true;
    for (var t = 0; t < s.tags.length; t++) if (r.tags && r.tags.indexOf(s.tags[t]) >= 0) return true;
    return false;
  }
  function matches(r, s) { return matchesBase(r, s) && (s.match === 'any' ? hasAny(r, s) : hasAll(r, s)); }

  var SORTERS = {
    top: function (a, b) { return b._top - a._top; },
    popular: function (a, b) { return CONFIG.popular(b) - CONFIG.popular(a); },
    mc: function (a, b) { return (b.mc == null ? -1 : b.mc) - (a.mc == null ? -1 : a.mc) || b._top - a._top; },
    rt: function (a, b) { return (b.rt == null ? -1 : b.rt) - (a.rt == null ? -1 : a.rt) || (b.rtN || 0) - (a.rtN || 0); },
    steam: function (a, b) { return (b.steam == null ? -1 : b.steam + Math.min(b.steamN || 0, 5e4) / 1e6) - (a.steam == null ? -1 : a.steam + Math.min(a.steamN || 0, 5e4) / 1e6); },
    new: function (a, b) { return (b.year || 0) - (a.year || 0) || b._top - a._top; },
    old: function (a, b) { return (a.year || 9999) - (b.year || 9999) || b._top - a._top; },
    az: function (a, b) { return a.title.localeCompare(b.title); },
    author: function (a, b) { return lastName(a.author).localeCompare(lastName(b.author)) || (a.year || 0) - (b.year || 0); },
  };
  function lastName(s) { s = (s || '').trim(); return s.split(' ').pop() + ' ' + s; }

  function apply(keepScroll) {
    // Before the data is in, a choice is only remembered (in the address); the list follows.
    if (!loaded) {
      writeURL();
      if (pre.length) { pre = []; skeleton(); metaEl.style.visibility = 'hidden'; }
      return;
    }
    results = items.filter(function (r) { return matches(r, state); });
    results.sort(SORTERS[state.sort] || SORTERS.top);
    // Keep the cards the page was built with while they are still the top of the list.
    var keep = pre.length && pre.every(function (id, i) { return results[i] && results[i].id === id; });
    if (keep) {
      shown = pre.length;
      grid.querySelectorAll('[data-fav]').forEach(function (f) { f.classList.toggle('on', S.Favs.has(kind, f.getAttribute('data-fav'))); });
    } else {
      shown = 0;
      grid.innerHTML = '';
    }
    pre = [];
    renderMore();
    renderMeta();
    renderChips();
    renderActive();
    renderShow();
    if (genresDlg.open) refreshPicker();
    if (filtersDlg.open) refreshCountries();
    writeURL();
    if (window.ShelfReels && window.ShelfReels.isOpen()) window.ShelfReels.refresh();
    else if (!keepScroll && window.scrollY > grid.offsetTop) window.scrollTo({ top: grid.offsetTop - 160 });
  }

  function badgeKey() { return CONFIG.badge[state.sort] || (state.min != null ? CONFIG.min.key : CONFIG.defBadge); }
  function badgeFor(r) {
    var k = badgeKey(), b = S.METRICS[k].badge(r);
    if (!b && kind === 'games') b = S.METRICS[k === 'mc' ? 'steam' : 'mc'].badge(r);
    return b;
  }

  function renderMore() {
    var end = Math.min(shown + PAGE, results.length);
    if (!results.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h2>No matches</h2><p>Try fewer filters.</p><p><button class="btn sm" data-reset>Clear filters</button></p></div>';
      return;
    }
    var html = '';
    for (var i = shown; i < end; i++) {
      var r = results[i];
      html += S.cardHTML(kind, r, { meta: CONFIG.meta(r), badge: badgeFor(r), fav: true, eager: i < 6, high: i < 3 });
    }
    grid.insertAdjacentHTML('beforeend', html);
    shown = end;
  }

  function avgOf(rows) {
    var k = CONFIG.avg, sum = 0, n = 0;
    for (var i = 0; i < rows.length; i++) { var v = S.METRICS[k].v(rows[i]); if (v != null) { sum += v; n++; } }
    if (!n) return '';
    var a = sum / n;
    if (k === 'imdb') return 'avg ★ ' + a.toFixed(1);
    if (k === 'rating') return 'avg ★ ' + a.toFixed(2);
    return 'avg Metascore ' + Math.round(a);
  }
  function renderMeta() {
    var n = results.length;
    metaEl.style.visibility = '';
    metaEl.innerHTML = '<span><b>' + n.toLocaleString() + '</b> ' + (n === 1 ? K.one : K.many) + (n ? ' · ' + avgOf(results) : '') + '</span>' +
      (n ? '<button class="link-btn" id="surprise">' + icon('shuffle', 'sm') + ' Surprise me</button>' : '');
  }

  /* ---------------------------------------------------------- genre chips */
  function byCount(counts) { return function (a, b) { return (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b); }; }
  /* The quick row: the biggest genres, with anything picked from the full list up front.
     The button that opens the full list sits outside the row, so it is never scrolled away. */
  function renderChips() {
    var top = Object.keys(genreCount).sort(byCount(genreCount)).slice(0, 12);
    var extra = state.genres.filter(function (g) { return top.indexOf(g) < 0; });
    var html = '<button class="chip" type="button" data-chip="" aria-pressed="' + !(state.genres.length || state.tags.length) + '">All</button>';
    state.tags.forEach(function (t) { html += '<button class="chip" type="button" data-tag="' + esc(t) + '" aria-pressed="true">' + esc(t) + '</button>'; });
    extra.concat(top).forEach(function (g) {
      html += '<button class="chip" type="button" data-chip="' + esc(g) + '" aria-pressed="' + (state.genres.indexOf(g) >= 0) + '">' + esc(g) + '</button>';
    });
    chipsEl.innerHTML = html;
    chipsEl.style.visibility = '';
    var n = state.genres.length + state.tags.length, gc = $('#genresBtn .count');
    if (gc) { gc.textContent = n; gc.hidden = !n; }
    chipFade();
  }
  function chipFade() {
    var l = chipsEl.scrollLeft > 4, r = chipsEl.scrollLeft + chipsEl.clientWidth < chipsEl.scrollWidth - 4;
    chipsEl.setAttribute('data-fade', (l ? 'l' : '') + (r ? 'r' : ''));
  }
  chipsEl.addEventListener('scroll', chipFade, { passive: true });
  window.addEventListener('resize', chipFade);

  function filterCount() {
    return (state.from || state.to ? 1 : 0) + (state.min != null ? 1 : 0) + (state.len ? 1 : 0) + (state.status ? 1 : 0) + (state.saved ? 1 : 0) + (state.country.length ? 1 : 0);
  }
  function renderActive() {
    var pills = [];
    var add = function (label, key, val) { pills.push('<button class="pill" data-drop="' + key + '" data-val="' + esc(val || '') + '">' + esc(label) + icon('x') + '</button>'); };
    if (state.from || state.to) add(state.from && state.to ? (state.from === state.to ? state.from : state.from + '–' + state.to) : state.from ? state.from + ' or later' : 'Up to ' + state.to, 'years');
    if (state.min != null) add(S.METRICS[CONFIG.min.key].label + ' ' + CONFIG.min.fmt(state.min) + (CONFIG.min.key === 'mc' ? '' : '+'), 'min');
    if (state.len) add({ short: 'Under 90 min', mid: '90 to 120 min', long: 'Over 2 hours' }[state.len], 'len');
    if (state.status) add({ ongoing: 'Ongoing', ended: 'Ended', mini: 'Miniseries' }[state.status], 'status');
    state.country.forEach(function (c) { add(c, 'country', c); });
    if (state.saved) add('Saved', 'saved');
    if (state.q) add('“' + state.q + '”', 'q');
    var total = pills.length + state.genres.length + state.tags.length;
    activeEl.innerHTML = pills.join('') + (total > 1 ? '<button class="link-btn" data-reset>Clear all</button>' : '');
    var fb = $('#filtersBtn .count');
    var n = filterCount();
    if (fb) { fb.textContent = n; fb.hidden = !n; }
  }

  /* ------------------------------------------------------------ panels */
  var genresDlg = $('#genresDlg'), filtersDlg = $('#filtersDlg');
  // [[group, [theme, ...]], ...]: the taxonomy the data refresh tags titles with, written in by the build.
  var TAX = window.SHELF_TAXONOMY || [];
  var groups = null, expanded = {};

  function showLabel() {
    var n = results.length;
    return n ? 'Show ' + n.toLocaleString() + ' ' + (n === 1 ? K.one : K.many) : 'No ' + K.many + ' match';
  }
  function renderShow() { $('#genreShow').textContent = showLabel(); $('#filterShow').textContent = showLabel(); }

  /* What each genre and theme would give, given everything else that is picked.
     "Match all" counts what each would narrow the list to; "match any" counts each on its own. */
  function pickerCounts() {
    var gc = {}, tc = {};
    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      if (!matchesBase(r, state) || (state.match === 'all' && !hasAll(r, state))) continue;
      if (r.genres) for (var a = 0; a < r.genres.length; a++) gc[r.genres[a]] = (gc[r.genres[a]] || 0) + 1;
      if (r.tags) for (var b = 0; b < r.tags.length; b++) tc[r.tags[b]] = (tc[r.tags[b]] || 0) + 1;
    }
    return { gc: gc, tc: tc };
  }
  function squash(s) { return S.fold(s).replace(/ /g, ''); }

  /* Lays the picker out once per opening, search or mode change. Picks in between only
     update counts in place, so nothing jumps around while choosing. */
  function layoutPicker() {
    if (!groups) {
      var known = {};
      TAX.forEach(function (g) { g[1].forEach(function (t) { known[t] = 1; }); });
      var rest = Object.keys(tagCount).filter(function (t) { return !known[t]; }).sort(byCount(tagCount));
      groups = TAX.map(function (g) { return [g[0], g[1].filter(function (t) { return tagCount[t]; })]; })
        .concat([['More', rest]]).filter(function (g) { return g[1].length; });
    }
    var c = pickerCounts(), raw = $('#genreFind').value.trim(), find = squash(raw);
    var section = function (title, list, attr, counts, sel, limit) {
      var hit = find && squash(title).indexOf(find) >= 0;
      var names = list.filter(function (n) {
        if (sel.indexOf(n) >= 0) return true;
        if (!find) return counts[n] > 0;
        return squash(n).indexOf(find) >= 0 || (hit && counts[n] > 0);
      }).sort(byCount(counts));
      if (!names.length) return '';
      var more = 0;
      if (limit && !find && !expanded[title] && names.length > limit + 2) {
        var keep = names.slice(0, limit);
        names.slice(limit).forEach(function (n) { if (sel.indexOf(n) >= 0) keep.push(n); });
        more = names.length - keep.length;
        names = keep;
      }
      return '<div class="opt-group"><h3>' + esc(title) + '</h3><div class="opt-wrap">' + names.map(function (n) {
        var k = counts[n] || 0, on = sel.indexOf(n) >= 0;
        return '<button class="chip" type="button" ' + attr + '="' + esc(n) + '" aria-pressed="' + on + '"' + (k || on ? '' : ' disabled') + '>' +
          esc(n) + '<small>' + k.toLocaleString() + '</small></button>';
      }).join('') + (more ? '<button class="chip expand" type="button" data-expand="' + esc(title) + '">+ ' + more + ' more</button>' : '') + '</div></div>';
    };
    // Themes that belong to a picked genre (Slasher under Horror) come first.
    var lead = groups.filter(function (g) { return g[0].split(' & ').some(function (p) { return state.genres.indexOf(p) >= 0; }); });
    var html = section('Genres', Object.keys(genreCount), 'data-chip', c.gc, state.genres, 0) +
      lead.concat(groups.filter(function (g) { return lead.indexOf(g) < 0; })).map(function (g) {
        return section(g[0], g[1], 'data-tag', c.tc, state.tags, 10);
      }).join('');
    $('#genreBody').innerHTML = html || '<p class="p-hint">' + (find ? 'Nothing matches “' + esc(raw) + '”' : 'Nothing left with these filters') + '</p>';
    pickerHead();
  }
  function refreshPicker() {
    var c = pickerCounts();
    genresDlg.querySelectorAll('#genreBody [data-chip], #genreBody [data-tag]').forEach(function (b) {
      var isGenre = b.hasAttribute('data-chip'), name = b.getAttribute(isGenre ? 'data-chip' : 'data-tag');
      var k = (isGenre ? c.gc : c.tc)[name] || 0, on = (isGenre ? state.genres : state.tags).indexOf(name) >= 0;
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !k && !on;
      b.lastChild.textContent = k.toLocaleString();
    });
    pickerHead();
  }
  function pickerHead() {
    var pill = function (attr) { return function (n) { return '<button class="pill" type="button" ' + attr + '="' + esc(n) + '" aria-label="Remove ' + esc(n) + '">' + esc(n) + icon('x') + '</button>'; }; };
    $('#genreSel').innerHTML = state.genres.map(pill('data-chip')).join('') + state.tags.map(pill('data-tag')).join('');
    genresDlg.querySelectorAll('[data-match]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-match') === state.match)); });
    $('#genreClear').hidden = !(state.genres.length || state.tags.length);
  }
  function openGenres() {
    $('#genreFind').value = '';
    if (!loaded) {
      $('#genreBody').innerHTML = '<p class="p-hint">Loading…</p>';
      if (!genresDlg.open) genresDlg.showModal();
      return;
    }
    layoutPicker();
    if (!genresDlg.open) genresDlg.showModal();
    $('#genreBody').scrollTop = 0;
  }
  $('#genreFind').addEventListener('input', layoutPicker);

  /* Countries of origin, from each title's Wikipedia categories, counted within everything else picked. */
  var allCountries = false;
  function countryCounts() {
    var s2 = Object.assign({}, state, { country: [] }), cc = {};
    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      if (r.country && r.country.length && matches(r, s2)) for (var j = 0; j < r.country.length; j++) cc[r.country[j]] = (cc[r.country[j]] || 0) + 1;
    }
    return cc;
  }
  function refreshCountries() {
    var cc = countryCounts();
    filtersDlg.querySelectorAll('[data-country]').forEach(function (b) {
      var x = b.getAttribute('data-country');
      b.setAttribute('aria-pressed', String(state.country.indexOf(x) >= 0));
      b.lastChild.textContent = (cc[x] || 0).toLocaleString();
    });
  }

  function openFilters() {
    var m = CONFIG.min;
    var decades = [[2020, null, '2020s'], [2010, 2019, '2010s'], [2000, 2009, '2000s'], [1990, 1999, '1990s'], [1980, 1989, '1980s'], [null, 1979, 'Older']];
    var html = '<div class="row-field"><label>Released</label><div class="range2">' +
      '<input type="number" id="fFrom" inputmode="numeric" placeholder="From" max="' + THIS_YEAR + '" value="' + (state.from || '') + '" aria-label="From year">' +
      '<span>to</span><input type="number" id="fTo" inputmode="numeric" placeholder="To" max="' + THIS_YEAR + '" value="' + (state.to || '') + '" aria-label="To year"></div>' +
      '<div class="seg">' + decades.map(function (d) {
        var on = state.from === d[0] && state.to === d[1];
        return '<button class="chip" data-dec="' + (d[0] || '') + '-' + (d[1] || '') + '" aria-pressed="' + on + '">' + d[2] + '</button>';
      }).join('') + '</div></div>';
    var cur = state.min != null ? state.min : 0;
    html += '<div class="row-field"><label for="fMin">Minimum ' + S.METRICS[m.key].label + ' <output id="fMinOut">' + (cur ? m.fmt(cur) : 'Any') + '</output></label>' +
      '<input type="range" id="fMin" min="0" max="' + m.max + '" step="' + m.step + '" value="' + cur + '"></div>';
    if (kind === 'movies') html += seg('Length', 'len', [['', 'Any'], ['short', 'Under 90 min'], ['mid', '90 to 120 min'], ['long', 'Over 2 hours']]);
    if (kind === 'shows') html += seg('Status', 'status', [['', 'Any'], ['ongoing', 'Ongoing'], ['ended', 'Ended'], ['mini', 'Miniseries']]);
    if (kind === 'movies' || kind === 'shows') {
      var cc = countryCounts(), all = Object.keys(cc).sort(byCount(cc));
      var list = allCountries ? all : all.slice(0, 12);
      state.country.forEach(function (x) { if (list.indexOf(x) < 0) list.push(x); });
      if (list.length) html += '<div class="row-field"><label>Country</label><div class="seg">' + list.map(function (x) {
        return '<button class="chip" type="button" data-country="' + esc(x) + '" aria-pressed="' + (state.country.indexOf(x) >= 0) + '">' + esc(x) + '<small>' + (cc[x] || 0).toLocaleString() + '</small></button>';
      }).join('') + (all.length > list.length ? '<button class="chip expand" type="button" data-more-countries>+ ' + (all.length - list.length) + ' more</button>' : '') + '</div></div>';
    }
    html += seg('Show', 'saved', [['', 'Everything'], ['1', 'Saved only']]);
    $('#filterBody').innerHTML = html;
    if (!filtersDlg.open) filtersDlg.showModal();
  }
  function seg(label, key, opts) {
    var cur = key === 'saved' ? (state.saved ? '1' : '') : state[key];
    return '<div class="row-field"><label>' + label + '</label><div class="seg">' + opts.map(function (o) {
      return '<button class="chip" data-seg="' + key + '" data-val="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div></div>';
  }
  filtersDlg.addEventListener('input', function (e) {
    if (e.target.id === 'fMin') {
      var v = Number(e.target.value);
      state.min = v > 0 ? v : null;
      $('#fMinOut').textContent = v > 0 ? CONFIG.min.fmt(v) : 'Any';
      apply(true);
    } else if (e.target.id === 'fFrom' || e.target.id === 'fTo') {
      var rawFrom = $('#fFrom').value, rawTo = $('#fTo').value;
      // Wait for a whole year: "19" on the way to "1990" is not a filter.
      if ((rawFrom && rawFrom.replace('-', '').length < 3) || (rawTo && rawTo.replace('-', '').length < 3)) return;
      state.from = Number(rawFrom) || null; state.to = Number(rawTo) || null;
      filtersDlg.querySelectorAll('[data-dec]').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
      apply(true);
    }
  });

  /* ------------------------------------------------------------- detail */
  var detailDlg = $('#detailDlg'), current = null;
  function scoreBlock(v, cls, label, sub, href) {
    var tag = href ? 'a class="score" href="' + esc(href) + '" target="_blank" rel="noopener"' : 'div class="score"';
    return '<' + tag + '><span class="v ' + cls + '">' + v + '</span><span class="l"><b>' + label + '</b><span>' + sub + '</span></span></' + (href ? 'a' : 'div') + '>';
  }
  function scoresHTML(r) {
    var h = [];
    if (kind === 'movies' || kind === 'shows') {
      if (r.imdb != null) h.push(scoreBlock(r.imdb.toFixed(1), 'plain', 'IMDb', S.compact(r.votes) + ' votes', 'https://www.imdb.com/title/' + r.id + '/'));
      if (r.mc != null) h.push(scoreBlock(r.mc, S.tone(r.mc), 'Metascore', (r.mcN ? r.mcN + ' critics' : 'Metacritic'), r.mcSlug ? 'https://www.metacritic.com/' + (kind === 'movies' ? 'movie' : 'tv') + '/' + r.mcSlug + '/' : null));
      if (r.rt != null) h.push(scoreBlock(r.rt + '%', r.rt >= 60 ? 'good' : 'bad', 'Rotten Tomatoes', (r.rtN ? r.rtN + ' reviews' : 'Tomatometer'), r.rtPath ? 'https://www.rottentomatoes.com/' + r.rtPath : null));
      // Too few critics for a Tomatometer: say so rather than leave a gap.
      else if (r.rtN != null && r.rtPath) h.push(scoreBlock('–', 'plain', 'Rotten Tomatoes', r.rtN + (r.rtN === 1 ? ' review' : ' reviews') + (r.rtN < 5 ? ', too few to score' : ', no score yet'), 'https://www.rottentomatoes.com/' + r.rtPath));
    } else if (kind === 'games') {
      if (r.mc != null) h.push(scoreBlock(r.mc, S.tone(r.mc), 'Metascore', (r.mcN ? r.mcN + ' critics' : 'Metacritic'), r.mcSlug ? 'https://www.metacritic.com/game/' + r.mcSlug + '/' : null));
      if (r.steam != null) h.push(scoreBlock(r.steam + '%', S.tone(r.steam), 'Steam reviews', S.compact(r.steamN) + ' reviews', r.steamId ? 'https://store.steampowered.com/app/' + r.steamId + '/' : null));
      if (r.ign != null) h.push(scoreBlock(r.ign, S.tone(r.ign * 10), 'IGN', 'out of 10', r.ignUrl || null));
    } else {
      if (r.rating != null) h.push(scoreBlock(r.rating.toFixed(2), 'plain', 'Goodreads', S.compact(r.ratings) + ' ratings', r.gr ? 'https://www.goodreads.com/book/show/' + r.gr : r.isbn ? 'https://www.goodreads.com/book/isbn/' + r.isbn : null));
    }
    return h.join('');
  }
  function metaBits(r) {
    var b = [];
    if (kind === 'books') { b.push(esc(r.author)); if (r.year) b.push(r.year < 0 ? -r.year + ' BC' : r.year); }
    else if (kind === 'shows') { b.push(years(r)); if (r.seasons) b.push(r.seasons + (r.seasons === 1 ? ' season' : ' seasons')); if (r.runtime) b.push(runtime(r.runtime) + ' episodes'); if (r.by) b.push('By ' + esc(r.by)); }
    else if (kind === 'movies') { b.push(r.year); if (r.runtime) b.push(runtime(r.runtime)); if (r.by) b.push('Directed by ' + esc(r.by)); }
    else { b.push(r.year); if (r.steamId) b.push('On Steam'); }
    return b.filter(Boolean).map(function (x) { return '<span>' + x + '</span>'; }).join('');
  }
  function linksHTML(r) {
    var l = [];
    if (r.wiki) l.push(['Wikipedia', 'https://en.wikipedia.org/wiki/' + encodeURIComponent(r.wiki.replace(/ /g, '_'))]);
    if (kind === 'games' && r.steamId) l.push(['Steam store', 'https://store.steampowered.com/app/' + r.steamId + '/']);
    if ((kind === 'movies' || kind === 'shows')) l.push(['IMDb', 'https://www.imdb.com/title/' + r.id + '/']);
    return l.map(function (x) { return '<a class="btn sm" href="' + esc(x[1]) + '" target="_blank" rel="noopener">' + x[0] + icon('ext', 'sm') + '</a>'; }).join('');
  }

  function open(id, push) {
    var r = byId[id];
    if (!r) return;
    current = r;
    var tags = (r.genres || []).map(function (g) { return '<a href="?genre=' + encodeURIComponent(g) + '" data-chip="' + esc(g) + '">' + esc(g) + '</a>'; })
      .concat((r.tags || []).slice(0, 6).map(function (t) { return '<a href="?theme=' + encodeURIComponent(t) + '" data-tag="' + esc(t) + '">' + esc(t) + '</a>'; })).join('');
    var saved = S.Favs.has(kind, r.id);
    $('#detailBody').innerHTML =
      '<div class="detail" style="--k:var(--k-' + kind + ')">' +
        S.coverHTML(kind, r, { eager: true }) +
        '<div class="d-head">' +
          '<div class="d-kind">' + K.one.charAt(0).toUpperCase() + K.one.slice(1) + '</div>' +
          '<h2 class="d-title" id="detailTitle">' + esc(r.title) + '</h2>' +
          '<div class="d-meta">' + metaBits(r) + '</div>' +
        '</div>' +
        '<div class="d-body">' +
          (tags ? '<div class="d-genres">' + tags + '</div>' : '') +
          '<div class="scores">' + scoresHTML(r) + '</div>' +
          '<p class="summary" id="summary">' + (r.blurb ? esc(r.blurb) : '') + '</p>' +
          '<div class="d-actions">' +
            '<button class="btn sm" id="saveBtn" aria-pressed="' + saved + '">' + icon('heart', 'sm') + (saved ? 'Saved' : 'Save') + '</button>' +
            (r.yt ? '<button class="btn sm primary" id="trailerBtn">' + icon('play', 'sm') + 'Trailer</button>' : '') +
            '<button class="btn sm" id="shareBtn">' + icon('link', 'sm') + 'Copy link</button>' +
            linksHTML(r) +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="similar"><h3>More like this</h3><div class="mini-row" id="simRow"></div></div>';
    $('#simRow').innerHTML = similar(r).map(function (x) { return S.cardHTML(kind, x, { meta: CONFIG.meta(x) }); }).join('');
    if (!detailDlg.open) detailDlg.showModal();
    detailDlg.querySelector('.sheet').scrollTop = 0;
    if (push !== false) history.replaceState(null, '', location.pathname + location.search + '#' + encodeURIComponent(r.id));
    summary(r);
  }

  var sumCache = {};
  function summary(r) {
    var el = $('#summary');
    var done = function (text, src) {
      if (current !== r || !el) return;
      if (!text) return;
      // Two sentences is enough to decide; the full article is a click away.
      var sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
      var s = sentences.slice(0, 2).join('').trim();
      if (s.length > 330) s = s.slice(0, 330).replace(/\s+\S*$/, '') + '…';
      el.innerHTML = esc(s) + (src ? ' <a class="src" href="' + esc(src) + '" target="_blank" rel="noopener">Wikipedia</a>' : '');
    };
    if (!r.wiki) return;
    if (sumCache[r.id]) return done(sumCache[r.id][0], sumCache[r.id][1]);
    fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(r.wiki.replace(/ /g, '_')))
      .then(function (x) { return x.ok ? x.json() : null; })
      .then(function (j) {
        if (!j || j.type === 'disambiguation' || !j.extract) return;
        sumCache[r.id] = [j.extract, j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page];
        done(sumCache[r.id][0], sumCache[r.id][1]);
      }).catch(function () {});
  }

  /* Same-shelf recommendations: shared genres and themes, weighted by how rare
     they are, plus the same director or author, nudged towards better-rated
     and better-known titles. */
  var idf = null;
  function names(s) { return (s || '').split(/,\s*/).filter(Boolean); }
  function similar(r) {
    if (!idf) {
      idf = {};
      var N = items.length;
      Object.keys(genreCount).forEach(function (g) { idf['g:' + g] = Math.log(N / genreCount[g]); });
      // Themes are finer than genres but noisier, so each counts for less.
      Object.keys(tagCount).forEach(function (t) { idf['t:' + t] = Math.log(N / tagCount[t]) * 0.5; });
    }
    var mine = {};
    (r.genres || []).forEach(function (g) { mine['g:' + g] = 1; });
    (r.tags || []).forEach(function (t) { mine['t:' + t] = 1; });
    var makers = names(r.by || r.author);
    var g = r.genres || [];
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var x = items[i];
      if (x === r) continue;
      var s = 0, shared = 0;
      // Shared genres count for their rarity; genres the original lacks count a little against.
      if (x.genres) for (var a = 0; a < x.genres.length; a++) {
        if (mine['g:' + x.genres[a]]) { s += idf['g:' + x.genres[a]]; shared++; } else s -= idf['g:' + x.genres[a]] * 0.35;
      }
      if (x.tags) for (var b = 0; b < x.tags.length; b++) if (mine['t:' + x.tags[b]]) s += idf['t:' + x.tags[b]];
      if (g.length > 1 && shared >= g.length) s += 1;
      if (makers.length && names(x.by || x.author).some(function (m) { return makers.indexOf(m) >= 0; })) s += 3.5;
      if (s <= 0 || (!shared && s < 3)) continue;
      if (r.year && x.year) s += Math.max(0, 1 - Math.abs(r.year - x.year) / 25) * 0.8;
      s += Math.max(0, x._top - avgTop) * (CONFIG.min.max === 100 ? 0.07 : CONFIG.min.max === 5 ? 2.5 : 0.8);
      s += Math.log10(1 + CONFIG.popular(x)) * 0.5;
      out.push([s, x]);
    }
    out.sort(function (p, q) { return q[0] - p[0]; });
    var seen = {}, list = [];
    for (var j = 0; j < out.length && list.length < 14; j++) {
      var key = S.fold(out[j][1].title).replace(/\b(part|vol|volume|chapter|season)\b.*$/, '').slice(0, 18);
      if (seen[key]) continue;
      seen[key] = 1;
      list.push(out[j][1]);
    }
    return list;
  }

  function openFromHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (id && byId[id]) open(id, false);
  }

  /* -------------------------------------------------------------- events */
  var qT;
  qEl.addEventListener('input', function () {
    qEl.parentNode.classList.toggle('has-value', Boolean(qEl.value));
    clearTimeout(qT);
    qT = setTimeout(function () { state.q = qEl.value.trim(); apply(); }, 140);
  });
  $('#q + .clear, .field .clear').addEventListener('click', function () { qEl.value = ''; qEl.parentNode.classList.remove('has-value'); state.q = ''; apply(); qEl.focus(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; apply(); });

  function toggleIn(list, v) { var i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var fav = t.closest('[data-fav]');
    if (fav) {
      e.preventDefault(); e.stopPropagation();
      var fid = fav.getAttribute('data-fav');
      var on = S.Favs.toggle(kind, fid);
      document.querySelectorAll('[data-fav="' + CSS.escape(fid) + '"]').forEach(function (f) { f.classList.toggle('on', on); });
      S.toast(on ? 'Saved' : 'Removed from saved');
      if (state.saved) apply(true);
      return;
    }
    var chip = t.closest('[data-chip]');
    if (chip) {
      e.preventDefault();
      var g = chip.getAttribute('data-chip');
      if (!g) { state.genres = []; state.tags = []; }
      else if (chip.closest('#detailBody')) { state.genres = [g]; state.tags = []; detailDlg.close(); }
      else toggleIn(state.genres, g);
      apply(true);
      return;
    }
    var tag = t.closest('[data-tag]');
    if (tag) {
      e.preventDefault();
      var v = tag.getAttribute('data-tag');
      if (tag.closest('#detailBody')) { state.genres = []; state.tags = [v]; detailDlg.close(); }
      else toggleIn(state.tags, v);
      apply(true);
      return;
    }
    if (t.closest('[data-open="genres"]')) { openGenres(); return; }
    var mt = t.closest('[data-match]');
    if (mt) { state.match = mt.getAttribute('data-match'); apply(true); layoutPicker(); return; }
    if (t.closest('#genreClear')) { state.genres = []; state.tags = []; apply(true); layoutPicker(); return; }
    var ex = t.closest('[data-expand]');
    if (ex) { expanded[ex.getAttribute('data-expand')] = true; layoutPicker(); return; }
    var ct = t.closest('[data-country]');
    if (ct) { toggleIn(state.country, ct.getAttribute('data-country')); apply(true); return; }
    if (t.closest('[data-more-countries]')) { allCountries = true; openFilters(); return; }
    if (t.closest('#filtersBtn')) { openFilters(); return; }
    if (t.closest('[data-trailers]') && (kind === 'movies' || kind === 'shows') && loaded) { e.preventDefault(); openReels(null, true); return; }
    if (t.closest('#trailerBtn') && current) {
      var tid = current.id;
      detailDlg.close();
      if (window.ShelfReels && window.ShelfReels.isOpen()) window.ShelfReels.open({ start: tid });
      else openReels(tid, true);
      return;
    }
    if (t.closest('[data-close]')) { t.closest('dialog').close(); return; }
    var dec = t.closest('[data-dec]');
    if (dec) {
      var p = dec.getAttribute('data-dec').split('-');
      var from = Number(p[0]) || null, to = Number(p[1]) || null;
      var same = state.from === from && state.to === to;
      state.from = same ? null : from; state.to = same ? null : to;
      filtersDlg.querySelectorAll('[data-dec]').forEach(function (c) { c.setAttribute('aria-pressed', String(!same && c === dec)); });
      $('#fFrom').value = state.from || ''; $('#fTo').value = state.to || '';
      apply(true);
      return;
    }
    var sg = t.closest('[data-seg]');
    if (sg) {
      var key = sg.getAttribute('data-seg'), val = sg.getAttribute('data-val');
      if (key === 'saved') state.saved = val === '1'; else state[key] = val;
      sg.parentNode.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', String(c === sg)); });
      apply(true);
      return;
    }
    var drop = t.closest('[data-drop]');
    if (drop) {
      var d = drop.getAttribute('data-drop');
      if (d === 'years') { state.from = null; state.to = null; }
      else if (d === 'min') state.min = null;
      else if (d === 'q') { state.q = ''; qEl.value = ''; qEl.parentNode.classList.remove('has-value'); }
      else if (d === 'saved') state.saved = false;
      else if (d === 'country') state.country = state.country.filter(function (c) { return c !== drop.getAttribute('data-val'); });
      else state[d] = '';
      apply(true);
      return;
    }
    if (t.closest('[data-reset]')) {
      var keepSort = state.sort;
      state = defaults(); state.sort = keepSort;
      qEl.value = ''; qEl.parentNode.classList.remove('has-value');
      if (filtersDlg.open) openFilters();
      apply(true);
      return;
    }
    if (t.closest('#surprise')) {
      if (results.length) open(results[Math.floor(Math.random() * Math.min(results.length, 400))].id);
      return;
    }
    if (t.closest('#saveBtn') && current) {
      var now = S.Favs.toggle(kind, current.id);
      var sb = $('#saveBtn');
      sb.setAttribute('aria-pressed', String(now));
      sb.innerHTML = icon('heart', 'sm') + (now ? 'Saved' : 'Save');
      var cardFav = grid.querySelector('[data-fav="' + CSS.escape(current.id) + '"]');
      if (cardFav) cardFav.classList.toggle('on', now);
      return;
    }
    if (t.closest('#shareBtn') && current) {
      var url = location.origin + location.pathname + '#' + encodeURIComponent(current.id);
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { S.toast('Link copied'); }, function () { prompt('Copy this link', url); });
      return;
    }
    var card = t.closest('.card[data-id]');
    if (card && !card.matches('a')) { e.preventDefault(); open(card.getAttribute('data-id')); }
  });

  detailDlg.addEventListener('close', function () {
    current = null;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  });
  [detailDlg, genresDlg, filtersDlg].forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
  });
  document.addEventListener('keydown', function (e) {
    if (!detailDlg.open || !current) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var i = results.indexOf(current);
    if (i < 0) return;
    var next = results[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) open(next.id);
  });
  window.addEventListener('hashchange', openFromHash);

  var io = new IntersectionObserver(function (es) {
    if (es[0].isIntersecting && shown < results.length) renderMore();
  }, { rootMargin: '1200px 0px' });
  io.observe($('#sentinel'));

  /* ----------------------------------------------------------- trailer reels */
  var reelsJs = null, reelsPushed = false;
  function loadReels() {
    if (!reelsJs) reelsJs = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'assets/reels.js?v=' + (($('meta[name="shelf-build"]') || {}).content || '');
      sc.onload = resolve;
      sc.onerror = function () { reelsJs = null; reject(); };
      document.head.appendChild(sc);
    });
    return reelsJs;
  }
  /* push: add a history entry, so Back (or a phone's back gesture) closes the feed
     rather than leaving the page. Opened from the address, there is none to add. */
  function openReels(startId, push) {
    if (!(kind === 'movies' || kind === 'shows') || !loaded) return;
    state.view = 'trailers';
    if (push) { history.pushState({ reels: 1 }, '', location.pathname + location.search + location.hash); reelsPushed = true; }
    writeURL();
    loadReels().then(function () { window.ShelfReels.open({ start: startId }); }, function () { S.toast('Could not load trailers'); });
  }
  function closeReels() {
    state.view = '';
    if (reelsPushed) { reelsPushed = false; history.back(); } else writeURL();
  }
  window.addEventListener('popstate', function () {
    if (new URLSearchParams(location.search).get('view') === 'trailers') return;
    if (window.ShelfReels && window.ShelfReels.isOpen()) { reelsPushed = false; window.ShelfReels.close(true); }
    state.view = '';
    // Genres or filters changed inside the feed carry over to the grid.
    if (loaded) { writeURL(); apply(true); }
  });

  window.ShelfCatalog = {
    open: open, kind: kind,
    results: function () { return results; },
    byId: function (id) { return byId[id]; },
    avgTop: function () { return avgTop; },
    state: function () { return state; },
    filterCount: filterCount,
    sorters: SORTERS, sorts: CONFIG.sorts,
    setOrder: function (v) { state.rsort = v; writeURL(); if (window.ShelfReels) window.ShelfReels.refresh(); },
    openFilters: openFilters,
    closeReels: closeReels,
  };
  chipFade();   // the chip row the page was built with may already overflow
  if (kind === 'movies' || kind === 'shows') {
    document.addEventListener('shelf:trailers', function () { loadReels().catch(function () {}); });
    if (state.view === 'trailers') S.warmTrailers();
  }
  load();
})();
