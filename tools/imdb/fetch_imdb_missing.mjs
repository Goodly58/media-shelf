/**
 * Find IMDb ids for the catalogue entries that have none.
 *
 *   node tools/imdb/fetch_imdb_missing.mjs           resolve + report, writes _imdb-missing.json
 *   node tools/imdb/fetch_imdb_missing.mjs --report  re-print the report from the existing JSON
 *
 * This script NEVER touches data/movies.json or data/shows.json. It writes only
 * its result file and its caches. Applying is tools/imdb/apply_imdb_missing.mjs, which is
 * report-only unless you pass --apply.
 *
 * ROBOTS  (checked before the first fetch, for every host touched)
 * ---------------------------------------------------------------
 *   datasets.imdbws.com    /robots.txt -> 404, no rules. IMDb's official bulk-data
 *                          host, published for exactly this use. No key, no limit.
 *   v2.sg.media-imdb.com   /robots.txt -> 404, no rules. The suggestion endpoint
 *                          behind IMDb's own search box.
 *   www.imdb.com           "User-agent: *  Disallow: /"  ->  NEVER FETCHED.
 *                          Every fact below comes from the two hosts above.
 *
 * WHY BULK DATA AND NOT SEARCH ALONE
 * ----------------------------------
 * The suggestion endpoint returns eight rows ordered by popularity, which is the
 * wrong ordering for a catalogue full of obscure documentaries: searching
 * "three sisters" does not surface Wang Bing's 2012 film anywhere in the eight.
 *
 * And the job's known-hard case — non-English titles — is not a fuzzy-matching
 * problem at all. It only looks like one because search answers with a title's
 * ENGLISH name: `les_revenants` returns "The Returned", `gojira` returns
 * "Godzilla". You cannot accept those on a name comparison, and accepting them
 * without one is guessing.
 *
 * IMDb publishes the answer. title.basics carries originalTitle beside
 * primaryTitle, and title.akas carries every released title in every region.
 * "Gojira" is a registered US aka of tt0047034; "Les Revenants" is the FR aka of
 * tt2521668. So the hard case becomes an exact match against IMDb's own alias
 * table, and the same table then re-verifies every id the search path proposed.
 * 59M alias rows scan in about 40 seconds.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const REPORT_ONLY = process.argv.includes('--report');

const OUT = '_imdb-missing.json';
const RATINGS_TSV = '_imdb-ratings.tsv';
const BASICS_SUBSET = '_imdb-basics-subset.json';
const AKAS_SUBSET = '_imdb-akas-subset.json';
const SUGGEST_CACHE = '_imdb-suggest-cache.json';
// the two IMDb dumps are ~740 MB, so they live outside the repo
const SCRATCH = process.env.IMDB_SCRATCH || path.join(os.tmpdir(), 'imdb-datasets');
const BASICS_GZ = path.join(SCRATCH, 'title.basics.tsv.gz');
const AKAS_GZ = path.join(SCRATCH, 'title.akas.tsv.gz');

/* ------------------------------------------------------------------ titles */

/* Entities are decoded BEFORE folding. Folding an undecoded "&amp;" leaves the
   letters a-m-p inside the key, so "Preludes & Nocturnes" stops matching itself.
   This catalogue carries none today; the normaliser is shared and being right
   here costs one replace. */
