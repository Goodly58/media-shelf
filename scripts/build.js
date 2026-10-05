/* Build the site into _site/: every page from src/ templates, the search
   index, and a service worker versioned by a hash of everything it serves.

   Usage: node scripts/build.js */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const r = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KINDS = ['games', 'books', 'movies', 'shows'];
const LABEL = { games: 'Games', books: 'Books', movies: 'Films', shows: 'Series' };
const PAGE = { games: 'games.html', books: 'books.html', movies: 'movies.html', shows: 'shows.html' };
const THIS_YEAR = new Date().getFullYear();
const SITE = 'https://goodly58.github.io/media-shelf/';

/* ------------------------------------------------------------- inputs */
// SHELF_DATA_DIR builds from another copy of the data (used to preview a merge).
const DATA_DIR = process.env.SHELF_DATA_DIR || path.join(ROOT, 'data');
const DATA = {};
for (const k of KINDS) DATA[k] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${k}.json`), 'utf8'));

// The browser's own renderer (assets/app.js), run here so cards drawn at build time are
// exactly the ones the page draws. It needs only a few inert stand-ins for the DOM.
const Shelf = (() => {
  const noop = () => {};
  const ctx = {
    document: { addEventListener: noop, querySelector: () => null, documentElement: { getAttribute: noop, setAttribute: noop }, body: { getAttribute: () => null } },
    localStorage: { getItem: () => null, setItem: noop }, navigator: {}, location: { protocol: 'file:' }, setTimeout, clearTimeout,
  };
  ctx.window = ctx;
  vm.runInNewContext(r('assets/app.js'), ctx, { filename: 'assets/app.js' });
  return ctx.Shelf;
})();
const { icon, esc } = Shelf;

// The genre picker groups themes with the same taxonomy the data refresh tags titles with.
const TAXONOMY = require('./refresh/taxonomy.mjs').clientTaxonomy();

/* -------------------------------------------------------------- build id */
const hashed = [
  ...fs.readdirSync(path.join(ROOT, 'assets')).map((f) => 'assets/' + f),
  ...fs.readdirSync(path.join(ROOT, 'src')).map((f) => 'src/' + f),
  'manifest.webmanifest', 'scripts/build.js', 'scripts/refresh/taxonomy.mjs',
].sort();
const h = crypto.createHash('sha256');
for (const f of hashed) { h.update(f); h.update(fs.readFileSync(path.join(ROOT, f))); }
for (const k of KINDS) h.update(fs.readFileSync(path.join(DATA_DIR, `${k}.json`)));
let META = {};
try { META = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'meta.json'), 'utf8')); } catch {}
h.update(JSON.stringify(META));
const BUILD = h.digest('hex').slice(0, 10);

const lastData = KINDS.map((k) => fs.statSync(path.join(DATA_DIR, `${k}.json`)).mtime).sort().pop();
const UPDATED = (process.env.SHELF_UPDATED ? new Date(process.env.SHELF_UPDATED) : lastData)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/* ---------------------------------------------------------------- scores */
function weighted(v, n, m, c) { return v == null ? -1 : (n / (n + m)) * v + (m / (n + m)) * c; }
const mean = (list, key) => { const v = list.map((x) => x[key]).filter((x) => x != null); return v.reduce((a, b) => a + b, 0) / (v.length || 1); };
const C = { movies: mean(DATA.movies, 'imdb'), shows: mean(DATA.shows, 'imdb'), books: mean(DATA.books, 'rating') };
const TOP = {
  movies: (x) => weighted(x.imdb, x.votes || 0, 25000, C.movies),
  shows: (x) => weighted(x.imdb, x.votes || 0, 15000, C.shows),
  games: (x) => (x.mc != null ? x.mc + 100 : x.steam != null ? x.steam * 0.9 : -1),
  books: (x) => weighted(x.rating, x.ratings || 0, 4000, C.books),
};
const POP = { movies: (x) => x.votes || 0, shows: (x) => x.votes || 0, games: (x) => x.steamN || 0, books: (x) => x.ratings || 0 };
// The score each catalogue shows on its cards by default, as catalog.js chooses it.
const BADGE = { movies: 'imdb', shows: 'imdb', games: 'mc', books: 'rating' };
const badge = (kind, x) => Shelf.METRICS[BADGE[kind]].badge(x) || (kind === 'games' ? Shelf.METRICS.steam.badge(x) : '');

/* ----------------------------------------------------------------- cards */
const imgUrl = (kind, x) => Shelf.imgUrl(kind, x);
// Wall and fan tiles are small, so Commons thumbnails come down a size.
const smallImg = (kind, x) => (imgUrl(kind, x) || '').replace('/330px-', '/250px-');
// Wikimedia sets cookies on every image it serves; an anonymous request keeps them out.
const anon = (url) => (/\.wikimedia\.org\//.test(url) ? ' crossorigin="anonymous"' : '');
const card = (kind, x, meta) => Shelf.cardHTML(kind, x, { href: `${PAGE[kind]}#${encodeURIComponent(x.id)}`, meta, badge: badge(kind, x) });
const metaOf = (kind, x) => (kind === 'books' ? x.author : (x.genres || [])[0]);

