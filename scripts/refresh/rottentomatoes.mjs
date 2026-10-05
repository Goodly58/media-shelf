/* Rotten Tomatoes scores, critics' (Tomatometer) and audience's (Popcornmeter),
   read from each title's page at the exact path Wikidata records. Both sit in a
   JSON block about a third of the way down, so the download stops as soon as it
   has passed it. */
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
  // The page's structured data near the top carries its release date.
  const year = Number((html.match(/"dateCreated":"(\d{4})/) || [])[1]) || null;
  return {
    score: Number.isFinite(score) ? score : null,
    n: cs.reviewCount ?? cs.ratingCount ?? null,
    ...audienceOf(card),
    title,
    year,
    path: finalPath,
  };
}

/**
 * The audience half of a page's scorecard: { aud, audN }. RT publishes how many rated
 * a title only in bands ("25,000+ Ratings", "5,000+ Verified Ratings"), so audN is the
 * band's lower end, as the page itself shows it.
 */
export function audienceOf(card) {
  const a = card?.audienceScore || {};
  const band = String(a.bandedRatingCount || '');
  const score = a.score === '' || a.score == null ? null : Number(a.score);
  // Not out yet (RT hides the score), or too few ratings for RT to give one.
  if (card?.hideAudienceScore || !Number.isFinite(score) || /fewer/i.test(band)) return { aud: null, audN: null };
  return { aud: score, audN: Number(band.replace(/\D/g, '')) || null };
}

/** RT's address for a film title: lower case, words joined by underscores ("m/the_dark_knight"). */
export function slugRT(title) {
  // Not fold(): RT keeps a leading "the" ("m/the_dark_knight").
  return decode(String(title)).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/(\d),(?=\d)/g, '$1').replace(/['\u2019]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Titles compared without spaces or punctuation: "Alien 3" and "Alien³", "Hara-Kiri" and "Harakiri".
const same = (a, b) => fold(a).replace(/ /g, '') === fold(b).replace(/ /g, '');

/**
 * Films Wikidata has no Rotten Tomatoes link for (or a wrong one): try RT's own addresses,
 * the title with its year first, then the bare title, then (for two words) the words run
 * together ("m/trollhunter"). A page counts only when its title is the same as ours and its
 * year within two of ours (a foreign film often reaches the US a year or two later), so a
 * remake or namesake never does.
 * titles: [{ id, title, year }]. Cache: { id: { score, n, title, year, path, at } | { none, at } }.
 */
export async function findRT(titles, { budgetMin = 12, maxAgeDays = 90, cacheName = 'rt-guess' } = {}) {
  const cache = loadCache(cacheName);
  const stale = Date.now() - maxAgeDays * 864e5;
  const deadline = Date.now() + budgetMin * 60e3;
  const todo = titles.filter((t) => !cache[t.id] || cache[t.id].at < stale);
  let n = 0, found = 0;
  for (const t of todo) {
    if (Date.now() > deadline) break;
    const base = slugRT(t.title);
    if (!base) continue;
    let hit = null;
    const paths = [`m/${base}_${t.year}`, `m/${base}`];
    if (base.split('_').length === 2) paths.push(`m/${base.replace('_', '')}`);
    for (const path of paths) {
      let r;
      try { r = await rtScore(path); } catch (e) { log(`rt find ${path}: ${e.message}`); continue; }
      // A guessed page must also have a score: an unscored one is too thin to tell a namesake apart.
      if (r && !r.missing && r.score != null && same(r.title, t.title) && r.year && Math.abs(r.year - t.year) <= 2) { hit = r; break; }
    }
    cache[t.id] = hit ? { ...hit, at: Date.now() } : { none: true, at: Date.now() };
    n++;
    if (hit) found++;
    if (n % 50 === 0) saveCache(cacheName, cache);
  }
  saveCache(cacheName, cache);
  log(`rt find: ${n} of ${todo.length} films tried, ${found} found`);
  return cache;
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
  // Up to date: read lately, from this address, since pages were read for the audience score too.
  const upToDate = (c, t) => c && c.src === t.rt && c.at >= stale && (c.missing || c.mismatch || 'aud' in c);
  const todo = titles.filter((t) => t.rt && !upToDate(cache[t.id], t) && !upToDate(others[t.id], t));
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
