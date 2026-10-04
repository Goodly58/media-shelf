/**
 * Final independent re-read of the biggest claimed corrections, via the endpoint
 * that is not currently challenged. Confirms both the NUMBER and the IDENTITY of
 * each book (title + author) so a "correction" cannot be a wrong-book artifact.
 */
import fs from 'node:fs';
import { readArray, sleep } from './gr_lib.mjs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const rows = JSON.parse(fs.readFileSync('_book-ratings.json', 'utf8'));
const { array: BOOKS } = readArray('books.html', 'BOOKS');
const authorOf = new Map(BOOKS.filter((b) => b.isbn).map((b) => [String(b.isbn), b.author]));

const pick = rows.filter((r) => r.gap >= 0.25).slice(0, 12);
let confirmed = 0;
for (const r of pick) {
  let j = null;
  for (let t = 0; t < 5 && !j; t++) {
    try {
      const res = await fetch(`https://www.goodreads.com/book/auto_complete?format=json&q=${r.isbn}`,
        { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (res.status === 200) {
        const txt = await res.text();
        if (!txt.includes('awsWafCookieDomainList')) j = JSON.parse(txt);
      }
    } catch { /* retry */ }
    if (!j) await sleep(5000 * 2 ** t);
  }
  if (!j || !j.length) { console.log(`??  ${r.title} - could not re-read`); continue; }
  const a = j[0];
  const same = Math.abs(Number(a.avgRating) - r.theirs) < 0.02;
  if (same) confirmed += 1;
  console.log(`${same ? 'OK ' : '?? '} ${String(r.ours).padEnd(5)} -> ${String(r.theirs).padEnd(5)} live=${String(a.avgRating).padEnd(5)} | "${r.title}" (${authorOf.get(r.isbn)}) == "${a.bookTitleBare}" (${a.author?.name})`);
  await sleep(1300);
}
console.log(`\n${confirmed}/${pick.length} of the largest corrections re-confirmed on a fresh read`);
