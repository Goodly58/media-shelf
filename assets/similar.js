/* =====================================================================
   similar.js — "If you liked this" across the four catalogues.
   =====================================================================

   The one thing this site can do that no other site can: it holds games,
   books, films and series together, with one comparable score and one
   uniform one-line description each. So it can answer a question nobody
   else is positioned to answer — you loved this game, what should you
   READ? Goodreads cannot say. Metacritic cannot say.

   All the work happens at build time in build-similar.js. This file only
   fetches the result, decodes it and renders it, and it does that lazily:
   the index is not touched until a reader actually opens something.

   Display fields come from data/backlog-index.json, which the backlog
   page already ships and the service worker already precaches, so the
   incremental cost of this feature is one 223 KB file.
   ===================================================================== */
(function () {
  'use strict';

  var IDX = null;      // similar.json
  var DISP = null;     // backlog-index.json, for titles and scores
  var loading = null;

  var PAGE_FOR = { games: 'games.html', books: 'books.html', movies: 'movies.html', shows: 'shows.html' };
  var LABEL_FOR = { games: 'Game', books: 'Book', movies: 'Film', shows: 'Series' };

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetch('data/similar.json').then(function (r) { return r.ok ? r.json() : null; }),
      fetch('data/backlog-index.json').then(function (r) { return r.ok ? r.json() : null; })
    ]).then(function (both) {
      IDX = both[0];
      DISP = both[1];
      return IDX && DISP;
    }).catch(function () { return false; });
    return loading;
  }

  /* The packed neighbour string is fixed-width base36: three characters of
     global index, one of axis. '0000' means the slot is empty, which is a
     real answer — some items have nothing close enough in another medium. */
  function neighboursOf(gi) {
    var out = [];
    var base = gi * IDX.stride * 4;
    for (var s = 0; s < IDX.stride; s++) {
      var c = IDX.n.substr(base + s * 4, 4);
      if (!c || c === '0000') continue;
      var j = parseInt(c.substr(0, 3), 36);
      var ax = parseInt(c.charAt(3), 36) - 1;
      if (isNaN(j)) continue;
      out.push({ i: j, axis: ax >= 0 ? IDX.axes[ax] : null });
    }
    return out;
  }

  /** Global index -> {kind, entry from backlog-index} */
  function resolve(gi) {
    for (var k = 0; k < IDX.kinds.length; k++) {
      var kind = IDX.kinds[k];
      var off = IDX.offsets[kind];
      var n = IDX.counts[kind];
      if (gi >= off && gi < off + n) {
        var row = DISP.kinds[kind] && DISP.kinds[kind][gi - off];
        return row ? { kind: kind, t: row.t, y: row.y, s: row.s, v: row.v } : null;
      }
    }
    return null;
  }

  /** Find an item's global index by title within its own medium. */
  function indexOf(kind, title) {
    var rows = DISP.kinds[kind];
    if (!rows) return -1;
    var want = String(title || '').toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].t).toLowerCase() === want) return IDX.offsets[kind] + i;
    }
    return -1;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function scoreColour(s) {
    if (s == null) return 'var(--mut2)';
    if (s >= 80) return 'var(--good, #00ce7c)';
    if (s >= 60) return 'var(--mid, #ffc24b)';
    return 'var(--bad, #ff6874)';
  }

  function cardFor(n) {
    var r = resolve(n.i);
    if (!r) return '';
    var href = PAGE_FOR[r.kind] + '#open=' + encodeURIComponent(r.t);
    /* Books are scored from compiled reader ratings, everything else from
       Metascores. Saying "critics" for a Goodreads-style average would be the
       same overclaim the verified badge used to make, so the two are named
       apart here exactly as they are on the backlog page. */
    var basis = r.kind === 'books' ? 'readers' : (r.v ? 'critics ✓' : 'critics');
    return '<a class="simcard" href="' + href + '">'
      + '<span class="simkind">' + LABEL_FOR[r.kind] + '</span>'
      + '<span class="simtitle">' + esc(r.t) + '</span>'
      + '<span class="simmeta">' + (r.y || '') + ' · ' + basis + '</span>'
      + '<span class="simscore" style="color:' + scoreColour(r.s) + '">' + (r.s == null ? '—' : r.s) + '</span>'
      + '</a>';
  }

  /** "Both are ..." — what the recommendation is actually claiming. */
  function reasonFor(list) {
    var counts = {}, best = null, bestN = 0;
    for (var i = 0; i < list.length; i++) {
      var a = list[i].axis;
      if (!a) continue;
      counts[a] = (counts[a] || 0) + 1;
      if (counts[a] > bestN) { bestN = counts[a]; best = a; }
    }
    if (!best || !IDX.phrases[best]) return '';
    return 'Mostly picked because both are ' + IDX.phrases[best] + '.';
  }

  function adaptationsFor(gi) {
    var list = IDX.adapt && IDX.adapt[gi];
    if (!list || !list.length) return '';
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var r = resolve(list[i]);
      if (!r) continue;
      parts.push('<a href="' + PAGE_FOR[r.kind] + '#open=' + encodeURIComponent(r.t) + '">'
        + LABEL_FOR[r.kind].toLowerCase() + (r.y ? ' (' + r.y + ')' : '') + '</a>');
    }
    if (!parts.length) return '';
    /* Deliberately NOT a recommendation. An adaptation of the thing you are
       already looking at is the same story again — useful to know, useless as
       an answer to "what next". */
    return '<div class="simadapt">Also on the shelf as a ' + parts.join(', ') + '.</div>';
  }

  /**
   * Append the section to an open modal.
   *   mount(modalBodyElement, 'games', itemObject)
   */
  function mount(host, kind, item) {
    if (!host || !item) return;
    load().then(function (ok) {
      if (!ok || !host.isConnected) return;

      var gi = indexOf(kind, item.title);
      if (gi < 0) return;

      var list = neighboursOf(gi);
      var adapt = adaptationsFor(gi);
      if (!list.length && !adapt) return;

      var wrap = document.createElement('div');
      wrap.className = 'simwrap';

      var cards = '';
      for (var i = 0; i < list.length; i++) cards += cardFor(list[i]);

      /* Fewer than three is a real answer, not a bug: about a quarter of game
         blurbs are pure mechanics ("Sequel platform fighter adding a slime
         meter") and genuinely have no cross-medium cousin. Padding the row
         would be inventing one. */
      var thin = list.length && list.length < 3
        ? '<div class="simthin">Not much else on the shelf is close to this one.</div>' : '';

      wrap.innerHTML =
        '<div class="simhead">If you liked this'
        + '<span class="simhint">across the rest of the shelf</span></div>'
        + (cards ? '<div class="simgrid">' + cards + '</div>' : '')
        + thin
        + (list.length ? '<div class="simwhy">' + esc(reasonFor(list)) + '</div>' : '')
        + adapt;

      host.appendChild(wrap);
    });
  }

  window.ShelfSimilar = { mount: mount };
})();
