/**
 * Metascore pass over the REMAINDER — the games and films the earlier
 * _verify_games.mjs / _verify_screen.mjs passes could not match.
 *
 * REPORT ONLY. This script never writes games.html or data/*.json. It produces
 * _metascores.json and prints a summary. Applying is done centrally elsewhere.
 *
 *   node _ms_resolve.mjs --plan   # how many candidates, fetch nothing
 *   node _ms_resolve.mjs          # fetch (cached, resumable) + write the report
 *
 * ## How it resolves a title the earlier passes could not
 *
 * Those passes built one slug per title and gave up when it 404'd. The misses
 * are dominated by slug shape: `divinity-original-sin-2` is really
 * `divinity-original-sin-ii`, `civilization-v` is `civilization-5`, Horizon
 * Zero Dawn's PC product is `horizon-zero-dawn-complete-edition`.
 *
 * Rather than guess variants against the API (610 titles x ~9 shapes, nearly
 * all 404s), this reads the slug index the site publishes for the purpose.
 * robots.txt names games.xml / movies.xml as sitemaps and disallows neither, so
 * the full slug universe is fair game and one cheap crawl replaces thousands of
 * speculative lookups. Candidates come out of that universe; only real slugs
 * are ever fetched.
 *
 * ## The two traps
 *
 * PLATFORM. A game is scored per platform. item.criticScoreSummary.score is the
 * cross-platform headline and is frequently a console release — reading it
 * drops Disco Elysium from 97 to 89 (verified live: headline 89, PC 97). This
 * is a PC catalogue, so the PC entry in item.platforms[] is the number, and a
 * page with no PC score is reported as such rather than back-filled.
 *
 * YEAR. A title does not identify a work. `psycho` resolves to the 1998 remake
 * (47, verified live) not the 1960 original (97); Inside Out resolves to a 2011
 * namesake. Title AND year must agree, and a missing date is a non-match, not a
 * pass.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import {
  readArray, UA, KEY, keysFor, titlesAgree, decodeEntities, slugVariants,
} from './_ms_lib.mjs';

const CACHE_DIR = '.verify-cache';
const SITEMAP = `${CACHE_DIR}/ms-sitemap.json`;
const API_CACHE = `${CACHE_DIR}/ms-api.json`;
const PLAN = process.argv.includes('--plan');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Aggregate ~1 request/sec at the backend host. */
const CONCURRENCY = 2;
const GAP_MS = 2000;

/**
 * Year slack.
 *
 * Games get more room than films because a PC catalogue's year and Metacritic's
 * date legitimately diverge: Early Access vs 1.0 (Valheim 2021/2026), a Steam
 * re-release vs the original (Dwarf Fortress 2022/2006), a staggered PC port.
 * A remake or namesake is a decade-plus away, and where several slugs compete
 * the year picks between them rather than merely waving one through.
 */
const SLACK = { games: 4, movies: 3 };

/* -------------------------------------------------------------------------- */
/* Candidate slugs                                                             */
/* -------------------------------------------------------------------------- */

if (!existsSync(SITEMAP)) throw new Error('run _ms_sitemap.mjs first');
const sitemap = JSON.parse(readFileSync(SITEMAP, 'utf8'));

/**
 * Keys a sitemap slug is indexed under.
 *
 * Besides its own fold, a slug is indexed under its brand-stripped fold: the
 * page is `sid-meiers-civilization-v` and we store "Civilization V". Slugs have
 * no apostrophes, so the possessive has to be spotted token-wise — a short
 * leading run of tokens ending in "s". Bounded to 14 characters of prefix and a
 * remainder of at least 8, and every hit is still verified against the returned
 * title and year before it can become a score.
 *
 * @param {string} slug
 * @returns {string[]}
 */
function indexKeys(slug) {
  const out = keysFor(slug);

  // Metacritic disambiguates same-named works with a trailing year:
  // `psycho` is the 1998 remake and `psycho-1960` is Hitchcock's. Indexing the
  // year-stripped form too means a lookup on "Psycho" surfaces BOTH, and the
  // year check then picks between them instead of taking whichever the naive
  // slug happened to be. This is the exact failure the brief cites.
  const yr = slug.match(/^(.+)-((?:18|19|20)\d{2})$/);
  if (yr) for (const k of keysFor(yr[1])) if (!out.includes(k)) out.push(k);

  const toks = slug.split('-').filter(Boolean);
  for (let cut = 1; cut <= 3 && cut < toks.length; cut += 1) {
    const head = toks.slice(0, cut).join('');
    if (head.length > 14 || !head.endsWith('s')) continue;
    const tail = toks.slice(cut).join('-');
    for (const k of keysFor(tail)) if (k.length >= 8 && !out.includes(k)) out.push(k);
  }
  return out;
}