const withArt = (kind) => (x) => Boolean(imgUrl(kind, x));
/* Best n titles passing `filter`. Titles with artwork are preferred; if too
   few have any yet, the row falls back to text covers rather than vanishing. */
function top(kind, n, filter, { strict = false } = {}) {
  const sorted = DATA[kind].filter((x) => (filter ? filter(x) : true)).sort((a, b) => TOP[kind](b) - TOP[kind](a));
  const art = sorted.filter(withArt(kind));
  return strict || art.length >= Math.min(n, 8) ? art.slice(0, n) : sorted.slice(0, n);
}

/* ------------------------------------------------------------ catalogues */
/* Each catalogue page arrives with its first screen drawn: the default list (top rated,
   no filters), its genre chips and its count, all as catalog.js draws them. The page keeps
   them when its data confirms the same list, so nothing moves when it comes alive. */
const FIRST = 30;
const NOUN = { games: ['game', 'games'], books: ['book', 'books'], movies: ['film', 'films'], shows: ['series', 'series'] };
function firstScreen(kind) {
  const rows = DATA[kind];
  const list = rows.slice().sort((a, b) => TOP[kind](b) - TOP[kind](a)).slice(0, FIRST);
  const cards = list.map((x, i) => Shelf.cardHTML(kind, x, { meta: metaOf(kind, x), badge: badge(kind, x), fav: true, eager: i < 6, high: i < 3 })).join('');
  const count = {};
  for (const x of rows) for (const g of x.genres || []) count[g] = (count[g] || 0) + 1;
  const genres = Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b)).slice(0, 12);
  const chips = '<button class="chip" type="button" data-chip="" aria-pressed="true">All</button>' +
    genres.map((g) => `<button class="chip" type="button" data-chip="${esc(g)}" aria-pressed="false">${esc(g)}</button>`).join('');
  const key = BADGE[kind];
  const v = rows.map((x) => Shelf.METRICS[key].v(x)).filter((x) => x != null);
  const a = v.reduce((p, q) => p + q, 0) / (v.length || 1);
  const avg = !v.length ? '' : key === 'imdb' ? 'avg ★ ' + a.toFixed(1) : key === 'rating' ? 'avg ★ ' + a.toFixed(2) : 'avg Metascore ' + Math.round(a);
  const meta = `<span><b>${rows.length.toLocaleString('en-US')}</b> ${NOUN[kind][rows.length === 1 ? 0 : 1]}${avg ? ' · ' + avg : ''}</span>` +
    `<button class="link-btn" id="surprise">${icon('shuffle', 'sm')} Surprise me</button>`;
  return { cards, chips, meta };
}

