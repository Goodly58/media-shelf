/* Shelf · trailer reels for films and series. A vertical feed of YouTube trailers that
   follows the catalogue's own genres, themes, filters and order, loaded by catalog.js
   when someone opens it.

   YouTube's rules for embedded players shape the layout: nothing is drawn over a
   player or its controls, at most one plays at a time, and playback starts only once
   the player is fully on screen (never behind an open panel). Players run in YouTube's
   privacy-enhanced mode (youtube-nocookie.com). */
(function () {
  'use strict';
  var S = window.Shelf, C = window.ShelfCatalog, icon = S.icon, esc = S.esc;
  var kind = C.kind;
  var SEEN_KEY = 'shelf_seen_trailers', CHUNK = 30;
  var reduce = Boolean(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  var dlg, track, empty, io, list = [], active = -1, rendered = 0;
  var players = {}, muted = true, api = null, blocked = false, timers = {};

  /* ------------------------------------------------------------ seen */
  // Trailers watched lately go to the back of a shuffle, so the feed does not repeat itself.
  var seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') || []; } catch (e) { seen = []; }
  function markSeen(id) {
    var i = seen.indexOf(id);
    if (i >= 0) seen.splice(i, 1);
    seen.push(id);
    if (seen.length > 400) seen.shift();
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
  }

  /* ------------------------------------------------------------ order */
  /* A weighted shuffle (each title draws random^(1/weight)): better-rated, better-known
     titles tend to come sooner, every change of genre or filter deals a new order, and
     anything watched recently goes after everything that was not. */
  function shuffle(rows) {
    var avg = C.avgTop(), recent = {};
    for (var i = 0; i < seen.length; i++) recent[seen[i]] = 1;
    return rows.map(function (r) {
      var w = Math.exp(Math.max(-2.5, Math.min(2.5, (r._top - avg) * 0.8)));
      return [Math.pow(Math.random(), 1 / w) - (recent[r.id] ? 2 : 0), r];
    }).sort(function (a, b) { return b[0] - a[0]; }).map(function (x) { return x[1]; });
  }
  function order(startId) {
    var rows = C.results().filter(function (r) { return r.yt; });
    var by = C.state().rsort;
    rows = by === 'shuffle' || !C.sorters[by] ? shuffle(rows) : rows.slice().sort(C.sorters[by]);
    if (startId) {
      var at = -1;
      for (var i = 0; i < rows.length; i++) if (rows[i].id === startId) { at = i; break; }
      if (at < 0 && C.byId(startId) && C.byId(startId).yt) rows.unshift(C.byId(startId));
      else if (at > 0) rows.unshift(rows.splice(at, 1)[0]);
    }
    return rows;
  }

  /* ------------------------------------------------------------ markup */
  function runtime(m) { if (!m) return ''; var h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm'; }
  function sub(r) {
    var b = [];
    if (kind === 'shows') b.push(r.end && r.end !== r.year ? r.year + '–' + r.end : r.year);
    (r.genres || []).slice(0, 2).forEach(function (g) { b.push(g); });
    if (kind === 'movies' && r.runtime) b.push(runtime(r.runtime));
    if (kind === 'shows' && r.seasons) b.push(r.seasons + (r.seasons === 1 ? ' season' : ' seasons'));
    if (r.by) b.push(r.by.split(',')[0]);
    return b.filter(Boolean).map(esc).join(' · ');
  }
  function scores(r) {
    var s = [];
    if (r.imdb != null) s.push('<span><b>' + r.imdb.toFixed(1) + '</b>IMDb</span>');
    if (r.mc != null) s.push('<span><b>' + r.mc + '</b>Metascore</span>');
    if (r.rt != null) s.push('<span><b>' + r.rt + '%</b>Rotten Tomatoes</span>');
    return s.join('');
  }
  function soundLabel() { return icon(muted ? 'mute' : 'sound', 'sm') + '<span>' + (muted ? 'Sound off' : 'Sound on') + '</span>'; }
  function slide(r, i) {
    var picked = C.state().tags;
    var tags = (r.tags || []).slice(0, 4).map(function (t) {
      return '<button class="chip" type="button" data-tag="' + esc(t) + '" aria-pressed="' + (picked.indexOf(t) >= 0) + '">' + esc(t) + '</button>';
    }).join('');
    var saved = S.Favs.has(kind, r.id);
    return '<section class="reel" data-i="' + i + '" aria-roledescription="trailer" aria-label="' + esc(r.title) + '">' +
      '<div class="reel-bg" data-bg="' + esc(S.imgUrl(kind, r) || '') + '"></div>' +
      '<div class="reel-in">' +
        '<div class="reel-head"><h2>' + esc(r.title) + '</h2><div class="reel-sub">' + sub(r) + '</div></div>' +
        '<div class="reel-player" data-thumb="https://i.ytimg.com/vi/' + esc(r.yt) + '/hqdefault.jpg"><div class="reel-slot"></div></div>' +
        (scores(r) ? '<div class="reel-scores">' + scores(r) + '</div>' : '') +
        (tags ? '<div class="reel-tags">' + tags + '</div>' : '') +
        '<div class="reel-act">' +
          '<button class="btn sm" type="button" data-reel-sound>' + soundLabel() + '</button>' +
          '<button class="btn sm reel-fav' + (saved ? ' on' : '') + '" type="button" data-fav="' + esc(r.id) + '" aria-label="Save">' + icon('heart', 'sm') + '<span>Save</span></button>' +
          '<button class="btn sm" type="button" data-reel-detail="' + esc(r.id) + '">' + icon('info', 'sm') + '<span>Details</span></button>' +
          '<button class="icon-btn reel-next" type="button" data-reel-next aria-label="Next trailer">' + icon('chevD') + '</button>' +
        '</div>' +
      '</div>' +
    '</section>';
  }
  function bar() {
    var sorts = [['shuffle', 'Shuffle']].concat(C.sorts);
    var cur = C.state().rsort;
    return '<div class="reels-bar">' +
      '<button class="icon-btn" type="button" data-reels-close aria-label="Close trailers">' + icon('x') + '</button>' +
      '<nav class="reels-kinds" aria-label="Trailers">' + ['movies', 'shows'].map(function (k) {
        return '<a href="' + S.KINDS[k].page + '?view=trailers"' + (k === kind ? ' aria-current="page"' : '') + '>' + S.KINDS[k].label + '</a>';
      }).join('') + '</nav>' +
      '<select class="select" id="reelsSort" aria-label="Order">' + sorts.map(function (s) {
        return '<option value="' + s[0] + '"' + (s[0] === cur ? ' selected' : '') + '>' + s[1] + '</option>';
      }).join('') + '</select>' +
      '<button class="btn sm" type="button" data-open="genres" aria-label="Genres">' + icon('plus', 'sm') + '<span>Genres</span><span class="count" data-count="genres" hidden></span></button>' +
      '<button class="btn sm" type="button" data-reels-filters aria-label="Filters">' + icon('sliders', 'sm') + '<span>Filters</span><span class="count" data-count="filters" hidden></span></button>' +
    '</div>';
  }
  function counts() {
    var st = C.state(), g = st.genres.length + st.tags.length, f = C.filterCount();
    [['genres', g], ['filters', f]].forEach(function (x) {
      var el = dlg.querySelector('[data-count="' + x[0] + '"]');
      if (el) { el.textContent = x[1]; el.hidden = !x[1]; }
    });
  }

  /* ------------------------------------------------------------ feed */
  function more() {
    var end = Math.min(rendered + CHUNK, list.length), html = '';
    for (var i = rendered; i < end; i++) html += slide(list[i], i);
    track.insertAdjacentHTML('beforeend', html);
    for (var j = rendered; j < end; j++) io.observe(track.children[j]);
    rendered = end;
  }
  function slideAt(i) { return track.children[i] || null; }
  // Posters behind a slide and the trailer's still go in only near the one on screen.
  function paint(i) {
    var el = slideAt(i);
    if (!el || el.__painted) return;
    el.__painted = true;
    var bg = el.querySelector('.reel-bg'), pl = el.querySelector('.reel-player');
    if (bg.getAttribute('data-bg')) bg.style.backgroundImage = 'url("' + bg.getAttribute('data-bg') + '")';
    pl.style.backgroundImage = 'url("' + pl.getAttribute('data-thumb') + '")';
  }
  function setActive(i) {
    if (i === active || !list[i]) return;
    active = i;
    for (var j = i - 1; j <= i + 2; j++) paint(j);
    Object.keys(players).forEach(function (k) {
      k = Number(k);
      if (k < i - 1 || k > i + 1) destroy(k); else if (k !== i) pause(k);
    });
    clearTimeout(timers.start);
    // A short wait, so swiping quickly past a trailer does not start it.
    timers.start = setTimeout(function () { if (active === i) start(i); }, 180);
    if (rendered - i < 8 && rendered < list.length) more();
  }
  function next(step) {
    var el = slideAt(active + (step || 1));
    if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  function refresh(startId) {
    Object.keys(players).forEach(function (k) { destroy(Number(k)); });
    io.disconnect();
    list = order(startId);
    track.innerHTML = '';
    rendered = 0; active = -1;
    track.scrollTop = 0;
    empty.hidden = list.length > 0;
    counts();
    if (list.length) more();
  }

  /* ------------------------------------------------------------ YouTube */
  function loadApi() {
    if (api) return api;
    api = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) { resolve(window.YT); return; }
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); resolve(window.YT); };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = function () { api = null; reject(new Error('YouTube did not load')); };
      document.head.appendChild(s);
    });
    return api;
  }
  function slot(i) { var el = slideAt(i); return el && el.querySelector('.reel-player'); }

  function create(i, autoplay) {
    if (players[i] || !list[i]) return;
    players[i] = { pending: true };
    loadApi().then(function (YT) {
      var box = slot(i);
      if (!box || !players[i] || !players[i].pending) return;
      var p = new YT.Player(box.querySelector('.reel-slot'), {
        host: 'https://www.youtube-nocookie.com',
        videoId: list[i].yt, width: '100%', height: '100%',
        playerVars: { autoplay: autoplay ? 1 : 0, mute: muted ? 1 : 0, playsinline: 1, rel: 0, iv_load_policy: 3, origin: location.origin },
        events: {
          onReady: function (e) {
            p.ready = true;
            var f = e.target.getIframe && e.target.getIframe();
            if (f) f.title = 'Trailer: ' + list[i].title;
            if (i === active && !blocked && !reduce) { sound(e.target); e.target.playVideo(); watch(i); cueNext(i); }
          },
          onStateChange: function (e) {
            if (i !== active) return;
            if (e.data === YT.PlayerState.PLAYING) {
              clearTimeout(timers.check);
              clearTimeout(timers.seen);
              timers.seen = setTimeout(function () { if (i === active) markSeen(list[i].id); }, 3000);
            } else if (e.data === YT.PlayerState.ENDED) next();
          },
          onError: function () { gone(i); },
        },
      });
      players[i] = p;
    }, function () { offline(i); });
  }
  // Browsers may refuse to start a trailer with sound before a tap: if it never started
  // at all (still unstarted or cued, so not an ad or buffering), fall back to muted.
  function watch(i) {
    clearTimeout(timers.check);
    timers.check = setTimeout(function () {
      var p = players[i];
      if (i !== active || !p || !p.ready || muted) return;
      var st = p.getPlayerState();
      if (st === -1 || st === 5) { muted = true; sound(p); p.playVideo(); labels(); }
    }, 3500);
  }
  function sound(p) {
    if (!p || !p.ready) return;
    if (muted) p.mute(); else { p.unMute(); p.setVolume(100); }
  }
  function start(i) {
    if (blocked) return;
    var p = players[i];
    if (!p) { create(i, !reduce); return; }
    if (p.ready) { sound(p); if (!reduce) { p.playVideo(); watch(i); } cueNext(i); }
  }
  function cueNext(i) { if (list[i + 1] && !players[i + 1]) create(i + 1, false); }
  function pause(i) { var p = players[i]; if (p && p.ready && p.getPlayerState() === 1) p.pauseVideo(); }
  function destroy(i) {
    var p = players[i];
    delete players[i];
    if (p && p.destroy) { try { p.destroy(); } catch (e) {} }
    var box = slot(i);
    if (box && !box.querySelector('.reel-slot') && !box.classList.contains('gone')) box.insertAdjacentHTML('afterbegin', '<div class="reel-slot"></div>');
  }
  function gone(i) {
    destroy(i);
    var box = slot(i);
    if (box) {
      box.classList.add('gone');
      box.innerHTML = '<p>This trailer is no longer available. <a href="https://www.youtube.com/watch?v=' + esc(list[i].yt) + '" target="_blank" rel="noopener">Try YouTube</a></p>';
    }
    if (i === active) setTimeout(function () { if (i === active) next(); }, 1500);
  }
  function offline(i) {
    delete players[i];
    var box = slot(i);
    if (box && !box.classList.contains('gone')) {
      box.classList.add('gone');
      box.innerHTML = '<p>YouTube did not load. <a href="https://www.youtube.com/watch?v=' + esc(list[i].yt) + '" target="_blank" rel="noopener">Watch on YouTube</a></p>';
    }
  }
  function labels() { dlg.querySelectorAll('[data-reel-sound]').forEach(function (b) { b.innerHTML = soundLabel(); b.setAttribute('aria-pressed', String(!muted)); }); }

  /* ------------------------------------------------------------ panels over the feed */
  // Genres, filters and details open on top of the feed: the trailer waits until they close.
  function watchPanels() {
    var panels = ['#genresDlg', '#filtersDlg', '#detailDlg'].map(function (s) { return document.querySelector(s); }).filter(Boolean);
    var mo = new MutationObserver(function () {
      var any = panels.some(function (d) { return d.open; });
      if (any === blocked) return;
      blocked = any;
      if (blocked) Object.keys(players).forEach(function (k) { pause(Number(k)); });
      else if (dlg.open && active >= 0) start(active);
    });
    panels.forEach(function (d) { mo.observe(d, { attributes: true, attributeFilter: ['open'] }); });
  }

  /* ------------------------------------------------------------ open and close */
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'reels';
    dlg.setAttribute('aria-label', 'Trailers');
    // Opening focuses the feed itself rather than its first button, so no focus ring
    // appears unprompted; Tab still reaches every control.
    dlg.tabIndex = -1;
    dlg.innerHTML = bar() + '<div class="reels-track" id="reelsTrack"></div>' +
      '<div class="reels-empty" hidden><h2>No trailers here</h2><p>None of these ' + S.KINDS[kind].many + ' has a trailer yet. Try other filters.</p><p><button class="btn sm" type="button" data-reset>Clear filters</button></p></div>';
    document.body.appendChild(dlg);
    track = dlg.querySelector('.reels-track');
    empty = dlg.querySelector('.reels-empty');
    io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number(e.target.getAttribute('data-i'))); });
    }, { root: track, threshold: [0.6] });

    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-reels-close]')) { close(); return; }
      if (t.closest('[data-reels-filters]')) { C.openFilters(); return; }
      if (t.closest('[data-reel-next]')) { next(); return; }
      if (t.closest('[data-reel-sound]')) {
        muted = !muted; labels();
        var p = players[active];
        if (p && p.ready) { sound(p); if (p.getPlayerState() !== 1 && !blocked) p.playVideo(); }
        return;
      }
      var d = t.closest('[data-reel-detail]');
      if (d) { C.open(d.getAttribute('data-reel-detail')); return; }
    });
    dlg.querySelector('#reelsSort').addEventListener('change', function () { C.setOrder(this.value); });
    dlg.addEventListener('keydown', function (e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); next(1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); next(-1); }
      else if (e.key === 'm') { dlg.querySelector('[data-reel-sound]') && dlg.querySelector('[data-reel-sound]').click(); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) Object.keys(players).forEach(function (k) { pause(Number(k)); });
    });
    watchPanels();
  }

  /* The catalogue page owns the address: it opens the feed, and closes it on Back. */
  function open(opts) {
    opts = opts || {};
    if (!dlg) build();
    document.documentElement.classList.add('reels-open');
    if (!dlg.open) { dlg.showModal(); dlg.focus(); }
    loadApi().catch(function () {});
    refresh(opts.start);
  }
  // quiet: the page is already closing it (Back was pressed), so do not tell it again.
  function close(quiet) {
    Object.keys(players).forEach(function (k) { destroy(Number(k)); });
    clearTimeout(timers.start); clearTimeout(timers.check); clearTimeout(timers.seen);
    io.disconnect();
    track.innerHTML = '';
    if (dlg.open) dlg.close();
    document.documentElement.classList.remove('reels-open');
    if (quiet !== true) C.closeReels();
  }

  window.ShelfReels = {
    open: open,
    close: close,
    isOpen: function () { return Boolean(dlg && dlg.open); },
    // The catalogue changed (genres, filters, order): deal a new feed.
    refresh: function () { if (dlg && dlg.open) refresh(); },
  };
})();
