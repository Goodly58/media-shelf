/**
 * Rotten Tomatoes scores for the series catalogue.
 *
 *   node _rt_tv.mjs            fetch + report   (resumable)
 *   node _rt_tv.mjs --apply    write data/shows.json
 *   node _rt_tv.mjs --status   progress only
 *
 * The films pass never touched series — it only ever read data/movies.json — so
 * shows sat at 0% RT while films reached 99%. This closes that.
 *
 * WHAT IS DIFFERENT ABOUT TV, ALL FOUND BY LOOKING RATHER THAN ASSUMING
 * --------------------------------------------------------------------
 * 1. Search rows for TV use ENTIRELY DIFFERENT ATTRIBUTES from film rows:
 *      film:  release-year="1976"  tomatometer-score="94"   (hyphenated)
 *      tv:    startyear="2002" endyear="2008" tomatometerscore="94"
 *             ...and releaseyear="" is present but EMPTY
 *    Reusing the film selectors returns nothing at all, silently.
 * 2. Slugs use hyphens where films use underscores: The Wire is /tv/the-wire,
 *    not /tv/the_wire. Guessing the film convention 404s.
 * 3. A series spans years. The catalogue stores the first-air year, so the match
 *    accepts our year anywhere in [startyear, endyear], not just at startyear —
 *    otherwise every long-running show fails on its own later seasons.
 *
 * Same guards as the films pass, for the same reasons:
 *   - SLUG-BASED, not search-based. rottentomatoes.com/robots.txt disallows
 *     /search for every user-agent, so an automated pass must not go through it.
 *     The /tv/ pages themselves are allowed, and RT 301-redirects between its two
 *     slug conventions — /tv/the_wire lands on /tv/the-wire, /tv/breaking-bad
 *     lands on /tv/breaking_bad — so following redirects resolves most shows
 *     without a search at all.
 *   - confirm the page is the right SHOW before believing its score
 *   - throttles are retryable and never cached as an answer
 *   - report before writing
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(HERE, f);

const APPLY = process.argv.includes('--apply');
const STATUS = process.argv.includes('--status');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PACE = 1100;
/* SAMPLE=n runs only the first n series — for smoke-testing the resolver
   without committing to the full pass. */
const SAMPLE = Number(process.env.SAMPLE || 0);

const PAGES = at('_rt-tv-pages.json');
const SEARCH = at('_rt-tv-search.json');
const OUT = at('_rt-tv-scores.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);

const ENT = { amp: '&', quot: '"', apos: "'", lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', nbsp: ' ', hellip: '...', mdash: '-', ndash: '-' };
const decode = (s) => String(s == null ? '' : s)
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)));
const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const fold = (s) => deaccent(decode(s)).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Series titles carry a lot of parenthetical noise; strip it before comparing. */
const bare = (t) => decode(t)
  .replace(/\s*\((?:19|20)\d{2}\)\s*$/, '')
  .replace(/\s*:\s*(season|series)\s+\d+.*$/i, '')
  .trim();

