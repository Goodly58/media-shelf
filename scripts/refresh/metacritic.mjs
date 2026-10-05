/* Metacritic scores, read from the same backend metacritic.com's own pages
   call. Films and series come from the browse ("finder") listing, 50 titles
   per request, so a full pass over all ~21,000 scored titles is a few hundred
   small requests. Games use the per-title page, which carries the PC score.
   User scores come a title at a time from each title's user-review stats, the
   only place that says how many people rated it. */
import { get, log, loadCache, saveCache, fold } from './lib.mjs';

/* The public key metacritic.com's front end sends with every request. */
const KEY = '1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u';
const FINDER = 'https://backend.metacritic.com/finder/metacritic/web';
const PAGE = 'https://backend.metacritic.com/composer/metacritic/pages';
const USER = 'https://backend.metacritic.com/reviews/metacritic/user';

function reduce(i) {
  const m = (i.image?.filename || '').match(/^5-(tt\d+)\./);
  return {
    mcId: i.id,
    slug: i.slug,
    title: i.title,
    year: i.premiereYear || null,
    score: i.criticScoreSummary?.score ?? null,
    n: i.criticScoreSummary?.reviewCount ?? null,
    user: i.userScore?.score ?? null,
    imdb: m ? m[1] : null,
  };
}

/** Every scored title of one type ('movies' | 'tv'), walked year by year. */
export async function crawlFinder(type, { fromYear = 1910, budgetMin = 30 } = {}) {
  const out = new Map();
  const last = new Date().getFullYear();
  const deadline = Date.now() + budgetMin * 60e3;
  // Newest years first, so a run cut short by the budget still covers what changes most.
  for (let y = last; y >= fromYear; y--) {
    if (Date.now() > deadline) { log(`metacritic ${type}: out of time at ${y}`); break; }
    let total = 0;
    const seen = new Set();
    // Ties in the sort can shuffle across pages; walking the year in both
    // directions closes any gap that leaves.
    for (const sortBy of ['-metaScore', 'metaScore']) {
      for (let offset = 0; ; offset += 50) {
        const url = `${FINDER}?sortBy=${sortBy}&productType=${type}&releaseYearMin=${y}&releaseYearMax=${y}&offset=${offset}&limit=50&apiKey=${KEY}`;
        const d = (await get(url, { paceMs: 700 }))?.data;
        if (!d || !d.items?.length) break;
        total = d.totalResults;
        for (const it of d.items) {
          const r = reduce(it);
          if (r.score == null) continue;
          out.set(r.mcId, r);
          seen.add(r.mcId);
        }
        if (offset + 50 >= total) break;
      }
      if (seen.size >= total) break;
    }
    if (y % 10 === 0) log(`metacritic ${type}: back to ${y}, ${out.size} scored`);
  }
  log(`metacritic ${type}: ${out.size} scored titles`);
  return [...out.values()];
}

/**
 * Attach Metacritic scores to films/series. Match order, most exact first:
 * the IMDb id Metacritic embeds in its own artwork, the slug Wikidata
 * records, then a unique title + year match.
 */
