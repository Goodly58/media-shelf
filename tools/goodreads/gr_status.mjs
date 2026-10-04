import fs from 'node:fs';
import { readArray, isFinal } from './gr_lib.mjs';

const { array: BOOKS } = readArray('books.html', 'BOOKS');
const cache = JSON.parse(fs.readFileSync('_goodreads-cache.json', 'utf8'));

const withIsbn = BOOKS.filter((b) => b.isbn);
const isbns = [...new Set(withIsbn.map((b) => String(b.isbn)))];

let ok = 0, dead = 0, retry = 0, absent = 0, norate = 0;
const retryReasons = {};
for (const i of isbns) {
  const v = cache[i];
  if (!v) { absent++; continue; }
  if (v.ok === true) { ok++; continue; }
  if (v.status === 404) { dead++; continue; }
  // "no-rating-confirmed" is a real answer, not something to refetch
  if (v.status === 'no-rating-confirmed') { norate++; continue; }
  retry++;
  const r = String(v.status);
  retryReasons[r] = (retryReasons[r] || 0) + 1;
}

console.log(`books: ${BOOKS.length}   with ISBN: ${withIsbn.length}   distinct ISBNs: ${isbns.length}`);
console.log(`cached OK (real rating): ${ok}`);
console.log(`cached 404 (genuinely no such book): ${dead}`);
console.log(`confirmed unrated (real answer): ${norate}`);
console.log(`RETRYABLE (must refetch): ${retry}`);
console.log(`never attempted: ${absent}`);
console.log(`--> work queue: ${retry + absent}`);
console.log('\nretryable breakdown:');
for (const [k, n] of Object.entries(retryReasons).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${k}`);
}
const orphans = Object.keys(cache).filter((k) => !isbns.includes(k));
console.log(`\ncache keys no longer in catalogue: ${orphans.length}`);
console.log(`isFinal() sanity - entries kept: ${Object.values(cache).filter(isFinal).length}`);
