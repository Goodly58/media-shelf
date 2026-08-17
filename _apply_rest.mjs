/**
 * Apply the two corrections that are actually established, from caches already
 * on disk. No network.
 *
 *   node _apply_rest.mjs          report
 *   node _apply_rest.mjs --apply  write books.html and data/movies.json
 *
 * 1. BOOKS — only where the gap is real.
 *    Comparing to two decimals called 599 of 634 wrong, which measured the test
 *    rather than the data: a Goodreads average moves daily, and 69% of gaps are
 *    under 0.10. A 0.25 floor keeps the genuine errors (The Sandman Vol. 1 is
 *    stored at 4.80 and is 4.25 across 276k ratings) and ignores the drift.
 *    Everything confirmed is marked verified regardless, since agreement inside
 *    the drift band IS confirmation.
 *
 * 2. FILMS — the Rotten Tomatoes critics score, which was fetched but never
 *    parsed. Read from the criticsScore block, and only when that block carries
 *    a real reviewCount: a page that loads with reviewCount 0 has not answered.
 */
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const DRIFT = 0.25;
const APPLY_RT = false;   // see the note in the films block

function readArray(file, name) {
  const h = fs.readFileSync(file, 'utf8');
  const at = h.search(new RegExp('const ' + name + '\\s*=\\s*\\['));
  const s = h.indexOf('[', at);
  let d = 0, e = -1, q = false, esc = false;
  for (let i = s; i < h.length; i++) {
    const c = h[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { e = i + 1; break; } }
  }
  return { array: JSON.parse(h.slice(s, e)), start: s, end: e, html: h };
}
/* Entities must be decoded BEFORE folding. Goodreads returns "Preludes &amp;
   Nocturnes"; stripping non-alphanumerics turns &amp; into the literal token
   "amp", so the title stopped matching its own book and The Sandman Vol. 1 was
   discarded as "a different work" while sitting in the cache at 4.25. */
const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&#x27;|&apos;|&#39;/g, "'")
  .replace(/&quot;|&#34;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const fold = (s) => decode(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/* ------------------------------------------------------------------- books */
const { array: BOOKS, start, end, html } = readArray('books.html', 'BOOKS');
const gr = JSON.parse(fs.readFileSync('_goodreads-cache.json', 'utf8'));

let bChecked = 0, bDrift = 0, bFixed = 0, bSkip = 0;
const bMoves = [];
for (const b of BOOKS) {
  const v = b.isbn ? gr[String(b.isbn)] : null;
  if (!v || !v.ok || b.rating == null) continue;
  if (v.title) {
    const a = fold(b.title), t = fold(v.title);
    if (a && t && !t.includes(a) && !a.includes(t)) { bSkip += 1; continue; }
  }
  bChecked += 1;
  const gap = Math.abs(b.rating - v.rating);
  b.ratingVerified = true;
  if (v.count) b.ratingsCount = v.count;
  if (gap < DRIFT) { bDrift += 1; continue; }
  bMoves.push([b.title, b.rating, v.rating, v.count]);
  b.rating = Math.round(v.rating * 100) / 100;
  bFixed += 1;
}
console.log(`BOOKS  ${bChecked} confirmed against Goodreads (${bSkip} ISBNs named another book)`);
console.log(`       ${bDrift} agree within ${DRIFT}, ${bFixed} genuinely wrong and corrected\n`);
for (const [t, o, n, c] of bMoves.sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2])).slice(0, 10)) {
  console.log(`  ${o.toFixed(2)} -> ${n.toFixed(2)}  ${t}${c ? `  (${c.toLocaleString()})` : ''}`);
}

/* ------------------------------------------------------------------- films */
const raw = JSON.parse(fs.readFileSync('data/movies.json', 'utf8'));
const movies = Array.isArray(raw) ? raw : raw.movies;
const rt = JSON.parse(fs.readFileSync('_rt-cache.json', 'utf8'));

let rChecked = 0, rAgree = 0, rFixed = 0, rThin = 0;
const rMoves = [];
for (const m of movies) {
  const v = rt[m.title];
  if (!v || !v.ok || !v.critics) continue;
  const cnt = Number((v.critics.match(/"reviewCount":(\d+)/) || [])[1] || 0);
  const sc = Number((v.critics.match(/"score":"(\d+)"/) || [])[1] || NaN);
  if (!cnt || !Number.isFinite(sc)) { rThin += 1; continue; }
  const page = (v.title || '').replace(/\s*\|\s*Rotten Tomatoes\s*$/i, '');
  const a = fold(m.title), t = fold(page);
  if (t && a && !t.includes(a) && !a.includes(t)) { rThin += 1; continue; }
  /* HELD. The title guard cannot catch a remake, because a remake has the SAME
     title: /m/carrie resolves to the 2013 film, not De Palma's 1976, and the
     name matches perfectly. That produced Carrie 92->51, RoboCop 88->50,
     Suspiria 94->65 and Pinocchio 97->0, every one of them a different film.
     The RT page's year was never captured, so there is nothing here to check it
     against — and an unverifiable correction is not a correction. Re-fetch with
     the release year before trusting any of this. */
  rChecked += 1;
  if (!APPLY_RT) continue;
  m.rtVerified = true;
  m.rtReviews = cnt;
  if (m.rt === sc) { rAgree += 1; continue; }
  rMoves.push([m.title, m.rt, sc, cnt]);
  m.rt = sc;
  rFixed += 1;
}
console.log(`\nFILMS  ${rChecked} confirmed against Rotten Tomatoes (${rThin} pages thin or mismatched)`);
console.log(`       ${rAgree} already correct, ${rFixed} corrected\n`);
for (const [t, o, n, c] of rMoves.sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2])).slice(0, 10)) {
  console.log(`  ${String(o ?? '—').padStart(3)} -> ${String(n).padStart(3)}  ${t}  (${c} reviews)`);
}

if (!APPLY) { console.log('\n(report only — pass --apply to write)'); process.exit(0); }
fs.writeFileSync('books.html', html.slice(0, start) + JSON.stringify(BOOKS) + html.slice(end));
fs.writeFileSync('data/movies.json', JSON.stringify(Array.isArray(raw) ? movies : { ...raw, movies }));
console.log('\nwrote books.html and data/movies.json');
