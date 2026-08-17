/**
 * Second pass over what _rt_tv.mjs resolved. Two jobs, one fetch per series page:
 *
 *   unscored rows -> walk the show's seasons for a real season-level Tomatometer
 *   scored rows   -> verify the match that produced the score is the right show
 *
 *   node _rt_tv_seasons.mjs        fetch + report  (resumable)
 *   node _rt_tv_seasons.mjs --status
 *
 * REPORT ONLY. There is deliberately no --apply. Writes _rt-tv-season-scores.json
 * and _rt-tv-verify.json; data/shows.json is never opened for writing, and
 * _rt-tv-scores.json is left for _rt_tv_merge.mjs to fold these into.
 *
 * WHY THE VERIFICATION HALF EXISTS
 * --------------------------------
 * The first pass reports "matched on title AND year", but its year guard reads
 * the hero strip, which frequently carries no year at all (Bluey's metadataProps
 * are ["TV-G","Next Ep Sep 29","3 Seasons"]) — and when there is no year the
 * guard passes silently, so most rows are title-only matches wearing a
 * year-checked label. Its title rule is substring-based on top of that, which is
 * how "Warrior" (2019) landed on a page named "Warriors of the Mongkon". The
 * series JSON-LD's dateCreated is a real first-air year and settles both.
 *
 * WHY THIS IS HONEST, AND WHERE THE LINE IS
 * -----------------------------------------
 * RT aggregates many series per season, so ~1/3 of the catalogue has a real
 * Tomatometer that simply does not live on the series page. Reading it off the
 * season page is recovering a real critic score, not inventing one — but only
 * under these rules:
 *
 *  - The number is labelled. It lands in `seasonScore`/`seasonLabel`, never in
 *    the series `score` field, so nothing downstream can mistake a Season 1
 *    Tomatometer for a whole-series one.
 *  - EARLIEST scored season wins, not the best one. The catalogue year is the
 *    first-air year, so season 1 is the matching object. Taking the highest of
 *    N seasons would be score-shopping and would make the catalogue read better
 *    than the truth.
 *  - reviewCount > 0, same as the series pass. A 0-review score is not a score.
 *  - `name === "Tomatometer"` is checked on the season JSON-LD. On a SERIES page
 *    that same aggregateRating field is name="AudienceScore" — Bluey's is the
 *    80 that must never be used — so the name check is what keeps the audience
 *    number out. Confirmed by looking at both page types, not assumed.
 *
 * Season URLs come from the series page's JSON-LD `containsSeason`, which is
 * authoritative. Scraping /sNN hrefs out of the markup instead picks up the
 * "you might also like" carousel and yields other shows' seasons entirely.
 *
 * robots.txt (checked): rottentomatoes.com disallows /m/*\/pictures,
 * /tv/*\/pictures, /search and /critics/self-submission/ for all agents.
 * /tv/<slug> and /tv/<slug>/sNN are both allowed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(HERE, f);

const STATUS = process.argv.includes('--status');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PACE = 1100;
const SAMPLE = Number(process.env.SAMPLE || 0);
/* How many seasons deep to look before giving up on a show.
   Measured, not guessed: over the first 35 shows walked, the season that first
   carried a Tomatometer was s01 eight times, s03 three times, and s24 once —
   while three shows cost 21, 22 and 24 fetches apiece to learn nothing. A cap of
   4 keeps 11 of those 12 recoveries and drops the 20+ page walks.
   The one it drops deserves dropping: the catalogue dates each show by its
   first-air year, so a season-24 Tomatometer describes a different body of work
   two decades later. Finding it by exhausting every season is the same
   score-shopping as picking the highest, just arrived at the long way round. */
const MAX_SEASONS = Number(process.env.MAX_SEASONS || 4);

