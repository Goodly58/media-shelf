/* Photos of the cast, from TMDB: each title's credits there, matched by name to IMDb's billed
   cast (imdb.mjs loadCast), which stays the source of who is in a title and as whom. Asked with
   the same key as the trailers and posters.

   Cache 'tmdb-cast': { imdbId: { c: [[name, photo path], ...], tm, at } | { none: true, tm, at } }. */
import { get, loadCache, saveCache, log, fold } from './lib.mjs';

const DAY = 864e5;
// 185 pixels wide: sharp in the details' 80px circles at twice the density.
export const TMDB_FACE = 'https://image.tmdb.org/t/p/w185';
const PHOTO = /^\/[\w-]+\.(jpg|jpeg|png|webp)$/;

/** The people in a TMDB credits answer (a film's /credits, a series' /aggregate_credits) who have
    a photo, in TMDB's billing order, as [name, photo path], up to 30. */
export function tmdbFaces(j) {
  const cast = (j && Array.isArray(j.cast) ? j.cast : []).slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return cast.filter((p) => p && typeof p.name === 'string' && typeof p.profile_path === 'string' && PHOTO.test(p.profile_path))
    .slice(0, 30).map((p) => [p.name, p.profile_path]);
}

/** A title's billed cast ([[name, character]], IMDb's names with any "(1981)" that tells two
    people apart) with each one's photo from TMDB's credits, matched by name: [[name, character, photo]]. */
export function facesFor(cast, faces) {
  const by = new Map((faces || []).map(([name, p]) => [fold(name), p]));
  return cast.map(([name, role]) => [name, role || null, by.get(fold(name.replace(/\s\((\d{4}|nm\d+)\)$/, ''))) || null]);
}

/**
 * Ask TMDB for the credits of each title (id, kind, votes) due a look: never asked; one with no
 * photos a month ago; one with photos four months ago. Most-voted first, until the budget runs out.
 */
export async function refreshCastPhotos(titles, { budgetMin = 50 } = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) { log('cast photos: no TMDB_API_KEY, skipped'); return; }
  const cache = loadCache('tmdb-cast'), videos = loadCache('tmdb-videos');
  const deadline = Date.now() + budgetMin * 60e3;
  const due = (c) => !c || Date.now() - c.at > (c.none ? 30 : 120) * DAY;
  const order = titles.filter((t) => due(cache[t.id])).sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const api = (p) => `https://api.themoviedb.org/3${p}${p.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`;
  let n = 0, found = 0, errors = 0;
  for (const t of order) {
    if (Date.now() > deadline) break;
    // A bad key fails every request: stop rather than run through the whole catalogue.
    if (errors >= 20) { log('cast photos: tmdb keeps failing; stopping'); break; }
    try {
      // TMDB's own id, kept by the trailers step, saves the lookup by IMDb id.
      let tm = videos[t.id]?.tm || cache[t.id]?.tm || null;
      if (!tm) {
        const f = await get(api(`/find/${t.id}?external_source=imdb_id`), { paceMs: 120 });
        tm = (t.kind === 'shows' ? f?.tv_results : f?.movie_results)?.[0]?.id || null;
      }
      const j = tm ? await get(api(t.kind === 'shows' ? `/tv/${tm}/aggregate_credits` : `/movie/${tm}/credits`), { paceMs: 120 }) : null;
      const c = tmdbFaces(j);
      cache[t.id] = c.length ? { c, tm, at: Date.now() } : { none: true, tm, at: Date.now() };
      n++; errors = 0;
      if (c.length) found++;
    } catch (e) { errors++; log(`cast photos: tmdb ${t.id}: ${e.message}`); }
    if (n && n % 500 === 0) saveCache('tmdb-cast', cache);
  }
  saveCache('tmdb-cast', cache);
  log(`cast photos: asked TMDB about ${n} of ${order.length} due, ${found} with photos`);
}
