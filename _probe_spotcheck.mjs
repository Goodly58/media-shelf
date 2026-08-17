/**
 * Independent re-verification of a sample of _steam-missing.json.
 *
 *   node _probe_spotcheck.mjs [n]
 *
 * Deliberately does NOT read the cache. Every id in the sample is looked up
 * fresh from appdetails and from the CDN, and the answers are compared against
 * what the pass wrote down. The point is to catch a mistake in the pass's own
 * bookkeeping — a name recorded against the wrong row, a type that drifted, an
 * art check that was stale — which re-reading its cache could never reveal.
 *
 * Read-only. Nothing is written anywhere.
 */
import fs from 'node:fs';

const N = Number(process.argv[2]) || 25;
const rows = JSON.parse(fs.readFileSync('_steam-missing.json', 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Sample across the whole file rather than the head of it, so a systematic
   failure that only starts halfway down is still visible. */
const step = Math.max(1, Math.floor(rows.length / N));
const sample = rows.filter((_, i) => i % step === 0).slice(0, N);

console.log(`re-verifying ${sample.length} of ${rows.length} proposals, fresh from Steam\n`);

let ok = 0, bad = 0;
for (const r of sample) {
  const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${r.newId}&cc=us&l=en&filters=basic,release_date`, {
    headers: { 'User-Agent': 'media-shelf-id-repair/1.0' }, signal: AbortSignal.timeout(25000),
  });
  let live = null;
  try { const j = await res.json(); const d = j[r.newId]; if (d && d.success) live = d.data; } catch { /* handled below */ }
  await sleep(1600);

  const art = await fetch(`https://cdn.cloudflare.steamstatic.com/steam/apps/${r.newId}/header.jpg`, {
    method: 'HEAD', signal: AbortSignal.timeout(20000),
  }).then((x) => x.status === 200).catch(() => null);
  await sleep(400);

  const problems = [];
  if (!live) problems.push('appdetails returns nothing now');
  else {
    if (live.name !== r.steamName) problems.push(`name is "${live.name}", file says "${r.steamName}"`);
    if (live.type !== r.type) problems.push(`type is "${live.type}", file says "${r.type}"`);
  }
  if (art !== null && art !== r.headerOk) problems.push(`headerOk is ${art} live, file says ${r.headerOk}`);

  if (problems.length) { bad++; console.log(`  MISMATCH  ${r.title} (${r.year}) -> ${r.newId}`); for (const p of problems) console.log(`            ${p}`); }
  else { ok++; console.log(`  ok        ${r.title.slice(0, 44).padEnd(44)} -> ${String(r.newId).padEnd(8)} "${r.steamName}"`); }
}

console.log(`\n${ok} agreed, ${bad} disagreed`);
