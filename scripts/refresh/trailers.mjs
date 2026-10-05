/* Trailers for films and series: one YouTube video per title, for the reels view.

   Sources, best first:
   - TMDB, only when TMDB_API_KEY is set: official trailers for nearly every title.
   - KinoCheck (api.kinocheck.com, free, 1,000 requests a day): official trailers,
     strongest for recent films and for series.
   - Wikidata (property P1651): YouTube ids recorded on a title's item, used only when
     the statement is marked as a trailer or teaser. Unmarked ids are nearly always
     YouTube's paid listing of the whole film (titled just "The Godfather"), not a trailer.

   Every id is checked with YouTube's oEmbed endpoint, which answers only for public,
   embeddable videos, so a removed or locked trailer is dropped. Official trailers are
   used before their check comes back (the page skips any that fail to play); Wikidata
   ids wait for it. Each source keeps its own cache; pickTrailer() makes the choice. */
import { get, log, loadCache, saveCache } from './lib.mjs';

const SPARQL = 'https://query.wikidata.org/sparql';
const TRAILER_ROLE = /trailer|teaser/i;
const YT_ID = /^[\w-]{11}$/;
const DAY = 864e5;

/* ----------------------------------------------------------- the choice */

/** A title's Wikidata trailers (statements marked as one), English first. */
function rankWikidata(c) {
  return (c || []).filter((x) => TRAILER_ROLE.test(x[1] || '')).sort((a, b) => (b[2] === 'English') - (a[2] === 'English'));
}

/**
 * The trailer for one title from the caches, or null when the sources say there is none.
 * Returns undefined when no source has looked at the title yet.
 */
export function pickTrailer(id, { tmdb = {}, kino = {}, wd = {}, check = {} }) {
  const known = tmdb[id] || kino[id] || wd[id];
  if (!known) return undefined;
  const dead = (yt) => check[yt] && check[yt].ok === false;
  for (const src of [tmdb[id], kino[id]]) if (src && src.yt && !dead(src.yt)) return src.yt;
  // Wikidata's ids wait for YouTube to confirm they still play.
  for (const [yt] of rankWikidata(wd[id] && wd[id].c)) if (check[yt] && check[yt].ok) return yt;
  return null;
}

/** The pick for every title, from the current caches. */
export function loadTrailers() {
  const caches = { tmdb: loadCache('tmdb-videos'), kino: loadCache('kinocheck'), wd: loadCache('wikidata-yt'), check: loadCache('yt-check') };
  return (id) => pickTrailer(id, caches);
}

/* --------------------------------------------------------------- Wikidata */

async function wikidataIds(titles, { maxAgeDays = 60, batch = 300 } = {}) {
  const cache = loadCache('wikidata-yt');
  const stale = Date.now() - maxAgeDays * DAY;
  const todo = titles.filter((t) => !cache[t.id] || cache[t.id].at < stale).map((t) => t.id);
  log(`trailers: wikidata for ${todo.length} of ${titles.length}`);
  for (let i = 0; i < todo.length; i += batch) {
    const chunk = todo.slice(i, i + batch);
    const q = `SELECT ?imdb ?yt ?role ?lang WHERE {
  VALUES ?imdb { ${chunk.map((x) => `"${x}"`).join(' ')} }
  ?item wdt:P345 ?imdb ; p:P1651 ?st .
  ?st ps:P1651 ?yt .
  OPTIONAL { ?st pq:P3831 ?r . ?r rdfs:label ?role . FILTER(LANG(?role) = "en") }
  OPTIONAL { ?st pq:P407 ?l . ?l rdfs:label ?lang . FILTER(LANG(?lang) = "en") }
}`;
    let json;
    try {
      json = await get(SPARQL, {
        method: 'POST', paceMs: 1500, timeout: 90000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
        body: new URLSearchParams({ query: q }).toString(),
      });
    } catch (e) { log(`trailers: wikidata batch failed: ${e.message}`); continue; }
    const found = {};
    for (const b of json.results.bindings) {
      const yt = b.yt.value;
      if (!YT_ID.test(yt)) continue;
      (found[b.imdb.value] ||= []).push([yt, b.role ? b.role.value : '', b.lang ? b.lang.value : '']);
    }
    for (const id of chunk) cache[id] = { c: found[id] || [], at: Date.now() };
  }
  saveCache('wikidata-yt', cache);
  return cache;
}