/** kind -> Map(foldKey -> slug[]) */
const universe = { games: new Map(), movies: new Map() };
let urlCount = 0;
for (const urls of Object.values(sitemap)) {
  for (const u of urls) {
    // entries look like "game/<slug>" or "movie/<slug>"
    const m = /^(game|movie)\/(.+)$/.exec(u);
    if (!m) continue;
    const kind = m[1] === 'game' ? 'games' : 'movies';
    const slug = m[2];
    if (slug.includes('/')) continue; // critic-reviews, user-reviews, etc.
    urlCount += 1;
    for (const k of indexKeys(slug)) {
      if (!universe[kind].has(k)) universe[kind].set(k, []);
      const bucket = universe[kind].get(k);
      if (!bucket.includes(slug)) bucket.push(slug);
    }
  }
}
console.log(`slug universe: ${urlCount} urls -> games ${universe.games.size} keys, movies ${universe.movies.size} keys`);

/**
 * Keys of one kind, sorted, so a prefix lookup is a binary search rather than a
 * scan of 300k keys per title.
 * @type {Record<string,string[]>}
 */
const sortedKeys = {
  games: [...universe.games.keys()].sort(),
  movies: [...universe.movies.keys()].sort(),
};

/**
 * Every indexed key beginning with `base`.
 * @param {'games'|'movies'} kind
 * @param {string} base
 */
function prefixRange(kind, base) {
  const keys = sortedKeys[kind];
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < base) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo; i < keys.length && keys[i].startsWith(base); i += 1) out.push(keys[i]);
  return out;
}

/** Edition/re-release suffixes a slug may carry that the catalogue title does not. */
const EDITION_TAIL =
  /^(19|20)\d{2}$|^(complete|definitive|enhanced|remastered|redux|goty|gameoftheyear|gameoftheyearedition|specialedition|deluxe|deluxeedition|ultimate|ultimateedition|anniversary|anniversaryedition|extended|gold|goldedition|hd|hdremaster|remake|classic|legacy|edition|collection|version|completeedition|finalcut|directorscut|reloaded|plus|steam|pc|remasteredversion|therestlessedition|royal)+$/;

/**
 * Candidate slugs for one title, best first.
 * @param {'games'|'movies'} kind
 * @param {string} title
 * @returns {string[]}
 */