const SCORES = at('_rt-tv-scores.json');
const CACHE = at('_rt-tv-season-cache.json');
const OUT = at('_rt-tv-season-scores.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);

const RETRYABLE = (s) => s === 202 || s === 429 || s === 408 || (s >= 500 && s < 600);

/* Throttles are never an answer (rule 6): back off and retry, and if it is still
   throttled leave it marked retry so a rerun picks it up rather than freezing a
   failure into the cache. */
async function grab(url, tries = 4) {
  let wait = 2000;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (RETRYABLE(res.status)) { await sleep(wait); wait *= 2; continue; }
      if (!res.ok) return { status: res.status };
      const html = await res.text();
      if (!html.length) { await sleep(wait); wait *= 2; continue; }
      return { status: 200, html, url: res.url };
    } catch {
      await sleep(wait); wait *= 2;
    }
  }
  return { retry: true, status: 'throttled' };
}

function jsonBlob(html, id) {
  const m = html.match(new RegExp('<script[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</script>'));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
function ldAll(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean);
}

/* The series JSON-LD carries dateCreated / genre / numberOfSeasons. dateCreated is
   a far better year signal than the hero strip the first pass uses: hero
   metadataProps for Bluey are ["TV-G","Next Ep Sep 29","3 Seasons"] with no year
   at all, so the first pass's year guard silently does nothing on pages like it,
   while dateCreated says 2018-10-01. Captured here in the same fetch, free. */
function seriesFacts(html) {
  const ld = ldAll(html).find((j) => j['@type'] === 'TVSeries') || {};
  const dc = String(ld.dateCreated || (ld.partOfSeries || {}).startDate || '');
  const y = Number((dc.match(/^((?:19|20)\d{2})/) || [])[1]) || null;
  /* What RT calls the number on a series page. Recorded for every show so the
     claim that it is a per-season average rests on the whole corpus rather than
     on the handful of pages that were eyeballed. */
  const cs = (jsonBlob(html, 'media-scorecard-json') || {}).criticsScore || null;
  return {
    ldYear: y,
    ldGenres: Array.isArray(ld.genre) ? ld.genre : (ld.genre ? [ld.genre] : []),
    ldSeasons: ld.numberOfSeasons != null ? Number(ld.numberOfSeasons) : null,
    ldName: ld.name || null,
    scoreTitle: cs ? cs.title || null : null,
  };
}

/** Season list straight from the series page's JSON-LD. */
function seasonsOf(html) {
  const ld = ldAll(html).find((j) => j['@type'] === 'TVSeries') || {};
  const list = Array.isArray(ld.containsSeason) ? ld.containsSeason : [];
  return list
    .map((s) => {
      const url = String(s.url || '').split('?')[0];
      const n = Number((url.match(/\/s(\d+)$/) || [])[1] ?? (String(s.name || '').match(/(\d+)/) || [])[1]);
      return { n: Number.isFinite(n) ? n : null, name: s.name || null, url };
    })
    .filter((s) => s.url && s.n != null)
    .sort((a, b) => a.n - b.n);
}

/** A season's critic score, only when real reviews back it. */
function seasonScore(html) {
  const sc = jsonBlob(html, 'media-scorecard-json') || {};
  const cs = sc.criticsScore || null;
  let reviews = cs && cs.reviewCount != null ? Number(cs.reviewCount) : 0;
  let score = cs && cs.score != null ? Number(cs.score) : null;

  /* Cross-check against the season JSON-LD, which on a TVSeason IS the
     Tomatometer — but only if it says so by name. */
  const ld = ldAll(html).find((j) => j['@type'] === 'TVSeason') || {};
  const agg = ld.aggregateRating || null;
  const ldIsTomato = agg && String(agg.name || '') === 'Tomatometer';
  const ldScore = ldIsTomato && agg.ratingValue != null ? Number(agg.ratingValue) : null;
  const ldReviews = ldIsTomato && agg.reviewCount != null ? Number(agg.reviewCount) : 0;

  if (score == null && ldScore != null) { score = ldScore; reviews = ldReviews; }

  return {
    score: Number.isFinite(score) && reviews > 0 ? score : null,
    reviews,
    scorecardTitle: cs ? cs.title || null : null,
    ldName: agg ? agg.name || null : null,
    ldScore, ldReviews,
    agrees: ldScore == null || score == null || ldScore === score,
  };
}

