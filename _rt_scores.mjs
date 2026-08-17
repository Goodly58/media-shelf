/**
 * Rotten Tomatoes critics score for every film, matched on TITLE **AND YEAR**.
 *
 * Why the year is not optional: /m/carrie is the 2013 remake. An earlier pass
 * captured criticsScore but not releaseYear, so its title guard passed on every
 * remake and it produced Carrie 92->51, RoboCop 88->50, Suspiria 94->65,
 * Pinocchio 97->0 — four different films. A page only answers for a film if the
 * NAME matches and the YEAR is within 1.
 *
 * Report-only by design: this writes _rt-scores.json and never touches
 * data/movies.json.
 *
 *   node _rt_scores.mjs            # resume the fetch, then write the report
 *   node _rt_scores.mjs --report   # re-derive the report from cache, no fetch
 *   SAMPLE=40 node _rt_scores.mjs  # first 40 films only (probe run)
 *
 * Two caches, both keyed by the thing actually fetched so a re-run resumes:
 *   _rt-pages.json   url   -> parsed page (or a permanent 404)
 *   _rt-search.json  query -> search rows
 * Throttling (202/429/5xx/timeout) is never cached. A cached failure that was
 * really a rate limit caps coverage at a number the bug chose, not the truth.
 */
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGES = '_rt-pages.json';
const SEARCH = '_rt-search.json';
const OUT = '_rt-scores.json';
const PACE = 1100;                       // ~1 request/second, one host
const REPORT_ONLY = process.argv.includes('--report');
const SAMPLE = Number(process.env.SAMPLE || 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const load = (f, k) => { const r = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(r) ? r : r[k] || []; };

/* ---- title handling ------------------------------------------------------ */

/** Rule 4: decode entities BEFORE folding. "Preludes &amp; Nocturnes" folded raw
 *  yields the token "amp" and stops matching itself. */
const ENT = { amp: '&', quot: '"', apos: "'", lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', nbsp: ' ', hellip: '...', mdash: '-', ndash: '-', eacute: 'é', egrave: 'è', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', agrave: 'à', iacute: 'í', oacute: 'ó', aacute: 'á', ntilde: 'ñ', uacute: 'ú', lt: '<', gt: '>' };
const decode = (s) => String(s == null ? '' : s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => (n.toLowerCase() in ENT ? ENT[n.toLowerCase()] : m));

const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Fold to bare alphanumerics for comparison. Ampersands become "and" so
 *  "Sex, Lies & Videotape" and "Sex, Lies, and Videotape" agree. */
const fold = (s) => deaccent(decode(s)).toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[‘’']/g, '')
  .replace(/[^a-z0-9]+/g, '');

/** RT slugs: lowercase, ascii, apostrophes dropped, everything else "_". */
const slugify = (s) => deaccent(decode(s)).toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[‘’'.]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

/** RT decorates names with the year and with long parentheticals:
 *  "Suspiria (2018)", "Summer of Soul (...Or, When the Revolution...)". */
const bareName = (t) => decode(t)
  .replace(/\s*\((?:19|20)\d{2}\)\s*$/, '')
  .replace(/\s*\([^)]*\)\s*$/, '')
  .trim();

/** Titles agree if they fold the same, or one is the other plus a subtitle
 *  ("Alien" vs "Alien: Director's Cut"). Never a bare substring test — that
 *  would let "Carrie" match "Carrie Pilby". */
function titleAgrees(ours, theirs) {
  const a = fold(ours), b = fold(theirs);
  if (!a || !b) return false;
  if (a === b) return true;
  const na = fold(bareName(ours)), nb = fold(bareName(theirs));
  if (na && na === nb) return true;
  const strip = (t) => fold(String(bareName(t)).split(/[:–—]| - /)[0]);
  const sa = strip(ours), sb = strip(theirs);
  if (sa && sa === sb && sa.length >= 4) return true;
  const dropArticle = (t) => t.replace(/^(the|a|an|le|la|les|el|il)/, '');
  return dropArticle(na) === dropArticle(nb) && dropArticle(na).length >= 4;
}

const yearAgrees = (ours, theirs) => ours != null && theirs != null && Math.abs(Number(ours) - Number(theirs)) <= 1;

/* ---- fetching ------------------------------------------------------------ */

/** Rule 5: separate "the site said no" from "the site did not answer".
 *  404 is an answer and is cached. 202/429/5xx/timeouts are not answers. */
const RETRYABLE = (s) => s === 202 || s === 429 || s === 408 || (s >= 500 && s < 600);

async function grab(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const html = await res.text();
        // A 200 with no body is a throttle wearing a success code.
        if (!html || html.length < 2000) { await sleep(4000 * (attempt + 1)); continue; }
        return { ok: true, html, finalUrl: res.url };
      }
      if (!RETRYABLE(res.status)) return { ok: false, status: res.status, permanent: true };
      await sleep(4000 * (attempt + 1));
    } catch (e) {
      await sleep(4000 * (attempt + 1));
    }
  }
  return { ok: false, status: 'throttled', permanent: false };
}

