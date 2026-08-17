/**
 * Independent spot-check: confirm a sample of _metascores.json against the
 * public page rather than the API that produced the number.
 *
 * The API and the page are the same source, but the page is what a person would
 * check, and reading it catches a whole class of error the API cannot show —
 * a slug that resolves to a different product, or a PC score attributed to a
 * console release. www.metacritic.com/robots.txt disallows /search, /signup,
 * /login, /user and two ad paths for `*`; /game/ and /movie/ product pages are
 * not disallowed, and no Claude/Anthropic agent is named.
 *
 *   node _ms_spotcheck.mjs [n]
 */

import { readFileSync } from 'node:fs';
import { UA } from './_ms_lib.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.argv[2] ?? 20);
const rows = JSON.parse(readFileSync('_metascores.json', 'utf8'));

// Sample across statuses that assert a number, plus some that assert absence.
const scored = rows.filter((r) => r.theirs != null && r.url);
const absent = rows.filter((r) => r.status === 'no-score' && r.url);
const pick = [];
const stride = Math.max(1, Math.floor(scored.length / Math.max(1, N - 4)));
for (let i = 0; i < scored.length && pick.length < N - 4; i += stride) pick.push(scored[i]);
for (let i = 0; i < absent.length && pick.length < N; i += Math.max(1, Math.floor(absent.length / 4))) pick.push(absent[i]);

let ok = 0;
let bad = 0;
for (const r of pick) {
  let html = '';
  for (let a = 0; a < 4; a += 1) {
    const res = await fetch(r.url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    html = await res.text();
    if (res.status === 202 || res.status === 429 || res.status >= 500 || !html.trim()) {
      await sleep(2000 * 2 ** a);
      html = '';
      continue;
    }
    break;
  }
  if (!html) { console.log(`  ?? ${r.title}: could not read page`); continue; }

  // The page embeds the same product JSON; read the PC platform score from it.
  const titleOnPage = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  let pageScore = null;
  const m = html.match(/"platforms":\s*(\[[^\]]*?\{[\s\S]*?\])\s*,\s*"/);
  const pcBlock = html.match(/\{"name":"PC"[\s\S]{0,400}?\}/);
  if (pcBlock) {
    const s = pcBlock[0].match(/"score":\s*(\d+)/);
    if (s) pageScore = Number(s[1]);
  }
  if (pageScore == null) {
    const s = html.match(/"criticScoreSummary":\s*\{[^}]*"score":\s*(\d+)/);
    if (s) pageScore = Number(s[1]);
  }
  const agree = r.theirs == null ? pageScore == null : pageScore === r.theirs;
  console.log(`  ${agree ? 'ok  ' : 'MISMATCH'} [${r.kind}] ${r.title} (${r.year}) ours=${r.ours} report=${r.theirs} page=${pageScore}  <${titleOnPage.slice(0, 60)}>`);
  agree ? (ok += 1) : (bad += 1);
  await sleep(1200);
}
console.log(`\nspot-check: ${ok} agree, ${bad} disagree, of ${pick.length} sampled`);