/* ---- caches -------------------------------------------------------------- */

const cache = readJson(CACHE, {});
const flush = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

async function cached(url, parse) {
  if (cache[url] && !cache[url].retry) return cache[url];
  const r = await grab(url);
  await sleep(PACE);
  cache[url] = r.status === 200 ? { ok: true, finalUrl: r.url, ...parse(r.html) } : { ok: false, status: r.status, retry: !!r.retry };
  return cache[url];
}

/* ---- main ---------------------------------------------------------------- */

const rows = readJson(SCORES, null);
if (!rows) { console.error('no _rt-tv-scores.json — run node _rt_tv.mjs first'); process.exit(1); }

/* Read-only. The catalogue's own season count and genre are the second and third
   disambiguators, and the pass uses neither. Utopia is why: ours is the 2013
   Channel 4 series, 2 seasons, Sci-Fi & Fantasy; RT's /tv/utopia is a 2014
   1-season show scored 29. One year apart, so no year check of any tolerance
   separates them — but 2 seasons vs 1 does. */
const catalogue = new Map();
for (const s of JSON.parse(fs.readFileSync(at('data/shows.json'), 'utf8'))) {
  catalogue.set(`${s.title}|${s.year}`, s);
}
const norm = (g) => String(g || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);

/* Two jobs, one fetch of each series page:
     unscored -> walk its seasons looking for a real Tomatometer
     ok       -> year-verify the match that produced the score
   The first pass matched on title plus a +/-25y window against a hero year that
   is frequently absent, so "matched on title AND year" is weaker than it sounds.
   dateCreated settles it, and it costs nothing extra to read while we are here. */
const unscored = rows.filter((r) => r.status === 'unscored' && r.url);
const scored = rows.filter((r) => r.status === 'ok' && r.url);
console.log(`${unscored.length} matched but with no series-level Tomatometer -> walk seasons`);
console.log(`${scored.length} scored -> year-verify against RT's dateCreated`);

if (STATUS) {
  const all = [...unscored, ...scored];
  const done = all.filter((r) => cache[r.url] && !cache[r.url].retry).length;
  console.log(`${done}/${all.length} series pages read`);
  process.exit(0);
}

const targets = SAMPLE ? [...unscored, ...scored].slice(0, SAMPLE) : [...unscored, ...scored];
console.log(`(~${Math.round(targets.length * PACE * 1.6 / 60000)} min)\n`);

const out = [];
const verified = [];
let recovered = 0, stillNone = 0, failed = 0, n = 0;

