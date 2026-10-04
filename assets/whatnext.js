/* Shelf · What next: rank an exported list against the catalogues. */
(function () {
  'use strict';
  var S = window.Shelf, esc = S.esc;
  var $ = function (s) { return document.querySelector(s); };
  var build = (document.querySelector('meta[name="shelf-build"]') || {}).content || '';

  /* Films and series are one sitting; books and games are total commitment. */
  var TIMES = {
    movies: [['Any', 0], ['Under 90 min', 90], ['Under 2 hours', 120], ['Under 2½ hours', 150]],
    shows: [['Any', 0], ['Under 8 hours', 480], ['Under 20 hours', 1200], ['Under 50 hours', 3000]],
    books: [['Any', 0], ['A sitting or two', 240], ['Under 8 hours', 480], ['Under 15 hours', 900]],
    games: [['Any', 0]],
  };

  var state = { items: [], kind: 'books', mins: 0, floor: 70, status: 'todo' };
  var cache = {};

  function load(kind) {
    if (cache[kind]) return Promise.resolve(cache[kind]);
    return fetch('data/' + kind + '.json?v=' + build).then(function (r) { return r.json(); }).then(function (rows) {
      cache[kind] = rows.map(function (r) {
        var score = kind === 'books' ? null
          : kind === 'games' ? (r.mc != null ? r.mc : r.steam != null ? r.steam : null)
          : (r.mc != null ? r.mc : r.imdb != null ? Math.round(r.imdb * 10) : null);
        return {
          id: r.id, title: r.title, year: r.year, genre: (r.genres || [])[0] || '',
          runtime: r.runtime || null, seasons: r.seasons || null, eps: r.eps || null,
          metacritic: score, rating: kind === 'books' ? r.rating : null,
          author: r.author || r.by || '', row: r,
        };
      });
      return cache[kind];
    });
  }

  function fmtMins(m) {
    if (m == null) return '';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h < 24 && r ? h + 'h ' + r + 'm' : h + 'h';
  }

  function render() {
    if (!state.items.length) return;
    var kind = state.kind;
    load(kind).then(function (catalogue) {
      var out = window.ShelfBacklog.build({
        items: state.items, catalogue: catalogue, kind: kind,
        minutes: state.mins, minScore: state.floor, status: state.status,
      });
      var s = out.stats;
      $('#summary').innerHTML = '<span><b>' + s.shown + '</b> to pick from · ' + s.matched + ' of ' + s.considered + ' found on Shelf</span>';
      var none = $('#none');
      if (!out.rows.length) {
        $('#results').innerHTML = '';
        none.hidden = false;
        none.textContent = s.considered ? 'Nothing clears that bar. Lower the score or allow more time.' : 'Nothing in this list is marked that way.';
        return;
      }
      none.hidden = true;
      $('#results').innerHTML = out.rows.slice(0, 120).map(function (r, i) {
        var e = r.entry && r.entry.row;
        var href = e ? S.KINDS[kind].page + '#' + encodeURIComponent(e.id) : null;
        var meta = [r.year, r.creator, r.genre, fmtMins(r.minutes)].filter(Boolean).map(esc).join(' · ');
        var score = r.score == null ? '' : '<span class="badge ' + S.tone(r.score) + '">' + r.score + '</span>';
        var basis = r.basis === 'community' ? 'from your list' : r.basis === 'none' ? 'unrated' : '';
        return '<li class="bl-row">' +
          '<span class="bl-rank">' + (i + 1) + '</span>' +
          (e ? '<a class="bl-cov" href="' + href + '">' + S.coverHTML(kind, e) + '</a>' : '<span class="bl-cov"><span class="cover" style="--k:var(--k-' + kind + ')"><span class="ph"><b>' + esc(r.title) + '</b></span></span></span>') +
          '<span class="bl-body">' +
            (href ? '<a class="bl-t" href="' + href + '">' + esc(r.title) + '</a>' : '<span class="bl-t">' + esc(r.title) + '</span>') +
            '<span class="bl-m">' + meta + (basis ? ' · <i>' + basis + '</i>' : '') + '</span>' +
          '</span>' + score + '</li>';
      }).join('');
    });
  }

  function adopt(parsed) {
    if (!parsed.items.length) { alert('No rows recognised. Paste a list of titles instead.'); return; }
    state.items = parsed.items;
    if (parsed.source && parsed.source.kind) { state.kind = parsed.source.kind; $('#kind').value = state.kind; }
    buildChips();
    $('#intake').hidden = true;
    $('#workspace').hidden = false;
    render();
  }

  function readFile(file) {
    var fr = new FileReader();
    fr.onload = function () { adopt(window.ShelfBacklog.readExport(String(fr.result || ''))); };
    fr.onerror = function () { alert('That file could not be read.'); };
    fr.readAsText(file);
  }

  var chips = $('#timeChips');
  function buildChips() {
    var list = TIMES[state.kind];
    state.mins = 0;
    $('.bl-time').hidden = list.length < 2;
    chips.innerHTML = list.map(function (t, i) {
      return '<button type="button" class="chip" data-mins="' + t[1] + '" aria-pressed="' + (i === 0) + '">' + t[0] + '</button>';
    }).join('');
  }
  chips.addEventListener('click', function (e) {
    var c = e.target.closest('.chip');
    if (!c) return;
    state.mins = Number(c.getAttribute('data-mins'));
    chips.querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); });
    render();
  });
  buildChips();

  $('#pick').addEventListener('click', function () { $('#file').click(); });
  $('#file').addEventListener('change', function (e) { if (e.target.files && e.target.files[0]) readFile(e.target.files[0]); });
  var intake = $('#intake');
  ['dragenter', 'dragover'].forEach(function (ev) { intake.addEventListener(ev, function (e) { e.preventDefault(); intake.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { intake.addEventListener(ev, function (e) { e.preventDefault(); intake.classList.remove('over'); }); });
  intake.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  $('#usePasted').addEventListener('click', function () { adopt(window.ShelfBacklog.readPasted($('#pasted').value)); });
  $('#kind').addEventListener('change', function (e) { state.kind = e.target.value; buildChips(); render(); });
  $('#status').addEventListener('change', function (e) { state.status = e.target.value; render(); });
  $('#floor').addEventListener('input', function (e) { state.floor = Number(e.target.value); $('#floorVal').textContent = state.floor; render(); });
  $('#reset').addEventListener('click', function () {
    state.items = [];
    $('#workspace').hidden = true;
    $('#intake').hidden = false;
    $('#file').value = '';
  });
})();
