/* Wikidata links an IMDb id to the exact Metacritic and Rotten Tomatoes pages,
   the English Wikipedia article (for poster art) and finer-grained genres.
   Exact ids mean no fuzzy title matching for the scores. */
import { get, log, sleep, loadCache, saveCache } from './lib.mjs';

const ENDPOINT = 'https://query.wikidata.org/sparql';

function query(ids, { series }) {
  const values = ids.map((i) => `"${i}"`).join(' ');
  return `SELECT ?imdb ?article ?mc ?rt
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres)
  (GROUP_CONCAT(DISTINCT ?creatorLabel; separator="|") AS ?creators)
WHERE {
  VALUES ?imdb { ${values} }
  ?item wdt:P345 ?imdb .
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  OPTIONAL { ?item wdt:P1712 ?mc . }
  OPTIONAL { ?item wdt:P1258 ?rt . }
  OPTIONAL { ?item wdt:P136 ?genre . ?genre rdfs:label ?genreLabel . FILTER(LANG(?genreLabel) = "en") }
  ${series ? 'OPTIONAL { ?item wdt:P170 ?creator . ?creator rdfs:label ?creatorLabel . FILTER(LANG(?creatorLabel) = "en") }' : ''}
} GROUP BY ?imdb ?article ?mc ?rt`;
}

/** Games: Steam app id -> Wikipedia article and Metacritic slug. */
export async function resolveSteam(appIds, { maxAgeDays = 60, batch = 300 } = {}) {
  const cache = loadCache('wikidata-steam');
  const stale = Date.now() - maxAgeDays * 864e5;
  const todo = appIds.map(String).filter((id) => !cache[id] || cache[id].at < stale);
  log(`wikidata steam: ${todo.length} of ${appIds.length} to resolve`);
  for (let i = 0; i < todo.length; i += batch) {
    const chunk = todo.slice(i, i + batch);
    const q = `SELECT ?steam ?article ?mc WHERE {
  VALUES ?steam { ${chunk.map((x) => `"${x}"`).join(' ')} }
  ?item wdt:P1733 ?steam .
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  OPTIONAL { ?item wdt:P1712 ?mc . FILTER(STRSTARTS(?mc, "game/")) }
}`;
    let json;
    try {
      json = await get(ENDPOINT, {
        method: 'POST', paceMs: 1500, timeout: 90000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
        body: new URLSearchParams({ query: q }).toString(),
      });
    } catch (e) { log(`wikidata steam batch failed: ${e.message}`); continue; }
    const seen = new Set();
    for (const b of json.results.bindings) {
      const id = b.steam.value;
      const rec = seen.has(id) ? cache[id] : {};
      if (!rec.wiki && b.article) rec.wiki = articleTitle(b.article.value);
      if (!rec.mc && b.mc) rec.mc = b.mc.value.replace(/^game\/(pc\/)?/, '').replace(/^[a-z0-9-]+\/(?=[^/]+$)/, '');
      rec.at = Date.now();
      cache[id] = rec;
      seen.add(id);
    }
    for (const id of chunk) if (!seen.has(id)) cache[id] = { none: true, at: Date.now() };
  }
  saveCache('wikidata-steam', cache);
  return cache;
}

const articleTitle = (url) => decodeURIComponent(url.replace('https://en.wikipedia.org/wiki/', '')).replace(/_/g, ' ');

/**
 * Resolve ids not already cached (or older than maxAgeDays). Returns the
 * cache: { tt123: { wiki, mc, rt, genres:[], creators:[], at } }.
 */
export async function resolveWikidata(titles, { maxAgeDays = 60, batch = 250 } = {}) {
  const cache = loadCache('wikidata');
  const stale = Date.now() - maxAgeDays * 864e5;
  const todo = titles.filter((t) => !cache[t.id] || cache[t.id].at < stale);
  log(`wikidata: ${todo.length} of ${titles.length} to resolve`);
  for (let i = 0; i < todo.length; i += batch) {
    const chunk = todo.slice(i, i + batch);
    const series = chunk.some((t) => t.kind === 'shows');
    let json;
    try {
      json = await get(ENDPOINT, {
        method: 'POST', paceMs: 1500, timeout: 90000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
        body: new URLSearchParams({ query: query(chunk.map((t) => t.id), { series }) }).toString(),
      });
    } catch (e) {
      log(`wikidata batch ${i} failed: ${e.message}; smaller batches next time`);
      await sleep(10000);
      continue;
    }
    const seen = new Set();
    for (const b of json.results.bindings) {
      const id = b.imdb.value;
      const prev = seen.has(id) ? cache[id] : null;
      const rec = prev || { genres: [], creators: [] };
      if (!rec.wiki && b.article) rec.wiki = articleTitle(b.article.value);
      if (!rec.mc && b.mc) rec.mc = b.mc.value;
      if (!rec.rt && b.rt) rec.rt = b.rt.value;
      for (const g of (b.genres?.value || '').split('|').filter(Boolean)) if (!rec.genres.includes(g)) rec.genres.push(g);
      for (const c of (b.creators?.value || '').split('|').filter(Boolean)) if (!rec.creators.includes(c)) rec.creators.push(c);
      rec.at = Date.now();
      cache[id] = rec;
      seen.add(id);
    }
    for (const t of chunk) if (!seen.has(t.id)) cache[t.id] = { none: true, genres: [], creators: [], at: Date.now() };
    if ((i / batch) % 5 === 4) saveCache('wikidata', cache);
    log(`wikidata: ${Math.min(i + batch, todo.length)}/${todo.length}`);
  }
  saveCache('wikidata', cache);
  return cache;
}
