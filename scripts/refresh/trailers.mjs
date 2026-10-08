/* Trailers for films and series: a YouTube video per title for the reels view, and up to
   two backups the player turns to when one will not play.

   Sources, best first:
   - TMDB, only when TMDB_API_KEY is set: official trailers for nearly every title.
   - KinoCheck (api.kinocheck.com, free, 1,000 requests a day): official trailers,
     strongest for recent films and for series.
   - Wikidata (property P1651): YouTube ids recorded on a title's item, used only when
     the statement is marked as a trailer or teaser. Unmarked ids are nearly always
     YouTube's paid listing of the whole film (titled just "The Godfather"), not a trailer.

   Every id in use is checked with YouTube's oEmbed endpoint, which answers only for
   public, embeddable videos, and checked again each month: a trailer found dead gives
   way to the next. Official trailers are used before their check comes back (the page
   turns to a backup if one fails to play); Wikidata ids wait for it. A check cannot see
   a video blocked in the viewer's country or behind an age gate, which is what the
   backups on the page are for. Each source keeps its own cache; pickTrailers() makes
   the choice. */
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
 * Every usable trailer for one title, best first: TMDB's (its best, then its others),
 * KinoCheck's, then Wikidata's once YouTube has confirmed them. Videos YouTube has said
 * will not play are left out. Returns undefined when no source has looked at the title yet.
 */
export function rankTrailers(id, { tmdb = {}, kino = {}, wd = {}, check = {} }) {
  if (!(tmdb[id] || kino[id] || wd[id])) return undefined;
  const out = [];
  const add = (yt) => { if (yt && !(check[yt] && check[yt].ok === false) && !out.includes(yt)) out.push(yt); };
  for (const src of [tmdb[id], kino[id]]) if (src) { add(src.yt); (src.alt || []).forEach(add); }
  // Wikidata's ids wait for YouTube to confirm they still play.
  for (const [yt] of rankWikidata(wd[id] && wd[id].c)) if (check[yt] && check[yt].ok) add(yt);
  return out;
}

/**
 * A title's trailer and up to two backups ([] when the sources know of none, undefined when
 * none has looked). Backups from another YouTube channel come first: a studio that takes one
 * trailer down, or is blocked somewhere, usually takes or has all of its own with it.
 */
export function pickTrailers(id, caches) {
  const ranked = rankTrailers(id, caches);
  if (!ranked || ranked.length < 3) return ranked;
  const [first, ...rest] = ranked;
  const by = (yt) => caches.check && caches.check[yt] && caches.check[yt].by;
  const elsewhere = by(first) ? rest.filter((yt) => by(yt) && by(yt) !== by(first)) : [];
  return [first, ...new Set([...elsewhere, ...rest])].slice(0, 3);
}

/** The trailer alone: a video id, null when there is none, undefined when no source has looked. */
export function pickTrailer(id, caches) {
  const l = rankTrailers(id, caches);
  return l === undefined ? undefined : l[0] || null;
}

/**
 * The choice for every title, from the current caches: list(id) gives pickTrailers(), has(id)
 * whether there is a trailer at all, and fromTmdb(id, yt) whether TMDB supplied a video.
 */
export function loadTrailers() {
  const caches = { tmdb: loadCache('tmdb-videos'), kino: loadCache('kinocheck'), wd: loadCache('wikidata-yt'), check: loadCache('yt-check') };
  return {
    caches,
    list: (id) => pickTrailers(id, caches),
    has: (id) => Boolean(pickTrailer(id, caches)),
    fromTmdb: (id, yt) => Boolean(yt && caches.tmdb[id] && (caches.tmdb[id].yt === yt || (caches.tmdb[id].alt || []).includes(yt))),
  };
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

/** The trailers in a KinoCheck answer, best first: its own pick, then any trailer, then teasers. */
export function kinoRanked(j) {
  if (!j || j.error) return [];
  const vids = (j.trailer ? [j.trailer] : []).concat(j.videos || []).filter((v) => YT_ID.test((v && v.youtube_video_id) || ''));
  const is = (v, re) => (v.categories || []).some((c) => re.test(c));
  const own = j.trailer && YT_ID.test(j.trailer.youtube_video_id || '') ? [j.trailer] : [];
  const keys = [...own, ...vids.filter((x) => is(x, /trailer/i)), ...vids.filter((x) => is(x, /teaser/i))].map((v) => v.youtube_video_id);
  return [...new Set(keys)];
}
export function kinoPick(j) { return kinoRanked(j)[0] || null; }

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
    const ranked = kinoRanked(j);
    cache[t.id] = ranked.length ? { yt: ranked[0], alt: ranked.slice(1, 4), at: Date.now() } : { none: true, at: Date.now() };
    if (ranked.length) found++;
    if (n % 100 === 0) saveCache('kinocheck', cache);
  }
  saveCache('kinocheck', cache);
  log(`trailers: kinocheck asked about ${n} titles, ${found} with a trailer`);
  return cache;
}

/* ------------------------------------------------------------------- TMDB */

/** The videos in a TMDB /videos answer worth showing, best first: official trailers, other
    trailers, then teasers, newest first within each. */
export function tmdbRanked(j) {
  const yt = ((j && j.results) || []).filter((v) => v.site === 'YouTube' && YT_ID.test(v.key || ''));
  const rank = (v) => (v.type === 'Trailer' ? 2 : v.type === 'Teaser' ? 1 : 0) * 2 + (v.official ? 1 : 0);
  return [...new Set(yt.filter((v) => rank(v) >= 2).sort((a, b) => rank(b) - rank(a) || String(b.published_at).localeCompare(String(a.published_at))).map((v) => v.key))];
}
export function tmdbPick(j) { return tmdbRanked(j)[0] || null; }