/* ---- page parsing -------------------------------------------------------- */

function jsonBlobs(h) {
  const o = {};
  for (const m of h.matchAll(/<script[^>]*id="([^"]+)"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { o[m[1]] = JSON.parse(m[2]); } catch { /* leave absent */ }
  }
  return o;
}

const YEAR_OK = (y) => Number(y) >= 1870 && Number(y) <= 2035;
const yr = (v) => { const m = String(v == null ? '' : v).match(/(\d{4})/); return m && YEAR_OK(m[1]) ? Number(m[1]) : null; };

/**
 * NOTE ON THE YEAR — no single field on the page is the release year.
 *   "releaseDate"/ld dateCreated is whatever RT last put in cinemas:
 *      /m/the_godfather -> 2022 (50th anniversary), /m/vertigo -> 1984,
 *      /m/psycho -> 2003, /m/grand_illusion -> 2012 (restoration).
 *   w2w releaseYear is right for those four, and wrong for a film in
 *      re-release right now: /m/pans_labyrinth -> 2026.
 *   heroProps carries the original year, except while a re-release is on,
 *      when it carries "In Theaters Oct 9" and no year at all.
 * So every candidate is collected and the film matches if ANY of them lands on
 * our year. That stays safe against remakes because a remake's page never cites
 * the original's year — /m/carrie says 2013 six ways and never 1976 — and
 * re-release years are always later than the original, so they cannot collide
 * with an older film's year.
 *
 * Everything a year or title could be derived from is stored, so changing this
 * ranking later is a re-parse of the cache, never a re-fetch of the site.
 */