function titleAgrees(ours, theirs) {
  const a = fold(bare(ours));
  const b = fold(bare(theirs));
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/* Both of RT's conventions plus punctuation variants. RT redirects between the
   hyphen and underscore forms, so either usually lands; the rest is punctuation
   ("O.J.: Made in America" needs oj_made_in_america, not o-j-...). */
function tvSlugs(title, year) {
  const base = bare(title);
  const clean = deaccent(decode(base)).toLowerCase()
    .replace(/['’´`.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = clean.split(' ').filter(Boolean);
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  push(words.join('_'));
  push(words.join('-'));
  // articles are sometimes dropped
  if (['the', 'a', 'an'].includes(words[0])) {
    push(words.slice(1).join('_'));
    push(words.slice(1).join('-'));
  }
  if (year) { push(`${words.join('_')}_${year}`); push(`${words.join('-')}_${year}`); }
  return out.slice(0, 6);
}

const RETRYABLE = (s) => s === 202 || s === 429 || s === 408 || (s >= 500 && s < 600);

async function grab(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (RETRYABLE(res.status)) return { retry: true, status: res.status };
    if (!res.ok) return { status: res.status };
    const html = await res.text();
    if (!html.length) return { retry: true, status: 'empty' };
    return { status: 200, html, url: res.url };
  } catch (e) {
    return { retry: true, status: String(e.name || e) };
  }
}

/* ---- parsing ------------------------------------------------------------- */

function jsonBlob(html, id) {
  const m = html.match(new RegExp('<script[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</script>'));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function parseShow(html) {
  const sc = jsonBlob(html, 'media-scorecard-json') || {};
  const hero = (jsonBlob(html, 'media-hero-json') || {}).content || {};
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .find((j) => j && (j['@type'] === 'TVSeries' || j['@type'] === 'TVSeason')) || {};

  /* ONLY the critics score, and only when real reviews back it.
     The JSON-LD aggregateRating looked like a tidy fallback and is a trap: Bluey's
     series page carries an empty scorecard ("Avg. Tomatometer", reviewCount 0)
     alongside aggregateRating 80, which is not the Tomatometer at all — taking it
     would have rewritten a 100 to an 80 from a different measure entirely. It is
     the same confusion as a community score standing in for a critic score.
     RT aggregates many series per season, so a series page with no overall
     Tomatometer is normal and the honest answer there is no score, not a number
     borrowed from elsewhere on the page. */
  const cs = sc.criticsScore || null;
  const reviews = cs && cs.reviewCount != null ? Number(cs.reviewCount) : 0;
  const score = cs && cs.score != null && reviews > 0 ? Number(cs.score) : null;

  // hero metadataProps looks like ["TV-MA","2019","1 Season"]
  const props = Array.isArray(hero.metadataProps) ? hero.metadataProps : [];
  const heroYear = props.map((p) => (String(p).match(/^((?:19|20)\d{2})$/) || [])[1]).filter(Boolean).map(Number)[0] ?? null;

  return {
    name: hero.title || ld.name || null,
    score: Number.isFinite(score) ? score : null,
    reviews,
    heroYear,
    ldName: ld.name || null,
  };
}

/* TV search rows use startyear/endyear/tomatometerscore — NOT the film pass's
   release-year/tomatometer-score. Same element, different attribute names. */
function parseSearchTv(html) {
  const rows = [];
  for (const m of html.matchAll(/<search-page-media-row[\s\S]*?<\/search-page-media-row>/g)) {
    const s = m[0];
    const href = (s.match(/href="(https:\/\/www\.rottentomatoes\.com\/tv\/[^"]+)"/) || [])[1];
    if (!href) continue;
    const start = (s.match(/startyear="(\d{4})"/) || [])[1];
    const end = (s.match(/endyear="(\d{4})"/) || [])[1];
    const score = (s.match(/tomatometerscore="(\d+)"/) || [])[1];
    const name = (s.match(/data-qa="info-name"[^>]*>([\s\S]*?)<\/a>/) || [])[1];
    rows.push({
      url: href.split('?')[0].replace(/\/s\d+$/, ''),
      start: start ? Number(start) : null,
      end: end ? Number(end) : null,
      searchScore: score ? Number(score) : null,
      name: name ? decode(name.replace(/<[^>]+>/g, '')).trim() : null,
    });
  }
  return rows;
}

/** Our year is the first-air year, so accept it anywhere in the run. */
function yearAgrees(ours, row) {
  if (ours == null) return true;
  const s = row.start, e = row.end || row.start;
  if (s == null) return true;
  return ours >= s - 1 && ours <= (e ?? s) + 1;
}

/* ---- caches -------------------------------------------------------------- */

const pages = readJson(PAGES, {});
const searches = readJson(SEARCH, {});
const flush = () => { fs.writeFileSync(PAGES, JSON.stringify(pages)); fs.writeFileSync(SEARCH, JSON.stringify(searches)); };

async function getPage(url) {
  if (pages[url] && !pages[url].retry) return pages[url];
  const r = await grab(url);
  await sleep(PACE);
  pages[url] = r.status === 200
    ? { ok: true, finalUrl: r.url, ...parseShow(r.html) }
    : { ok: false, status: r.status, retry: !!r.retry };
  return pages[url];
}

/** Try each slug until a page comes back that is actually about this show. */
async function resolve(show) {
  const key = show.title;
  if (searches[key] && !searches[key].retry) return searches[key];
  for (const slug of tvSlugs(show.title, show.year)) {
    const url = `https://www.rottentomatoes.com/tv/${slug}`;
    const page = await getPage(url);
    if (page.retry) { searches[key] = { retry: true }; return searches[key]; }
    if (!page.ok || !page.name) continue;
    if (!titleAgrees(show.title, page.name)) continue;   // right URL shape, wrong show
    searches[key] = { url: page.finalUrl || url, page };
    return searches[key];
  }
  searches[key] = { none: true };
  return searches[key];
}

/* ---- main ---------------------------------------------------------------- */

const raw = JSON.parse(fs.readFileSync(at('data/shows.json'), 'utf8'));
const shows = Array.isArray(raw) ? raw : raw.shows;

if (STATUS) {
  const done = shows.filter((s) => searches[s.title] && !searches[s.title].retry).length;
  console.log(`${done}/${shows.length} searched`);
  process.exit(0);
}

const targets = SAMPLE ? shows.slice(0, SAMPLE) : shows;
console.log(`${targets.length} series — searching RT (~${Math.round(targets.length * PACE * 2 / 60000)} min)
`);

const out = [];
let ok = 0, noMatch = 0, noScore = 0, n = 0;

for (const s of targets) {
  const hit = await resolve(s);

  if (!hit || hit.none || hit.retry) {
    noMatch += 1;
    out.push({ title: s.title, ourYear: s.year, status: 'not-found' });
  } else {
    const page = hit.page;
    /* The page's own year is whatever it last aired, so it is a weak signal — but
       a gross disagreement still means we landed on the wrong show. */
    const yearOk = s.year == null || page.heroYear == null || Math.abs(s.year - page.heroYear) <= 25;
    if (!yearOk) {
      noMatch += 1;
      out.push({ title: s.title, ourYear: s.year, rtYear: page.heroYear, url: hit.url, status: 'year-mismatch' });
    } else if (page.score == null) {
      /* No series-level Tomatometer. Normal for documentaries and older shows,
         which RT scores per season. Reported, never guessed at. */
      noScore += 1;
      out.push({ title: s.title, ourYear: s.year, url: hit.url, pageName: page.name, status: 'unscored' });
    } else {
      ok += 1;
      out.push({
        title: s.title, ourYear: s.year, rtYear: page.heroYear,
        score: page.score, reviewCount: page.reviews,
        url: hit.url, pageName: page.name, ourRt: s.rt ?? null,
        status: 'ok',
      });
    }
  }

  n += 1;
  if (n % 20 === 0) { flush(); process.stdout.write(`  ${n}/${targets.length} — ${ok} scored, ${noMatch} not found\r`); }
}
flush();
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

console.log(`\n\n${ok} of ${targets.length} series matched on title AND year`);
console.log(`${noMatch} not found, ${noScore} found but unscored\n`);

const moves = out.filter((r) => r.status === 'ok' && r.ourRt != null && r.ourRt !== r.score);
console.log(`${moves.length} differ from the stored value:`);
for (const m of moves.sort((a, b) => Math.abs(b.ourRt - b.score) - Math.abs(a.ourRt - a.score)).slice(0, 12)) {
  console.log(`  ${String(m.ourRt).padStart(3)} -> ${String(m.score).padStart(3)}  ${m.title} (${m.ourYear})`);
}

if (!APPLY) { console.log(`\nwrote ${OUT}\n(report only — pass --apply to write data/shows.json)`); process.exit(0); }

const byTitle = new Map(out.filter((r) => r.status === 'ok').map((r) => [r.title, r]));
let applied = 0;
for (const s of shows) {
  const r = byTitle.get(s.title);
  if (!r) continue;
  s.rt = r.score;
  s.rtVerified = true;
  if (r.reviewCount) s.rtReviews = r.reviewCount;
  s.rtUrl = r.url;
  applied += 1;
}
fs.writeFileSync(at('data/shows.json'), JSON.stringify(Array.isArray(raw) ? shows : { ...raw, shows }));
console.log(`\napplied to ${applied} series — wrote data/shows.json`);
console.log('now: node build-pages.js && node build-stats.js && node build-backlog-index.js && node build-similar.js && node build-version.js && node validate.js');
