/* Pre-publish checks for Shelf. Run after the build: node scripts/validate.js
 *
 * The deploy runs this and publishes nothing if it fails, so a broken build
 * stays a failed build instead of becoming a broken site. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const fail = [];
const ok = [];
const at = (f) => path.join(OUT, f);
const has = (f) => fs.existsSync(at(f));
const read = (f) => fs.readFileSync(at(f), 'utf8');

if (!has('index.html')) {
  console.error('_site/ is missing or empty: run npm run build first');
  process.exit(1);
}

/* ---------- pages ---------- */
const PAGES = ['index.html', 'games.html', 'books.html', 'movies.html', 'shows.html', 'backlog.html', '404.html'];
const sw = has('sw.js') ? read('sw.js') : '';
const version = (sw.match(/var VERSION = '([^']+)'/) || [])[1];
if (!version) fail.push('sw.js has no VERSION');

for (const p of PAGES) {
  if (!has(p)) { fail.push(`${p} is missing`); continue; }
  const h = read(p);
  if (/\{\{[\w:-]+\}\}/.test(h)) fail.push(`${p}: unfilled template placeholder ${h.match(/\{\{[\w:-]+\}\}/)[0]}`);
  const stamp = (h.match(/name="shelf-build" content="([^"]+)"/) || [])[1];
  if (stamp !== version) fail.push(`${p}: build stamp ${stamp} does not match sw.js ${version}`);
  let n = 0;
  for (const m of h.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(m[1])) continue;
    n++;
    // Speculation rules (and any other typed block) are JSON, not script.
    const json = /\btype="(speculationrules|application\/(ld\+)?json)"/.test(m[1]);
    try { if (json) JSON.parse(m[2]); else new Function(m[2]); } catch (e) { fail.push(`${p}: inline ${json ? 'JSON' : 'script'} #${n}: ${e.message}`); }
  }
  for (const m of h.matchAll(/(?:href|src)="((?:assets|data)\/[^"?#]+)/g)) {
    if (!has(m[1])) fail.push(`${p} references ${m[1]}, which is not in _site/`);
  }
}
ok.push(`${PAGES.length} pages: templates filled, scripts parse, references resolve`);

/* ---------- scripts ---------- */
const scripts = fs.readdirSync(at('assets')).filter((f) => f.endsWith('.js'));
for (const f of scripts) {
  try { new Function(read('assets/' + f)); } catch (e) { fail.push(`assets/${f}: ${e.message}`); }
}
try { new Function(sw); } catch (e) { fail.push(`sw.js: ${e.message}`); }
const shell = JSON.parse((sw.match(/var SHELL = (\[[\s\S]*?\]);/) || [])[1] || '[]');
for (const s of shell) {
  const f = s.split('?')[0];
  if (f && f !== './' && !has(f)) fail.push(`sw.js precaches ${s}, which does not exist`);
}
ok.push(`${scripts.length} scripts parse; ${shell.length} precached files exist`);

/* ---------- data ---------- */
const MIN = { games: 1000, books: 1500, movies: 5000, shows: 1500 };
const RANGE = { imdb: [1, 10], mc: [0, 100], mcu: [0, 10], rt: [0, 100], rta: [0, 100], steam: [0, 100], rating: [1, 5], ign: [0, 10] };
let total = 0;
for (const kind of Object.keys(MIN)) {
  let rows;
  try { rows = JSON.parse(read(`data/${kind}.json`)); } catch (e) { fail.push(`data/${kind}.json: ${e.message}`); continue; }
  if (!Array.isArray(rows)) { fail.push(`data/${kind}.json is not an array`); continue; }
  total += rows.length;
  if (rows.length < MIN[kind]) fail.push(`data/${kind}.json has ${rows.length} rows, expected at least ${MIN[kind]}`);
  const ids = new Set();
  for (const r of rows) {
    if (!r.id || !r.title) { fail.push(`${kind}: row without id or title: ${JSON.stringify(r).slice(0, 80)}`); continue; }
    if (ids.has(r.id)) fail.push(`${kind}: duplicate id ${r.id}`);
    ids.add(r.id);
    for (const [k, [lo, hi]] of Object.entries(RANGE)) {
      if (r[k] != null && !(typeof r[k] === 'number' && r[k] >= lo && r[k] <= hi)) fail.push(`${kind} ${r.id}: ${k}=${r[k]} is out of range`);
    }
    if (r.genres && !Array.isArray(r.genres)) fail.push(`${kind} ${r.id}: genres is not a list`);
    if (r.aw != null && !(Array.isArray(r.aw) && r.aw.every((a) => Array.isArray(a) && a.length >= 3 && a.every((x) => typeof x === 'string')))) fail.push(`${kind} ${r.id}: awards are not [key, years, category, ...] lists`);
  }
  if (kind === 'games') {
    const bare = rows.filter((r) => r.mc == null && r.steam == null).length;
    if (bare) fail.push(`games: ${bare} rows have neither a Metascore nor a Steam score`);
  }
  if (kind === 'books') {
    const bare = rows.filter((r) => r.rating == null).length;
    if (bare) fail.push(`books: ${bare} rows have no Goodreads rating`);
    const lost = rows.filter((r) => r.cv && !has(`covers/${r.cv}.webp`)).length;
    if (lost) fail.push(`books: ${lost} rows name a kept cover that is not in covers/`);
    const hue = rows.filter((r) => r.cc != null && !/^[0-9a-f]{6}$/.test(r.cc)).length;
    if (hue) fail.push(`books: ${hue} rows with a cover colour that is not six hex digits`);
  }
  if (kind === 'movies' || kind === 'shows') {
    const bad = rows.filter((r) => !/^tt\d+$/.test(r.id)).length;
    if (bad) fail.push(`${kind}: ${bad} rows without an IMDb id`);
  }
  ok.push(`data/${kind}.json: ${rows.length} rows, ids unique, scores in range`);
}

for (const kind of ['movies', 'shows', 'games']) {
  let b;
  try { b = JSON.parse(read(`data/${kind}-trailers.json`)); } catch (e) { if (e.code !== 'ENOENT') fail.push(`data/${kind}-trailers.json: ${e.message}`); continue; }
  // Films and series: backup YouTube ids. Games: Steam videos, [id, path of the stream].
  const ok1 = kind === 'games'
    ? (id, l) => Array.isArray(l) && l.length && l.every((v) => Array.isArray(v) && Number.isInteger(v[0]) && /^[\w/.?=-]+\.m3u8\?t=\d+$/.test(v[1]))
    : (id, l) => /^tt\d+$/.test(id) && Array.isArray(l) && l.every((v) => /^[\w-]{11}$/.test(v));
  const bad = Object.entries(b).filter(([id, l]) => !ok1(id, l)).length;
  if (bad) fail.push(`data/${kind}-trailers.json: ${bad} entries that are not trailer lists`);
  else ok.push(`data/${kind}-trailers.json: backups for ${Object.keys(b).length} titles`);
}

try {
  const s = JSON.parse(read('data/search.json'));
  if (s.items.length !== total) fail.push(`search.json holds ${s.items.length} titles, the catalogues ${total}`);
  else ok.push(`search index covers all ${total} titles`);
} catch (e) { fail.push(`data/search.json: ${e.message}`); }

/* ---------- report ---------- */
for (const o of ok) console.log('  ok    ' + o);
for (const f of fail.slice(0, 60)) console.log('  FAIL  ' + f);
if (fail.length > 60) console.log(`  ... and ${fail.length - 60} more`);
if (fail.length) { console.log(`\n${fail.length} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
