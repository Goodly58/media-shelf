/**
 * Verify every IMDb rating in the films and series catalogues against IMDb's own
 * published dataset.
 *
 *   node tools/imdb/verify_imdb.mjs          report only
 *   node tools/imdb/verify_imdb.mjs --apply  write corrections into data/*.json
 *
 * WHY THIS ONE IS CLEAN
 * ---------------------
 * IMDb has no free query API, which is why these ratings shipped unverified. But
 * IMDb publishes the whole ratings table as a nightly dataset at
 * datasets.imdbws.com — official, free, no key, no scraping and no rate limit.
 * 8.6 MB gzipped covering ~1.5M titles.
 *
 * And the join is exact rather than fuzzy: the catalogue already stores `imdbId`
 * (tt0068646) for every film and 78% of series, so there is no title matching to
 * get wrong. No remake can be mistaken for its original here, which is the whole
 * class of error the Metacritic sweep had to defend against with year guards.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline';
import { Readable } from 'node:stream';

const APPLY = process.argv.includes('--apply');
const LOCAL = '_imdb-ratings.tsv';

async function ensureDataset() {
  if (fs.existsSync(LOCAL)) {
    console.log(`using cached ${LOCAL} (${Math.round(fs.statSync(LOCAL).size / 1e6)} MB)`);
    return;
  }
  console.log('downloading title.ratings.tsv.gz from IMDb…');
  const res = await fetch('https://datasets.imdbws.com/title.ratings.tsv.gz', {
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`IMDb dataset returned ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), zlib.createGunzip(), fs.createWriteStream(LOCAL));
  console.log(`downloaded (${Math.round(fs.statSync(LOCAL).size / 1e6)} MB uncompressed)`);
}

/** tconst -> { rating, votes } for only the ids we care about. */
async function loadRatings(wanted) {
  const out = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(LOCAL), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const tab = line.indexOf('\t');
    const id = line.slice(0, tab);
    if (!wanted.has(id)) continue;
    const rest = line.slice(tab + 1).split('\t');
    out.set(id, { rating: Number(rest[0]), votes: Number(rest[1]) });
  }
  return out;
}

const load = (f, k) => {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { raw, rows: Array.isArray(raw) ? raw : raw[k] || [] };
};

const sets = [
  { file: 'data/movies.json', key: 'movies', label: 'films' },
  { file: 'data/shows.json', key: 'shows', label: 'series' },
];

await ensureDataset();

const wanted = new Set();
for (const s of sets) {
  s.data = load(s.file, s.key);
  for (const r of s.data.rows) if (r.imdbId) wanted.add(r.imdbId);
}
console.log(`${wanted.size} distinct IMDb ids in the catalogues`);

const ratings = await loadRatings(wanted);
console.log(`${ratings.size} of them found in the dataset\n`);

/* ---------------------------------------------------------------------------
 * Confirm an id actually names the title we think it does.
 *
 * The join looked exact and was not. A first pass trusted the stored `imdbId`
 * and produced 472 "corrections", including Columbo 8.3 -> 4.1 and Lonesome
 * Dove 8.6 -> 5.5 — both beloved shows that really are rated around 8.3. The
 * ratings were right; the IDS were fabricated:
 *
 *   tt0068289  catalogue says Columbo        actually Blood Sabbath (1972)
 *   tt0098966  catalogue says Lonesome Dove  actually Three Men and a Little Lady
 *   tt4380324  catalogue says Love Island    actually 800 Words (2015)
 *   tt9421570  catalogue says Primal         actually The Guilty (2021)
 *
 * So every disagreement is checked against IMDb's own suggestion endpoint before
 * it is believed. An id that resolves to a different title corrects nothing — it
 * marks the id as bad, which is a more useful thing to learn anyway.
 * ------------------------------------------------------------------------- */
const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const RESOLVE_CACHE = '_imdb-resolved.json';
const resolved = fs.existsSync(RESOLVE_CACHE) ? JSON.parse(fs.readFileSync(RESOLVE_CACHE, 'utf8')) : {};

async function resolveId(id) {
  if (id in resolved) return resolved[id];
  const got = await fetchId(id);
  resolved[id] = got;
  if (Object.keys(resolved).length % 25 === 0) fs.writeFileSync(RESOLVE_CACHE, JSON.stringify(resolved));
  return got;
}

