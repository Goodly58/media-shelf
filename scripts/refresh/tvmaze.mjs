/* Series posters from TVmaze (portrait art, looked up by IMDb id). Wikipedia's
   lead image for a TV show is often a logo or title card, which crops badly
   on a poster-shaped card. TVmaze asks for at most 20 calls per 10 seconds. */
import { get, log, loadCache, saveCache } from './lib.mjs';

export async function resolveTvmaze(ids, { maxAgeDays = 120, budgetMin = 60 } = {}) {
  const cache = loadCache('tvmaze');
  const stale = Date.now() - maxAgeDays * 864e5;
  const deadline = Date.now() + budgetMin * 60e3;
  const todo = ids.filter((id) => !cache[id] || cache[id].at < stale);
  log(`tvmaze: ${todo.length} of ${ids.length} to look up`);
  let n = 0;
  for (const id of todo) {
    if (Date.now() > deadline) break;
    let j = null;
    try { j = await get(`https://api.tvmaze.com/lookup/shows?imdb=${id}`, { paceMs: 600 }); }
    catch (e) { log(`tvmaze ${id}: ${e.message}`); continue; }
    cache[id] = { img: j?.image?.medium || null, tvmaze: j?.id || null, at: Date.now() };
    if (++n % 200 === 0) { saveCache('tvmaze', cache); log(`tvmaze: ${n}/${todo.length}`); }
  }
  saveCache('tvmaze', cache);
  return cache;
}
