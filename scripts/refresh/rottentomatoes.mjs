/* Rotten Tomatoes critic scores (Tomatometer), read from each title's page at
   the exact path Wikidata records. The score sits in a JSON block about a
   third of the way down, so the download stops as soon as it has passed it. */
import { get, log, loadCache, saveCache, fold, decode } from './lib.mjs';

const BASE = 'https://www.rottentomatoes.com/';

async function readUntilScore(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let html = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
    const at = html.indexOf('media-scorecard-json');
    if ((at >= 0 && html.indexOf('</script>', at) > 0) || html.length > 600000) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  return html;
}

export async function rtScore(path) {
  const res = await get(BASE + path, { type: 'response', paceMs: 700, headers: { Accept: 'text/html' } });
  if (!res) return { missing: true };
  const finalPath = new URL(res.url).pathname.replace(/^\//, '').replace(/\/$/, '');
  if (!/^(m|tv)\//.test(finalPath)) { res.body?.cancel?.(); return { missing: true }; }
  const html = await readUntilScore(res);
  const at = html.indexOf('media-scorecard-json');
  const title = decode((html.match(/<title>([^<|]+)/) || [])[1] || '').trim();
  if (at < 0) return { missing: true, title, path: finalPath };
  const s = html.indexOf('>', at) + 1;
  let card = null;
  try { card = JSON.parse(html.slice(s, html.indexOf('</script>', s))); } catch {}
  const cs = card?.criticsScore || {};
  const score = cs.score === '' || cs.score == null ? null : Number(cs.score);
  return {
    score: Number.isFinite(score) ? score : null,
    n: cs.reviewCount ?? cs.ratingCount ?? null,
    title,
    path: finalPath,
  };
}

/**
 * Fetch RT scores for titles ({id, title, rt}) in the order given, skipping
 * any checked within maxAgeDays, until the time budget runs out.
 */
export async function refreshRT(titles, { budgetMin = 60, maxAgeDays = 30, cacheName = 'rt' } = {}) {
  const cache = loadCache(cacheName);
  const others = cacheName === 'rt' ? {} : loadCache('rt');
  const stale = Date.now() - maxAgeDays * 864e5;
  const deadline = Date.now() + budgetMin * 60e3;
  const fresh = (c) => c && c.at >= stale;
  const todo = titles.filter((t) => t.rt && !(fresh(cache[t.id]) && cache[t.id].src === t.rt) && !(fresh(others[t.id]) && others[t.id].src === t.rt));
  log(`rt: ${todo.length} of ${titles.length} due`);
  let done = 0, scored = 0, mismatch = 0;
  for (const t of todo) {
    if (Date.now() > deadline) break;
    let r;
    try { r = await rtScore(t.rt); }
    catch (e) { log(`rt ${t.rt}: ${e.message}`); continue; }
    // A page whose title shares nothing with ours is a stale or reused slug.
    if (r.title && !r.missing) {
      const a = fold(r.title), b = fold(t.title);
      if (a && b && !a.includes(b) && !b.includes(a) && !sharesWords(a, b)) { r = { ...r, score: null, mismatch: true }; mismatch++; }
    }
    cache[t.id] = { ...r, src: t.rt, at: Date.now() };
    done++;
    if (r.score != null) scored++;
    if (done % 100 === 0) { saveCache(cacheName, cache); log(`rt: ${done}/${todo.length}, ${scored} scored, ${mismatch} mismatched`); }
  }
  saveCache(cacheName, cache);
  log(`rt: ${done} fetched, ${scored} scored, ${mismatch} mismatched`);
  return cache;
}

function sharesWords(a, b) {
  const A = new Set(a.split(' ').filter((w) => w.length > 3));
  return b.split(' ').some((w) => w.length > 3 && A.has(w));
}