for (const r of targets) {
  if (r.status === 'ok') {
    const p = await cached(r.url, (html) => seriesFacts(html));
    const gap = r.ourYear != null && p.ldYear != null ? Math.abs(r.ourYear - p.ldYear) : null;
    const ours = catalogue.get(`${r.title}|${r.ourYear}`);

    /* Soft signals. Neither is decisive on its own — RT's genre vocabulary is not
       ours, and season counts drift as shows run on — but a show that disagrees on
       both while sitting a year or two away is very likely a different show. */
    const seasonGap = ours && ours.seasons != null && p.ldSeasons != null ? Math.abs(ours.seasons - p.ldSeasons) : null;
    const rtG = (p.ldGenres || []).flatMap(norm);
    const ourG = ours ? norm(ours.genre) : [];
    const genreOverlap = ourG.length && rtG.length ? ourG.some((g) => rtG.includes(g)) : null;

    let verdict;
    if (!p.ok) verdict = 'unreadable';
    else if (gap == null) verdict = 'no-year-on-rt';
    else if (gap > 3) verdict = 'YEAR-CONFLICT';
    else if (seasonGap != null && seasonGap >= 2 && genreOverlap === false) verdict = 'SUSPECT-DIFFERENT-SHOW';
    else verdict = 'year-confirmed';

    verified.push({
      title: r.title, ourYear: r.ourYear, rtLdYear: p.ldYear ?? null, yearGap: gap,
      score: r.score, reviewCount: r.reviewCount, pageName: r.pageName, url: r.url,
      ourSeasons: ours ? ours.seasons ?? null : null, rtSeasons: p.ldSeasons ?? null, seasonGap,
      ourGenre: ours ? ours.genre ?? null : null, rtGenres: p.ldGenres || [], genreOverlap,
      ourStoredRt: ours ? ours.rt ?? null : null,
      rtScoreTitle: p.scoreTitle ?? null,
      verdict,
    });
    n += 1;
    if (n % 10 === 0) { flush(); process.stdout.write(`  ${n}/${targets.length}\r`); }
    continue;
  }

  const seriesPage = await cached(r.url, (html) => ({ seasons: seasonsOf(html), ...seriesFacts(html) }));

  /* Rule 4: a title match is not a match where remakes exist. dateCreated is the
     real first-air year, so a big gap here means we resolved a different show. */
  const yearGap = r.ourYear != null && seriesPage.ldYear != null ? Math.abs(r.ourYear - seriesPage.ldYear) : null;

  if (!seriesPage.ok || seriesPage.retry) {
    failed += 1;
    out.push({ title: r.title, ourYear: r.ourYear, url: r.url, status: 'series-page-failed', detail: seriesPage.status });
  } else {
    const seasons = seriesPage.seasons || [];
    if (!seasons.length) {
      stillNone += 1;
      out.push({ title: r.title, ourYear: r.ourYear, url: r.url, status: 'no-seasons-listed' });
    } else {
      const seen = [];
      let picked = null;
      /* Ascending, and we stop at the FIRST season that has a real score.
         Deliberately not scanning them all for the best number. */
      const walk = seasons.slice(0, MAX_SEASONS);
      for (const s of walk) {
        const p = await cached(s.url, (html) => seasonScore(html));
        if (!p.ok) { seen.push({ season: s.n, url: s.url, error: p.status }); continue; }
        seen.push({ season: s.n, url: s.url, score: p.score, reviews: p.reviews, ldName: p.ldName, agrees: p.agrees });
        if (p.score != null) { picked = { ...p, season: s.n, name: s.name, url: s.url }; break; }
      }

      if (picked) {
        recovered += 1;
        out.push({
          title: r.title, ourYear: r.ourYear, url: r.url, pageName: r.pageName,
          status: 'season-score',
          scoreLevel: 'season',
          seasonScore: picked.score,
          seasonReviewCount: picked.reviews,
          seasonNumber: picked.season,
          seasonLabel: picked.name || `Season ${picked.season}`,
          seasonUrl: picked.url,
          ldName: picked.ldName,
          rtLdYear: seriesPage.ldYear, yearGap,
          rtGenres: seriesPage.ldGenres,
          seasonsChecked: seen,
          totalSeasons: seasons.length,
          suspectMatch: yearGap != null && yearGap > 3,
        });
      } else {
        stillNone += 1;
        /* Say which it is. "No score in the first 4 of 24 seasons" is a different
           and weaker claim than "no score anywhere", and reporting the weaker one
           as the stronger is how a cap turns into a false negative. */
        const capped = seasons.length > walk.length;
        out.push({
          title: r.title, ourYear: r.ourYear, url: r.url, pageName: r.pageName,
          status: capped ? 'no-score-in-first-seasons' : 'no-score-any-season',
          seasonsChecked: seen, seasonsWalked: walk.length, totalSeasons: seasons.length,
          rtLdYear: seriesPage.ldYear, yearGap, suspectMatch: yearGap != null && yearGap > 3,
        });
      }
    }
  }

  n += 1;
  if (n % 10 === 0) { flush(); process.stdout.write(`  ${n}/${targets.length} — ${recovered} recovered\r`); }
}
flush();
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
fs.writeFileSync(at('_rt-tv-verify.json'), JSON.stringify(verified, null, 1));

console.log(`\n\nseason walk over ${unscored.length} previously-unscored series`);
console.log(`  ${recovered} have a season-level Tomatometer`);
console.log(`  ${stillNone} genuinely have no critic score at any level`);
console.log(`  ${failed} could not be read`);

