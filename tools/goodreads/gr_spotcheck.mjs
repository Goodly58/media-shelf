/**
 * Final end-to-end check. Take the biggest claimed corrections and re-verify them
 * against the AUTHORITATIVE /book/isbn/ HTML route via a real browser-free fetch,
 * confirming the page is about the right book before believing the number.
 */
import fs from 'node:fs';
import { sleep, decodeEntities } from './gr_lib.mjs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const rows = JSON.parse(fs.readFileSync('_book-ratings.json', 'utf8'));
const pick = [...rows.filter((r) => r.gap >= 0.25).slice(0, 6), ...rows.filter((r) => r.gap < 0.02).slice(0, 3)];

for (const r of pick) {
  let out = 'inconclusive';
  for (let tries = 0; tries < 5; tries++) {
    const res = await fetch(`https://www.goodreads.com/book/isbn/${r.isbn}`,
      { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const b = await res.text();
    if (res.status === 202 || b.includes('awsWafCookieDomainList') || b.length < 20000) {
      await sleep(6000 * 2 ** tries); continue;   // RULE 5
    }
    const m = b.match(/"ratingValue":\s*([0-9.]+)/);
    const c = b.match(/"ratingCount":\s*([0-9]+)/);
    const og = b.match(/<meta property="og:title" content="([^"]*)"/);
    out = `live=${m ? m[1] : '-'} count=${c ? c[1] : '-'} page="${og ? decodeEntities(og[1]) : '?'}"`;
    break;
  }
  const agree = out.includes(`live=${r.theirs}`);
  console.log(`${agree ? 'OK ' : '?? '} ours=${String(r.ours).padEnd(5)} recorded=${String(r.theirs).padEnd(5)} gap=${String(r.gap).padEnd(5)} ${r.title}`);
  console.log(`      ${out}`);
  await sleep(2500);
}
