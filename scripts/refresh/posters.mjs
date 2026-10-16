/* Posters for the films and series Wikipedia has none for (and, for series, TVmaze): TMDB's,
   asked with the same key as the trailers. Wikipedia covers some films in one article for two
   parts (Nymphomaniac), others in the series they belong to (anime compilation films), and
   some not at all; TMDB has a poster for nearly every one.

   Cache 'tmdb-posters': { imdbId: { p: '/path.jpg', at } | { none: true, at } }. */
import { get, loadCache, saveCache, log } from './lib.mjs';

const DAY = 864e5;
// 342 pixels wide: sharp on the grid's 170px cards at twice the density.
export const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

/** The poster in a TMDB /find answer for a film or a series: its path, or null. */
export function tmdbPoster(j, kind) {
  const hit = j && (kind === 'shows' ? j.tv_results : j.movie_results)?.[0];
  const p = hit && hit.poster_path;
  return typeof p === 'string' && /^\/[\w-]+\.(jpg|jpeg|png|webp)$/.test(p) ? p : null;
}

/**
 * Ask TMDB about each title (id, kind, votes) due a look: never asked, one it had no poster for
 * a month ago, one it had half a year ago. Most-voted first, until the budget runs out.
 */
export async function refreshPosters(titles, { budgetMin = 20 } = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) { log('posters: no TMDB_API_KEY, skipped'); return; }
  const cache = loadCache('tmdb-posters');
  const deadline = Date.now() + budgetMin * 60e3;
  const due = (c) => !c || Date.now() - c.at > (c.none ? 30 : 180) * DAY;
  const order = titles.filter((t) => due(cache[t.id])).sort((a, b) => (b.votes || 0) - (a.votes || 0));
  let n = 0, found = 0, errors = 0;
  for (const t of order) {
    if (Date.now() > deadline) break;
    // A bad key fails every request: stop rather than run through the whole list.
    if (errors >= 20) { log('posters: tmdb keeps failing; stopping'); break; }
    try {
      const j = await get(`https://api.themoviedb.org/3/find/${t.id}?external_source=imdb_id&api_key=${encodeURIComponent(key)}`, { paceMs: 120 });
      const p = tmdbPoster(j, t.kind);
      cache[t.id] = p ? { p, at: Date.now() } : { none: true, at: Date.now() };
      n++; errors = 0;
      if (p) found++;
    } catch (e) { errors++; log(`posters: tmdb ${t.id}: ${e.message}`); }
  }
  saveCache('tmdb-posters', cache);
  log(`posters: asked TMDB about ${n} of ${order.length} due, ${found} with a poster`);
}