async function fetchId(id) {
  try {
    const res = await fetch(`https://v2.sg.media-imdb.com/suggestion/t/${id}.json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const d = (j.d || [])[0];
    return d ? { title: d.l, year: d.y ?? null } : null;
  } catch {
    return null;
  }
}

/** Does the resolved title plausibly match ours? Titles vary in punctuation and
 *  articles, and a series year is the first season rather than the entry's. */
/* The first version compared folded strings directly and called four correct ids
   fabricated: "Harlan County, USA" vs "Harlan County U.S.A." differ only in where
   the spaces land, and "Star Wars: The Force Awakens" is a strict subset of
   "Star Wars: Episode VII - The Force Awakens". Both are the same film. So the
   comparison runs at two levels — spaces removed, then token containment — and
   only what survives both is treated as a genuinely different work. */
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'part', 'episode', 'vol', 'volume']);
const tokens = (s) => fold(s).split(' ').filter((t) => t && !STOPWORDS.has(t) && !/^[ivxlc]+$/.test(t));

function sameWork(ours, oursYear, them) {
  if (!them) return false;

  const a = fold(ours).replace(/ /g, '');
  const b = fold(them.title).replace(/ /g, '');
  let titleOk = a === b || a.includes(b) || b.includes(a);

  if (!titleOk) {
    // Every meaningful word of the shorter title present in the longer one.
    const ta = tokens(ours);
    const tb = tokens(them.title);
    if (ta.length && tb.length) {
      const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
      const set = new Set(long);
      titleOk = short.every((t) => set.has(t));
    }
  }

  if (!titleOk) return false;
  if (oursYear && them.year && Math.abs(oursYear - them.year) > 3) return false;
  return true;
}

let totalChecked = 0;
let totalAgree = 0;
let totalFixed = 0;
let totalBadId = 0;
const worst = [];
const badIds = [];

for (const s of sets) {
  let checked = 0, agree = 0, fixed = 0, missing = 0, noId = 0, bad = 0;
  const disputes = [];

  for (const row of s.data.rows) {
    if (!row.imdbId) { noId += 1; continue; }
    const hit = ratings.get(row.imdbId);
    if (!hit) { missing += 1; continue; }
    checked += 1;
    const theirs = Math.round(hit.rating * 10) / 10;
    const ours = row.imdb == null ? null : Math.round(row.imdb * 10) / 10;
    if (ours === theirs) {
      /* An exact match on a ten-point scale is strong evidence the id is right,
         so it needs no network round trip to confirm. */
      agree += 1;
      row.imdbVerified = true;
      continue;
    }
    disputes.push({ row, theirs, votes: hit.votes });
  }

  process.stdout.write(`${s.label}: confirming ${disputes.length} disagreements against IMDb…\n`);
  for (let i = 0; i < disputes.length; i++) {
    const { row, theirs, votes } = disputes[i];
    // Named `named`, not `resolved` — the cache above is already called that,
    // and shadowing it here reads as a cache lookup when it is a single result.
    const named = await resolveId(row.imdbId);
    if (!sameWork(row.title, row.year, named)) {
      bad += 1;
      badIds.push({ label: s.label, title: row.title, year: row.year, id: row.imdbId, actually: named ? `${named.title} (${named.year ?? '?'})` : 'unresolvable' });
      delete row.imdbId;              // a wrong id is worse than none
      row.imdbVerified = false;
      continue;
    }
    worst.push({ label: s.label, title: row.title, year: row.year, ours: row.imdb, theirs, votes });
    row.imdb = theirs;
    row.imdbVotes = votes;
    row.imdbVerified = true;
    fixed += 1;
    if (i % 25 === 0) process.stdout.write(`  ${i}/${disputes.length}\r`);
  }

  totalChecked += checked; totalAgree += agree; totalFixed += fixed; totalBadId += bad;
  console.log(`${s.label.padEnd(7)} ${String(checked).padStart(4)} checked  ${String(agree).padStart(4)} already right  `
    + `${String(fixed).padStart(4)} corrected  ${String(bad).padStart(4)} BAD ID  ${missing} not in dataset  ${noId} without an id`);
}

worst.sort((a, b) => Math.abs(b.ours - b.theirs) - Math.abs(a.ours - a.theirs));
console.log(`\nthe 15 biggest corrections:`);
for (const w of worst.slice(0, 15)) {
  console.log(`  ${w.label.padEnd(6)} ${String(w.ours ?? '—').padStart(4)} -> ${String(w.theirs).padStart(4)}  ${w.title} (${w.year})`);
}
console.log(`\nIDs that name a different work entirely (${badIds.length}):`);
for (const b of badIds.slice(0, 15)) {
  console.log(`  ${b.label.padEnd(6)} ${b.id}  we say "${b.title}" (${b.year})  ->  really ${b.actually}`);
}
if (badIds.length > 15) console.log(`  … and ${badIds.length - 15} more`);
fs.writeFileSync(RESOLVE_CACHE, JSON.stringify(resolved));
fs.writeFileSync("_bad-imdb-ids.json", JSON.stringify(badIds, null, 2));

console.log(`\n${totalChecked} checked, ${totalAgree} already correct (${Math.round(totalAgree / totalChecked * 100)}%), `
  + `${totalFixed} corrected, ${totalBadId} bad ids dropped`);

if (!APPLY) { console.log('\n(report only — pass --apply to write)'); process.exit(0); }
for (const s of sets) {
  const out = Array.isArray(s.data.raw) ? s.data.rows : { ...s.data.raw, [s.key]: s.data.rows };
  fs.writeFileSync(s.file, JSON.stringify(out));
  console.log(`wrote ${s.file}`);
}
