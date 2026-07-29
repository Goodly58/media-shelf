/**
 * Verify every game's Metascore against metacritic.com.
 *
 * ## Why this reads the PC score, not the headline
 *
 * Metacritic scores a game once per platform and also publishes a headline
 * aggregate. This is a **PC** catalogue — the page says "Browse PC games ranked
 * by Metacritic" — so the PC score is the number the site is claiming, and the
 * headline is a different statistic that happens to sit in the same place.
 *
 * The existing data is a mix of the two, which is why it cannot simply be
 * trusted or simply be overwritten:
 *
 *     Disco Elysium: The Final Cut   stored 97   headline 89   PC 97
 *     The Witcher 3                  stored 93   headline 92   PC 93
 *     NieR: Automata                 stored 88   headline 88   PC 84
 *     Grand Theft Auto V             stored 97   headline 97   PC 96
 *
 * Verifying against the headline would have quietly rewritten Disco Elysium
 * from 97 to 89. Verifying against PC corrects NieR and GTA V, which are
 * currently showing console scores on a PC list. Both numbers are recorded so
 * the choice stays auditable.
 *
 * ## Matching
 *
 * A wrong match is worse than no match: it writes a real score for the wrong
 * game and marks it verified. So the returned title must agree with the stored
 * one after normalisation, and anything that does not agree is left untouched
 * and reported rather than guessed at.
 *
 * ## Politeness
 *
 * One backend request per game, bounded concurrency, and a disk cache so a
 * re-run costs nothing. Resumable: kill it and start it again.
 *
 *   node _verify_games.mjs          # fetch + report, writes nothing
 *   node _verify_games.mjs --apply  # also rewrite games.html
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/** Public key the site's own front end uses; no account, no secret. */
const KEY = '1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u';

const CACHE_DIR = '.verify-cache';
const CACHE_FILE = `${CACHE_DIR}/games-v2.json`;
const CONCURRENCY = 5;
const GAP_MS = 260;

const APPLY = process.argv.includes('--apply');

/* -------------------------------------------------------------------------- */
/* The dataset                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pull the GAMES array out of games.html by bracket matching. A regex cannot do
 * this safely — blurbs contain brackets.
 * @returns {{ arr: object[], start: number, end: number, html: string }}
 */
