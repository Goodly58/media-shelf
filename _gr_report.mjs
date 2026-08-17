/**
 * Build _book-ratings.json and state coverage.
 *
 *   node _gr_report.mjs           report only (default)
 *   node _gr_report.mjs --apply   write corrections into books.html
 *
 * RULE 1: report-only by default.
 * RULE 2: the ISBN join is exact, but the returned page TITLE is still checked.
 * RULE 4: HTML entities are decoded before any title comparison.
 * DRIFT:  a Goodreads average moves daily. Only a gap of >= 0.25 is an error.
 */
import fs from 'node:fs';
import { readArray, decodeEntities, titleMatch, authorMatch } from './_gr_lib.mjs';

/**
 * Pick the candidate that actually IS our book, or reject.
 * The autocomplete endpoint is a search, so rank 1 is not automatically right;
 * a nonsense ISBN returns an unrelated book. Title must agree, and where we know
 * the author it must agree too.
 */
// A strong title match on an exact ISBN is much better evidence than the author
// field, because Goodreads routinely credits a co-author, a translator or the
// publisher as the primary author: The Illusion of Life is filed under Ollie
// Johnston not Frank Thomas, If Not, Winter under Sappho not Anne Carson,
// Blues People under Amiri Baraka (the same man as LeRoi Jones). Vetoing those
// throws away correct books. So the author only vetoes a WEAK title match.
const STRONG = new Set(['exact', 'prefix', 'substring', 'main-title', 'no-page-title', 'empty']);

// avgRating 0 alongside 0 ratings means UNRATED, not "rated zero" - believing it
// claimed a 3.85 -> 0 "correction" on The Gaucho Martin Fierro.
const isRated = (c) => Number(c.rating) > 0 && (c.count == null || Number(c.count) > 0);

function resolve(book, v) {
  const cands = (v.cands && v.cands.length ? v.cands : [{
    title: v.title, author: v.author, rating: v.rating, count: v.count,
  }]);
  // Identity first: if the ISBN names a different book, that is the finding,
  // whether or not that other book happens to carry a rating.
  let weak = null, unratedHit = null;
  for (const c of cands) {
    const tm = titleMatch(book.title, c.title);
    if (!tm.ok) continue;
    if (!STRONG.has(tm.why) && !authorMatch(book.author, c.author).ok) {
      weak = weak || { c, am: authorMatch(book.author, c.author) };
      continue;
    }
    if (isRated(c)) return { hit: c, why: tm.why };
    unratedHit = unratedHit || c;               // right book, genuinely unrated
  }
  if (unratedHit) return { reject: 'unrated', cand: unratedHit };
  if (weak) return { reject: 'author', detail: weak.am.why, cand: weak.c };
  return { reject: 'title', cand: cands[0] };
}

const APPLY = process.argv.includes('--apply');
const DRIFT = 0.25;

const { array: BOOKS, start, end, html } = readArray('books.html', 'BOOKS');
const cache = JSON.parse(fs.readFileSync('_goodreads-cache.json', 'utf8'));

const rows = [];
let rated = 0, unrated = 0, gone = 0, pending = 0, noIsbn = 0, mismatch = 0, authorRejects = 0;
const mismatches = [], errors = [];

for (const b of BOOKS) {
  if (!b.isbn) { noIsbn += 1; continue; }
  const v = cache[String(b.isbn)];
  if (!v) { pending += 1; continue; }

  if (v.ok !== true) {
    if (v.status === 404) gone += 1;
    else if (v.status === 'no-rating-confirmed') unrated += 1;
    else pending += 1;                       // retryable leftovers
    continue;
  }

  const r = resolve(b, v);
  if (r.reject === 'unrated') { unrated += 1; continue; }   // real absence, not a failure
  if (r.reject) {
    mismatch += 1;
    if (r.reject === 'author') authorRejects += 1;
    mismatches.push({
      isbn: String(b.isbn), ours: b.title, ourAuthor: b.author || null,
      page: decodeEntities(r.cand.title || ''), pageAuthor: r.cand.author || null,
      reject: r.reject,
    });
    continue;                                // never trust a rating from a different book
  }

  rated += 1;
  const ours = b.rating == null ? null : Number(b.rating);
  const theirs = Number(r.hit.rating);
  const gap = ours == null ? null : Math.round(Math.abs(ours - theirs) * 1000) / 1000;
  const row = { title: b.title, isbn: String(b.isbn), ours, theirs, count: r.hit.count ?? null, gap };
  rows.push(row);
  if (gap != null && gap >= DRIFT) errors.push(row);
}