function candidates(kind, title, w_year) {
  const uni = universe[kind];
  const out = [];
  const add = (s) => { if (s && !out.includes(s)) out.push(s); };

  const t = decodeEntities(title);
  // 1. exact key hit
  for (const k of keysFor(t)) for (const s of uni.get(k) ?? []) add(s);

  // 2. the title with an edition suffix stripped
  const stripped = t.replace(
    /\s*[:\-–]?\s*\b(the\s+)?(game of the year|goty|definitive|complete|enhanced|remastered|redux|director'?s cut|final cut|special|deluxe|ultimate|anniversary|extended|gold|hd|remake|reloaded|classic|legacy)\b\s*(edition|collection|version)?\s*$/i,
    '',
  );
  if (stripped.trim() && stripped !== t) for (const k of keysFor(stripped)) for (const s of uni.get(k) ?? []) add(s);

  // 3. trailing parenthetical dropped
  const paren = t.replace(/\s*\([^)]*\)\s*$/, '');
  if (paren.trim() && paren !== t) for (const k of keysFor(paren)) for (const s of uni.get(k) ?? []) add(s);

  // 4. main title alone, where a subtitle may not be in the slug
  const colon = t.match(/^(.*?)\s*[:–—]\s+(.*)$/);
  if (colon && colon[1].trim().length >= 6) {
    for (const k of keysFor(colon[1])) for (const s of uni.get(k) ?? []) add(s);
  }

  // 5. slugs that extend ours: Horizon Zero Dawn's PC product is
  //    horizon-zero-dawn-complete-edition, Hearthstone's page is
  //    hearthstone-heroes-of-warcraft. A short base is restricted to an
  //    edition-ish tail so "portal" cannot reach "portal-knights"; a long base
  //    may take any tail except a sequel number, which titlesAgree would refuse
  //    anyway. Shortest tails first — the closest name wins.
  const base = keysFor(t)[0];
  const extend = [];
  if (base.length >= 6) {
    const hits = [];
    for (const k of prefixRange(kind, base)) {
      const tail = k.slice(base.length);
      if (!tail) continue;
      if (/^\d/.test(tail) || /^(i{1,3}|iv|vi{0,3}|ix|xi{0,2}|x)$/.test(tail)) continue;
      if (base.length < 10 && !EDITION_TAIL.test(tail)) continue;
      hits.push(k);
    }
    hits.sort((a, b) => a.length - b.length);
    for (const k of hits.slice(0, 8)) for (const s of uni.get(k) ?? []) extend.push(s);
  }

  // 6. the BASE slug reconstructed from those extensions.
  //
  //    The sitemap is not complete: `sid-meiers-civilization-vi` and
  //    `hearthstone-heroes-of-warcraft` are both live pages that it never
  //    lists, though it lists a dozen of their DLC. Truncating a DLC slug back
  //    to the token boundary where it still keys to our title reconstructs the
  //    parent, which is the page we actually want. Added ahead of the DLC so
  //    the expansion never wins over the game.
  const derived = [];
  for (const s of extend) {
    const toks = s.split('-');
    for (let i = 1; i < toks.length; i += 1) {
      const p = toks.slice(0, i).join('-');
      if (indexKeys(p).includes(base) && !derived.includes(p)) derived.push(p);
    }
  }
  for (const s of derived) add(s);

  // 7. year-disambiguated slug, Metacritic's own convention for a namesake:
  //    `psycho` is the 1998 remake and `psycho-1960` is Hitchcock's — and
  //    `psycho-1960` is another live page the sitemap omits.
  const naive = slugVariants(t)[0];
  if (naive && w_year != null) add(`${naive}-${w_year}`);

  for (const s of extend) add(s);

  // 8. naive shapes, as a last resort where the sitemap simply has no entry.
  for (const s of slugVariants(t).slice(0, 3)) add(s);

  return out;
}

/* -------------------------------------------------------------------------- */
/* The remainder                                                               */
/* -------------------------------------------------------------------------- */

const GAMES = readArray('games.html', 'GAMES');
const MOVIES = JSON.parse(readFileSync('data/movies.json', 'utf8'));

const work = [
  ...GAMES.filter((g) => g.metacritic != null && !g.verified)
    .map((g) => ({ kind: 'games', title: g.title, year: g.year, ours: g.metacritic })),
  ...MOVIES.filter((m) => m.metacritic != null && !m.verified)
    .map((m) => ({ kind: 'movies', title: m.title, year: m.year, ours: m.metacritic })),
];

for (const w of work) w.cands = candidates(w.kind, w.title, w.year);

const noCand = work.filter((w) => w.cands.length === 0);
const fetchSet = new Set();
for (const w of work) for (const s of w.cands.slice(0, 8)) fetchSet.add(`${w.kind}/${s}`);

console.log(`remainder: ${work.length} (games ${work.filter((w) => w.kind === 'games').length}, films ${work.filter((w) => w.kind === 'movies').length})`);
console.log(`  with candidates    ${work.length - noCand.length}`);
console.log(`  NO slug anywhere   ${noCand.length}  <- absent from Metacritic's own sitemap`);
console.log(`  slugs to fetch     ${fetchSet.size}`);

