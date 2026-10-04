/**
 * Folds the season-level findings into _rt-tv-scores.json.
 *
 *   node tools/rotten-tomatoes/rt_tv_merge.mjs
 *
 * REPORT ONLY — rewrites _rt-tv-scores.json (this pass's own report file) and
 * nothing else. data/shows.json is never opened.
 *
 * The series `score` field is left exactly as the series pass found it. A season
 * Tomatometer arrives in its own fields and carries `scoreLevel:"season"`, so a
 * later applier has to opt into it deliberately rather than absorbing it as if
 * RT had scored the whole series. Rows keep a `status` that says which it is:
 *
 *   ok                  series-level Tomatometer, reviewCount > 0
 *   season-score        no series score; earliest scored season, labelled
 *   unscored            RT has the show, no critic score at any level  <- a real result
 *   not-found           no RT page resolved from any slug               <- also a real result
 *   year-mismatch       resolved a page whose year is far from ours (first pass's own guard)
 *   year-conflict       looked fine to the first pass, but RT's dateCreated says it is a
 *                       different show of the same name — NOT applicable
 *
 * Rows may also carry `reresolvedFrom`, meaning the first pass had accepted a
 * substring title match on an earlier slug and a better page was found.
 *
 * Inputs, all optional — whichever exist get folded in:
 *   _rt-tv-reresolve.json      better-matching pages (takes precedence)
 *   _rt-tv-verify.json         dateCreated year verification of scored rows
 *   _rt-tv-season-scores.json  season-level Tomatometers for unscored rows
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (f) => path.join(ROOT, f);
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);

const rows = readJson(at('_rt-tv-scores.json'), null);
if (!rows) { console.error('no _rt-tv-scores.json'); process.exit(1); }
const seasons = readJson(at('_rt-tv-season-scores.json'), []);
const verify = readJson(at('_rt-tv-verify.json'), []);
const reres = readJson(at('_rt-tv-reresolve.json'), []);

const byTitle = new Map();
for (const s of seasons) byTitle.set(s.title, s);
const vByTitle = new Map();
for (const v of verify) vByTitle.set(v.title, v);
/* Re-resolve wins over everything else for the rows it touched: it re-examined
   exactly the rows whose accepted page was not titled what we asked for, and
   picked by exact title then year rather than by first-slug-that-passed. */
const rByTitle = new Map();
for (const x of reres) if (x.changed && x.now) rByTitle.set(x.title, x);

let merged = 0, stillNone = 0, conflicts = 0, fixed = 0;
const out = rows.map((r) => {
  const fix = rByTitle.get(r.title);
  if (fix) {
    fixed += 1;
    const hasScore = fix.now.score != null;
    return {
      ...r,
      status: hasScore ? 'ok' : 'unscored',
      scoreLevel: hasScore ? 'series' : null,
      score: fix.now.score, reviewCount: fix.now.reviews,
      url: fix.now.url, pageName: fix.now.pageName, rtYear: fix.now.rtYear,
      yearVerdict: fix.now.yearGap != null && fix.now.yearGap <= 3 ? 'year-confirmed' : 'no-year-on-rt',
      reresolvedFrom: { url: fix.was.url, pageName: fix.was.pageName, status: fix.was.status },
      note: 'first pass accepted a substring title match on an earlier slug; re-resolved to the exact-title page',
    };
  }
  if (r.status === 'ok') {
    const v = vByTitle.get(r.title);
    if (!v) return { ...r, scoreLevel: 'series' };
    /* A year conflict means the slug resolved to a different show wearing the
       same title. The score is real, it just is not this show's, so it stops
       being an 'ok' row rather than staying applicable with a footnote. */
    if (v.verdict === 'YEAR-CONFLICT') {
      conflicts += 1;
      return {
        ...r, status: 'year-conflict', scoreLevel: null,
        rtLdYear: v.rtLdYear, yearGap: v.yearGap, rtGenres: v.rtGenres,
        note: 'RT first-air year disagrees with ours — resolved a different show of the same name, do not apply',
      };
    }
    return { ...r, scoreLevel: 'series', yearVerdict: v.verdict, rtLdYear: v.rtLdYear ?? null };
  }
  const s = byTitle.get(r.title);
  if (!s) return r;
  if (s.status === 'season-score') {
    /* Several unscored rows were matched by substring onto a LATER arc of the same
       franchise — "Haikyu!!" (2014) landed on "Haikyu!! To the Top" (2020),
       "Sword Art Online" (2012) on "Sword Art Online: Alicization". Walking those
       pages returns a perfectly real Tomatometer for the wrong body of work, so a
       season score inherits the doubt about the page it came from. */
    if (s.suspectMatch) {
      return {
        ...r, status: 'season-score-suspect', scoreLevel: null,
        seasonScore: s.seasonScore, seasonUrl: s.seasonUrl, seasonLabel: s.seasonLabel,
        rtLdYear: s.rtLdYear, yearGap: s.yearGap,
        note: 'season score found, but on a page whose first-air year is far from ours — likely a later arc or a different show, do not apply',
      };
    }
    merged += 1;
    return {
      ...r,
      status: 'season-score',
      scoreLevel: 'season',
      seasonScore: s.seasonScore,
      seasonReviewCount: s.seasonReviewCount,
      seasonNumber: s.seasonNumber,
      seasonLabel: s.seasonLabel,
      seasonUrl: s.seasonUrl,
      totalSeasons: s.totalSeasons,
      note: 'RT has no series-level Tomatometer; this is the earliest scored season only',
    };
  }
  if (s.status === 'no-score-any-season') {
    stillNone += 1;
    return { ...r, seasonsChecked: s.totalSeasons, note: 'no critic score on the series page or any of its season pages' };
  }
  if (s.status === 'no-score-in-first-seasons') {
    /* Weaker claim than the one above, and kept distinct from it. */
    return {
      ...r, seasonsChecked: s.seasonsWalked, totalSeasons: s.totalSeasons,
      note: `no critic score on the series page or in the first ${s.seasonsWalked} of ${s.totalSeasons} seasons; later seasons not checked`,
    };
  }
  return r;
});