async function tmdb(titles, has, key, { deadline } = {}) {
  const cache = loadCache('tmdb-videos');
  const stale = Date.now() - 120 * DAY;
  // Due: never asked, asked four months ago, or asked before the other videos were kept.
  const due = (c) => !c || c.at < stale || (!c.none && !c.alt);
  const order = titles.filter((t) => due(cache[t.id])).sort((a, b) => (has(a.id) - has(b.id)) || (b.votes - a.votes));
  const api = (path) => `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`;
  let n = 0, found = 0, errors = 0;
  for (const t of order) {
    if (Date.now() > deadline) break;
    // A bad key fails every request: stop rather than run through the whole catalogue.
    if (errors >= 20) { log('trailers: tmdb keeps failing; stopping'); break; }
    try {
      // TMDB's own id, kept from the first look, saves the lookup by IMDb id next time.
      let tm = cache[t.id] && cache[t.id].tm;
      if (!tm) {
        const f = await get(api(`/find/${t.id}?external_source=imdb_id`), { paceMs: 120 });
        const hit = f && (t.kind === 'shows' ? f.tv_results : f.movie_results)?.[0];
        tm = hit ? hit.id : null;
      }
      const v = tm ? await get(api(`/${t.kind === 'shows' ? 'tv' : 'movie'}/${tm}/videos?language=en-US`), { paceMs: 120 }) : null;
      const ranked = tmdbRanked(v);
      cache[t.id] = ranked.length ? { yt: ranked[0], alt: ranked.slice(1, 4), tm, at: Date.now() } : { none: true, tm, at: Date.now() };
      n++; errors = 0; if (ranked.length) found++;
    } catch (e) { errors++; log(`trailers: tmdb ${t.id}: ${e.message}`); }
    if (n % 200 === 0) saveCache('tmdb-videos', cache);
  }
  saveCache('tmdb-videos', cache);
  log(`trailers: tmdb asked about ${n} titles, ${found} with a trailer`);
  return cache;
}

/* ------------------------------------------------------------- YouTube */

/**
 * Ask YouTube about the videos the site uses: every title's trailer first (most popular titles
 * first), then the first backups, then the second, then anything last asked a month ago. A video
 * found dead hands its place to the next, which is asked about in the next round.
 */
async function verify(titles, { deadline, paceMs = 450 } = {}) {
  const caches = { tmdb: loadCache('tmdb-videos'), kino: loadCache('kinocheck'), wd: loadCache('wikidata-yt'), check: loadCache('yt-check') };
  const check = caches.check;
  const byVotes = titles.slice().sort((a, b) => b.votes - a.votes);
  // Wikidata's ids are only used once confirmed, so they are asked about too, after the rest.
  const wdIds = (id) => rankWikidata(caches.wd[id] && caches.wd[id].c).map((c) => c[0]).slice(0, 2);
  let n = 0, ok = 0, total = 0;
  const ask = async (yt) => {
    let r;
    try {
      r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + yt)}`, { paceMs, answers: [400, 401, 403] });
    } catch (e) { log(`trailers: youtube ${yt}: ${e.message}`); return; }
    n++;
    // 401 and 403: private, or embedding switched off; 400 and 404: no such video.
    check[yt] = r && r.title
      ? { ok: true, title: String(r.title).slice(0, 120), by: String(r.author_name || '').slice(0, 80), at: Date.now() }
      : { ok: false, at: Date.now() };
    if (check[yt].ok) ok++;
    if (n % 200 === 0) saveCache('yt-check', check);
  };
  for (let round = 0; round < 5 && Date.now() < deadline; round++) {
    const want = new Set();
    for (const slot of [0, 1, 2]) {
      for (const t of byVotes) {
        const yt = (pickTrailers(t.id, caches) || [])[slot];
        if (yt && !check[yt]) want.add(yt);
      }
    }
    for (const t of byVotes) for (const yt of wdIds(t.id)) if (!check[yt]) want.add(yt);
    if (!want.size) break;
    total += want.size;
    for (const yt of want) { if (Date.now() > deadline) break; await ask(yt); }
  }
  // Videos in use asked about a month ago or more, oldest first: trailers go private over time.
  const stale = Date.now() - 30 * DAY;
  const used = new Set();
  for (const t of byVotes) for (const yt of pickTrailers(t.id, caches) || []) used.add(yt);
  const old = [...used].filter((yt) => check[yt] && check[yt].at < stale).sort((a, b) => check[a].at - check[b].at);
  total += old.length;
  for (const yt of old) { if (Date.now() > deadline) break; await ask(yt); }
  saveCache('yt-check', check);
  log(`trailers: youtube checked ${n} of ${total} videos, ${ok} playable`);
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
  const has = () => loadTrailers().has;
  const key = process.env.TMDB_API_KEY;
  if (key) await tmdb(titles, has(), key, { deadline: Date.now() + budgetMin * 30e3 });
  await kinocheck(titles, has(), { limit: kinoLimit, deadline: deadline - 15 * 60e3 });
  await verify(titles, { deadline });
  const pick = loadTrailers();
  const n = { movies: 0, shows: 0 }, backed = { movies: 0, shows: 0 };
  for (const t of titles) {
    const l = pick.list(t.id) || [];
    if (l.length) n[t.kind]++;
    if (l.length > 1) backed[t.kind]++;
  }
  log(`trailers: ${n.movies} films and ${n.shows} series have one; ${backed.movies} and ${backed.shows} have a backup`);
}
