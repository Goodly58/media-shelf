/**
 * Verify film and series Metascores against metacritic.com.
 *
 * The films/series pass that ran earlier used agents reading the site; this
 * uses the same backend endpoint the games sweep uses, so the two catalogues
 * are verified by one method rather than two.
 *
 * No platform ambiguity here — a film has one Metascore — so this is the
 * straightforward case the games sweep is not.
 *
 *   node _verify_screen.mjs          # report only
 *   node _verify_screen.mjs --apply  # rewrite data/*.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const KEY = '1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u';
const CACHE_DIR = '.verify-cache';
const CACHE_V = 'v2';
const CONCURRENCY = 4;
const GAP_MS = 300;
const APPLY = process.argv.includes('--apply');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} s */
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** @param {string} s */
const fold = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');

/**
 * How far apart the years may be and still be the same film.
 *
 * The check that nearly shipped without this compared titles only, and a
 * remake has the same title as its original. It produced Psycho 97 -> 47 (the
 * 1998 Van Sant remake), Inside Out 94 -> 28 (a different 2011 film) and
 * Moonlight 99 -> 59. Every one of those would have been written as verified.
 */
const YEAR_SLACK = 3;
// Three, not one, and measured rather than guessed: the rejected set clusters
// at 2-3 years (a foreign film's US release — Oldboy 2003/2005, Princess
// Mononoke 1997/1999, where the stored and found scores are identical) and
// then jumps to 11+ for the genuine namesakes. Nothing sits between 7 and 10
// that matters, so 3 recovers the lag without coming near a remake.

/**
 * @param {number|string|null|undefined} storedYear
 * @param {string|null|undefined} foundYear
 */
function yearsAgree(storedYear, foundYear) {
  const a = Number(storedYear);
  const b = Number(foundYear);
  // Nothing to check against is a fail, not a pass.
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < 1880) return false;
  return Math.abs(a - b) <= YEAR_SLACK;
}

function titlesAgree(stored, found) {
  const a = fold(stored);
  const b = fold(found);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.startsWith(short);
}

/**
 * @param {'movies'|'shows'} kind
 * @param {string} slug
 */
async function fetchOne(kind, slug) {
  const url = `https://backend.metacritic.com/composer/metacritic/pages/${kind}/${slug}/web?apiKey=${KEY}`;
  for (let a = 0; a < 3; a += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 404) return { missing: true, status: 404 };
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (a + 1));
        continue;
      }
      if (res.status !== 200) return { missing: true, status: res.status };
      const j = await res.json();
      const item = j?.components?.[0]?.data?.item;
      if (!item) return { missing: true, status: 200 };
      return {
        title: item.title ?? '',
        score: item.criticScoreSummary?.score ?? null,
        reviews: item.criticScoreSummary?.reviewCount ?? null,
        year: (item.releaseDate ?? item.premiereDate ?? '').slice(0, 4),
      };
    } catch {
      await sleep(1200 * (a + 1));
    }
  }
  return { missing: true, status: 0 };
}

mkdirSync(CACHE_DIR, { recursive: true });

/**
 * @param {string} file
 * @param {'movies'|'shows'} kind
 */
async function run(file, kind) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.movies ?? raw.shows ?? [];
  const cacheFile = `${CACHE_DIR}/${kind}.json`;
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};

  // Everything with a score, so previously-verified entries are re-checked by
  // the same method rather than trusted because an older pass said so.
  const targets = list.filter((o) => o.metacritic != null);
  let cursor = 0;
  let fetched = 0;

  async function worker() {
    for (;;) {
      const item = targets[cursor];
      cursor += 1;
      if (!item) return;
      const slug = slugify(item.title);
      if (cache[slug] !== undefined) continue;
      cache[slug] = await fetchOne(kind, slug);
      fetched += 1;
      if (fetched % 60 === 0) {
        writeFileSync(cacheFile, JSON.stringify(cache));
        process.stdout.write(`    ${cursor}/${targets.length}\n`);
      }
      await sleep(GAP_MS);
    }
  }

  console.log(`${file}: ${targets.length} scored entries, cache ${Object.keys(cache).length}`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  writeFileSync(cacheFile, JSON.stringify(cache));

  let agree = 0;
  let corrected = 0;
  const mismatch = [];
  const wrongYear = [];
  const missing = [];
  const changes = [];

  for (const o of list) {
    if (o.metacritic == null) continue;
    const hit = cache[slugify(o.title)];
    if (!hit || hit.missing || hit.score == null) {
      missing.push(o.title);
      continue;
    }
    if (!titlesAgree(o.title, hit.title)) {
      mismatch.push(`${o.title} -> ${hit.title}`);
      continue;
    }
    if (!yearsAgree(o.year, hit.year)) {
      wrongYear.push(`${o.title} (${o.year}) -> ${hit.title} (${hit.year || '?'})`);
      continue;
    }
    if (hit.score === o.metacritic) agree += 1;
    else {
      corrected += 1;
      changes.push([o.title, o.metacritic, hit.score]);
    }
    if (APPLY) {
      o.metacritic = hit.score;
      o.verified = true;
    }
  }

  // Anything unverifiable must not keep a badge from an earlier pass.
  if (APPLY) {
    for (const o of list) {
      if (o.metacritic == null) continue;
      const hit = cache[slugify(o.title)];
      const ok = hit && !hit.missing && hit.score != null && titlesAgree(o.title, hit.title) && yearsAgree(o.year, hit.year);
      if (!ok && o.verified) delete o.verified;
    }
    writeFileSync(file, JSON.stringify(Array.isArray(raw) ? list : raw, null, 0));
  }

  console.log(`  agreed ${agree}, corrected ${corrected}, title mismatch ${mismatch.length}, WRONG YEAR ${wrongYear.length}, not found ${missing.length}`);
  if (wrongYear.length) console.log('     wrong year (a remake or namesake, left alone):');
  for (const w of wrongYear.slice(0, 10)) console.log('        ' + w);
  for (const [t, from, to] of changes.slice(0, 12)) console.log(`     ${t}: ${from} -> ${to}`);
  if (mismatch.length) console.log(`     mismatches: ${mismatch.slice(0, 6).join(' | ')}`);
  if (missing.length) console.log(`     not found: ${missing.slice(0, 6).join(' | ')}`);
  console.log('');
}

await run('data/movies.json', 'movies');
await run('data/shows.json', 'shows');
if (!APPLY) console.log('Dry run. Re-run with --apply to write.');