/* -------------------------------------------------------------- KinoCheck */

/** The best trailer in a KinoCheck answer: its own pick, then any trailer, then a teaser. */
export function kinoPick(j) {
  if (!j || j.error) return null;
  const vids = (j.trailer ? [j.trailer] : []).concat(j.videos || []);
  const is = (v, re) => (v.categories || []).some((c) => re.test(c));
  const v = (j.trailer && j.trailer.youtube_video_id ? j.trailer : null) || vids.find((x) => is(x, /trailer/i)) || vids.find((x) => is(x, /teaser/i));
  return v && YT_ID.test(v.youtube_video_id || '') ? v.youtube_video_id : null;
}

async function kinocheck(titles, has, { limit = 950, deadline } = {}) {
  const cache = loadCache('kinocheck');
  const now = Date.now(), year = new Date().getFullYear();
  // Titles with nothing to show come first, recent and popular before old and obscure (its
  // catalogue is thin before about 2005); then misses worth asking again, then old finds.
  // A new release with no trailer yet is asked again after three weeks, anything else after two months.
  const due = (t) => {
    const c = cache[t.id];
    if (!c) return true;
    return c.none ? c.at < now - (t.year >= year - 1 ? 21 : 60) * DAY : c.at < now - 180 * DAY;
  };
  const order = titles.filter(due).sort((a, b) =>
    (has(a.id) - has(b.id)) || (Boolean(cache[a.id]) - Boolean(cache[b.id])) ||
    ((b.year >= 2005) - (a.year >= 2005)) || (b.votes - a.votes));
  let n = 0, found = 0;
  for (const t of order) {
    if (n >= limit || Date.now() > deadline) break;
    const url = `https://api.kinocheck.com/${t.kind === 'shows' ? 'shows' : 'movies'}?imdb_id=${t.id}&language=en`;
    let j;
    try { j = await get(url, { paceMs: 1100 }); } catch (e) { log(`trailers: kinocheck ${t.id}: ${e.message}`); continue; }
    n++;
    const yt = kinoPick(j);
    cache[t.id] = yt ? { yt, at: Date.now() } : { none: true, at: Date.now() };
    if (yt) found++;
    if (n % 100 === 0) saveCache('kinocheck', cache);
  }
  saveCache('kinocheck', cache);
  log(`trailers: kinocheck asked about ${n} titles, ${found} with a trailer`);
  return cache;
}

/* ------------------------------------------------------------------- TMDB */

/** The best video in a TMDB /videos answer: an official trailer, any trailer, then a teaser. */
export function tmdbPick(j) {
  const yt = ((j && j.results) || []).filter((v) => v.site === 'YouTube' && YT_ID.test(v.key || ''));
  const rank = (v) => (v.type === 'Trailer' ? 2 : v.type === 'Teaser' ? 1 : 0) * 2 + (v.official ? 1 : 0);
  const best = yt.filter((v) => rank(v) >= 2).sort((a, b) => rank(b) - rank(a) || String(b.published_at).localeCompare(String(a.published_at)))[0];
  return best ? best.key : null;
}

