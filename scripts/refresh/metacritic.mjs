/* Metacritic scores, read from the same backend metacritic.com's own pages
   call. Films and series come from the browse ("finder") listing, 50 titles
   per request, so a full pass over all ~21,000 scored titles is a few hundred
   small requests. Games use the per-title page, which carries the PC score. */
import { get, log, loadCache, saveCache, fold } from './lib.mjs';

/* The public key metacritic.com's front end sends with every request. */
const KEY = '1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u';
const FINDER = 'https://backend.metacritic.com/finder/metacritic/web';
const PAGE = 'https://backend.metacritic.com/composer/metacritic/pages';

function reduce(i) {
  const m = (i.image?.filename || '').match(/^5-(tt\d+)\./);
  return {
    mcId: i.id,
    slug: i.slug,
    title: i.title,
    year: i.premiereYear || null,
    score: i.criticScoreSummary?.score ?? null,
    n: i.criticScoreSummary?.reviewCount ?? null,
    imdb: m ? m[1] : null,
  };
}

/** Every scored title of one type ('movies' | 'tv'), walked year by year. */
export async function crawlFinder(type, { fromYear = 1910 } = {}) {
  const out = new Map();
  const last = new Date().getFullYear();
  for (let y = fromYear; y <= last; y++) {
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
    if (y % 10 === 0) log(`metacritic ${type}: through ${y}, ${out.size} scored`);
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
  const claim = (t, r, how) => { result.set(t.id, { score: r.score, n: r.n, slug: r.slug, how }); used.add(r.mcId); };

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