const vc = {};
for (const v of verified) vc[v.verdict] = (vc[v.verdict] || 0) + 1;
console.log(`\nyear-verification of ${verified.length} series-level scores:`);
for (const [k, v] of Object.entries(vc).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);

const conflicts = verified.filter((v) => v.verdict === 'YEAR-CONFLICT');
if (conflicts.length) {
  console.log(`\n${conflicts.length} scores that belong to a DIFFERENT SHOW of the same name — do not apply these:`);
  for (const v of conflicts.sort((a, b) => b.yearGap - a.yearGap)) {
    console.log(`  ours ${v.ourYear} vs RT ${v.rtLdYear} (${String(v.yearGap).padStart(2)}y)  ${String(v.score).padStart(3)}  ${v.title}  ${v.url}`);
  }
}

const susp = verified.filter((v) => v.verdict === 'SUSPECT-DIFFERENT-SHOW');
if (susp.length) {
  console.log(`\n${susp.length} within a year or two but disagreeing on BOTH season count and genre:`);
  for (const v of susp) {
    console.log(`  ${v.title} (${v.ourYear}) ours ${v.ourSeasons}s/${v.ourGenre} vs RT ${v.rtLdYear} ${v.rtSeasons}s/[${v.rtGenres.join(',')}] score ${v.score}  ${v.url}`);
  }
}

const lowered = verified.filter((v) => v.verdict === 'year-confirmed' && v.ourStoredRt != null && v.score < v.ourStoredRt);
const raised = verified.filter((v) => v.verdict === 'year-confirmed' && v.ourStoredRt != null && v.score > v.ourStoredRt);
/* Direction matters more than the size of the tail. Sorting the differences by
   magnitude shows nothing but big drops and invites the conclusion that RT's
   number is a different measure pulling everything down; the signed mean is what
   actually settles it. */
const cmp = verified.filter((v) => v.verdict === 'year-confirmed' && v.ourStoredRt != null);
const signed = cmp.reduce((a, v) => a + (v.score - v.ourStoredRt), 0) / (cmp.length || 1);
const identical = cmp.filter((v) => v.score === v.ourStoredRt).length;
console.log(`\namong ${cmp.length} year-confirmed matches with a stored value:`);
console.log(`  ${identical} identical, ${raised.length} rise, ${lowered.length} drop, mean signed change ${signed.toFixed(2)}`);

const tc = {};
for (const v of verified) if (v.rtScoreTitle) tc[v.rtScoreTitle] = (tc[v.rtScoreTitle] || 0) + 1;
console.log(`\nwhat RT calls the number on the SERIES page, across all ${verified.length} scored matches:`);
for (const [k, v] of Object.entries(tc).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  "${k}"`);
console.log(`\n"Avg. Tomatometer" on a series page is an average over that show's seasons;`);
console.log(`a season page says plain "Tomatometer". They are different quantities, so the`);
console.log(`season scores above are reported in their own fields rather than merged in.`);
console.log(`That said, the stored column tracks the series number closely (see the signed`);
console.log(`mean), so the differences are mostly drift plus a tail of wrong-show matches —`);
console.log(`not a wholesale mismatch of measure. Judge the big movers individually.`);
console.log(`\nwrote ${OUT} + _rt-tv-verify.json (report only — nothing written to data/shows.json)`);

const dis = out.filter((r) => r.status === 'season-score' && r.seasonsChecked.some((s) => s.agrees === false));
if (dis.length) console.log(`\n${dis.length} where scorecard and JSON-LD disagreed — inspect before trusting`);

const suspect = out.filter((r) => r.suspectMatch);
if (suspect.length) {
  console.log(`\n${suspect.length} where RT's first-air year is >3y from ours — probably the WRONG SHOW, do not use:`);
  for (const s of suspect.slice(0, 25)) {
    console.log(`  ours ${s.ourYear} vs RT ${s.rtLdYear}  ${s.title}  ${s.url}`);
  }
}