/* ------------------------------------------------------------------ home */
function wallRow(items) {
  // The first screenful loads straight away, the rest as the row drifts into view.
  const cells = items.map(([kind, x], i) => `<img src="${esc(smallImg(kind, x))}" alt=""${anon(smallImg(kind, x))}${i >= 4 ? ' loading="lazy"' : ''} decoding="async" referrerpolicy="no-referrer" onerror="Shelf.imgFail(this)">`).join('');
  return `<div class="wall-row">${cells}${cells}</div>`;
}
function homePage() {
  const filmTop = top('movies', 18, (x) => x.votes > 400000, { strict: true });
  const showTop = top('shows', 18, (x) => x.votes > 150000, { strict: true });
  const gameTop = top('games', 9, (x) => x.steamId && x.steamN > 50000, { strict: true });
  const bookTop = top('books', 9, (x) => x.ratings > 200000, { strict: true });
  const mix = [];
  for (let i = 0; i < 9; i++) { if (gameTop[i]) mix.push(['games', gameTop[i]]); if (bookTop[i]) mix.push(['books', bookTop[i]]); }
  const wall = wallRow(filmTop.map((x) => ['movies', x])) + wallRow(showTop.map((x) => ['shows', x])) + wallRow(mix);

  const blurb = { games: 'Metacritic and Steam', books: 'Goodreads', movies: 'IMDb, Metacritic, Rotten Tomatoes', shows: 'IMDb, Metacritic, Rotten Tomatoes' };
  const shelves = KINDS.map((k) => {
    const fan = top(k, 3, (x) => POP[k](x) > 0, { strict: true }).map((x) => `<img src="${esc(smallImg(k, x))}" alt=""${anon(smallImg(k, x))} loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="Shelf.imgFail(this)">`).join('');
    return `<a class="shelf" href="${PAGE[k]}" style="--k:var(--k-${k})"><div class="fan" aria-hidden="true">${fan}</div><h2>${LABEL[k]}</h2><p>${blurb[k]}</p></a>`;
  }).join('');

  const row = (title, kind, items, href) => `<section class="rowsec" style="--k:var(--k-${kind || 'movies'})">` +
    `<div class="rowsec-h"><h2>${kind ? '<span class="dot"></span>' : ''}${esc(title)}</h2>${href ? `<a href="${href}">See all${icon('chevR', 'sm')}</a>` : ''}</div>` +
    `<div class="scroller"><button class="scroll-btn l" type="button" aria-label="Scroll left" hidden>${icon('chevL')}</button>` +
    `<div class="scroll-row">${items.join('')}</div>` +
    `<button class="scroll-btn r" type="button" aria-label="Scroll right">${icon('chevR')}</button></div></section>`;

  const fresh = [];
  const recent = {};
  for (const k of KINDS) recent[k] = top(k, 6, (x) => x.year >= THIS_YEAR && POP[k](x) > (k === 'books' ? 5000 : k === 'games' ? 3000 : 20000), { strict: true });
  for (let i = 0; i < 6; i++) for (const k of ['movies', 'shows', 'games', 'books']) if (recent[k][i]) fresh.push(card(k, recent[k][i], metaOf(k, recent[k][i])));

  const rows = [
    row('Top films', 'movies', top('movies', 18).map((x) => card('movies', x, metaOf('movies', x))), 'movies.html'),
    row('Top series', 'shows', top('shows', 18).map((x) => card('shows', x, metaOf('shows', x))), 'shows.html'),
    row('Top games', 'games', top('games', 18).map((x) => card('games', x, metaOf('games', x))), 'games.html'),
    row('Top books', 'books', top('books', 18).map((x) => card('books', x, metaOf('books', x))), 'books.html'),
    fresh.length >= 6 ? row(`New in ${THIS_YEAR}`, null, fresh, null) : '',
    row('Horror', 'movies', top('movies', 18, (x) => (x.genres || []).includes('Horror') && x.votes > 50000).map((x) => card('movies', x, metaOf('movies', x))), 'movies.html?genre=Horror'),
    row('Animated films', 'movies', top('movies', 18, (x) => (x.genres || []).includes('Animation')).map((x) => card('movies', x, metaOf('movies', x))), 'movies.html?genre=Animation'),
    row('Crime series', 'shows', top('shows', 18, (x) => (x.genres || []).includes('Crime')).map((x) => card('shows', x, metaOf('shows', x))), 'shows.html?genre=Crime'),
  ].join('');

  return fill(r('src/home.html'), { wall, shelves, rows });
}

