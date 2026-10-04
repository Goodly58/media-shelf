/**
 * Verify book ratings against Goodreads.
 *
 *   node tools/goodreads/verify_books.mjs          report only
 *   node tools/goodreads/verify_books.mjs --apply  write the corrections into books.html
 *
 * I previously called this impossible. That was wrong, and the mistake is worth
 * naming: Goodreads retired its API in December 2020, and I treated "no API" as
 * "no data". The book PAGES are server-rendered and carry JSON-LD with
 * ratingValue and ratingCount, and /book/isbn/{isbn} resolves directly — no
 * search, no key, no fuzzy title matching. Dune returns 4.29 from 1,698,127
 * ratings against the 4.27 the catalogue holds.
 *
 * The join is by ISBN, which 93% of the catalogue has, so this cannot repeat the
 * IMDb failure where a plausible-looking id pointed at a different work — but
 * the returned title is checked anyway, because that assumption is exactly the
 * one that failed last time.
 */
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const CACHE = '_goodreads-cache.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function readArray(file, name) {
  const h = fs.readFileSync(file, 'utf8');
  const at = h.search(new RegExp(`const ${name}\\s*=\\s*\\[`));
  const s = h.indexOf('[', at);
  let d = 0, e = -1, q = false, esc = false;
  for (let i = s; i < h.length; i++) {
    const c = h[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { e = i + 1; break; } }
  }
  return { array: JSON.parse(h.slice(s, e)), start: s, end: e, html: h };
}

const { array: BOOKS, start, end, html } = readArray('books.html', 'BOOKS');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function fetchBook(isbn) {
  try {
    const res = await fetch(`https://www.goodreads.com/book/isbn/${isbn}`, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const h = await res.text();
    const rating = h.match(/"ratingValue":\s*([0-9.]+)/);
    const count = h.match(/"ratingCount":\s*([0-9]+)/);
    const name = h.match(/<meta property="og:title" content="([^"]*)"/)
      || h.match(/"name":\s*"([^"]{2,120})"/);
    if (!rating) return { ok: false, status: 'no rating in page' };
    return {
      ok: true,
      rating: Number(rating[1]),
      count: count ? Number(count[1]) : null,
      title: name ? name[1] : null,
    };
  } catch (e) {
    return { ok: false, status: String(e.name || e) };
  }
}

const withIsbn = BOOKS.filter((b) => b.isbn);
const todo = withIsbn.filter((b) => !(String(b.isbn) in cache));
console.log(`${withIsbn.length} of ${BOOKS.length} books carry an ISBN`);
console.log(`${Object.keys(cache).length} cached, ${todo.length} to fetch (~${Math.round(todo.length * 1.6 / 60)} min)\n`);

let done = 0;
for (const b of todo) {
  cache[String(b.isbn)] = await fetchBook(b.isbn);
  done += 1;
  if (done % 25 === 0) {
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    const ok = Object.values(cache).filter((v) => v && v.ok).length;
    process.stdout.write(`  ${done}/${todo.length}  (${ok} resolved)\r`);
  }
  await sleep(1500); // deliberately gentle; this is someone else's server
}
fs.writeFileSync(CACHE, JSON.stringify(cache));

/* ------------------------------------------------------------------ compare */

let checked = 0, agree = 0, fixed = 0, mismatch = 0, failed = 0;
const moves = [];

for (const b of BOOKS) {
  const hit = b.isbn ? cache[String(b.isbn)] : null;
  if (!hit) continue;
  if (!hit.ok) { failed += 1; continue; }

  // The ISBN join should be exact, but so should have been the IMDb one.
  if (hit.title) {
    const a = fold(b.title), t = fold(hit.title);
    if (a && t && !t.includes(a) && !a.includes(t)) { mismatch += 1; continue; }
  }

  checked += 1;
  const theirs = Math.round(hit.rating * 100) / 100;
  const ours = b.rating == null ? null : Math.round(b.rating * 100) / 100;
  if (ours === theirs) { agree += 1; b.ratingVerified = true; continue; }
  moves.push([b.title, ours, theirs, hit.count]);
  b.rating = theirs;
  if (hit.count) b.ratingsCount = hit.count;
  b.ratingVerified = true;
  fixed += 1;
}

moves.sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2]));
console.log(`\n${checked} compared, ${agree} already correct, ${fixed} corrected`);
console.log(`${mismatch} ISBNs resolved to a different book, ${failed} could not be fetched\n`);
console.log('biggest corrections:');
for (const [t, o, n, c] of moves.slice(0, 15)) {
  console.log(`  ${String(o ?? '—').padStart(5)} -> ${String(n).padStart(5)}  ${t}${c ? `  (${c.toLocaleString()} ratings)` : ''}`);
}

if (!APPLY) { console.log('\n(report only — pass --apply to write)'); process.exit(0); }
fs.writeFileSync('books.html', html.slice(0, start) + JSON.stringify(BOOKS) + html.slice(end));
console.log('\nwrote books.html');
