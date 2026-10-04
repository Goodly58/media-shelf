/* Wikipedia categories for each title's article. WikiProject Film and
   WikiProject Television keep these consistent ("2010s satirical films",
   "American body horror films", "Films about revenge"), which makes them the
   richest source of subgenres, themes and countries of origin. Hidden
   maintenance categories are left out. */
import { get, log, loadCache, saveCache } from './lib.mjs';

const API = 'https://en.wikipedia.org/w/api.php';

/** items: [{ key, wiki }]. Returns the cache: { key: { wiki, cats: [...], at } }. */
export async function resolveCategories(items, { cacheName = 'wp-categories', maxAgeDays = 90, budgetMin = 30 } = {}) {
  const cache = loadCache(cacheName);
  const stale = Date.now() - maxAgeDays * 864e5;
  const deadline = Date.now() + budgetMin * 60e3;
  const todo = items.filter((x) => x.wiki && (!cache[x.key] || cache[x.key].wiki !== x.wiki || cache[x.key].at < stale));
  log(`categories: ${todo.length} of ${items.length} to fetch`);
  for (let i = 0; i < todo.length; i += 50) {
    if (Date.now() > deadline) { log('categories: out of time'); break; }
    const chunk = todo.slice(i, i + 50);
    const found = new Map();
    const hop = new Map();
    let cont = {};
    // The API caps categories per response, so one batch can take several pages.
    for (let page = 0; page < 12; page++) {
      const params = new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', redirects: '1',
        prop: 'categories', cllimit: 'max', clshow: '!hidden',
        titles: chunk.map((x) => x.wiki).join('|'), ...cont,
      });
      let j;
      try { j = await get(`${API}?${params}`, { paceMs: 300 }); }
      catch (e) { log(`categories batch ${i}: ${e.message}`); break; }
      const q = j?.query || {};
      for (const n of q.normalized || []) hop.set(n.from, n.to);
      for (const r of q.redirects || []) hop.set(r.from, r.to);
      for (const p of q.pages || []) {
        if (!found.has(p.title)) found.set(p.title, []);
        for (const c of p.categories || []) found.get(p.title).push(c.title.replace(/^Category:/, ''));
      }
      if (!j?.continue) break;
      cont = j.continue;
    }
    for (const x of chunk) {
      let t = x.wiki;
      for (let k = 0; k < 3 && hop.has(t); k++) t = hop.get(t);
      cache[x.key] = { wiki: x.wiki, cats: [...new Set(found.get(t) || [])], at: Date.now() };
    }
    if ((i / 50) % 20 === 19) { saveCache(cacheName, cache); log(`categories: ${Math.min(i + 50, todo.length)}/${todo.length}`); }
  }
  saveCache(cacheName, cache);
  return cache;
}
