/* =====================================================================
   Shelf — cover art resolver                            assets/covers.js
   Loaded AFTER assets/site.js, deferred, on the four catalogue pages.

   Every page ships some baked-in artwork URL — a Steam header id, an ISBN
   for Open Library, a TMDB poster path — and every one of those sources
   misses a slice of the catalogue. Rather than let each page invent its
   own recovery, all four hand the problem here: given an item and what
   kind of thing it is, find a picture or honestly report that there is
   none, using only keyless, CORS-enabled, free endpoints.

   Three things were quietly breaking the old per-page attempts:

   1. Wikimedia stopped serving arbitrary thumbnail widths. Hotlinks are
      rejected with HTTP 400 unless the width is one of the standard steps
      below (phab:T414805). The old code rewrote every thumbnail to 420px
      to sharpen it, which is not a standard step, so the sharpening turned
      a working poster into a broken image.
   2. `prop=pageimages` defaults to `pilicense=free`, and film, television
      and video-game cover art is almost always non-free. The search
      fallback was therefore asking for the one class of image it was
      built to find and being told, correctly, that there is none.
   3. A dead baked-in URL had no path back here at all. Roughly two in five
      TMDB poster paths in the dataset now 404, and each of those cards was
      pinned to its title card forever even though Wikipedia had the poster.

   Nothing here is load-bearing: every lookup is wrapped, a failure resolves
   to null, and null simply leaves the title card showing. Offline, the
   fetches reject immediately and every card keeps its typographic poster.
   ===================================================================== */