/* ------------------------------------------------------------- templates */
function fill(tpl, vars) {
  return tpl
    .replace(/\{\{icon:([a-zA-Z]+)(?::([\w-]+))?\}\}/g, (m, n, c) => icon(n, c))
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}
function page({ file, title, description, body, kind, current, scripts = '', head = '' }) {
  let html = fill(r('src/layout.html'), {
    build: BUILD, title: esc(title), description: esc(description), updated: UPDATED,
    site: SITE, url: SITE + (file === 'index.html' ? '' : file),
    // TMDB's terms: its logo, less prominent than ours, wherever its data is used.
    credits: META.tmdbTrailers > 0 ? `<a class="tmdb" href="https://www.themoviedb.org/" target="_blank" rel="noopener" title="This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB."><span>Trailers via</span><img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB" width="92" height="12" loading="lazy" referrerpolicy="no-referrer"></a>` : '',
    body, scripts, head,
    bodyAttrs: kind ? ` data-kind="${kind}" style="--k:var(--k-${kind})"` : '',
  });
  html = html.replace(/\{\{cur:(\w+)\}\}/g, (m, k) => (k === current ? ' aria-current="page"' : ''));
  if (/\{\{\w+(:\w+)*\}\}/.test(html)) throw new Error(`${file}: unfilled placeholder ${html.match(/\{\{\w+(:\w+)*\}\}/)[0]}`);
  fs.writeFileSync(path.join(OUT, file), html);
}

const SORTS = {
  movies: [['top', 'Top rated'], ['popular', 'Most popular'], ['mc', 'Metascore'], ['rt', 'Rotten Tomatoes'], ['new', 'Newest'], ['old', 'Oldest'], ['az', 'A–Z']],
  shows: [['top', 'Top rated'], ['popular', 'Most popular'], ['mc', 'Metascore'], ['rt', 'Rotten Tomatoes'], ['new', 'Newest'], ['old', 'Oldest'], ['az', 'A–Z']],
  games: [['top', 'Top rated'], ['steam', 'Steam rating'], ['popular', 'Most reviewed'], ['new', 'Newest'], ['old', 'Oldest'], ['az', 'A–Z']],
  books: [['top', 'Top rated'], ['popular', 'Most rated'], ['new', 'Newest'], ['old', 'Oldest'], ['az', 'A–Z'], ['author', 'Author']],
};
const CAT = {
  games: { title: 'Games · Shelf', desc: 'PC games ranked by Metacritic and Steam reviews. Filter by genre, tag and year.', ph: 'Search games or tags' },
  books: { title: 'Books · Shelf', desc: 'Books ranked by Goodreads rating. Filter by genre and year.', ph: 'Search books or authors' },
  movies: { title: 'Films · Shelf', desc: 'Films ranked by IMDb, Metacritic and Rotten Tomatoes. Filter by genre, subgenre, year and length.', ph: 'Search films or directors' },
  shows: { title: 'Series · Shelf', desc: 'TV series ranked by IMDb, Metacritic and Rotten Tomatoes. Filter by genre, subgenre and year.', ph: 'Search series or creators' },
};

/* ------------------------------------------------------------ search.json */
function searchIndex() {
  const rows = [];
  KINDS.forEach((k, ki) => {
    const sorted = DATA[k].slice().sort((a, b) => POP[k](b) - POP[k](a));
    sorted.forEach((x, i) => {
      const score = k === 'books' ? x.rating : k === 'games' ? (x.mc != null ? x.mc : x.steam) : x.imdb;
      // Authors help tell books apart; for the rest the year does, and directors would double the file.
      const sub = k === 'books' ? x.author : '';
      rows.push({ p: i / sorted.length, row: [ki, x.id, x.title, x.year || null, score == null ? null : score, sub || undefined] });
    });
  });
  rows.sort((a, b) => a.p - b.p);
  return JSON.stringify({ kinds: KINDS, items: rows.map((x) => x.row) });
}

/* ---------------------------------------------------------------- service worker */
function serviceWorker(shell) {
  return `/* Shelf service worker. Generated by scripts/build.js; do not edit. */
var VERSION = '${BUILD}';
var SHELL = ${JSON.stringify(shell)};
var CORE = 'shelf-core-' + VERSION, DATA = 'shelf-data-' + VERSION, IMG = 'shelf-art-v1', FONT = 'shelf-font-v1';
var IMG_MAX = 400;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CORE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) { return [CORE, DATA, IMG, FONT].indexOf(n) < 0; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

function trim(cache, max) {
  cache.keys().then(function (keys) { if (keys.length > max) Promise.all(keys.slice(0, keys.length - max).map(function (k) { return cache.delete(k); })); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var same = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CORE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
    }));
    return;
  }
  if (same && url.pathname.indexOf('/data/') >= 0) {
    e.respondWith(caches.open(DATA).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; });
        return hit || net;
      });
    }));
    return;
  }
  if (same && /\\.woff2$/.test(url.pathname)) {
    e.respondWith(caches.open(FONT).then(function (c) {
      return c.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }); });
    }));
    return;
  }
  if (same) {
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
    return;
  }
  if (req.destination === 'image') {
    e.respondWith(caches.open(IMG).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trim(c, IMG_MAX); }
          return res;
        });
      });
    }));
  }
});
`;
}

