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
  var players = {}, muted = true, api = null, blocked = false, timers = {}, skips = 0;
  var BUILD = (document.querySelector('meta[name="shelf-build"]') || {}).content || '';

  /* ------------------------------------------------------------ backups */
  /* A trailer can stop playing between the nightly checks (taken private or down) or never
     play in some places (blocked in a country, or age-gated), which no check from elsewhere
     can see. So each title brings up to two backups, in a file fetched once the feed is open,
     and a video that fails here is remembered on this device for a month and not tried again. */
  var backups = null, backupsP = null;
  function loadBackups() {
    if (!backupsP) {
      backupsP = fetch('data/' + kind + '-trailers.json?v=' + BUILD).then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; }).then(function (b) { backups = b; return b; });
    }
    return backupsP;
  }
  var BAD_KEY = 'shelf_bad_trailers', bad = {}, failedNow = {};
  try { bad = JSON.parse(localStorage.getItem(BAD_KEY) || '{}') || {}; } catch (e) { bad = {}; }
  Object.keys(bad).forEach(function (k) { if (!(bad[k] > Date.now() - 30 * 864e5)) delete bad[k]; });
  function remember(yt) {
    bad[yt] = Date.now();
    var keys = Object.keys(bad);
    if (keys.length > 300) keys.sort(function (a, b) { return bad[a] - bad[b]; }).slice(0, keys.length - 300).forEach(function (k) { delete bad[k]; });
    try { localStorage.setItem(BAD_KEY, JSON.stringify(bad)); } catch (e) {}
  }
  // A title's videos still worth trying here, best first.
  function videos(r) {
    return [r.yt].concat((backups && backups[r.id]) || []).filter(function (v) { return v && !bad[v] && !failedNow[v]; });
  }

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
    // Hidden titles never come up, unless hidden ones are what the filters ask for.
    var skip = !C.state().hidden;
    // Titles none of whose videos play here are left out, once the backups say so.
    var rows = C.results().filter(function (r) { return r.yt && !(skip && S.Hidden.has(kind, r.id)) && (!backups || videos(r).length); });
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
  /* Each source's scores under its name: IMDb, then Metacritic and Rotten Tomatoes with
     their critics' and audience scores side by side, each with how many it comes from. */
  function score(href, value, count) {
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener"><b>' + value + '</b><small>' + count + '</small></a>';
  }
  function group(name, items) {
    items = items.filter(Boolean);
    return items.length ? '<span class="grp"><span class="src">' + name + '</span>' + items.join('') + '</span>' : '';
  }
  function plural(n, one) { return S.compact(n) + ' ' + one + (n === 1 ? '' : 's'); }
  function scores(r) {
    var mc = 'https://www.metacritic.com/' + (kind === 'movies' ? 'movie' : 'tv') + '/' + (r.mcSlug || '') + '/';
    var rt = 'https://www.rottentomatoes.com/' + (r.rtPath || '');
    return [
      group('IMDb', [r.imdb != null && score('https://www.imdb.com/title/' + r.id + '/', r.imdb.toFixed(1), r.votes ? plural(r.votes, 'vote') : 'votes')]),
      group('Metacritic', [
        r.mc != null && score(mc, r.mc, r.mcN ? plural(r.mcN, 'critic') : 'critics'),
        r.mcu != null && score(mc + 'user-reviews/', r.mcu.toFixed(1), r.mcuN ? plural(r.mcuN, 'user') : 'users'),
      ]),
      group('Rotten Tomatoes', [
        r.rt != null ? score(rt, r.rt + '%', r.rtN ? plural(r.rtN, 'critic') : 'critics')
          // Too few critics for a Tomatometer: said, rather than the score just being absent.
          : r.rtN != null && r.rtPath && score(rt, '–', r.rtN < 5 ? 'too few critics' : 'no score yet'),
        r.rta != null && score(rt, r.rta + '%', r.rtaN ? S.compact(r.rtaN) + '+ audience' : 'audience'),
      ]),
    ].join('');
  }
  function soundLabel() { return icon(muted ? 'mute' : 'sound', 'sm') + '<span>' + (muted ? 'Sound off' : 'Sound on') + '</span>'; }
  function slide(r, i) {
    var picked = C.state().tags;
    var tags = (r.tags || []).slice(0, 4).map(function (t) {
      return '<button class="chip" type="button" data-tag="' + esc(t) + '" aria-pressed="' + (picked.indexOf(t) >= 0) + '">' + esc(t) + '</button>';
    }).join('');
    var saved = S.Favs.has(kind, r.id), hid = S.Hidden.has(kind, r.id);
    return '<section class="reel" data-i="' + i + '" aria-roledescription="trailer" aria-label="' + esc(r.title) + '">' +
      '<div class="reel-bg" data-bg="' + esc(S.imgUrl(kind, r) || '') + '"></div>' +
      '<div class="reel-in">' +
        '<div class="reel-head"><h2>' + esc(r.title) + '</h2><div class="reel-sub">' + sub(r) + '</div></div>' +
        '<div class="reel-player" data-thumb="https://i.ytimg.com/vi/' + esc(videos(r)[0] || r.yt) + '/hqdefault.jpg"><div class="reel-slot"></div></div>' +
        (scores(r) ? '<div class="reel-scores">' + scores(r) + '</div>' : '') +
        (tags ? '<div class="reel-tags">' + tags + '</div>' : '') +
        '<div class="reel-act">' +
          '<button class="btn sm" type="button" data-reel-sound>' + soundLabel() + '</button>' +
          '<button class="btn sm reel-fav' + (saved ? ' on' : '') + '" type="button" data-fav="' + esc(r.id) + '" aria-label="Save">' + icon('heart', 'sm') + '<span>Save</span></button>' +
          '<button class="btn sm reel-hide" type="button" data-reel-hide aria-pressed="' + hid + '" title="Never show this one again">' + icon('eyeOff', 'sm') + '<span>' + (hid ? 'Hidden' : 'Hide') + '</span></button>' +
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
  function setActive(i, now) {
    if (i === active || !list[i]) return;
    active = i;
    for (var j = i - 1; j <= i + 2; j++) paint(j);
    Object.keys(players).forEach(function (k) {
      k = Number(k);
      if (k < i - 1 || k > i + 1) destroy(k); else if (k !== i) pause(k);
    });
    clearTimeout(timers.start);
    // A short wait, so swiping quickly past a trailer does not start it; none for the first.
    if (now) start(i);
    else timers.start = setTimeout(function () { if (active === i) start(i); }, 180);
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
    if (list.length) { more(); setActive(0, true); }
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
  function embed(yt, autoplay) {
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(yt) + '?autoplay=' + (autoplay ? 1 : 0) + '&mute=' + (muted ? 1 : 0) +
      '&playsinline=1&rel=0&iv_load_policy=3&enablejsapi=1&origin=' + encodeURIComponent(location.origin);
  }

  /* A player's frame goes in at once and starts loading (and, for the trailer on screen,
     playing) by itself. YouTube's API, which may still be on its way, takes hold of the
     frame when it arrives, to pause, mute and follow it. Each entry: { f: frame, p: player,
     ready, auto: started playing by itself, yt: the video it plays }. */
  function create(i, autoplay) {
    var box = slot(i), r = list[i];
    if (players[i] || !r || !box || box.classList.contains('gone')) return;
    var yt = videos(r)[0];
    if (!yt) {
      // Nothing left to try until the backups are in, or nothing at all.
      if (backups) gone(i);
      else loadBackups().then(function () { if (list[i] === r && !players[i]) { if (videos(r).length) create(i, autoplay && i === active); else gone(i); } });
      return;
    }
    // The still behind the player follows the video it is about to play.
    if (yt !== r.yt) box.style.backgroundImage = 'url("https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg")';
    var f = document.createElement('iframe');
    f.src = embed(yt, autoplay);
    f.title = 'Trailer: ' + list[i].title;
    f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    var old = box.querySelector('.reel-slot');
    if (old) box.replaceChild(f, old); else box.appendChild(f);
    var e = players[i] = { f: f, p: null, ready: false, auto: Boolean(autoplay), yt: yt };
    loadApi().then(function (YT) {
      if (players[i] !== e) return;
      e.p = new YT.Player(f, {
        events: {
          onReady: function () {
            e.ready = true;
            if (i === active && !blocked && !reduce) { sound(e); e.p.playVideo(); watch(i); cueNext(i); }
            else if (e.auto) e.p.pauseVideo();
          },
          onStateChange: function (ev) {
            if (i !== active) return;
            if (ev.data === YT.PlayerState.PLAYING) {
              skips = 0;
              clearTimeout(timers.check);
              clearTimeout(timers.seen);
              timers.seen = setTimeout(function () { if (i === active) markSeen(list[i].id); }, 3000);
            } else if (ev.data === YT.PlayerState.ENDED) next();
          },
          onError: function (ev) { if (players[i] === e) failed(i, ev.data); },
        },
      });
    }, function () {});
  }
  // Browsers may refuse to start a trailer with sound before a tap: if it never started
  // at all (still unstarted or cued, so not an ad or buffering), fall back to muted.
  function watch(i) {
    clearTimeout(timers.check);
    timers.check = setTimeout(function () {
      var e = players[i];
      if (i !== active || !e || !e.ready || muted) return;
      var st = e.p.getPlayerState();
      if (st === -1 || st === 5) { muted = true; sound(e); e.p.playVideo(); labels(); }
    }, 3500);
  }
  function sound(e) {
    if (!e || !e.ready) return;
    if (muted) e.p.mute(); else { e.p.unMute(); e.p.setVolume(100); }
  }
  function start(i) {
    if (blocked) return;
    var e = players[i];
    if (!e) { create(i, !reduce); return; }
    if (e.ready) { sound(e); if (!reduce) { e.p.playVideo(); watch(i); } cueNext(i); }
  }
  function cueNext(i) { if (list[i + 1] && !players[i + 1]) create(i + 1, false); }
  // A frame that started by itself and that the API has not reached yet cannot be paused,
  // so it goes: never two trailers playing at once.
  function pause(i) {
    var e = players[i];
    if (!e) return;
    if (e.ready) { if (e.p.getPlayerState() === 1) e.p.pauseVideo(); }
    else if (e.auto) destroy(i);
  }
  function destroy(i) {
    var e = players[i];
    delete players[i];
    if (e) {
      if (e.p && e.p.destroy) { try { e.p.destroy(); } catch (x) {} }
      if (e.f && e.f.parentNode) e.f.parentNode.removeChild(e.f);
    }
    var box = slot(i);
    if (box && !box.querySelector('.reel-slot') && !box.classList.contains('gone')) box.insertAdjacentHTML('afterbegin', '<div class="reel-slot"></div>');
  }
  /* A video that will not play gives way to the title's next one, at once and in place. YouTube's
     100 (removed or private), 101 and 150 (not allowed here, or age-gated) are remembered on this
     device; 2 and 5 only for now. When nothing is left, the feed moves on. */
  function failed(i, code) {
    var e = players[i], r = list[i];
    if (!e || !r) return;
    failedNow[e.yt] = 1;
    if (code === 100 || code === 101 || code === 150) remember(e.yt);
    destroy(i);
    loadBackups().then(function () {
      if (list[i] !== r || players[i]) return;
      if (videos(r).length) create(i, i === active && !blocked && !reduce);
      else gone(i);
    });
  }
  function gone(i) {
    destroy(i);
    var box = slot(i), r = list[i];
    if (box && r) {
      box.classList.add('gone');
      box.innerHTML = '<p>This trailer is unavailable. <a href="https://www.youtube.com/results?search_query=' + encodeURIComponent(r.title + ' ' + (r.year || '') + ' trailer') + '" target="_blank" rel="noopener">Search YouTube</a></p>';
    }
    // Straight on to the next; after three in a row it waits for a swipe, rather than racing on.
    if (i === active && skips < 3) { skips++; setTimeout(function () { if (i === active) next(); }, 500); }
  }
  function labels() { dlg.querySelectorAll('[data-reel-sound]').forEach(function (b) { b.innerHTML = soundLabel(); b.setAttribute('aria-pressed', String(!muted)); }); }

  /* ------------------------------------------------------------ hiding */
  /* Hide: the trailer goes, the next one starts, and the title never comes up in the feed
     (or among suggestions) again. The catalogue keeps the list; Undo is a tap away. */
  function hideAt(i) {
    var r = list[i];
    if (!r) return;
    var on = !S.Hidden.has(kind, r.id);
    C.setHidden(r.id, on);
    if (!on) return;
    S.toast('Hidden', { host: dlg, action: ['Undo', function () {
      C.setHidden(r.id, false);
      var el = slideAt(i);
      if (el && i !== active) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }] });
    if (i === active) next();
  }
  // A slide follows its title's hidden state: its player gives way to a note, and comes back.
  function mark(i, on) {
    var el = slideAt(i), box = slot(i);
    if (!el || !box) return;
    var b = el.querySelector('.reel-act [data-reel-hide]');
    b.setAttribute('aria-pressed', String(on));
    b.lastChild.textContent = on ? 'Hidden' : 'Hide';
    if (on && !box.classList.contains('hid')) {
      destroy(i);
      box.classList.add('gone', 'hid');
      box.innerHTML = '<div><p>Hidden</p><button class="btn sm" type="button" data-reel-hide>Undo</button></div>';
    } else if (!on && box.classList.contains('hid')) {
      box.classList.remove('gone', 'hid');
      box.innerHTML = '<div class="reel-slot"></div>';
      if (i === active) start(i);
    }
  }

  loadApi().catch(function () {});

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
        var cur = players[active];
        if (cur && cur.ready) { sound(cur); if (cur.p.getPlayerState() !== 1 && !blocked) cur.p.playVideo(); }
        return;
      }
      var d = t.closest('[data-reel-detail]');
      if (d) { C.open(d.getAttribute('data-reel-detail')); return; }
      if (t.closest('[data-reel-hide]')) { hideAt(Number(t.closest('.reel').getAttribute('data-i'))); return; }
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
    refresh(opts.start);
    // Backups come once the first trailer has had the connection to itself.
    setTimeout(loadBackups, 1500);
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
    // A title was hidden or brought back (here or from its details).
    sync: function (id) {
      if (!dlg || !dlg.open) return;
      for (var i = 0; i < rendered; i++) if (list[i].id === id) mark(i, S.Hidden.has(kind, id));
    },
  };
})();