rows.sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1));
fs.writeFileSync('_book-ratings.json', JSON.stringify(rows, null, 2));

const withIsbn = BOOKS.filter((b) => b.isbn).length;
const pct = (n, d) => `${(100 * n / d).toFixed(1)}%`;

console.log('COVERAGE');
console.log(`  ${BOOKS.length} books in the catalogue`);
console.log(`  ${withIsbn} carry an ISBN  (${noIsbn} do not, and cannot be joined)`);
console.log(`  ${rated} confirmed against Goodreads   ${pct(rated, withIsbn)} of ISBN books`);
console.log(`  ${gone} ISBNs Goodreads has no record of (real 404)`);
console.log(`  ${unrated} real pages that genuinely carry no rating`);
console.log(`  ${mismatch} ISBNs that resolve to a different book (excluded)`);
console.log(`      of those, ${authorRejects} matched on title but not on author`);
console.log(`  ${pending} still unresolved / not yet fetched`);
const accounted = rated + gone + unrated + mismatch + pending;
console.log(`  accounted: ${accounted}/${withIsbn}`);

const cmp = rows.filter((r) => r.gap != null);
console.log(`\nAGREEMENT  (drift rule: a gap under ${DRIFT} is normal daily movement, not an error)`);
console.log(`  ${cmp.length} books had a local rating to compare`);
console.log(`  ${cmp.length - errors.length} agree within ${DRIFT}`);
console.log(`  ${errors.length} are genuinely wrong (gap >= ${DRIFT})`);
console.log(`  ${rows.length - cmp.length} had no local rating at all`);
if (cmp.length) {
  const mean = cmp.reduce((s, r) => s + r.gap, 0) / cmp.length;
  console.log(`  mean drift ${mean.toFixed(3)}`);
}

console.log(`\nWORST GAPS`);
for (const r of errors.slice(0, 20)) {
  console.log(`  ${String(r.ours ?? '-').padStart(5)} -> ${String(r.theirs).padEnd(5)} gap ${String(r.gap).padEnd(5)} ${r.title}`);
}
if (mismatches.length) {
  console.log(`\nTITLE MISMATCHES (excluded, not corrected)`);
  for (const m of mismatches.slice(0, 20)) {
    console.log(`  [${m.reject}] ${m.isbn}  ours="${m.ours}" (${m.ourAuthor || '?'})  ->  "${m.page}" (${m.pageAuthor || '?'})`);
  }
  fs.writeFileSync('_book-isbn-mismatches.json', JSON.stringify(mismatches, null, 2));
}
console.log(`\nwrote _book-ratings.json (${rows.length} rows)`);

if (!APPLY) { console.log('\n(report only - pass --apply to write books.html)'); process.exit(0); }

let applied = 0;
for (const b of BOOKS) {
  if (!b.isbn) continue;
  const v = cache[String(b.isbn)];
  if (!v || v.ok !== true) continue;
  const r = resolve(b, v);
  if (r.reject) continue;
  b.rating = Number(r.hit.rating);
  if (r.hit.count) b.ratingsCount = r.hit.count;
  b.ratingVerified = true;
  applied += 1;
}
fs.writeFileSync('books.html', html.slice(0, start) + JSON.stringify(BOOKS) + html.slice(end));
console.log(`\nwrote books.html - ${applied} books updated`);
