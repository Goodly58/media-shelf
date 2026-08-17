/**
 * Build the outstanding-books work queue.  REPORT ONLY - writes no catalogue file.
 *
 * "Outstanding" = a book in books.html that does not carry ratingVerified:true.
 * That is 591 books: 406 with an ISBN, 185 without.
 *
 * The 406 were never checked against the authoritative route.  The existing
 * _goodreads-cache.json resolved them through /book/auto_complete (a SEARCH keyed
 * by ISBN), which returns a nearest-match and so can hand back an unrelated book.
 * This queue sends them to https://www.goodreads.com/book/isbn/<isbn>, which is a
 * lookup, not a search.
 *
 *   node _rest_queue.mjs
 */
import fs from 'node:fs';
import { readArray } from './_gr_lib.mjs';

const { array: BOOKS } = readArray('books.html', 'BOOKS');
const oldCache = JSON.parse(fs.readFileSync('_goodreads-cache.json', 'utf8'));

const outstanding = BOOKS.filter((b) => b.ratingVerified !== true);
const withIsbn = outstanding.filter((b) => b.isbn);
const noIsbn = outstanding.filter((b) => !b.isbn);

// what the old (autocomplete) cache thought of each outstanding ISBN
const prior = {};
for (const b of withIsbn) {
  const v = oldCache[String(b.isbn)];
  const k = !v ? 'never-fetched'
    : v.ok === true ? 'autocomplete-returned-a-different-book'
      : v.status === 404 ? 'isbn-404'
        : v.status === 'no-rating-confirmed' ? 'page-carries-no-rating'
          : 'retryable';
  prior[k] = (prior[k] || 0) + 1;
}

const queue = withIsbn.map((b) => ({
  isbn: String(b.isbn),
  title: b.title,
  author: b.author,
  year: b.year,
  ours: b.rating == null ? null : Number(b.rating),
  priorStatus: (() => {
    const v = oldCache[String(b.isbn)];
    if (!v) return 'never-fetched';
    if (v.ok === true) return 'ac-different-book';
    if (v.status === 404) return 'ac-404';
    if (v.status === 'no-rating-confirmed') return 'ac-no-rating';
    return 'ac-retryable';
  })(),
  priorTitle: (oldCache[String(b.isbn)] || {}).title || null,
}));

fs.writeFileSync('_gr-rest-queue.json', JSON.stringify(queue, null, 2));
fs.writeFileSync('_gr-rest-noisbn.json', JSON.stringify(
  noIsbn.map((b) => ({ title: b.title, author: b.author, year: b.year, ours: b.rating ?? null })), null, 2));

console.log(`catalogue                ${BOOKS.length}`);
console.log(`ratingVerified:true      ${BOOKS.length - outstanding.length}`);
console.log(`outstanding              ${outstanding.length}`);
console.log(`  with ISBN (fetchable)  ${withIsbn.length}   -> _gr-rest-queue.json`);
console.log(`  no ISBN                ${noIsbn.length}   -> _gr-rest-noisbn.json`);
console.log('\nwhat the old autocomplete cache said about the 406:');
for (const [k, n] of Object.entries(prior).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}
