/**
 * Repair the fabricated IMDb ids rather than merely dropping them, then apply
 * every title-confirmed rating correction.
 *
 *   node tools/imdb/repair_imdb.mjs          report only
 *   node tools/imdb/repair_imdb.mjs --apply  write data/movies.json and data/shows.json
 *
 * Run tools/imdb/verify_imdb.mjs first — this reads the bad-id list it writes.
 *
 * A wrong id is worse than a missing one: it sends a reader who clicked Columbo
 * to Blood Sabbath. But dropping it loses the outbound link for 128 entries, and
 * the right id is usually one search away — IMDb's suggestion endpoint takes a
 * title as well as an id. So each bad id is looked up by title, filtered to the
 * right KIND (a series must resolve to a series, not to one of its TV movies)
 * and accepted only on a year that agrees.
 */
import fs from 'node:fs';
import readline from 'node:readline';

const APPLY = process.argv.includes('--apply');
const TSV = '_imdb-ratings.tsv';
const BAD = JSON.parse(fs.readFileSync('_bad-imdb-ids.json', 'utf8'));

const load = (f, k) => {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { raw, rows: Array.isArray(raw) ? raw : raw[k] || [] };
};
const sets = {
  films: { file: 'data/movies.json', key: 'movies', kinds: ['movie', 'tvMovie', 'video'] },
  series: { file: 'data/shows.json', key: 'shows', kinds: ['tvSeries', 'tvMiniSeries'] },
};
for (const s of Object.values(sets)) s.data = load(s.file, s.key);

const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(title) {
  // The endpoint keys off the first character of the query.
  const q = title.toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim().replace(/\s+/g, '_');
  if (!q) return [];
  try {
    const res = await fetch(`https://v2.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q)}.json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.d || []).filter((d) => d.id && d.id.startsWith('tt'));
  } catch {
    return [];
  }
}

const repairs = [];
const giveUp = [];

console.log(`searching IMDb for ${BAD.length} mis-identified titles…\n`);
for (let i = 0; i < BAD.length; i++) {
  const b = BAD[i];
  const set = sets[b.label];
  const hits = await search(b.title);
  const want = fold(b.title);

  const candidate = hits.find((d) => {
    if (!set.kinds.includes(d.qid || d.q)) return false;
    const got = fold(d.l);
    if (got !== want && !got.includes(want) && !want.includes(got)) return false;
    // A series entry's year is its first season, so allow a little slack.
    if (b.year && d.y && Math.abs(b.year - d.y) > 3) return false;
    return true;
  });

  if (candidate) repairs.push({ ...b, newId: candidate.id, newTitle: candidate.l, newYear: candidate.y });
  else giveUp.push(b);

  if (i % 20 === 0) process.stdout.write(`  ${i}/${BAD.length}\r`);
  await sleep(220);
}

console.log(`repaired ${repairs.length} ids, could not resolve ${giveUp.length}\n`);
for (const r of repairs.slice(0, 12)) {
  console.log(`  ${r.title} (${r.year})  ${r.id} -> ${r.newId}  "${r.newTitle}" (${r.newYear ?? '?'})`);
}
if (giveUp.length) {
  console.log(`\nunresolved (id removed, no link rather than a wrong one):`);
  for (const g of giveUp.slice(0, 10)) console.log(`  ${g.label} ${g.title} (${g.year})`);
}

/* Ratings for the newly discovered ids — a second pass over the TSV, since the
   first only kept the ids we already knew about. */
const wanted = new Set(repairs.map((r) => r.newId));
const fresh = new Map();
if (wanted.size) {
  const rl = readline.createInterface({ input: fs.createReadStream(TSV), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const tab = line.indexOf('\t');
    const id = line.slice(0, tab);
    if (!wanted.has(id)) continue;
    const rest = line.slice(tab + 1).split('\t');
    fresh.set(id, { rating: Number(rest[0]), votes: Number(rest[1]) });
  }
}
console.log(`\nratings found for ${fresh.size} of the ${repairs.length} repaired ids`);

const byKey = new Map();
for (const r of repairs) byKey.set(`${r.label}|${r.title}|${r.year}`, r);
const drop = new Set(giveUp.map((g) => `${g.label}|${g.title}|${g.year}`));

let applied = 0, removed = 0;
for (const [label, s] of Object.entries(sets)) {
  for (const row of s.data.rows) {
    const key = `${label}|${row.title}|${row.year}`;
    if (drop.has(key)) { delete row.imdbId; row.imdbVerified = false; removed += 1; continue; }
    const r = byKey.get(key);
    if (!r) continue;
    row.imdbId = r.newId;
    const hit = fresh.get(r.newId);
    if (hit) { row.imdb = Math.round(hit.rating * 10) / 10; row.imdbVotes = hit.votes; row.imdbVerified = true; }
    applied += 1;
  }
}
console.log(`\n${applied} entries repointed, ${removed} left without an id`);

if (!APPLY) { console.log('\n(report only — pass --apply to write)'); process.exit(0); }
for (const s of Object.values(sets)) {
  const out = Array.isArray(s.data.raw) ? s.data.rows : { ...s.data.raw, [s.key]: s.data.rows };
  fs.writeFileSync(s.file, JSON.stringify(out));
  console.log(`wrote ${s.file}`);
}
