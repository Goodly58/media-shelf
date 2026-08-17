/**
 * The HTML route gave a TRUNCATED og:title and no author, so those entries are
 * verified more weakly than the autocomplete ones and the author guard cannot run
 * on them at all. Re-resolve them through autocomplete so every book in the
 * catalogue is checked on the same, stronger footing (full title + author).
 *
 * The existing rating is kept if the refresh fails - this only ADDS verification
 * material, so a throttle can never downgrade an answer we already hold.
 */
import fs from 'node:fs';
import { sleep } from './_gr_lib.mjs';

const CACHE = '_goodreads-cache.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));

const todo = Object.entries(cache)
  .filter(([, v]) => v && v.ok === true && !v.author && v.via !== 'autocomplete')
  .map(([k]) => k);
console.log(`${todo.length} entries lack author/full-title verification material`);

let upgraded = 0, changed = 0, failed = 0;
for (let i = 0; i < todo.length; i++) {
  const isbn = todo[i];
  let j = null;
  for (let tries = 0; tries < 4 && !j; tries++) {
    try {
      const r = await fetch(`https://www.goodreads.com/book/auto_complete?format=json&q=${isbn}`,
        { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
      if (r.status === 200) {
        const t = await r.text();
        if (!t.includes('awsWafCookieDomainList')) j = JSON.parse(t);
      }
    } catch { /* fall through to backoff */ }
    if (!j) await sleep(4000 * 2 ** tries);   // RULE 5: retry, never record failure
  }
  if (!j) { failed += 1; continue; }
  if (!Array.isArray(j) || !j.length) { failed += 1; continue; }

  const cands = j.slice(0, 3)
    .filter((a) => Number(a.avgRating) > 0 && Number(a.ratingsCount) > 0)
    .map((a) => ({ title: a.bookTitleBare || a.title, author: a.author?.name ?? null,
                   rating: Number(a.avgRating), count: a.ratingsCount ?? null, bookId: a.bookId }));
  if (!cands.length) { failed += 1; continue; }

  const before = cache[isbn].rating;
  cache[isbn] = {
    ok: true, rating: cands[0].rating, count: cands[0].count, title: cands[0].title,
    author: cands[0].author, bookId: cands[0].bookId, via: 'autocomplete',
    htmlTitle: cache[isbn].title,          // keep what the authoritative route said
    cands: cands.length > 1 ? cands : undefined,
  };
  upgraded += 1;
  if (Math.abs(before - cands[0].rating) > 0.02) changed += 1;

  if (upgraded % 50 === 0) {
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    console.log(`  ${i + 1}/${todo.length} upgraded=${upgraded} moved=${changed} failed=${failed}`);
  }
  await sleep(1100);
}
fs.writeFileSync(CACHE, JSON.stringify(cache));
console.log(`\ndone: ${upgraded} upgraded, ${changed} whose rating moved >0.02, ${failed} left as-is`);