(function () {
  'use strict';
  if (window.ShelfCovers) return;

  var page = (document.body && document.body.getAttribute('data-page')) || 'shelf';

  /* ------------------------------------------------------------------
     Cache
     ------------------------------------------------------------------
     Shape is unchanged from v1 — { "<title>|<year>": url | null } — so a
     miss still costs one entry and is never re-requested. The version
     moved because v1 caches are full of two kinds of poison: 420px URLs
     that can no longer load, and nulls recorded by the crippled search.
     Migration keeps the entries that are still good and forgets the rest,
     so a returning visitor keeps their warm cache instead of re-fetching
     the whole page. */
  var KEY = page + '_art_v2';
  var OLD = page + '_art_v1';
  var cache = {};

  /* Widths Wikimedia will render for a hotlinked thumbnail. Anything else
     is a 400, however reasonable it looks. */
  var STEPS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];
  var WANT = 500;                       // 2:3 card at ~180-300 CSS px, 2x display

  function legalWidth(url) {
    var m = /\/(\d+)px-/.exec(url || '');
    if (!m) return true;                // an original-size file, no thumbnailer involved
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i] === +m[1]) return true;
    return false;
  }

  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { cache = {}; }
  if (!Object.keys(cache).length) {
    try {
      var prev = JSON.parse(localStorage.getItem(OLD) || '{}');
      for (var k in prev) {
        if (typeof prev[k] === 'string' && legalWidth(prev[k])) cache[k] = prev[k];
      }
      localStorage.removeItem(OLD);
    } catch (e) { /* no v1, or unreadable — start clean */ }
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* quota — harmless */ }
    }, 800);
  }

  /* ------------------------------------------------------------------
     Request queue
     ------------------------------------------------------------------
     Four at a time, and only for cards near the viewport, so scrolling the
     full catalogue costs one request per title rather than thousands at
     once. Combined with the cache, a title is asked about at most once per
     browser, ever. */
  var inflight = 0;
  var queue = [];
  function pump() {
    if (inflight >= 4 || !queue.length) return;
    var job = queue.shift();
    inflight++;
    var released = false;
    function release() { if (released) return; released = true; inflight--; pump(); }
    // A job that throws on its way out would hold a slot forever and, four of
    // those in, stall every remaining card on the page.
    try { job(release); } catch (e) { release(); }
  }
  function enqueue(job) { queue.push(job); pump(); }

  /* `ctx.offline` is the difference between "Wikipedia has no picture of this"
     and "the request never arrived". Only the first deserves to be cached; a
     dropped connection cached as a miss would mean one flaky moment — or one
     read on the train — permanently blanking every card scrolled past. A 404
     is a real answer and counts as a miss. */
  function getJSON(ctx, url, cb) {
    var done = false;
    function finish(v) { if (!done) { done = true; cb(v); } }
    function dead() { ctx.offline = true; finish(null); }
    try {
      fetch(url).then(function (r) {
        if (r.status >= 500 || r.status === 429) return dead();
        if (!r.ok) return finish(null);
        return r.json().then(finish, dead);
      }, dead);
    } catch (e) { dead(); }
  }

  /* ------------------------------------------------------------------
     Wikipedia
     ------------------------------------------------------------------ */

  /* Ask for the widest standard step the source file can actually fill.
     The thumbnailer will not upscale, so requesting more than the original
     holds is another way to earn a broken image. */
  function pick(j) {
    if (!j || j.type === 'disambiguation') return null;
    var thumb = j.thumbnail && j.thumbnail.source;
    var orig = j.originalimage;
    if (!thumb) return orig && orig.source ? orig.source : null;
    var want = (orig && orig.width >= WANT) ? WANT : 0;
    return thumb.replace(/\/(\d+)px-/, function (m, w) {
      var target = Math.max(+w, want);
      for (var i = 0; i < STEPS.length; i++) if (STEPS[i] >= target) return '/' + STEPS[i] + 'px-';
      return m;
    });
  }

  function summary(ctx, title, cb) {
    getJSON(ctx, 'https://en.wikipedia.org/api/rest_v1/page/summary/' +
      encodeURIComponent(title.replace(/ /g, '_')), cb);
  }

  /* Compare titles with punctuation, case and accents removed, because the
     catalogue and Wikipedia disagree constantly about colons, ampersands
     and diacritics for the same work. */
  function fold(s) {
    return String(s || '').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  }

  /* The search index copes with renames, foreign titles and disambiguators
     nobody would guess. `pilicense=any` is what makes it useful at all:
     cover art is non-free, and the default excludes exactly that.

     The title must match exactly once its trailing "(1982 film)" qualifier
     is stripped. A looser prefix rule was tried and it happily answered
     "StarCraft II" with StarCraft's box art and "Creeper World 4" with a
     Minecraft mob, which is worse than showing no art at all. */
  function search(ctx, query, want, cb) {
    getJSON(ctx, 'https://en.wikipedia.org/w/api.php?action=query&generator=search' +
      '&gsrsearch=' + encodeURIComponent(query) + '&gsrlimit=5' +
      '&prop=pageimages&piprop=thumbnail|original&pithumbsize=' + WANT +
      '&pilicense=any&format=json&origin=*', function (j) {
      var pages = (j && j.query && j.query.pages) || {};
      var target = fold(want);
      for (var id in pages) {
        var p = pages[id];
        var src = (p.thumbnail && p.thumbnail.source) || (p.original && p.original.source);
        if (!src) continue;
        if (fold(String(p.title || '').replace(/\s*\([^)]*\)\s*$/, '')) !== target) continue;
        return cb(pick({ thumbnail: p.thumbnail, originalimage: p.original }) || src);
      }
      cb(null);
    });
  }

  /* Last resort, and only for an article we already know is the right one.
     A fair number of long-running series have no poster on Wikipedia at all —
     Columbo, Mr. Robot and Mindhunter are all represented by a free wordmark
     instead — and the image APIs correctly report nothing. The page's media
     list still holds the wordmark.

     The filename rule is deliberately strict: it must both start with this
     title and say what it is. Loosening it turns Succession's cast photo from
     a film festival into that show's "cover", which is worse than the title
     card it would replace. */
  function viaMediaList(ctx, article, want, cb) {
    getJSON(ctx, 'https://en.wikipedia.org/api/rest_v1/page/media-list/' +
      encodeURIComponent(article.replace(/ /g, '_')), function (j) {
      var items = (j && j.items) || [];
      var target = fold(want);
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.type !== 'image' || !it.srcset || !it.srcset.length) continue;
        var name = String(it.title || '').replace(/^File:/, '');
        if (!/poster|logo|cover|title.?card|box.?art|intertitle/i.test(name)) continue;
        if (fold(name).indexOf(target) !== 0) continue;
        return cb('https:' + it.srcset[0].src);
      }
      cb(null);
    });
  }

  /* Walk the likely article titles, then fall back to the search index.
     The exact disambiguator varies far too much to guess in one go —
     "Dune (2021 film)", "Severance (TV series)", "Portal (video game)",
     "Poor Things (film)" are all shapes that occur in this catalogue. */
  function viaWikipedia(ctx, cands, wantTitle, query, cb) {
    var i = 0;
    var article = null;          // the first candidate that turned out to be a real page
    (function step() {
      if (i >= cands.length) {
        return search(ctx, query, wantTitle, function (art) {
          if (art || !article) return cb(art);
          viaMediaList(ctx, article, wantTitle, cb);
        });
      }
      summary(ctx, cands[i++], function (j) {
        var art = pick(j);
        if (art) return cb(art);
        if (!article && j && j.title && j.type !== 'disambiguation') article = j.title;
        step();
      });
    }());
  }

  /* ------------------------------------------------------------------
     Per-kind resolvers
     ------------------------------------------------------------------ */
  function resolveScreen(ctx, x, kind, cb) {
    var qualifier = kind === 'tv' ? 'TV series' : 'film';
    viaWikipedia(ctx, [
      x.title + ' (' + x.year + ' ' + qualifier + ')',
      x.title + ' (' + qualifier + ')',
      x.title + ' (' + x.year + ' American ' + qualifier + ')',
      x.title
    ], x.title, x.title + ' ' + qualifier + ' ' + x.year, cb);
  }

  function resolveGame(ctx, x, cb) {
    viaWikipedia(ctx, [
      x.title + ' (' + x.year + ' video game)',
      x.title + ' (video game)',
      x.title
    ], x.title, x.title + ' video game', cb);
  }

  /* Open Library's cover-by-ISBN route only knows the exact edition it was
     given, so a reprint ISBN, a translated edition or a manga volume with
     no ISBN at all returns nothing. Its search index knows the work, and
     hands back a cover id for an edition it does hold — which is how the
     untranslated and out-of-print end of the shelf gets a picture.
     `default=false` matters: without it a bad id yields a grey placeholder
     image that would load happily and look like a bug. */
  function coverById(id) {
    return 'https://covers.openlibrary.org/b/id/' + id + '-L.jpg?default=false';
  }
  function resolveBook(ctx, b, cb) {
    var author = b.author || '';
    getJSON(ctx, 'https://openlibrary.org/search.json?title=' + encodeURIComponent(b.title) +
      '&author=' + encodeURIComponent(author) + '&fields=cover_i&limit=3', function (j) {
      var docs = (j && j.docs) || [];
      for (var i = 0; i < docs.length; i++) if (docs[i].cover_i) return cb(coverById(docs[i].cover_i));
      getJSON(ctx, 'https://openlibrary.org/search.json?q=' +
        encodeURIComponent(b.title + ' ' + author) + '&fields=cover_i&limit=3', function (j2) {
        var d2 = (j2 && j2.docs) || [];
        for (var n = 0; n < d2.length; n++) if (d2[n].cover_i) return cb(coverById(d2[n].cover_i));
        cb(null);
      });
    });
  }

  var RESOLVERS = {
    film: function (ctx, x, cb) { resolveScreen(ctx, x, 'film', cb); },
    tv: function (ctx, x, cb) { resolveScreen(ctx, x, 'tv', cb); },
    game: resolveGame,
    book: resolveBook
  };

  function cacheKey(kind, x) {
    return x.title + '|' + (kind === 'book' ? (x.author || '') : x.year);
  }

  /* The single entry point for a lookup. Always calls back, always with a
     string or null, never throws. */
  function resolve(kind, x, cb) {
    var key = cacheKey(kind, x);
    if (key in cache) return cb(cache[key]);
    var fn = RESOLVERS[kind];
    if (!fn) return cb(null);
    if (navigator.onLine === false) return cb(null);
    var ctx = { offline: false };
    var settled = false;
    function done(url) {
      if (settled) return;
      settled = true;
      if (url || !ctx.offline) { cache[key] = url || null; save(); }
      cb(url || null);
    }
    try { fn(ctx, x, done); } catch (e) { done(null); }
  }

  /* ------------------------------------------------------------------
     Card wiring
     ------------------------------------------------------------------
     A card's cover is three stacked layers: an optional shimmer, the title
     card, and an <img class="lazyart"> on top that fades in only once it
     has real pixels. Nothing needs hiding on failure — the title card is
     simply what remains visible, which is why an offline load still looks
     deliberate. */
  function clearShimmer(cover) {
    var sk = cover.querySelector('.sk');
    if (sk) sk.remove();
  }

  /* `resolved` tells the page this picture came from a lookup rather than from
     the source the frame was designed around. A Steam header is 460x215 and a
     Wikipedia game cover is portrait box art; cropping one to the other's frame
     loses most of the artwork, so the pages fit resolved art instead. */
  function show(img, url) {
    img.onload = function () { img.classList.add('ok'); clearShimmer(img.parentNode); };
    img.onerror = function () { img.removeAttribute('src'); clearShimmer(img.parentNode); };
    img.classList.add('resolved');
    /* A wordmark is a rendered SVG on a transparent ground. Cropped to fill a
       poster frame it becomes an abstract corner of a letter, so it is fitted
       whole and left to sit on the title card behind it. */
    if (/\.svg\/\d+px-|\.svg\.png$/i.test(url)) img.classList.add('logo');
    img.src = url;
  }

  function fill(el) {
    if (el.__coverDone) return;
    el.__coverDone = 1;
    var img = el.querySelector('img.lazyart');
    if (!img) return;
    enqueue(function (next) {
      resolve(el.__coverKind, el.__coverItem, function (url) {
        if (url && el.isConnected) show(img, url);
        next();
      });
    });
  }

  var observer = null;
  try {
    observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        observer.unobserve(entries[i].target);
        fill(entries[i].target);
      }
    }, { rootMargin: '400px' });
  } catch (e) { /* no observer: the sweep below covers the visible grid */ }

  /* claim(cardEl, kind, item, bakedUrl)
     bakedUrl is whatever the page already knows — a Steam header, an ISBN
     cover, a TMDB poster. It is tried first and, crucially, its failure is
     not the end: a dead baked URL falls through to the same lookup as a
     card that never had one. That single change is what recovers the
     stale TMDB paths. */
  function claim(el, kind, item, bakedUrl) {
    if (!el || !item) return;
    el.__coverKind = kind;
    el.__coverItem = item;
    var img = el.querySelector('img.lazyart');
    if (bakedUrl && img) {
      /* Claim the card for the baked URL up front. A slow Steam header is still
         in flight when the sweep below fires, and without this the sweep would
         resolve a Wikipedia cover and overwrite artwork that was about to
         arrive. The claim is released only if the image actually fails. */
      el.__coverDone = 1;
      img.onload = function () { img.classList.add('ok'); clearShimmer(el); };
      img.onerror = function () {
        img.removeAttribute('src');
        clearShimmer(el);
        el.__coverDone = 0;
        fill(el);
      };
      img.src = bakedUrl;
      return;
    }
    clearShimmer(el);
    if (observer) observer.observe(el); else fill(el);
  }

  /* If the observer never delivers — hidden tab, prerender, no compositing —
     the grid would sit on title cards forever. Sweep the first screenful
     once, unconditionally. */
  setTimeout(function () {
    var cards = document.querySelectorAll('.cover, .coverwrap');
    for (var i = 0; i < cards.length && i < 24; i++) {
      if (cards[i].__coverItem) fill(cards[i]);
    }
  }, 2500);

  /* The pages build their first screenful of cards from an inline script during
     parse, which is long before this deferred module runs — so a card cannot
     call claim() directly and expect anything to be listening. Cards push onto
     a queue instead; whatever accumulated before this point is drained now, and
     the queue is then replaced by one that claims on push, so re-renders and
     modals opened later go straight through. */
  var pending = window.ShelfCoverQueue || [];
  window.ShelfCoverQueue = { push: function (args) { claim.apply(null, args); } };
  for (var n = 0; n < pending.length; n++) claim.apply(null, pending[n]);

  window.ShelfCovers = { claim: claim, resolve: resolve };
}());