function readGames() {
  const html = readFileSync('games.html', 'utf8');
  const at = html.search(/const GAMES\s*=\s*\[/);
  if (at < 0) throw new Error('GAMES array not found in games.html');
  const start = html.indexOf('[', at);
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('GAMES array is unterminated');
  return { arr: JSON.parse(html.slice(start, end)), start, end, html };
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

/** @param {string} s */
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Fold a title to the form two spellings of the same game share. */
function fold(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * Do these two titles name the same game?
 *
 * Deliberately strict. Metacritic often carries an edition suffix the catalogue
 * does not ("Game of the Year Edition"), so a prefix match counts — but only in
 * that direction and only when the shared part is substantial.
 *
 * @param {string} stored
 * @param {string} found
 */
function titlesAgree(stored, found) {
  const a = fold(stored);
  const b = fold(found);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.startsWith(short);
}

/**
 * How far apart the years may be and still be the same release.
 *
 * A title alone does not identify a game, and this is the mistake that nearly
 * shipped: a remake carries the *same title* as its original, so the name guard
 * waves it through. On the film side the identical check would have written
 * Psycho (1960) the 1998 remake's 47, and Inside Out (2015) a different film's
 * 28. Games have the same trap — Resident Evil 4 (2005) against the 2023
 * remake, DOOM (1993) against DOOM (2016).
 *
 * Two years of slack absorbs a staggered PC port and a regional date without
 * coming close to a remake, which is always a decade or more away.
 */
const YEAR_SLACK = 2;

/**
 * @param {number|string|null|undefined} storedYear
 * @param {string|null|undefined} foundDate ISO date from the API
 */
function yearsAgree(storedYear, foundDate) {
  const a = Number(storedYear);
  const b = Number(String(foundDate ?? '').slice(0, 4));
  // No date to check against is not a pass — an unverifiable entry stays
  // unverified rather than being trusted on the strength of its name.
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < 1950) return false;
  return Math.abs(a - b) <= YEAR_SLACK;
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                    */
/* -------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} slug
 * @returns {Promise<{ok: boolean, status: number, item: object|null}>}
 */
async function fetchGame(slug) {
  const url = `https://backend.metacritic.com/composer/metacritic/pages/games/${slug}/web?apiKey=${KEY}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 404) return { ok: false, status: 404, item: null };
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (res.status !== 200) return { ok: false, status: res.status, item: null };
      const json = await res.json();
      return { ok: true, status: 200, item: json?.components?.[0]?.data?.item ?? null };
    } catch {
      await sleep(1200 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, item: null };
}

/**
 * Reduce the API item to the few fields this cares about.
 * @param {object} item
 */
function readItem(item) {
  const platforms = (item?.platforms ?? []).map((p) => ({
    name: p?.name ?? '',
    score: p?.criticScoreSummary?.score ?? null,
    date: p?.releaseDate ?? null,
  }));
  const pc = platforms.find((p) => /^PC$/i.test(p.name));
  return {
    title: item?.title ?? '',
    headline: item?.criticScoreSummary?.score ?? null,
    reviews: item?.criticScoreSummary?.reviewCount ?? null,
    pc: pc?.score ?? null,
    // The PC date, because a PC catalogue's year is its PC release. DOOM's item
    // date is 2017 (the Switch port); its PC date is 2016, which is the year
    // the catalogue holds.
    date: pc?.date ?? item?.releaseDate ?? null,
    platforms,
  };
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

const { arr: GAMES } = readGames();
mkdirSync(CACHE_DIR, { recursive: true });

/** @type {Record<string, any>} */
const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
let fetched = 0;
let cached = 0;

const queue = GAMES.map((g, i) => ({ g, i }));
let cursor = 0;

async function worker() {
  for (;;) {
    const next = queue[cursor];
    cursor += 1;
    if (!next) return;
    const { g } = next;
    const slug = slugify(g.title);
    if (cache[slug] !== undefined) {
      cached += 1;
      continue;
    }
    const { ok, status, item } = await fetchGame(slug);
    cache[slug] = ok && item ? readItem(item) : { missing: true, status };
    fetched += 1;
    if (fetched % 50 === 0) {
      writeFileSync(CACHE_FILE, JSON.stringify(cache));
      const done = cached + fetched;
      process.stdout.write(`  ${done}/${GAMES.length} (${fetched} fetched)\n`);
    }
    await sleep(GAP_MS);
  }
}

console.log(`${GAMES.length} games; cache has ${Object.keys(cache).length}`);
const t0 = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(CACHE_FILE, JSON.stringify(cache));
console.log(`fetched ${fetched}, reused ${cached}, in ${Math.round((Date.now() - t0) / 1000)}s\n`);

/* ------------------------------- reconcile -------------------------------- */

const report = {
  agreePc: 0,
  correctedToPc: 0,
  headlineOnly: 0,
  noPcScore: 0,
  titleMismatch: [],
  yearMismatch: [],
  notFound: [],
};

const updates = new Map();

for (const g of GAMES) {
  const slug = slugify(g.title);
  const hit = cache[slug];
  if (!hit || hit.missing) {
    report.notFound.push(g.title);
    continue;
  }
  if (!titlesAgree(g.title, hit.title)) {
    report.titleMismatch.push(`${g.title}  ->  ${hit.title}`);
    continue;
  }
  if (!yearsAgree(g.year, hit.date)) {
    report.yearMismatch.push(
      `${g.title} (${g.year})  ->  ${hit.title} (${String(hit.date ?? '?').slice(0, 4)})`,
    );
    continue;
  }

  // The PC score is what a PC catalogue is claiming. Fall back to the headline
  // only where Metacritic has no separate PC number.
  const truth = hit.pc ?? hit.headline;
  if (truth == null) {
    report.noPcScore += 1;
    continue;
  }
  if (hit.pc == null) report.headlineOnly += 1;

  if (truth === g.metacritic) report.agreePc += 1;
  else report.correctedToPc += 1;

  updates.set(g.title, { score: truth, source: hit.pc != null ? 'pc' : 'headline', reviews: hit.reviews });
}

console.log('=== reconciliation ===');
console.log(`  already correct        ${report.agreePc}`);
console.log(`  corrected              ${report.correctedToPc}`);
console.log(`  (of which no PC score, headline used) ${report.headlineOnly}`);
console.log(`  scored on no platform  ${report.noPcScore}`);
console.log(`  title mismatch         ${report.titleMismatch.length}`);
console.log(`  year mismatch (remake) ${report.yearMismatch.length}`);
console.log(`  not on metacritic      ${report.notFound.length}`);
console.log(`  => verifiable          ${updates.size} of ${GAMES.length}`);

console.log('\nfirst 15 corrections:');
let shown = 0;
for (const g of GAMES) {
  const u = updates.get(g.title);
  if (!u || u.score === g.metacritic) continue;
  console.log(`  ${g.title.padEnd(42).slice(0, 42)} ${String(g.metacritic).padStart(3)} -> ${String(u.score).padStart(3)}  (${u.source})`);
  if (++shown >= 15) break;
}

console.log('\nfirst 12 YEAR mismatches — a different release with the same name (left alone):');
for (const t of report.yearMismatch.slice(0, 12)) console.log('  ' + t);
console.log('\nfirst 10 title mismatches (left alone):');
for (const t of report.titleMismatch.slice(0, 10)) console.log('  ' + t);
console.log('\nfirst 10 not found (left alone):');
for (const t of report.notFound.slice(0, 10)) console.log('  ' + t);

writeFileSync('.verify-cache/report.json', JSON.stringify({ report, updates: [...updates] }, null, 1));

/* --------------------------------- apply ---------------------------------- */

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write games.html.');
  process.exit(0);
}

const { arr, start, end, html } = readGames();
let changed = 0;
let marked = 0;
for (const g of arr) {
  const u = updates.get(g.title);
  if (!u) {
    // Never leave a stale claim: unverifiable entries lose the badge.
    if (g.verified) {
      delete g.verified;
      marked += 1;
    }
    continue;
  }
  if (g.metacritic !== u.score) {
    g.metacritic = u.score;
    changed += 1;
  }
  if (!g.verified) {
    g.verified = true;
    marked += 1;
  }
}
const next = html.slice(0, start) + JSON.stringify(arr) + html.slice(end);
writeFileSync('games.html', next);
console.log(`\napplied: ${changed} scores changed, ${marked} badges added/removed`);
