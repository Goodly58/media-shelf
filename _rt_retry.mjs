/**
 * Second pass for Rotten Tomatoes, retrying the URLs the first pass missed.
 *
 * The first pass guessed /m/{title-slug} and resolved only 195 of 786. RT keys a
 * lot of pages on {title}_{year} — Parasite lives at /m/parasite_2019 — and uses
 * the bare slug for the rest, with no way to tell which from the title alone. So
 * the misses are retried with the year form, and only the misses: the 195 that
 * already answered are never fetched again.
 */
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CACHE = '_rt-cache.json';

const load = (f, k) => { const r = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(r) ? r : r[k] || []; };
const slug = (t) => String(t).toLowerCase().replace(/['’.:!?,]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
const movies = load('data/movies.json', 'movies');

const keep = (h) => ({
  critics: (h.match(/"criticsScore":\s*\{[^}]{0,300}\}/) || [])[0] || null,
  audience: (h.match(/"audienceScore":\s*\{[^}]{0,300}\}/) || [])[0] || null,
  percents: [...h.matchAll(/"scorePercent":"(\d+)%"/g)].map((m) => Number(m[1])).slice(0, 4),
  title: (h.match(/<title>([^<]{0,120})/) || [])[1] || null,
});

async function grab(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

/** A page that loaded but carries no review counts is no better than a miss. */
const thin = (v) => !v || !v.ok || !v.critics || /"reviewCount":0/.test(v.critics);

const retry = movies.filter((m) => thin(cache[m.title]));
console.log(`retrying ${retry.length} of ${movies.length} films with the {title}_{year} form`);

let done = 0, won = 0;
for (const m of retry) {
  const url = `https://www.rottentomatoes.com/m/${slug(m.title)}_${m.year}`;
  const h = await grab(url);
  if (h) {
    const got = keep(h);
    if (got.critics && !/"reviewCount":0/.test(got.critics)) {
      cache[m.title] = { ok: true, ...got, url };
      won += 1;
    }
  }
  done += 1;
  if (done % 25 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); process.stdout.write(`  ${done}/${retry.length} (+${won})\r`); }
  await sleep(900);
}
fs.writeFileSync(CACHE, JSON.stringify(cache));

const usable = movies.filter((m) => !thin(cache[m.title])).length;
console.log(`\nrecovered ${won}; ${usable} of ${movies.length} films now have a usable critics block`);
