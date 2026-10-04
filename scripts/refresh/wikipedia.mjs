/* Poster and cover art from the lead image of each title's English Wikipedia
   article: 50 articles per request. pilicense=any is needed because most film
   posters are non-free images, which the API leaves out by default. */
import { get, log, loadCache, saveCache } from './lib.mjs';

const API = 'https://en.wikipedia.org/w/api.php';

/**
 * items: [{ key, wiki }] where wiki is an article title.
 * Returns the cache: { key: { wiki, img, at } } with img null when the
 * article has no lead image.
 */
export async function resolveImages(items, { cacheName = 'images', maxAgeDays = 120, size = 330 } = {}) {
  const cache = loadCache(cacheName);
  const stale = Date.now() - maxAgeDays * 864e5;
  const todo = items.filter((x) => x.wiki && (!cache[x.key] || !('img' in cache[x.key]) || cache[x.key].wiki !== x.wiki || cache[x.key].at < stale));
  log(`images (${cacheName}): ${todo.length} of ${items.length} to resolve`);
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50);
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', redirects: '1',
      prop: 'pageimages', piprop: 'thumbnail', pithumbsize: String(size), pilicense: 'any',
      titles: chunk.map((x) => x.wiki).join('|'),
    });
    let j;
    try { j = await get(`${API}?${params}`, { paceMs: 400 }); }
    catch (e) { log(`images batch ${i} failed: ${e.message}`); continue; }
    const q = j?.query || {};
    const hop = new Map();
    for (const n of q.normalized || []) hop.set(n.from, n.to);
    for (const r of q.redirects || []) hop.set(r.from, r.to);
    const page = new Map((q.pages || []).map((p) => [p.title, p]));
    for (const x of chunk) {
      let t = x.wiki;
      for (let k = 0; k < 3 && hop.has(t); k++) t = hop.get(t);
      const p = page.get(t);
      cache[x.key] = { wiki: x.wiki, img: p?.thumbnail?.source || null, at: Date.now() };
    }
    if ((i / 50) % 20 === 19) { saveCache(cacheName, cache); log(`images: ${i + 50}/${todo.length}`); }
  }
  saveCache(cacheName, cache);
  return cache;
}

/** Search Wikipedia for the article best matching a query (used for games). */
export async function searchArticle(q) {
  const params = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', list: 'search', srsearch: q, srlimit: '3' });
  const j = await get(`${API}?${params}`, { paceMs: 400 });
  return (j?.query?.search || []).map((s) => s.title);
}