const decodeEntities = (s) => String(s ?? '')
  .replace(/&(?:amp|#38);/gi, '&').replace(/&(?:lt|#60);/gi, '<').replace(/&(?:gt|#62);/gi, '>')
  .replace(/&(?:quot|#34);/gi, '"').replace(/&(?:apos|#39);/gi, "'").replace(/&nbsp;/gi, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

const deaccent = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** Punctuation- and accent-insensitive key. "The Killing" -> "thekilling". */
const fold = (s) => deaccent(decodeEntities(s)).toLowerCase().replace(/[^a-z0-9]+/g, '');

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'part', 'episode', 'vol', 'volume']);
const tokens = (s) => deaccent(decodeEntities(s)).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  .split(' ').filter((t) => t && !STOPWORDS.has(t) && !/^[ivxlc]+$/.test(t));

/**
 * Ways this catalogue writes a title that IMDb might not.
 * tier 0 is the title as written (and the halves of a "Foreign (English)" pair).
 * tier 1 drops a decoration. tier 2 splits on a colon and therefore throws away
 * half the title — those are never auto-accepted, because "O.J.: Made in America"
 * reduced to "Made in America" matches eleven unrelated works.
 */
function variants(title) {
  const out = [];
  const push = (s, tier) => {
    const f = fold(s);
    if (f && !out.some((v) => v.f === f)) out.push({ f, tier, text: String(s).trim() });
  };
  const t = decodeEntities(title).trim();
  push(t, 0);
  const paren = t.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (paren) { push(paren[1], 0); push(paren[2], 0); }          // "The Killing (Forbrydelsen)"
  const poss = t.match(/^[^']{2,40}'s\s+(.{3,})$/);
  if (poss) push(poss[1], 1);                                    // "Genndy Tartakovsky's Sym-Bionic Titan"
  const art = t.match(/^(?:the|a|an)\s+(.+)$/i);
  if (art) push(art[1], 1);
  const colon = t.split(/\s*:\s*/);
  if (colon.length === 2) { push(colon[0], 2); push(colon[1], 2); }
  return out;
}

/* ------------------------------------------------------------- catalogue */

const load = (f, k) => {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { raw, rows: Array.isArray(raw) ? raw : raw[k] || [] };
};

const SETS = [
  { file: 'data/movies.json', key: 'movies', kind: 'film', accept: ['movie'], other: ['tvMovie', 'video', 'tvSpecial', 'short', 'tvSeries', 'tvMiniSeries'] },
  { file: 'data/shows.json', key: 'shows', kind: 'show', accept: ['tvSeries', 'tvMiniSeries'], other: ['tvMovie', 'movie', 'tvSpecial', 'video', 'short'] },
];

const targets = [];
const takenIds = new Map();   // ids already used elsewhere in the catalogue
for (const s of SETS) {
  const { rows } = load(s.file, s.key);
  for (const r of rows) {
    if (r.imdbId) { takenIds.set(r.imdbId, `${s.kind}: ${r.title} (${r.year})`); continue; }
    targets.push({
      title: r.title, year: r.year ?? null, kind: s.kind, ourImdb: r.imdb ?? null,
      creator: r.creator || '', seasons: r.seasons ?? null, set: s, vars: variants(r.title),
    });
  }
}
console.log(`${targets.length} entries without an imdbId `
  + `(${targets.filter((t) => t.kind === 'film').length} films, ${targets.filter((t) => t.kind === 'show').length} shows)`);
console.log(`${takenIds.size} ids already in use elsewhere in the catalogue (checked for collisions)\n`);

if (REPORT_ONLY) { report(JSON.parse(fs.readFileSync(OUT, 'utf8'))); process.exit(0); }

/* -------------------------------------------------------- bulk data files */

const wantedKeys = new Set();
for (const t of targets) for (const v of t.vars) wantedKeys.add(v.f);
const keyHash = crypto.createHash('sha1').update([...wantedKeys].sort().join('|')).digest('hex').slice(0, 12);

const KEEP_TYPES = new Set(['movie', 'tvMovie', 'tvSeries', 'tvMiniSeries', 'tvSpecial', 'video', 'short', 'tvShort']);

async function ensureGz(file, url, mb) {
  if (fs.existsSync(file)) return;
  console.log(`downloading ${path.basename(url)} from IMDb (${mb} MB)…`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(url, { signal: AbortSignal.timeout(1800000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
}

const gzLines = (f) => readline.createInterface({ input: fs.createReadStream(f).pipe(zlib.createGunzip()), crlfDelay: Infinity });

/** title.basics rows whose primaryTitle or originalTitle folds to one of our keys. */
async function buildBasicsSubset() {
  if (fs.existsSync(BASICS_SUBSET)) {
    const c = JSON.parse(fs.readFileSync(BASICS_SUBSET, 'utf8'));
    if (c.keyHash === keyHash) { console.log(`using cached ${BASICS_SUBSET} (${c.rows.length} rows)`); return c.rows; }
    console.log('cached basics subset was built for a different title set — rebuilding');
  }
  await ensureGz(BASICS_GZ, 'https://datasets.imdbws.com/title.basics.tsv.gz', 226);
  console.log('scanning title.basics…');
  const rows = []; let n = 0, first = true;
  for await (const line of gzLines(BASICS_GZ)) {
    if (first) { first = false; continue; }
    if (++n % 4000000 === 0) process.stdout.write(`  ${(n / 1e6).toFixed(0)}M\r`);
    const c = line.split('\t');
    if (!KEEP_TYPES.has(c[1])) continue;
    if (!wantedKeys.has(fold(c[2])) && !wantedKeys.has(fold(c[3]))) continue;
    rows.push({ id: c[0], type: c[1], primary: c[2], original: c[3], year: c[5] === '\\N' ? null : Number(c[5]) });
  }
  console.log(`  ${n} rows scanned, ${rows.length} kept        `);
  fs.writeFileSync(BASICS_SUBSET, JSON.stringify({ keyHash, rows }));
  return rows;
}

/** basics rows for a specific id set (for ids discovered only via the alias table). */
async function basicsByIds(ids) {
  const out = new Map();
  if (!ids.size) return out;
  let first = true;
  for await (const line of gzLines(BASICS_GZ)) {
    if (first) { first = false; continue; }
    const tab = line.indexOf('\t');
    if (!ids.has(line.slice(0, tab))) continue;
    const c = line.split('\t');
    out.set(c[0], { id: c[0], type: c[1], primary: c[2], original: c[3], year: c[5] === '\\N' ? null : Number(c[5]) });
    if (out.size === ids.size) break;
  }
  return out;
}

/**
 * One pass over title.akas doing both jobs:
 *   discover — ids that have ANY released title folding to one of our keys
 *   verify   — the full alias list for every id we are already considering
 */
async function buildAkasSubset(candidateIds) {
  const idHash = crypto.createHash('sha1').update([...candidateIds].sort().join('|')).digest('hex').slice(0, 12);
  if (fs.existsSync(AKAS_SUBSET)) {
    const c = JSON.parse(fs.readFileSync(AKAS_SUBSET, 'utf8'));
    if (c.keyHash === keyHash && c.idHash === idHash) {
      console.log(`using cached ${AKAS_SUBSET}`);
      return { hits: new Map(c.hits), aliases: new Map(c.aliases.map(([k, v]) => [k, new Set(v)])), names: new Map(c.names) };
    }
    console.log('cached akas subset is stale — rebuilding');
  }
  await ensureGz(AKAS_GZ, 'https://datasets.imdbws.com/title.akas.tsv.gz', 511);
  console.log('scanning title.akas (59M alias rows, ~40s)…');
  const hits = new Map();      // foldedKey -> [{id, title, region}]
  const aliases = new Map();   // id -> Set(folded aka)
  const names = new Map();     // id -> a readable aka sample
  let n = 0, first = true;
  for await (const line of gzLines(AKAS_GZ)) {
    if (first) { first = false; continue; }
    if (++n % 20000000 === 0) process.stdout.write(`  ${(n / 1e6).toFixed(0)}M\r`);
    const c = line.split('\t');
    const id = c[0], title = c[2];
    const known = candidateIds.has(id);
    const f = fold(title);
    if (!known && !wantedKeys.has(f)) continue;
    if (known) {
      if (!aliases.has(id)) aliases.set(id, new Set());
      aliases.get(id).add(f);
      if (!names.has(id)) names.set(id, title);
    }
    if (wantedKeys.has(f)) {
      if (!hits.has(f)) hits.set(f, []);
      const list = hits.get(f);
      if (!list.some((h) => h.id === id)) list.push({ id, title, region: c[3] === '\\N' ? null : c[3] });
    }
  }
  console.log(`  ${n} alias rows scanned; ${hits.size} of our title keys appear in IMDb's alias table   `);
  fs.writeFileSync(AKAS_SUBSET, JSON.stringify({
    keyHash, idHash,
    hits: [...hits], aliases: [...aliases].map(([k, v]) => [k, [...v]]), names: [...names],
  }));
  return { hits, aliases, names };
}

const basics = await buildBasicsSubset();
const byKey = new Map();
for (const r of basics) {
  for (const k of new Set([fold(r.primary), fold(r.original)])) {
    if (!wantedKeys.has(k)) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
}

/* --------------------------------------------------------------- ratings */

async function loadRatings(ids) {
  const out = new Map();
  if (!ids.size) return out;
  let first = true;
  for await (const line of readline.createInterface({ input: fs.createReadStream(RATINGS_TSV), crlfDelay: Infinity })) {
    if (first) { first = false; continue; }
    const tab = line.indexOf('\t');
    const id = line.slice(0, tab);
    if (!ids.has(id)) continue;
    const rest = line.slice(tab + 1).split('\t');
    out.set(id, { rating: Number(rest[0]), votes: Number(rest[1]) });
  }
  return out;
}

/* ------------------------------------------------- suggestion endpoint */

const suggestCache = fs.existsSync(SUGGEST_CACHE) ? JSON.parse(fs.readFileSync(SUGGEST_CACHE, 'utf8')) : {};
let cacheDirty = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastFetch = 0;
const incomplete = [];

/**
 * Rule 6: a 429, a 5xx or a 202-with-no-body is the server saying "not now".
 * None of those is ever cached, and none is ever the reason a title is called
 * unresolvable — they come back null and are reported as INCOMPLETE so a re-run
 * finishes them.
 */
async function suggest(kindPath, q) {
  const key = `${kindPath}/${q}`;
  if (key in suggestCache) return suggestCache[key];
  const backoff = [2000, 5000, 12000, 30000, 60000];
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    const wait = 1100 - (Date.now() - lastFetch);
    if (wait > 0) await sleep(wait);                      // ~1 req/sec per host
    lastFetch = Date.now();
    let status = 0, body = '';
    try {
      const res = await fetch(`https://v2.sg.media-imdb.com/suggestion/${kindPath}/${encodeURIComponent(q)}.json`, {
        signal: AbortSignal.timeout(25000),
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) media-shelf-catalogue-check' },
      });
      status = res.status; body = await res.text();
    } catch { status = -1; body = ''; }
    if (status === 202 || status === 429 || status >= 500 || status === -1 || (status === 200 && !body.trim())) {
      if (attempt === backoff.length) { incomplete.push({ key, status }); return null; }
      process.stdout.write(`    throttled (${status}) on ${key} — backing off ${backoff[attempt] / 1000}s\n`);
      await sleep(backoff[attempt]);
      continue;
    }
    if (status === 404) { suggestCache[key] = { d: [] }; cacheDirty = true; return suggestCache[key]; }
    if (status !== 200) { incomplete.push({ key, status }); return null; }
    let j = null;
    try { j = JSON.parse(body); } catch { incomplete.push({ key, status: 'bad-json' }); return null; }
    suggestCache[key] = { d: (j.d || []).filter((d) => d.id && d.id.startsWith('tt'))
      .map((d) => ({ id: d.id, l: d.l, y: d.y ?? null, qid: d.qid || null, rank: d.rank ?? null, s: d.s || '' })) };
    cacheDirty = true;
    if (Object.keys(suggestCache).length % 20 === 0) flushCache();
    return suggestCache[key];
  }
  return null;
}
const flushCache = () => { if (cacheDirty) { fs.writeFileSync(SUGGEST_CACHE, JSON.stringify(suggestCache)); cacheDirty = false; } };
const queryOf = (s) => deaccent(decodeEntities(s)).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().replace(/\s+/g, '_');

/* --------------------------------------------------------------- matching */

/**
 * Containment is anchored to the START of the title, which is not fussiness.
 * Unanchored containment matched BOTH American Crime Story rows to "Inside Look:
 * The People v. O.J. Simpson - American Crime Story", the behind-the-scenes
 * companion series — our whole title sits inside it, just after a qualifier that
 * changes what the work is. A trailing extension ("Drunken Master II" ->
 * "Drunken Master II: ...") adds detail; a leading one names a different show.
 */
function nameMatches(ourText, theirName) {
  const a = fold(ourText), b = fold(theirName);
  if (!a || !b) return false;
  if (a === b) return 'exact';
  if (a.startsWith(b) || b.startsWith(a)) return 'contains';
  const ta = tokens(ourText), tb = tokens(theirName);
  if (ta.length && tb.length) {
    const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    if (short.every((t) => new Set(long).has(t))) return ta.length === tb.length ? 'tokens' : 'tokens-partial';
  }
  return false;
}

const YEAR_OK = 2;        // auto-accept window
const YEAR_NEAR = 15;     // still collected, for the report only

/** A null year is NOT "inside the window" — it is unknown, and unknown loses. */
const yearGap = (ours, theirs) => (ours != null && theirs != null ? Math.abs(ours - theirs) : null);

console.log(`\nmatching against IMDb's bulk index…\n`);

/* pass 1 — exact title match in title.basics */
for (const t of targets) {
  const seen = new Map();
  for (const v of t.vars) {
    for (const row of byKey.get(v.f) || []) {
      const typeOk = t.set.accept.includes(row.type);
      if (!typeOk && !t.set.other.includes(row.type)) continue;
      const dY = yearGap(t.year, row.year);
      if (dY != null && dY > YEAR_NEAR) continue;
      const hitP = t.vars.some((x) => x.f === fold(row.primary));
      const hitO = t.vars.some((x) => x.f === fold(row.original));
      const g = {
        id: row.id, name: row.primary, original: row.original, type: row.type, year: row.year,
        tier: v.tier, typeOk, dY, exactTitle: true, via: 'basics', matchedText: v.text,
        matchedOn: hitP && hitO ? 'primaryTitle+originalTitle' : hitP ? 'primaryTitle' : 'originalTitle',
      };
      const prev = seen.get(g.id);
      if (!prev || g.tier < prev.tier) seen.set(g.id, g);
    }
  }
  t._seen = seen;
}

/* pass 2 — search, only where the index found nothing of the right type and year */
let searched = 0;
for (const t of targets) {
  const good = [...t._seen.values()].some((c) => c.typeOk && c.tier === 0 && c.dY != null && c.dY <= YEAR_OK);
  if (good) continue;
  searched += 1;
  const tried = new Set();
  for (const v of t.vars.slice(0, 4)) {
    const q = queryOf(v.text);
    if (!q || tried.has(q)) continue;
    tried.add(q);
    const res = await suggest('x', q);
    if (!res) continue;
    for (const d of res.d) {
      const typeOk = t.set.accept.includes(d.qid);
      if (!typeOk && !t.set.other.includes(d.qid)) continue;
      const dY = yearGap(t.year, d.y);
      if (dY != null && dY > YEAR_NEAR) continue;
      const nm = nameMatches(v.text, d.l);
      if (!nm) continue;
      if (t._seen.has(d.id)) continue;
      t._seen.set(d.id, {
        id: d.id, name: d.l, original: d.l, type: d.qid, year: d.y,
        tier: v.tier + (nm === 'exact' ? 0 : nm === 'contains' ? 1 : 2),
        typeOk, dY, exactTitle: nm === 'exact', via: 'search', matchedOn: `search:${nm}`, matchedText: v.text, stars: d.s,
      });
    }
  }
}
flushCache();
console.log(`search consulted for ${searched} of ${targets.length} entries`);

/* pass 3 — IMDb's alias table: discovery for what is still unmatched, and
   verification for everything already proposed. */
const candidateIds = new Set();
for (const t of targets) for (const id of t._seen.keys()) candidateIds.add(id);
const { hits: akaHits, aliases: akaAliases } = await buildAkasSubset(candidateIds);

const aliasNew = new Set();
for (const t of targets) {
  for (const v of t.vars) {
    for (const h of akaHits.get(v.f) || []) if (!t._seen.has(h.id)) aliasNew.add(h.id);
  }
}
const aliasBasics = await basicsByIds(aliasNew);
let aliasAdded = 0;
for (const t of targets) {
  for (const v of t.vars) {
    for (const h of akaHits.get(v.f) || []) {
      if (t._seen.has(h.id)) continue;
      const row = aliasBasics.get(h.id);
      if (!row) continue;
      const typeOk = t.set.accept.includes(row.type);
      if (!typeOk && !t.set.other.includes(row.type)) continue;
      const dY = yearGap(t.year, row.year);
      if (dY != null && dY > YEAR_NEAR) continue;
      t._seen.set(h.id, {
        id: h.id, name: row.primary, original: row.original, type: row.type, year: row.year,
        tier: v.tier, typeOk, dY, exactTitle: true, via: 'akas', matchedText: v.text,
        matchedOn: `aka${h.region ? ':' + h.region : ''}`, akaTitle: h.title,
      });
      aliasAdded += 1;
    }
  }
}
console.log(`alias table contributed ${aliasAdded} extra candidates\n`);

/* ------------------------------------------------------------- ranking */

const allIds = new Set();
for (const t of targets) for (const id of t._seen.keys()) allIds.add(id);
const ratings = await loadRatings(allIds);
console.log(`ratings found for ${ratings.size} of ${allIds.size} candidate ids`);

/**
 * Two ordering mistakes worth spelling out, because both produced a confident
 * wrong answer before they were fixed:
 *
 *  - A rating-less stub must not beat the real title on a one-year technicality.
 *    "Between the Lions" has a 1999 entry with thousands of votes and an empty
 *    2000 duplicate, and the pool picked the duplicate because 2000 matched our
 *    year exactly. Substance now outranks year precision.
 *
 *  - Filtering the pool to the right TYPE first threw away the right title.
 *    "O.J.: Made in America" exists once in IMDb, as tt5275892, filed as a
 *    movie; our catalogue files it as a show. Requiring a tvSeries dropped it
 *    and handed the slot to whatever generic "Made in America" was left. Type
 *    is now a ranking term, not a filter, so the exact title survives and comes
 *    back labelled KIND MISMATCH instead of silently becoming the wrong show.
 */
function pick(t) {
  const scored = [...t._seen.values()].map((c) => {
    const r = ratings.get(c.id) || null;
    return { ...c, rating: r ? Math.round(r.rating * 10) / 10 : null, votes: r ? r.votes : null, hasRating: !!r };
  });
  const inYear = scored.filter((c) => c.dY != null && c.dY <= YEAR_OK);
  const pool = inYear.length ? inYear : scored;
  const rank = (a, b) =>
    (a.tier - b.tier)
    || (Number(b.exactTitle) - Number(a.exactTitle))
    || (Number(b.typeOk) - Number(a.typeOk))
    || (Number(b.hasRating) - Number(a.hasRating))
    || ((a.dY ?? 99) - (b.dY ?? 99))
    || ((b.votes ?? -1) - (a.votes ?? -1));
  pool.sort(rank);
  const best = pool[0] || null;
  /* Near-misses are drawn from EVERY candidate, not just the pool, so the report
     can show what was rejected and why. A title reported as unresolvable while
     its obvious candidate sat in a discarded pool is not a useful answer. */
  const others = scored.filter((c) => c !== best).sort(rank).slice(0, 4);
  const hadGood = scored.some((c) => c.typeOk && c.dY != null && c.dY <= YEAR_OK);
  /* Is there exactly one substantive, right-type, exact-title candidate in all
     of IMDb? Then a year disagreement is IMDb's start-year quirk rather than a
     choice between two works, and the year gate can be relaxed — with the gap
     stated. Remakes never reach this branch: they produce two such candidates. */
  const solid = scored.filter((c) => c.typeOk && c.exactTitle && c.tier <= 1 && c.hasRating);
  return { best, others, hadGood, poolSize: scored.length, scored: scored.slice().sort(rank), uniqueExact: solid.length === 1 ? solid[0] : null };
}

/* ------------------------------------------------- independent confirmation */

console.log(`confirming each chosen id by id against IMDb…\n`);
const results = [];

for (const t of targets) {
  const { best, others, hadGood, poolSize, scored, uniqueExact } = pick(t);
  const base = { title: t.title, year: t.year, kind: t.kind };
  /* Always show the best candidate of the RIGHT kind, even when it ranked below
     four exact-title matches of the wrong kind. Without this, "The Boiling
     Point" reported four shorts and hid the 2023 series a reader would want. */
  const shown = [...others];
  const typed = others.find((o) => o.typeOk) ? null : scored.find((o) => o.typeOk && o !== best);
  if (typed && !shown.includes(typed)) shown.push(typed);
  const nearMiss = shown.map((o) => `${o.id} "${o.name}" (${o.year ?? '?'}, ${o.type}${o.votes ? ', ' + o.votes + ' votes' : ', no rating'})`);

  if (!best) {
    results.push({ ...base, newId: null, imdbName: null, imdbYear: null, rating: null, votes: null,
      status: 'unresolved', confidence: null, ourImdb: t.ourImdb, candidates: 0, nearMiss: [],
      note: 'no title of a usable type within 15 years of our year, in the bulk index, the alias table or search' });
    continue;
  }

  // Rule 3: ask IMDb what this id actually is, and compare the NAME it gives back.
  const conf = await suggest('t', best.id);
  const confRow = conf && conf.d.find((d) => d.id === best.id);
  const confirmName = confRow ? confRow.l : null;
  const confirmType = confRow ? confRow.qid : null;
  const confirmYear = confRow ? confRow.y : null;

  /* Does IMDb's own alias table list our title as a released title of this id?
     This is the strongest evidence available and the only thing that works for
     Gojira / Les Revenants, where the English name can never match. It is only
     accepted from tier 0 and 1 — a variant that dropped half the title on a
     colon would match the parent of an anthology and prove nothing.
     It is evidence of IDENTITY, not of YEAR: a remake carries the same aliases
     as its original, so the year gate below still has to be satisfied. */
  const aliasSet = akaAliases.get(best.id);
  const aliasProof = aliasSet ? (t.vars.find((v) => v.tier <= 1 && aliasSet.has(v.f))?.text ?? null) : null;

  const r = ratings.get(best.id) || null;
  const delta = r && t.ourImdb != null ? Math.round((Math.round(r.rating * 10) / 10 - t.ourImdb) * 10) / 10 : null;

  let status = 'resolved';
  let confidence = 'high';
  const notes = [];

  const yearOk = best.dY != null && best.dY <= YEAR_OK;
  /* An exact title (or an IMDb-registered alias of it) that is the only
     substantive candidate of the right type in the whole index. */
  const solitary = uniqueExact && uniqueExact.id === best.id;

  /* --- hard disqualifiers: these become REVIEW, never applied automatically --- */
  if (!best.typeOk) {
    status = 'kind-mismatch'; confidence = 'low';
    notes.push(`IMDb classifies this as ${best.type}; a ${t.kind} must resolve to ${t.set.accept.join('/')}`);
  } else if (!yearOk && solitary) {
    /* Not a choice between works — there is only one. IMDb's start year simply
       disagrees with ours, so the id stands and the gap is stated out loud. */
    confidence = 'medium';
    notes.push(best.dY == null
      ? 'IMDb records no start year; this is the only title of this name and type in the index'
      : `IMDb dates this ${best.year}, we say ${t.year} (${best.dY} years apart) — but it is the only "${best.name}" of this type in the index`);
  } else if (!yearOk) {
    status = 'review'; confidence = 'low';
    notes.push(best.dY == null
      ? 'IMDb has no start year for this title, and other titles of this name exist'
      : `nearest candidate is ${best.dY} years from our year${hadGood ? '' : ', and none is inside the window'}`);
  } else if (aliasProof) {
    /* Reached the right work by a scruffy route, but IMDb itself publishes our
       exact title as a name this id was released under. The route stops mattering. */
    if (best.tier > 0 || !best.exactTitle) confidence = 'medium';
  } else if (best.tier >= 2) {
    status = 'review'; confidence = 'low';
    notes.push(`matched only after reducing our title to "${best.matchedText ?? best.name}", which is not the whole title, and IMDb lists no alias matching what we wrote`);
  } else if (best.matchedOn === 'search:tokens-partial') {
    status = 'review'; confidence = 'low';
    notes.push(`our title has words IMDb's does not; matched loosely to "${best.name}"`);
  }

  if (confRow && !t.set.accept.includes(confirmType) && status === 'resolved') {
    status = 'review'; confidence = 'low'; notes.push(`confirm-by-id reports type ${confirmType}`);
  }
  if (confRow == null) { notes.push('confirm-by-id returned nothing'); if (confidence === 'high') confidence = 'medium'; }

  /* --- softer signals: still resolved, but flagged --- */
  if (status === 'resolved') {
    const nameAgrees = t.vars.some((v) => nameMatches(v.text, best.name))
      || (confirmName && t.vars.some((v) => nameMatches(v.text, confirmName)));
    if (!nameAgrees && !aliasProof) {
      status = 'review'; confidence = 'low';
      notes.push(`IMDb calls this "${best.name}" and lists no alias matching our title`);
    } else {
      if (!nameAgrees && aliasProof) notes.push(`IMDb's English title is "${best.name}"; "${aliasProof}" is a registered alias of it`);
      if (best.tier === 1) { confidence = 'medium'; notes.push('matched a reduced form of our title'); }
      if (best.matchedOn === 'originalTitle') notes.push('matched IMDb originalTitle, not its English primaryTitle');
      if (yearOk && best.dY > 0) notes.push(`year differs by ${best.dY}`);
      if (!r) { confidence = 'medium'; notes.push('IMDb has the title but no rating row yet'); }
      const rival = others.find((o) => o.typeOk && o.exactTitle && o.dY != null && o.dY <= YEAR_OK && o.hasRating);
      if (rival) { confidence = 'medium'; notes.push(`ambiguous: ${rival.id} "${rival.name}" (${rival.year}) also fits`); }
      /* The catalogue's own (unverified) rating is a free second opinion, and
         across the 161 comparable rows the median disagreement is 0.1 and the
         90th percentile 0.5 — so anything past that is worth saying out loud.
         How much it should COUNT depends on what carried the match. Where the
         title matched literally, a 0.9 gap just means our number went stale
         (Planet Earth III). Where an alias or a reduced form carried it, the
         same gap is the only thing left that could catch a wrong work, so the
         bar drops: that is what flags "The Circle Game", which IMDb really does
         publish as the original title of The Circle: France. */
      const literalName = fold(best.name) === fold(t.title) || fold(confirmName || '') === fold(t.title);
      const bar = literalName ? 1.0 : 0.5;
      if (delta != null && Math.abs(delta) >= bar) {
        if (confidence === 'high') confidence = 'medium';
        notes.push(`our stored rating ${t.ourImdb} vs IMDb ${Math.round(r.rating * 10) / 10} (${delta > 0 ? '+' : ''}${delta})`
          + (literalName ? '' : ' — and the title matched only via an alias, so this gap is the main remaining check'));
      }
    }
  }

  results.push({
    ...base,
    newId: best.id, imdbName: best.name, imdbYear: best.year,
    rating: r ? Math.round(r.rating * 10) / 10 : null, votes: r ? r.votes : null,
    status, confidence, imdbType: best.type,
    imdbOriginalTitle: best.original !== best.name ? best.original : null,
    matchedOn: best.matchedOn, foundVia: best.via, aliasProof,
    confirmName, confirmType, confirmYear,
    ourImdb: t.ourImdb, ratingDelta: delta,
    candidates: poolSize, nearMiss,
    note: notes.join('; ') || null,
  });
}
flushCache();

/* ------------------------------------------------------------ cross-checks */

/* Two entries landing on one id, or landing on an id another entry already owns,
   is the signature of a title that matched something generic. Neither is decided
   here — both are demoted and reported. */
const byId = new Map();
for (const r of results) if (r.newId) { if (!byId.has(r.newId)) byId.set(r.newId, []); byId.get(r.newId).push(r); }
let dupes = 0, collisions = 0;
for (const [id, rs] of byId) {
  if (rs.length > 1) {
    dupes += 1;
    for (const r of rs) {
      if (r.status === 'resolved') { r.status = 'review'; r.confidence = 'low'; }
      r.note = [r.note, `collides: ${rs.length} catalogue entries resolve to ${id} (${rs.map((x) => `"${x.title}"`).join(', ')})`].filter(Boolean).join('; ');
    }
  }
  if (takenIds.has(id)) {
    collisions += 1;
    for (const r of rs) {
      if (r.status === 'resolved') { r.status = 'review'; r.confidence = 'low'; }
      r.note = [r.note, `id already belongs to ${takenIds.get(id)} in the catalogue`].filter(Boolean).join('; ');
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
if (dupes) console.log(`${dupes} ids claimed by more than one entry — all demoted to review`);
if (collisions) console.log(`${collisions} ids already used elsewhere in the catalogue — all demoted to review`);
console.log();
report(results);

/* ---------------------------------------------------------------- report */

function report(rs) {
  const by = (s) => rs.filter((r) => r.status === s);
  const resolved = by('resolved'), review = by('review'), mism = by('kind-mismatch'), unres = by('unresolved');
  const hi = resolved.filter((r) => r.confidence === 'high');
  const med = resolved.filter((r) => r.confidence !== 'high');
  const noRating = rs.filter((r) => r.newId && r.rating == null && r.status === 'resolved');

  console.log('='.repeat(80));
  console.log(`${rs.length} catalogue entries had no imdbId`);
  console.log(`  ${String(resolved.length).padStart(3)} RESOLVED       ${hi.length} high confidence, ${med.length} flagged for a glance`);
  console.log(`  ${String(review.length).padStart(3)} REVIEW         a candidate exists but something disagrees — do not apply blind`);
  console.log(`  ${String(mism.length).padStart(3)} KIND MISMATCH  IMDb files it under a different kind than this catalogue does`);
  console.log(`  ${String(unres.length).padStart(3)} UNRESOLVED     IMDb has no such title — a real answer, not a failure`);
  console.log(`  ${String(noRating.length).padStart(3)} resolved but carrying no rating row yet`);
  console.log('='.repeat(80));

  const line = (r) => `  ${r.kind.padEnd(4)} ${String(r.newId || '—').padEnd(11)} ${String(r.rating ?? '—').padStart(4)} `
    + `${String(r.votes ?? '').padStart(8)}  ${r.title} (${r.year})`
    + (r.imdbName && fold(r.imdbName) !== fold(r.title) ? `  ->  "${r.imdbName}" (${r.imdbYear ?? '?'})` : '')
    + (r.note ? `\n           ${r.note}` : '');

  console.log(`\nRESOLVED — high confidence (${hi.length}): exact title, right type, year agrees, id re-confirmed`);
  for (const r of hi.slice(0, 25)) console.log(line(r));
  if (hi.length > 25) console.log(`  … and ${hi.length - 25} more in ${OUT}`);

  console.log(`\nRESOLVED — flagged (${med.length}):`);
  for (const r of med) console.log(line(r));

  console.log(`\nREVIEW — NOT safe to apply unchecked (${review.length}):`);
  for (const r of review) { console.log(line(r)); if (r.nearMiss?.length) console.log(`           also considered: ${r.nearMiss.join(' | ')}`); }

  console.log(`\nKIND MISMATCH (${mism.length}) — the id is right, the catalogue's category is not:`);
  for (const r of mism) { console.log(line(r)); if (r.nearMiss?.length) console.log(`           also considered: ${r.nearMiss.join(' | ')}`); }

  console.log(`\nUNRESOLVED (${unres.length}) — reported as absent, not padded:`);
  for (const r of unres) console.log(`  ${r.kind.padEnd(4)} ${r.title} (${r.year})\n           ${r.note}`);

  if (incomplete.length) {
    console.log(`\n!! ${incomplete.length} lookups never completed (throttled past the last backoff).`);
    console.log(`   NOT cached and NOT counted as absent — re-run to finish them.`);
    for (const i of incomplete.slice(0, 10)) console.log(`   ${i.key} (${i.status})`);
  }
  console.log(`\nReport only. Nothing was written to data/. Applying is: node tools/imdb/apply_imdb_missing.mjs --apply`);
}
