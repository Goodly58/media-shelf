/** What exactly is the remainder, and why did the earlier passes miss it? */
import { readFileSync, existsSync } from 'node:fs';
import { readArray, slugify, titlesAgree, decodeEntities } from './ms_lib.mjs';

const GAMES = readArray('games.html', 'GAMES');
const MOVIES = JSON.parse(readFileSync('data/movies.json', 'utf8'));

const gRem = GAMES.filter((g) => g.metacritic != null && !g.verified);
const mRem = MOVIES.filter((m) => m.metacritic != null && !m.verified);
console.log(`games: ${GAMES.length} total, ${GAMES.filter((g) => g.metacritic != null).length} scored, ${gRem.length} unverified`);
console.log(`films: ${MOVIES.length} total, ${MOVIES.filter((m) => m.metacritic != null).length} scored, ${mRem.length} unverified`);

// Why did the old pass miss them? Bucket against its own cache.
const gc = existsSync('.verify-cache/games-v2.json') ? JSON.parse(readFileSync('.verify-cache/games-v2.json', 'utf8')) : {};
const mc = existsSync('.verify-cache/movies.json') ? JSON.parse(readFileSync('.verify-cache/movies.json', 'utf8')) : {};

function bucket(list, cache, yearKey) {
  const b = { noCacheEntry: 0, slug404: 0, titleMismatch: 0, yearMismatch: 0, noScore: 0, other: 0 };
  const samples = { slug404: [], titleMismatch: [], yearMismatch: [] };
  for (const o of list) {
    const hit = cache[slugify(o.title)];
    if (hit === undefined) { b.noCacheEntry += 1; continue; }
    if (hit.missing) {
      b.slug404 += 1;
      if (samples.slug404.length < 25) samples.slug404.push(`${o.title} (${o.year}) [slug: ${slugify(o.title)}]`);
      continue;
    }
    if (!titlesAgree(o.title, hit.title)) {
      b.titleMismatch += 1;
      if (samples.titleMismatch.length < 20) samples.titleMismatch.push(`${o.title} -> ${hit.title}`);
      continue;
    }
    const fy = String(hit[yearKey] ?? hit.date ?? '').slice(0, 4);
    if (String(o.year) !== fy) {
      b.yearMismatch += 1;
      if (samples.yearMismatch.length < 20) samples.yearMismatch.push(`${o.title} (${o.year}) -> ${hit.title} (${fy || '?'})`);
      continue;
    }
    if ((hit.pc ?? hit.headline ?? hit.score) == null) { b.noScore += 1; continue; }
    b.other += 1;
  }
  return { b, samples };
}

console.log('\n=== games remainder, bucketed against the old cache ===');
const g = bucket(gRem, gc, 'date');
console.log(g.b);
console.log('slug 404 samples:'); g.samples.slug404.forEach((s) => console.log('   ' + s));
console.log('title mismatch samples:'); g.samples.titleMismatch.forEach((s) => console.log('   ' + s));
console.log('year mismatch samples:'); g.samples.yearMismatch.forEach((s) => console.log('   ' + s));

console.log('\n=== films remainder ===');
const m = bucket(mRem, mc, 'year');
console.log(m.b);
console.log('slug 404 samples:'); m.samples.slug404.forEach((s) => console.log('   ' + s));
console.log('title mismatch samples:'); m.samples.titleMismatch.forEach((s) => console.log('   ' + s));
console.log('year mismatch samples:'); m.samples.yearMismatch.forEach((s) => console.log('   ' + s));

// entity check (rule 5)
const ent = [...gRem, ...mRem].filter((o) => /&[a-z#0-9]+;/i.test(o.title));
console.log(`\ntitles carrying HTML entities: ${ent.length}`);
ent.slice(0, 15).forEach((o) => console.log(`   ${o.title}  ->  ${decodeEntities(o.title)}`));