/* ------------------------------------------------------------------ run */
// Empty _site rather than deleting it, so a local server running inside it survives a rebuild.
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

page({
  file: 'index.html', title: 'Shelf · Find your next game, book, film or series',
  description: 'Games, books, films and series ranked by IMDb, Metacritic, Rotten Tomatoes, Steam and Goodreads. Free, fast, no sign-up.',
  body: homePage(), current: 'home',
  scripts: `<script>
document.querySelectorAll('.scroller').forEach(function (s) {
  var row = s.querySelector('.scroll-row'), l = s.querySelector('.l'), r = s.querySelector('.r');
  function upd() { l.hidden = row.scrollLeft < 8; r.hidden = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8; }
  l.onclick = function () { row.scrollBy({ left: -row.clientWidth * 0.85, behavior: 'smooth' }); };
  r.onclick = function () { row.scrollBy({ left: row.clientWidth * 0.85, behavior: 'smooth' }); };
  row.addEventListener('scroll', upd, { passive: true }); upd();
});
</script>`,
});

for (const k of KINDS) {
  page({
    file: PAGE[k], title: CAT[k].title, description: CAT[k].desc, kind: k, current: k,
    body: fill(r('src/catalog.html'), {
      label: LABEL[k], placeholder: CAT[k].ph,
      sorts: SORTS[k].map(([v, l]) => `<option value="${v}">${l}</option>`).join(''),
      ...firstScreen(k),
    }),
    scripts: `<script>window.SHELF_TAXONOMY = ${JSON.stringify(TAXONOMY[k] || [])};</script>\n<script src="assets/catalog.js?v=${BUILD}" defer></script>`,
  });
}

page({
  file: 'backlog.html', title: 'What next · Shelf', current: 'backlog',
  description: 'Drop in a Goodreads, Letterboxd or IMDb export and get your backlog ranked, best first.',
  body: fill(r('src/backlog.html'), {}),
  scripts: `<script src="assets/backlog.js?v=${BUILD}" defer></script>\n<script src="assets/whatnext.js?v=${BUILD}" defer></script>`,
});

page({
  file: '404.html', title: 'Not found · Shelf', description: 'This page does not exist.',
  // Served for any missing path, however deep, so links must resolve from the site root.
  head: '<base href="/media-shelf/">',
  body: `<main id="main" class="wrap"><div class="empty"><h2>Nothing here</h2><p>That page does not exist.</p><p><a class="btn" href="./">Go home</a></p></div></main>`,
});

for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(OUT, 'assets', f));
for (const k of KINDS) fs.copyFileSync(path.join(DATA_DIR, `${k}.json`), path.join(OUT, `data/${k}.json`));
fs.writeFileSync(path.join(OUT, 'data/search.json'), searchIndex());
fs.copyFileSync(path.join(ROOT, 'manifest.webmanifest'), path.join(OUT, 'manifest.webmanifest'));

const shell = ['./', 'index.html', ...KINDS.map((k) => PAGE[k]), 'backlog.html', '404.html',
  `assets/app.css?v=${BUILD}`, `assets/app.js?v=${BUILD}`, `assets/catalog.js?v=${BUILD}`,
  `assets/backlog.js?v=${BUILD}`, `assets/whatnext.js?v=${BUILD}`, 'assets/icon.svg', 'assets/inter-latin.woff2', 'manifest.webmanifest'];
fs.writeFileSync(path.join(OUT, 'sw.js'), serviceWorker(shell));

fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  ['', ...KINDS.map((k) => PAGE[k]), 'backlog.html'].map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n') + '\n</urlset>\n');

const counts = KINDS.map((k) => `${DATA[k].length} ${k}`).join(', ');
console.log(`built ${BUILD} into _site/: ${counts}`);