export function matchScreen(titles, mcRows, wikidata, kindPrefix) {
  const byImdb = new Map(), bySlug = new Map(), byKey = new Map();
  for (const r of mcRows) {
    if (r.imdb) byImdb.set(r.imdb, r);
    bySlug.set(r.slug, r);
    const k = fold(r.title.replace(/\s*\((re-release|\d{4})\)\s*$/i, ''));
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const used = new Set();
  const result = new Map();
  const claim = (t, r, how) => { result.set(t.id, { score: r.score, n: r.n, user: r.user ?? null, slug: r.slug, how }); used.add(r.mcId); };

  for (const t of titles) {
    const r = byImdb.get(t.id);
    if (r) claim(t, r, 'imdb');
  }
  for (const t of titles) {
    if (result.has(t.id)) continue;
    const wd = wikidata[t.id];
    const slug = wd?.mc ? wd.mc.replace(new RegExp(`^${kindPrefix}/`), '').replace(/\/.*$/, '') : null;
    const r = slug && bySlug.get(slug);
    if (r && !used.has(r.mcId)) claim(t, r, 'wikidata');
  }
  // Title matching only for films: TV seasons are separate Metacritic entries with
  // their own names, so a title match can attach one season's score to another show.
  if (kindPrefix !== 'movie') return result;
  for (const t of titles) {
    if (result.has(t.id) || !t.year) continue;
    const cands = (byKey.get(fold(t.title)) || []).filter((r) => !used.has(r.mcId) && Math.abs((r.year || 0) - t.year) <= 1);
    if (cands.length === 1) claim(t, cands[0], 'title');
  }
  return result;
}

/** One game's PC Metascore (falls back to the headline score). */
export async function gameScore(slug) {
  const j = await get(`${PAGE}/games/${slug}/web?apiKey=${KEY}`, { paceMs: 900 });
  const item = j?.components?.[0]?.data?.item;
  if (!item) return null;
  const pc = (item.platforms || []).find((p) => /^PC$/i.test(p.name));
  const score = pc?.criticScoreSummary?.score ?? item.criticScoreSummary?.score ?? null;
  return {
    score,
    n: pc?.criticScoreSummary?.reviewCount ?? item.criticScoreSummary?.reviewCount ?? null,
    title: item.title,
    year: item.premiereYear || null,
    pc: Boolean(pc),
  };
}

/** A title's user-review stats: { score, n } (score null until enough have rated it). */
export function userOf(j) {
  const it = j?.data?.item;
  if (!it) return null;
  const n = Number(it.reviewCount) || 0;
  const score = it.score == null || it.score === '' ? null : Number(it.score);
  return { score: n > 0 && Number.isFinite(score) ? score : null, n };
}

/** type: 'movies' | 'shows' | 'games'. platform: 'pc' for a game's PC page. Null when there is no such page. */
export async function userStats(type, slug, platform) {
  const p = platform ? `${type}/${slug}/platform/${platform}` : `${type}/${slug}`;
  const j = await get(`${USER}/${p}/stats/web?apiKey=${KEY}`, { paceMs: 700 });
  return j ? userOf(j) : null;
}

/**
 * Metacritic user scores for jobs ({ id, type, slug, platform?, year, rank }): never-checked
 * first (most popular first, by rank), then the longest unchecked. A recent title is due
 * again after two weeks, an older one after four months, since a score settles once a
 * title has been out a while. Cache: { id: { slug, score, n, at } | { slug, none, n, at } }.
 */
export async function refreshMcUsers(jobs, { budgetMin = 55, cacheName = 'mc-user' } = {}) {
  const cache = loadCache(cacheName);
  const recent = new Date().getFullYear() - 1;
  const due = (j) => {
    const c = cache[j.id];
    return !c || c.slug !== j.slug || Date.now() - c.at > ((j.year || 0) >= recent ? 14 : 120) * 864e5;
  };
  const todo = jobs.filter(due);
  const fresh = todo.filter((j) => !cache[j.id]).sort((a, b) => a.rank - b.rank);
  const stale = todo.filter((j) => cache[j.id]).sort((a, b) => cache[a.id].at - cache[b.id].at);
  const deadline = Date.now() + budgetMin * 60e3;
  log(`metacritic users: ${todo.length} of ${jobs.length} due`);
  let done = 0, scored = 0, failedRun = 0;
  for (const j of [...fresh, ...stale]) {
    if (Date.now() > deadline) break;
    let r;
    try {
      r = await userStats(j.type, j.slug, j.platform);
      // A game that is not on PC has no PC page: its score across platforms instead.
      if (!r && j.platform) r = await userStats(j.type, j.slug);
      failedRun = 0;
    } catch (e) {
      log(`metacritic users ${j.type}/${j.slug}: ${e.message}`);
      // Twenty failures in a row: the backend has changed or is refusing us. The health check will say so.
      if (++failedRun >= 20) { log('metacritic users: stopping after 20 failures in a row'); break; }
      continue;
    }
    cache[j.id] = r && r.score != null ? { slug: j.slug, score: r.score, n: r.n, at: Date.now() } : { slug: j.slug, none: true, n: r ? r.n : null, at: Date.now() };
    done++;
    if (r && r.score != null) scored++;
    if (done % 200 === 0) { saveCache(cacheName, cache); log(`metacritic users: ${done}/${todo.length}, ${scored} scored`); }
  }
  saveCache(cacheName, cache);
  log(`metacritic users: ${done} checked, ${scored} scored`);
  return cache;
}

export async function crawlAll() {
  const movies = await crawlFinder('movies');
  saveCache('mc-movies', movies);
  const tv = await crawlFinder('tv', { fromYear: 1946 });
  saveCache('mc-tv', tv);
  return { movies, tv };
}

if (process.argv[1] && process.argv[1].endsWith('metacritic.mjs') && process.argv[2] === 'crawl') {
  await crawlAll();
}
