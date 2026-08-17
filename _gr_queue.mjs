import fs from 'node:fs';
import { readArray, isFinal } from './_gr_lib.mjs';

const { array: BOOKS } = readArray('books.html', 'BOOKS');
const cache = JSON.parse(fs.readFileSync('_goodreads-cache.json', 'utf8'));

const seen = new Set();
const queue = [];
for (const b of BOOKS) {
  if (!b.isbn) continue;
  const isbn = String(b.isbn);
  if (seen.has(isbn)) continue;
  seen.add(isbn);
  if (isFinal(cache[isbn])) continue;   // RULE 5: only real answers are kept
  queue.push({ isbn, title: b.title });
}
fs.writeFileSync('_gr_queue.json', JSON.stringify(queue, null, 0));
console.log(`queue: ${queue.length} ISBNs to fetch (of ${seen.size} distinct)`);
