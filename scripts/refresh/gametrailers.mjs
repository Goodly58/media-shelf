/* Game trailers for the trailer feed: Steam's own videos, from the store's appdetails API
   (US store, English). Steam serves them as HLS streams (H.264, 360p to 1080p) from its
   video CDN, which lets any site play them: Safari natively, other browsers through
   hls.js. They start faster than a YouTube embed and carry no ads.

   Each game keeps up to three (Steam's highlighted ones first, in Steam's order), the
   first to play and the others as backups, in data/games-trailers.json, which only the
   trailer feed reads: { gameId: [[movieId, path], ...] }, a path being the part of the
   stream's address after PREFIX + appId + '/'. */
import fs from 'node:fs';
import path from 'node:path';
import { get, log, loadCache, saveCache, ROOT } from './lib.mjs';

const API = 'https://store.steampowered.com/api/appdetails';
export const PREFIX = 'https://video.akamai.steamstatic.com/store_trailers/';
// Versions made for another language or another country's ratings board.
const FOREIGN = /\b(ES-MX|ES-ES|ESRB-ES|DE|FR|IT|JA|JP|KO|ZH|CN|RU|PT-BR|PL|TR|USK|CERO|GRAC)\b|español|deutsch|français|日本語|中文/i;
const DAY = 864e5;

/** A game's trailers from an appdetails answer, best first: [[movieId, path], ...]. */
export function steamTrailers(appId, j) {
  const d = j && j[appId];
  const movies = (d && d.success && d.data && Array.isArray(d.data.movies) && d.data.movies) || [];
  const base = PREFIX + appId + '/';
  const usable = movies.filter((m) => m && typeof m.hls_h264 === 'string' && m.hls_h264.startsWith(base) && !FOREIGN.test(m.name || ''));
  const ranked = usable.filter((m) => m.highlight).concat(usable.filter((m) => !m.highlight));
  return ranked.slice(0, 3).map((m) => [m.id, m.hls_h264.slice(base.length)]);
}

/**
 * Ask Steam for the trailers of each game (Steam app ids, most popular first), the never-asked
 * first, then any asked two months ago. Steam allows about 200 store requests in five minutes.
 * Cache 'steam-movies': { appId: { t: [[movieId, path], ...] } | { none } }.
 */
export async function refreshGameTrailers(appIds, { budgetMin = 55, maxAgeDays = 60 } = {}) {
  const cache = loadCache('steam-movies');
  const stale = Date.now() - maxAgeDays * DAY;
  const fresh = appIds.filter((id) => !cache[id]);
  const old = appIds.filter((id) => cache[id] && cache[id].at < stale).sort((a, b) => cache[a].at - cache[b].at);
  const deadline = Date.now() + budgetMin * 60e3;
  log(`game trailers: ${fresh.length} never asked, ${old.length} due again`);
  let n = 0, found = 0, failedRun = 0;
  for (const id of [...fresh, ...old]) {
    if (Date.now() > deadline) break;
    let j;
    try {
      j = await get(`${API}?appids=${id}&filters=movies&cc=us&l=english`, { paceMs: 1600 });
      failedRun = 0;
    } catch (e) {
      log(`game trailers: ${id}: ${e.message}`);
      if (++failedRun >= 20) { log('game trailers: stopping after 20 failures in a row'); break; }
      continue;
    }
    const t = steamTrailers(id, j);
    cache[id] = t.length ? { t, at: Date.now() } : { none: true, at: Date.now() };
    n++;
    if (t.length) found++;
    if (n % 100 === 0) saveCache('steam-movies', cache);
  }
  saveCache('steam-movies', cache);
  log(`game trailers: asked about ${n} games, ${found} with a trailer`);
}

/**
 * Give each game its trailer (row.tr: the first video's Steam id, which also names its still)
 * and return the feed's file: { gameId: [[movieId, path], ...] }. A game Steam has not been
 * asked about yet keeps what it had.
 */
export function attachGameTrailers(rows) {
  const cache = loadCache('steam-movies');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'games-trailers.json'), 'utf8')); } catch {}
  const out = {};
  for (const r of rows) {
    const c = r.steamId && cache[r.steamId];
    const t = c ? c.t || [] : prev[r.id] || [];
    r.tr = t.length ? t[0][0] : null;
    if (t.length) out[r.id] = t;
  }
  log(`game trailers: ${Object.keys(out).length} of ${rows.length} games have one`);
  return out;
}