if (PLAN) {
  console.log('\nno-candidate sample:');
  for (const w of noCand.slice(0, 30)) console.log(`   [${w.kind}] ${w.title} (${w.year})`);
  console.log('\nmulti-candidate sample:');
  for (const w of work.filter((x) => x.cands.length > 1).slice(0, 20)) {
    console.log(`   [${w.kind}] ${w.title} (${w.year}) -> ${w.cands.slice(0, 5).join(', ')}`);
  }
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/* Fetch                                                                       */
/* -------------------------------------------------------------------------- */

mkdirSync(CACHE_DIR, { recursive: true });
/** @type {Record<string, any>} */
const api = existsSync(API_CACHE) ? JSON.parse(readFileSync(API_CACHE, 'utf8')) : {};

/**
 * One product from the composer API.
 *
 * A slug that does not exist still answers 200 — the 404 is nested at
 * components[0].status. The earlier passes read res.status only, which is why
 * every one of their misses was recorded as "status 200" and why a genuine
 * absence was indistinguishable from a transport failure.
 *
 * Rule 6: 202/429/5xx/empty are retried with backoff and never stored.
 *
 * @param {'games'|'movies'} kind
 * @param {string} slug
 */
async function fetchOne(kind, slug) {
  const url = `https://backend.metacritic.com/composer/metacritic/pages/${kind}/${slug}/web?apiKey=${KEY}`;
  for (let a = 0; a < 5; a += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      const text = await res.text();
      if (res.status === 202 || res.status === 429 || res.status >= 500 || text.trim() === '') {
        await sleep(2000 * 2 ** a);
        continue;
      }
      if (res.status !== 200) return { transport: res.status };
      let j;
      try { j = JSON.parse(text); } catch { await sleep(2000 * 2 ** a); continue; }
      const comp = j?.components?.find((c) => c?.meta?.componentType === 'Product') ?? j?.components?.[0];
      if (comp?.status === 404) return { absent: true };
      const item = comp?.data?.item ?? j?.components?.[0]?.data?.item;
      if (!item) return { absent: true };
      const platforms = (item.platforms ?? []).map((p) => ({
        name: p?.name ?? '',
        score: p?.criticScoreSummary?.score ?? null,
        reviews: p?.criticScoreSummary?.reviewCount ?? null,
        date: p?.releaseDate ?? null,
      }));
      return {
        title: item.title ?? '',
        headline: item.criticScoreSummary?.score ?? null,
        reviews: item.criticScoreSummary?.reviewCount ?? null,
        date: item.releaseDate ?? item.premiereDate ?? null,
        platforms,
      };
    } catch {
      await sleep(2000 * 2 ** a);
    }
  }
  return null; // exhausted — an unknown, never cached as a result
}

const queue = [...fetchSet];
let cursor = 0;
let fetched = 0;
let throttleUnknown = 0;

async function worker() {
  for (;;) {
    const key = queue[cursor];
    cursor += 1;
    if (!key) return;
    if (api[key] !== undefined) continue;
    const [kind, slug] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
    const r = await fetchOne(kind, slug);
    if (r === null) { throttleUnknown += 1; } else { api[key] = r; }
    fetched += 1;
    if (fetched % 40 === 0) {
      writeFileSync(API_CACHE, JSON.stringify(api));
      console.log(`  ${cursor}/${queue.length}`);
    }
    await sleep(GAP_MS);
  }
}

