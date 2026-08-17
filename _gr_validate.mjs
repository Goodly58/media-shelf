/**
 * Trust check. Before using the light autocomplete endpoint for 1300 books,
 * confirm it returns the SAME answer as the authoritative /book/isbn/ HTML route
 * on books already resolved that way.
 */
import fs from 'node:fs';
import { sleep, fold, decodeEntities } from './_gr_lib.mjs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const cache = JSON.parse(fs.readFileSync('_goodreads-cache.json', 'utf8'));
const known = Object.entries(cache).filter(([, v]) => v && v.ok === true && v.rating != null);
// spread the sample across the file rather than taking a contiguous block
const step = Math.max(1, Math.floor(known.length / 60));
const sample = known.filter((_, i) => i % step === 0).slice(0, 60);

let agree = 0, drift = 0, disagree = 0, empty = 0, err = 0;
const bad = [];
for (const [isbn, htmlAnswer] of sample) {
  let j = null;
  try {
    const r = await fetch(`https://www.goodreads.com/book/auto_complete?format=json&q=${isbn}`,
      { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (r.status !== 200) { err++; await sleep(1100); continue; }
    j = JSON.parse(await r.text());
  } catch { err++; await sleep(1100); continue; }

  if (!Array.isArray(j) || !j.length) { empty++; bad.push([isbn, 'EMPTY', htmlAnswer.title]); await sleep(1100); continue; }
  const a = j[0];
  const theirs = Number(a.avgRating);
  const d = Math.abs(theirs - Number(htmlAnswer.rating));
  const tOk = (() => {
    const x = fold(a.bookTitleBare || a.title);
    const y = fold(decodeEntities(htmlAnswer.title || '').replace(/(…|\.\.\.)\s*$/, ''));
    if (!x || !y) return true;
    return x.startsWith(y) || y.startsWith(x) || x.includes(y) || y.includes(x);
  })();
  if (!tOk) { disagree++; bad.push([isbn, `TITLE html="${htmlAnswer.title}" json="${a.bookTitleBare}"`]); }
  else if (d < 0.001) agree++;
  else if (d < 0.05) drift++;
  else { disagree++; bad.push([isbn, `RATING html=${htmlAnswer.rating} json=${theirs} (${a.bookTitleBare})`]); }
  await sleep(1100);
}
console.log(`sampled ${sample.length} books already resolved via the authoritative HTML route`);
console.log(`  identical rating : ${agree}`);
console.log(`  within 0.05      : ${drift}`);
console.log(`  DISAGREE         : ${disagree}`);
console.log(`  empty result     : ${empty}`);
console.log(`  fetch error      : ${err}`);
for (const b of bad) console.log('   ', b.join('  '));