fs.writeFileSync(at('_rt-tv-scores.json'), JSON.stringify(out, null, 1));

const c = {};
for (const r of out) c[r.status] = (c[r.status] || 0) + 1;
const total = out.length;
const series = c['ok'] || 0;
const season = c['season-score'] || 0;

console.log(`${total} series in the catalogue\n`);
for (const [k, v] of Object.entries(c).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
}
console.log(`\nseries-level Tomatometer : ${series} (${(100 * series / total).toFixed(1)}%)`);
console.log(`+ season-level, labelled : ${season} (${(100 * season / total).toFixed(1)}%)`);
console.log(`= any critic score       : ${series + season} (${(100 * (series + season) / total).toFixed(1)}%)`);
console.log(`\nmerged ${merged} season scores; ${stillNone} confirmed to have no critic score anywhere`);
console.log(`${conflicts} previously-'ok' rows demoted to year-conflict (wrong show of the same name)`);
console.log(`${fixed} rows re-resolved to a better-matching RT page`);
/* A ready-to-apply subset for whoever applies centrally, with the two traps the
   pass itself falls into already removed:

   1. KEYED BY title+year, not title. data/shows.json holds two One Piece rows
      (1999, 2023) and two Doctor Who rows (1963, 2005). tools/rotten-tomatoes/rt_tv.mjs keys both its
      resolve cache and its --apply map by title alone, so one show's score is
      written to both rows and the 24-year gap on One Piece slips under its
      +/-25y guard. Anything whose title+year is not unique is excluded here.
   2. MEASURE IS NAMED. rtMeasure says whether the number is RT's per-season
      average ("Avg. Tomatometer" on the series page) or a single season's
      Tomatometer. These are different quantities and the plan does not pretend
      otherwise, so a consumer can take the series ones and leave the season ones,
      or keep them in separate columns. (The stored rt column does track the
      series number closely — a third of matches are identical — so this is a
      labelling precaution, not a claim that the column is measuring something
      else entirely.) */
const dupTitles = new Set();
const seenTitle = new Set();
for (const r of out) {
  if (seenTitle.has(r.title)) dupTitles.add(r.title);
  seenTitle.add(r.title);
}

const plan = [];
for (const r of out) {
  if (dupTitles.has(r.title)) continue;
  /* Soft-flagged rows are left out too. They agree on year but disagree on both
     season count and genre, which is the shape Utopia has — ours is the 2013
     2-season Channel 4 series, RT's /tv/utopia is a 2014 1-season show scored 29.
     No year tolerance separates those two, so they need a human, not a default. */
  if (r.yearVerdict === 'SUSPECT-DIFFERENT-SHOW') continue;
  if (r.status === 'ok' && r.score != null) {
    plan.push({
      title: r.title, year: r.ourYear, rt: r.score, rtReviews: r.reviewCount ?? null,
      rtUrl: r.url, rtMeasure: 'series-average', rtScoreTitle: 'Avg. Tomatometer',
      yearVerdict: r.yearVerdict ?? null, storedRt: r.ourRt ?? null,
    });
  } else if (r.status === 'season-score' && r.seasonScore != null) {
    plan.push({
      title: r.title, year: r.ourYear, rt: r.seasonScore, rtReviews: r.seasonReviewCount ?? null,
      rtUrl: r.seasonUrl, rtMeasure: 'single-season', rtScoreTitle: 'Tomatometer',
      rtSeason: r.seasonLabel ?? null, storedRt: r.ourRt ?? null,
    });
  }
}
fs.writeFileSync(at('_rt-tv-apply-plan.json'), JSON.stringify(plan, null, 1));

const excluded = out.filter((r) => dupTitles.has(r.title)).map((r) => `${r.title} (${r.ourYear})`);
console.log(`\napply plan: ${plan.length} rows, keyed by title+year`);
console.log(`  ${plan.filter((p) => p.rtMeasure === 'series-average').length} series-average, ${plan.filter((p) => p.rtMeasure === 'single-season').length} single-season`);
if (excluded.length) console.log(`  excluded ${excluded.length} rows with non-unique titles: ${excluded.join(', ')}`);

console.log('\nwrote _rt-tv-scores.json + _rt-tv-apply-plan.json (report only)');