async function tmdb(titles, has, key, { deadline } = {}) {
  const cache = loadCache('tmdb-videos');
  const stale = Date.now() - 120 * DAY;
  const order = titles.filter((t) => !cache[t.id] || cache[t.id].at < stale).sort((a, b) => (has(a.id) - has(b.id)) || (b.votes - a.votes));
  const api = (path) => `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`;
  let n = 0, found = 0, errors = 0;
  for (const t of order) {
    if (Date.now() > deadline) break;
    // A bad key fails every request: stop rather than run through the whole catalogue.
    if (errors >= 20) { log('trailers: tmdb keeps failing; stopping'); break; }
    try {
      const f = await get(api(`/find/${t.id}?external_source=imdb_id`), { paceMs: 120 });
      const hit = f && (t.kind === 'shows' ? f.tv_results : f.movie_results)?.[0];
      const v = hit ? await get(api(`/${t.kind === 'shows' ? 'tv' : 'movie'}/${hit.id}/videos?language=en-US`), { paceMs: 120 }) : null;
      const yt = tmdbPick(v);
      cache[t.id] = yt ? { yt, at: Date.now() } : { none: true, at: Date.now() };
      n++; errors = 0; if (yt) found++;
    } catch (e) { errors++; log(`trailers: tmdb ${t.id}: ${e.message}`); }
    if (n % 200 === 0) saveCache('tmdb-videos', cache);
  }
  saveCache('tmdb-videos', cache);
  log(`trailers: tmdb asked about ${n} titles, ${found} with a trailer`);
  return cache;
}

/* ------------------------------------------------------------- YouTube */

/** Ask YouTube about each candidate video once (again after 120 days), most popular titles first. */
async function verify(titles, { deadline } = {}) {
  const check = loadCache('yt-check');
  const [kino, tm, wd] = [loadCache('kinocheck'), loadCache('tmdb-videos'), loadCache('wikidata-yt')];
  const stale = Date.now() - 120 * DAY;
  const want = new Set();
  for (const t of titles.slice().sort((a, b) => b.votes - a.votes)) {
    for (const yt of [tm[t.id]?.yt, kino[t.id]?.yt, ...rankWikidata(wd[t.id]?.c).map((c) => c[0]).slice(0, 3)]) {
      if (yt && (!check[yt] || check[yt].at < stale)) want.add(yt);
    }
  }
  let n = 0, ok = 0;
  for (const yt of want) {
    if (Date.now() > deadline) break;
    let r;
    try {
      r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + yt)}`, { paceMs: 900, answers: [400, 401, 403] });
    } catch (e) { log(`trailers: youtube ${yt}: ${e.message}`); continue; }
    n++;
    // 401 and 403: embedding is switched off; 400 and 404: no such video.
    check[yt] = r && r.title ? { ok: true, title: String(r.title).slice(0, 120), at: Date.now() } : { ok: false, at: Date.now() };
    if (check[yt].ok) ok++;
    if (n % 200 === 0) saveCache('yt-check', check);
  }
  saveCache('yt-check', check);
  log(`trailers: youtube checked ${n} of ${want.size} videos, ${ok} playable`);
  return check;
}

/* ------------------------------------------------------------------ run */

/**
 * titles: [{ id, kind, title, year, votes }] for films and series.
 * kinoLimit keeps KinoCheck within its free 1,000 requests a day.
 */
export async function resolveTrailers(titles, { budgetMin = 50, kinoLimit = 950 } = {}) {
  const deadline = Date.now() + budgetMin * 60e3;
  await wikidataIds(titles);
  const has = () => {
    const pick = loadTrailers();
    return (id) => Boolean(pick(id));
  };
  const key = process.env.TMDB_API_KEY;
  if (key) await tmdb(titles, has(), key, { deadline: Date.now() + budgetMin * 30e3 });
  await kinocheck(titles, has(), { limit: kinoLimit, deadline: deadline - 15 * 60e3 });
  await verify(titles, { deadline });
  const pick = loadTrailers();
  const n = { movies: 0, shows: 0 };
  for (const t of titles) if (pick(t.id)) n[t.kind]++;
  log(`trailers: ${n.movies} films and ${n.shows} series have one`);
}