console.log(`\nfetching ${queue.filter((k) => api[k] === undefined).length} uncached of ${queue.length}...`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(API_CACHE, JSON.stringify(api));
console.log(`fetched ${fetched}; ${throttleUnknown} left unresolved by throttling (rerun resumes)\n`);

/* -------------------------------------------------------------------------- */
/* Reconcile                                                                   */
/* -------------------------------------------------------------------------- */

/** @param {any} hit @param {'games'|'movies'} kind */
function scoreOf(hit, kind) {
  if (kind === 'movies') return { score: hit.headline, platform: 'film', reviews: hit.reviews };
  const pc = (hit.platforms ?? []).find((p) => /^PC$/i.test(p.name));
  if (pc && pc.score != null) return { score: pc.score, platform: 'PC', reviews: pc.reviews ?? hit.reviews };
  // No PC score. The headline is a different statistic — usually a console
  // release — so it is recorded but never presented as this catalogue's number.
  return { score: null, platform: pc ? 'PC (tbd)' : 'no PC entry', reviews: hit.reviews, headline: hit.headline };
}

const results = [];
const tally = {};
const bump = (s) => { tally[s] = (tally[s] ?? 0) + 1; };

for (const w of work) {
  const slack = SLACK[w.kind];
  const tried = w.cands.slice(0, 8);
  /** every candidate that agrees on title, with its year distance */
  const matches = [];
  let sawPage = false;
  let sawTitleAgree = false;
  let unknown = false;

  for (const slug of tried) {
    const hit = api[`${w.kind}/${slug}`];
    if (hit === undefined) { unknown = true; continue; }
    if (hit.absent || hit.transport) continue;
    sawPage = true;
    if (!titlesAgree(w.title, hit.title)) continue;
    sawTitleAgree = true;
    const y = Number(String(hit.date ?? '').slice(0, 4));
    const pcDate = (hit.platforms ?? []).find((p) => /^PC$/i.test(p.name))?.date;
    const py = Number(String(pcDate ?? '').slice(0, 4));
    const best = [y, py].filter((n) => Number.isFinite(n) && n > 1880);
    const dist = best.length ? Math.min(...best.map((n) => Math.abs(n - Number(w.year)))) : Infinity;
    matches.push({ slug, hit, dist, mcYear: best.length ? best[0] : null });
  }

  const row = {
    title: w.title, year: w.year, kind: w.kind === 'games' ? 'game' : 'film',
    ours: w.ours, theirs: null, platform: null, url: null, status: null,
  };

  if (tried.length === 0) {
    row.status = 'no-page';
    row.note = "no slug in Metacritic's own sitemap folds to this title";
    bump('no-page'); results.push(row); continue;
  }
  if (!sawPage && unknown) {
    row.status = 'unresolved'; row.note = 'fetch never completed (throttled)';
    bump('unresolved'); results.push(row); continue;
  }
  if (!sawPage) {
    row.status = 'no-page'; row.note = 'every candidate slug answered 404';
    bump('no-page'); results.push(row); continue;
  }
  if (!sawTitleAgree) {
    row.status = 'unresolved';
    row.note = `candidate pages exist but none names this work (got: ${tried.map((s) => api[`${w.kind}/${s}`]?.title).filter(Boolean).slice(0, 3).join(' | ')})`;
    bump('unresolved'); results.push(row); continue;
  }

  matches.sort((a, b) => a.dist - b.dist);
  const inSlack = matches.filter((m) => m.dist <= slack);
  const chosen = inSlack[0];

  if (!chosen) {
    const near = matches[0];
    row.status = 'year-mismatch';
    row.url = `https://www.metacritic.com/${w.kind === 'games' ? 'game' : 'movie'}/${near.slug}/`;
    row.mcTitle = near.hit.title; row.mcYear = near.mcYear;
    const s = scoreOf(near.hit, w.kind);
    row.theirs = s.score; row.platform = s.platform;
    row.note = `title agrees but year is ${near.mcYear ?? 'absent'} against our ${w.year}; not applied`;
    bump('year-mismatch'); results.push(row); continue;
  }

  row.url = `https://www.metacritic.com/${w.kind === 'games' ? 'game' : 'movie'}/${chosen.slug}/`;
  row.mcTitle = chosen.hit.title;
  row.mcYear = chosen.mcYear;
  const s = scoreOf(chosen.hit, w.kind);
  row.platform = s.platform;
  row.reviews = s.reviews;
  if (s.score == null) {
    row.theirs = null;
    row.status = 'no-score';
    row.note = w.kind === 'games'
      ? `page exists, no Metascore for PC (${s.reviews ?? 0} critic reviews${s.headline != null ? `; cross-platform headline ${s.headline}` : ''})`
      : `page exists, no Metascore (${s.reviews ?? 0} critic reviews)`;
    bump('no-score'); results.push(row); continue;
  }
  row.theirs = s.score;
  row.status = s.score === w.ours ? 'confirmed' : 'corrected';
  bump(row.status);
  results.push(row);
}

results.sort((a, b) => a.kind.localeCompare(b.kind) || a.status.localeCompare(b.status) || a.title.localeCompare(b.title));
writeFileSync('_metascores.json', JSON.stringify(results, null, 1));

/* ---------------------------------- report -------------------------------- */

console.log('=== remainder outcome ===');
for (const k of ['confirmed', 'corrected', 'no-score', 'no-page', 'year-mismatch', 'unresolved']) {
  console.log(`  ${k.padEnd(15)} ${tally[k] ?? 0}`);
}
for (const kind of ['game', 'film']) {
  const sub = results.filter((r) => r.kind === kind);
  const t = {};
  for (const r of sub) t[r.status] = (t[r.status] ?? 0) + 1;
  console.log(`  ${kind}s (${sub.length}): ${JSON.stringify(t)}`);
}

const corr = results.filter((r) => r.status === 'corrected');
console.log(`\nfirst 25 corrections (report only, nothing written):`);
for (const r of corr.slice(0, 25)) {
  console.log(`  [${r.kind}] ${r.title.slice(0, 40).padEnd(40)} ${String(r.ours).padStart(3)} -> ${String(r.theirs).padStart(3)}  (${r.platform})  ${r.url}`);
}
console.log('\nfirst 12 year-mismatches (NOT applied — a namesake or a re-release, needs eyes):');
for (const r of results.filter((x) => x.status === 'year-mismatch').slice(0, 12)) {
  console.log(`  [${r.kind}] ${r.title} (${r.year}) vs ${r.mcTitle} (${r.mcYear}) ours=${r.ours} theirs=${r.theirs}`);
}
console.log('\nwrote _metascores.json — report only, catalogue untouched.');