function parseFilm(html) {
  const b = jsonBlobs(html);
  const hero = (b['media-hero-json'] || {}).content || {};
  const w2w = b['where-to-watch-json'] || {};
  const cs = (b['media-scorecard-json'] || {}).criticsScore || null;
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .find((j) => j && (j['@type'] === 'Movie' || j['@type'] === 'TVSeries')) || {};

  const titleTag = ((html.match(/<title>([^<]{0,200})</) || [])[1] || '')
    .replace(/\s*[|-]\s*Rotten Tomatoes.*$/i, '').trim();

  const ldDir = ld.director ? (Array.isArray(ld.director) ? ld.director : [ld.director]).map((d) => (d && d.name) || d).filter(Boolean) : [];
  const src = {
    ldDate: ld.dateCreated || null,
    ldName: ld.name || null,
    ldScore: ld.aggregateRating && ld.aggregateRating.ratingValue != null ? Number(ld.aggregateRating.ratingValue) : null,
    heroTitle: hero.title || null,
    heroProps: Array.isArray(hero.metadataProps) ? hero.metadataProps : null,
    w2wYear: w2w.releaseYear || null,
    w2wTitle: w2w.title || null,
    titleTag: titleTag || null,
  };
  const directors = [...new Set([...(w2w.director ? [w2w.director] : []), ...ldDir].map((d) => String(d).trim()).filter(Boolean))];

  const name = src.heroTitle || src.ldName || src.w2wTitle
    || (titleTag ? titleTag.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '') : null);

  const heroYear = src.heroProps
    ? src.heroProps.map((p) => (String(p).match(/^(\d{4})$/) || [])[1]).map(yr).find((y) => y != null) ?? null
    : null;
  const years = [...new Set([
    heroYear,
    yr(src.w2wYear),
    yr(src.ldDate),
    yr((html.match(/"releaseYear":\s*"?(\d{4})/) || [])[1]),
    yr((String(src.ldName || '').match(/\((\d{4})\)\s*$/) || [])[1]),
    yr((titleTag.match(/\((\d{4})\)\s*$/) || [])[1]),
  ].filter((y) => y != null))];

  const score = cs && cs.score != null && cs.score !== '' ? Number(cs.score) : null;
  const reviewCount = cs && cs.reviewCount != null ? Number(cs.reviewCount) : null;
  return { name, year: years[0] ?? null, years, directors, score, reviewCount, hasScorecard: !!cs, src };
}

/**
 * The third guard, and the only one that separates two different films sharing
 * a title AND a year: 2022 has both Zemeckis's Pinocchio (27) and del Toro's
 * (96), so title+year alone wrote 97 -> 27. Compared only when both sides name
 * someone; an unknown director never rejects a match, it just cannot rescue one.
 */
function directorCheck(ours, theirs) {
  if (!ours || !theirs || !theirs.length) return 'unknown';
  const split = (s) => String(s).replace(/["“”']/g, ' ').split(/,|\band\b|&|\//).map((x) => x.trim()).filter(Boolean);
  const tokens = (n) => deaccent(decode(n)).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const lastOf = (n) => { const p = tokens(n); return p[p.length - 1] || ''; };
  for (const a of split(ours)) {
    for (const b of theirs.flatMap(split)) {
      if (fold(a) === fold(b)) return 'match';
      if (lastOf(a) && lastOf(a) === lastOf(b)) return 'match';
      // A shared distinctive token catches "Questlove" vs
      // "Ahmir 'Questlove' Thompson", where no surname lines up.
      const ta = tokens(a), tb = tokens(b);
      if (ta.some((t) => t.length >= 5 && tb.includes(t))) return 'match';
    }
  }
  return 'mismatch';
}

function parseSearch(html) {
  const rows = [];
  for (const m of html.matchAll(/<search-page-media-row[\s\S]*?<\/search-page-media-row>/g)) {
    const s = m[0];
    const href = (s.match(/href="(https:\/\/www\.rottentomatoes\.com\/m\/[^"]+)"/) || [])[1];
    if (!href) continue;                                   // /tv/ rows and people
    const year = (s.match(/release-year="(\d{4})"/) || [])[1];
    const score = (s.match(/tomatometer-score="(\d+)"/) || [])[1];
    const name = (s.match(/data-qa="info-name"[^>]*>([\s\S]*?)<\/a>/) || [])[1];
    rows.push({
      url: href.split('?')[0],
      year: year ? Number(year) : null,
      searchScore: score ? Number(score) : null,
      name: name ? decode(name.replace(/<[^>]+>/g, '')).trim() : null,
    });
  }
  return rows;
}

/* ---- caches -------------------------------------------------------------- */

const pages = readJson(PAGES, {});
const searches = readJson(SEARCH, {});
let dirty = 0;
const flush = (force) => {
  if (!dirty && !force) return;
  fs.writeFileSync(PAGES, JSON.stringify(pages));
  fs.writeFileSync(SEARCH, JSON.stringify(searches));
  dirty = 0;
};

let requests = 0;
async function getPage(url) {
  if (url in pages) return pages[url];
  if (REPORT_ONLY) return null;
  requests += 1;
  const r = await grab(url);
  await sleep(PACE);
  if (!r.ok) {
    if (!r.permanent) return null;                        // never cache a throttle
    pages[url] = { ok: false, status: r.status };
  } else {
    pages[url] = { ok: true, ...parseFilm(r.html), url: r.finalUrl };
  }
  dirty += 1;
  if (dirty >= 10) flush();
  return pages[url];
}

async function getSearch(q) {
  if (q in searches) return searches[q];
  if (REPORT_ONLY) return null;
  requests += 1;
  const r = await grab(`https://www.rottentomatoes.com/search?search=${encodeURIComponent(q)}`);
  await sleep(PACE);
  if (!r.ok) return null;                                  // no negative caching
  const rows = parseSearch(r.html);
  /* A search for a catalogued film almost never legitimately returns nothing,
     so zero rows is more likely a soft block than an answer. Returning it
     without caching keeps the next run free to ask again. */
  if (!rows.length) return rows;
  searches[q] = rows;
  dirty += 1;
  if (dirty >= 10) flush();
  return searches[q];
}

/* ---- resolution ---------------------------------------------------------- */

/**
 * A page answers for a film only if it exists, names the film, cites our year
 * among its release years, and carries a critics block somebody reviewed.
 *
 * hintYear is RT's own release-year for this exact URL, taken from its search
 * row. It is the most trustworthy year available — it was right for Seven
 * Samurai (1954) where the page itself only ever says 1956 — so it joins the
 * page's own candidates rather than merely filling a gap.
 */
function verdict(page, film, hintYear, loose) {
  if (!page || !page.ok) return 'missing';
  const named = titleAgrees(film.title, page.name || '')
    || (loose && fold(page.name || '').includes(fold(film.title)) && fold(film.title).length >= 5);
  if (!named) return 'wrong-title';
  const cands = candidateYears(page, hintYear);
  if (!cands.length) return 'no-year';
  if (!cands.some((y) => yearAgrees(film.year, y))) return 'wrong-year';
  if (!page.hasScorecard) return 'no-scorecard';
  if (!page.reviewCount || page.score == null) return 'unreviewed';
  return 'ok';
}

const candidateYears = (page, hintYear) => [...new Set([
  ...(hintYear != null ? [Number(hintYear)] : []),
  ...(page.years || (page.year != null ? [page.year] : [])),
])];

/** The year to report: RT's search-row year if we have it, else the candidate
 *  that actually matched, else the page's first candidate. */
const reportYear = (page, film, hintYear) => {
  if (hintYear != null) return Number(hintYear);
  const c = candidateYears(page, hintYear);
  return c.find((y) => yearAgrees(film.year, y)) ?? c[0] ?? null;
};

/**
 * Search first. RT's search row is the only place that reliably states which
 * /m/ page is which film and what year it is, and it costs one request. The
 * slug guesses are the fallback for titles search cannot find (mostly foreign
 * titles filed under a different name).
 */
async function resolve(film) {
  const tried = [];
  let fallback = null;   // best page that failed the title+year test
  const rank = { unreviewed: 1, 'wrong-year': 2, 'no-year': 3 };

  /** Fetch a candidate and grade it on title+year. The director is recorded, not
   *  enforced: it decides between rivals, and a lone match is never thrown away
   *  over a name spelt differently. */
  const consider = async (url, hintYear, loose) => {
    const page = await getPage(url);
    const v = verdict(page, film, hintYear, loose);
    const dir = v === 'ok' ? directorCheck(film.creator, page.directors) : null;
    tried.push({ url, v, dir, name: page && page.name, years: page && page.years, directors: page && page.directors });
    if (v === 'ok') return { status: 'ok', page, url, rtYear: reportYear(page, film, hintYear), dir };
    if (page && page.ok && rank[v] && (!fallback || rank[v] < rank[fallback.v])) {
      const keep = v === 'unreviewed';
      fallback = {
        v, status: v, page: keep ? page : null, url: keep ? url : null,
        rtYear: keep ? reportYear(page, film, hintYear) : (page.years || [])[0] ?? null,
        rtDirectors: page.directors || [],
      };
    }
    return null;
  };

  const rows = (await getSearch(film.title)) || [];
  const seen = new Set();
  const tierA = [], tierB = [];
  for (const r of rows) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    if (!yearAgrees(film.year, r.year)) continue;
    if (titleAgrees(film.title, r.name || '')) tierA.push(r);
    // Tier B: right year, and our title is contained in theirs. RT files del
    // Toro's Pinocchio as "Guillermo del Toro's Pinocchio", which no title rule
    // should fold onto "Pinocchio" — but with the year and the director both
    // agreeing it is unmistakably the film.
    else if (fold(r.name || '').includes(fold(film.title)) && fold(film.title).length >= 5) tierB.push(r);
  }

  const cands = [...tierA.map((r) => ({ r, loose: false })), ...tierB.map((r) => ({ r, loose: true }))];
  const confirmed = [];
  for (const { r, loose } of cands.slice(0, 5)) {
    const hit = await consider(r.url, r.year, loose);
    if (hit) {
      confirmed.push(hit);
      // Sole candidate in this year: nothing to disambiguate against.
      if (cands.length === 1) return { ...hit, tried };
      // A tier-A page whose director also matches is already decisive; no need
      // to spend requests on the rest.
      if (!loose && hit.dir === 'match') return { ...hit, tried };
    }
  }

  if (confirmed.length === 1) return { ...confirmed[0], tried };
  if (confirmed.length > 1) {
    // Several pages pass title+year. Identical scores mean the same film filed
    // twice; different scores mean different films, and only the director can
    // say which is ours.
    const distinct = [...new Set(confirmed.map((c) => c.page.score))];
    if (distinct.length === 1) return { ...confirmed[0], tried };
    const byDir = confirmed.filter((c) => c.dir === 'match');
    if (byDir.length === 1) return { ...byDir[0], tried };
    return {
      status: 'ambiguous', page: null, url: null, rtYear: film.year, tried,
      alts: confirmed.map((c) => ({ url: c.url, score: c.page.score, reviewCount: c.page.reviewCount, directors: c.page.directors, dir: c.dir })),
    };
  }

  // Search knew nothing usable. Guess the slug; year form first, since a year
  // form can never be the remake.
  const s = slugify(film.title);
  for (const url of [`https://www.rottentomatoes.com/m/${s}_${film.year}`, `https://www.rottentomatoes.com/m/${s}`]) {
    if (seen.has(url)) continue;
    const hit = await consider(url);
    if (hit) return { ...hit, tried };
  }

  if (fallback) return { ...fallback, tried };
  const named = rows.filter((r) => titleAgrees(film.title, r.name || ''));
  if (named.length) return { status: 'year-mismatch', page: null, url: null, rtYear: named[0].year, tried, rows: named.slice(0, 4) };
  return { status: rows.length ? 'not-found' : 'unresolved', page: null, url: null, rtYear: null, tried };
}

/* ---- phase 2: rescue by year + director ---------------------------------- */

/**
 * Films the title rule cannot reach, because RT files them under another name:
 * Gojira as "Godzilla", Se7en as "Seven", Twelve Monkeys as "12 Monkeys",
 * Le Cercle Rouge as "The Red Circle", Joyeux Noel as "Merry Christmas". Four
 * more are unreachable because OUR title is corrupted with editorial prose —
 * "Fury Road's ancestor: Mad Max", "Cabaret-era classic Top Hat".
 *
 * So the title is dropped as a requirement here and the pair YEAR + DIRECTOR is
 * required instead. That pair is what makes it safe: it is exactly the guard the
 * remakes defeated a title-only check with, and "Mad Max, 1979, George Miller"
 * identifies one film in the world. A rescue still refuses anything whose year
 * is off by more than 1 or whose director does not match, and every rescue is
 * labelled matchedVia:"year+director" so it can be audited separately.
 */
const EXTRA_QUERIES = {
  // RT spells the Camorra film the Italian way, sharing no token with ours.
  Gomorrah: ['Gomorra'],
  // Title corrupted in the catalogue; the film is Frant Gwo's The Wandering Earth.
  'Arrival of a Wandering Earth': ['The Wandering Earth'],
};

async function rescue(film) {
  const queries = [film.title, ...(EXTRA_QUERIES[film.title] || [])];
  const rows = [];
  for (const q of queries) for (const r of (await getSearch(q)) || []) rows.push(r);

  const seen = new Set();
  const cands = rows.filter((r) => {
    if (seen.has(r.url) || !yearAgrees(film.year, r.year)) return false;
    seen.add(r.url);
    return true;
  });

  const passed = [];
  for (const r of cands.slice(0, 5)) {
    const page = await getPage(r.url);
    if (!page || !page.ok || !page.hasScorecard || !page.reviewCount || page.score == null) continue;
    if (!candidateYears(page, r.year).some((y) => yearAgrees(film.year, y))) continue;
    if (directorCheck(film.creator, page.directors) !== 'match') continue;
    passed.push({ page, url: r.url, rtYear: r.year });
  }
  if (!passed.length) return null;
  const distinct = [...new Set(passed.map((p) => p.page.score))];
  if (passed.length > 1 && distinct.length > 1) {
    return { status: 'ambiguous', page: null, url: null, rtYear: film.year, matchedVia: 'year+director',
      alts: passed.map((p) => ({ url: p.url, score: p.page.score, reviewCount: p.page.reviewCount, directors: p.page.directors })) };
  }
  const p = passed[0];
  return { status: 'ok', page: p.page, url: p.url, rtYear: p.rtYear, dir: 'match', matchedVia: 'year+director', rtName: p.page.name };
}

/* ---- run ----------------------------------------------------------------- */

let films = load('data/movies.json', 'movies');
if (process.env.ONLY) {
  const want = process.env.ONLY.split('|').map(fold);
  films = films.filter((f) => want.includes(fold(f.title)));
}
if (SAMPLE) films = films.slice(0, SAMPLE);
console.log(`${films.length} films; ${Object.keys(pages).length} pages cached, ${Object.keys(searches).length} searches cached`);

const results = [];
let n = 0;
for (const film of films) {
  results.push({ film, r: await resolve(film) });
  n += 1;
  if (n % 20 === 0) { flush(); process.stdout.write(`  ${n}/${films.length}  ok=${results.filter((x) => x.r.status === 'ok').length}  req=${requests}\r`); }
}
flush(true);
console.log(`\nphase 1 (title + year): ${results.filter((x) => x.r.status === 'ok').length} of ${films.length}`);

let rescued = 0;
for (const rec of results) {
  if (rec.r.status === 'ok') continue;
  const got = await rescue(rec.film);
  if (got) { rec.r = { ...got, tried: rec.r.tried }; if (got.status === 'ok') rescued += 1; }
}
flush(true);
console.log(`phase 2 (year + director, alternate names): +${rescued}`);

const out = results.map(({ film, r }) => {
  const p = r.page;
  return {
    title: film.title,
    ourYear: film.year,
    rtYear: r.rtYear ?? (p ? p.year : null) ?? null,
    score: r.status === 'ok' && p ? p.score : null,
    reviewCount: p ? p.reviewCount : null,
    url: r.url || null,
    status: r.status,
    matchedVia: r.matchedVia || (r.status === 'ok' ? 'title+year' : null),
    rtName: r.rtName || (p ? p.name : null),
    ourRt: film.rt == null ? null : film.rt,
    ourCreator: film.creator || null,
    rtDirectors: (p && p.directors) || r.rtDirectors || null,
    dirCheck: r.dir || null,
    // Independent corroboration: RT's JSON-LD aggregateRating for the same page.
    ldScore: r.status === 'ok' && p && p.src ? p.src.ldScore : null,
    alts: r.alts || null,
  };
});

const tally = {};
out.forEach((o) => { tally[o.status] = (tally[o.status] || 0) + 1; });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const ok = out.filter((o) => o.status === 'ok');
console.log(`\nconfirmed on title AND year: ${ok.length} of ${films.length}`);
console.log('breakdown:', JSON.stringify(tally));
console.log(`wrote ${OUT} (${requests} requests this run)`);
