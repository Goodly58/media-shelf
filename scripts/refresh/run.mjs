/* Refresh every catalogue from its sources, then rewrite data/*.json.

   node scripts/refresh/run.mjs                  everything (the weekly job)
   node scripts/refresh/run.mjs --merge          rebuild data/ from the caches only
   node scripts/refresh/run.mjs --only=rt,books  just those steps, then merge
   node scripts/refresh/run.mjs --budget=30      minutes per slow step (default 55)
   node scripts/refresh/run.mjs --only=rt --no-merge   fetch only; leave data/ alone

   Slow sources (Rotten Tomatoes, Steam, Metacritic games, Goodreads) are
   refreshed a slice at a time, oldest first, so each run stays within its
   budget and the whole catalogue is re-checked over a few weeks. A source
   that fails is logged and skipped; it never blocks the others. */
import fs from 'node:fs';
import path from 'node:path';
import { loadCache, saveCache, readData, writeData, writeMeta, compact, log, traffic, CACHE } from './lib.mjs';
import { loadImdb } from './imdb.mjs';
import { resolveWikidata, resolveSteam } from './wikidata.mjs';
import { crawlAll, gameScore } from './metacritic.mjs';
import { resolveImages, searchArticle } from './wikipedia.mjs';
import { resolveCategories } from './categories.mjs';
import { resolveTrailers } from './trailers.mjs';
import { refreshRT } from './rottentomatoes.mjs';
import { refreshReviews, refreshTags, popularApps, appDetails, refreshAssets } from './steam.mjs';
import { refreshBooks, refreshEditionCovers } from './books.mjs';
import { resolveTvmaze } from './tvmaze.mjs';
import { crawlGenreLists } from './goodreads-lists.mjs';
import { mergeScreen, mergeGames, mergeBooks, slugify, articleMatches } from './merge.mjs';
import { snapshot, assess, save as saveHealth } from './health.mjs';

const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}`));
  if (!a) return dflt;
  return a.includes('=') ? a.split('=')[1] : true;
};
const ONLY = arg('only', null);
const MERGE_ONLY = arg('merge', false);
const BUDGET = Number(arg('budget', 55));
const want = (s) => !MERGE_ONLY && (!ONLY || ONLY.split(',').includes(s));
// What each step did, for the health check (health.mjs) at the end.
const RUN_START = Date.now();
const SNAP = snapshot();
const steps = [];
const step = async (name, fn) => {
  if (!want(name)) return;
  const t = Date.now();
  try {
    await fn();
    steps.push({ name, seconds: Math.round((Date.now() - t) / 1000) });
    log(`${name}: done in ${Math.round((Date.now() - t) / 1000)}s`);
  } catch (e) {
    steps.push({ name, seconds: Math.round((Date.now() - t) / 1000), error: e.message });
    log(`${name}: FAILED (${e.message}), keeping previous data`);
  }
};
const health = (notes = []) => {
  if (!steps.length) return;
  const report = assess({ since: RUN_START, steps, snap: SNAP, traffic, notes });
  saveHealth(report);
  log(report.ok ? 'health: all sources fine' : `health: ${report.problems.join('; ')}`);
};
const MIN_VOTES = 10000;
const MIN_STEAM_REVIEWS = 10000;

const before = {};
for (const k of ['games', 'books', 'movies', 'shows']) before[k] = readData(k);

/* ---------------------------------------------------- films and series */
await step('imdb', async () => {
  const keep = new Set([...before.movies, ...before.shows].map((r) => r.id));
  const { titles } = await loadImdb({ minVotes: MIN_VOTES, keep });
  saveCache('imdb-selected', [...titles.values()]);
});
const selected = () => loadCache('imdb-selected', []);

await step('wikidata', async () => { await resolveWikidata(selected()); });

await Promise.all([
  step('metacritic', async () => { await crawlAll(); }),
  step('images', async () => {
    const wd = loadCache('wikidata');
    await resolveImages(selected().map((t) => ({ key: t.id, wiki: wd[t.id]?.wiki })).filter((x) => x.wiki), { cacheName: 'images' });
  }),
  step('categories', async () => {
    // Wikipedia categories: subgenres, themes and countries for the genre picker.
    const wd = loadCache('wikidata');
    await resolveCategories(selected().map((t) => ({ key: t.id, wiki: wd[t.id]?.wiki })).filter((x) => x.wiki), { budgetMin: Math.min(30, BUDGET) });
  }),
  step('trailers', async () => {
    // A YouTube trailer per film and series, for the reels view.
    // On its own (the daily run, or a catch-up) it may use the whole budget; alongside the rest, 50 minutes.
    await resolveTrailers(selected().map((t) => ({ id: t.id, kind: t.kind, title: t.title, year: t.year, votes: t.votes })), { budgetMin: ONLY === 'trailers' ? BUDGET : Math.min(50, BUDGET) });
  }),
  step('tvmaze', async () => {
    await resolveTvmaze(selected().filter((t) => t.kind === 'shows').map((t) => t.id), { budgetMin: Math.min(20, BUDGET) });
  }),
  step('steamlist', async () => {
    // New popular games: SteamSpy's listing, then the store says whether each is a released game.
    const pop = await popularApps({ pages: 6 });
    saveCache('steam-popular', pop);
    const have = new Set(before.games.map((g) => g.steamId).filter(Boolean));
    const details = loadCache('steam-details');
    for (const a of pop) {
      if (a.reviews < MIN_STEAM_REVIEWS || have.has(a.appId) || details[a.appId]) continue;
      details[a.appId] = (await appDetails(a.appId)) || { missing: true };
    }
    saveCache('steam-details', details);
  }),
]);

/* ------------------------------------------------- slow rolling refreshes */
const steamIds = () => {
  const pop = loadCache('steam-popular', []);
  const have = new Set(before.games.map((g) => g.steamId).filter(Boolean));
  return [...have, ...pop.filter((a) => a.reviews >= MIN_STEAM_REVIEWS && !have.has(a.appId)).map((a) => a.appId)];
};

await Promise.all([
  step('rt', async () => {
    const wd = loadCache('wikidata');
    const prev = new Map([...before.movies, ...before.shows].map((r) => [r.id, r]));
    const titles = selected().map((t) => ({ id: t.id, title: t.title, votes: t.votes, rt: wd[t.id]?.rt })).filter((t) => t.rt)
      // never-checked first, then the most popular
      .sort((a, b) => (prev.get(a.id)?.rt != null) - (prev.get(b.id)?.rt != null) || b.votes - a.votes);
    await refreshRT(titles, { budgetMin: BUDGET });
  }),
  step('steam', async () => {
    const ids = steamIds();
    await refreshAssets(ids);
    await Promise.all([refreshReviews(ids, { budgetMin: BUDGET }), refreshTags(ids, { budgetMin: BUDGET })]);
  }),
  step('gamesmc', async () => {
    const wds = await resolveSteam(steamIds());
    const mcg = loadCache('mc-games');
    const stale = Date.now() - 30 * 864e5;
    const pop = new Map(loadCache('steam-popular', []).map((a) => [a.appId, a]));
    const jobs = before.games.map((g) => ({ key: g.id, title: g.title, year: g.year, appId: g.steamId, slug: g.mcSlug }));
    for (const id of steamIds()) if (!before.games.some((g) => g.steamId === id)) jobs.push({ key: 'steam:' + id, title: pop.get(id)?.name, appId: id });
    const due = jobs.filter((j) => j.title && (!mcg[j.key] || mcg[j.key].at < stale)).sort((a, b) => (mcg[a.key]?.at || 0) - (mcg[b.key]?.at || 0));
    const deadline = Date.now() + BUDGET * 60e3;
    const norm = (s) => slugify(String(s).replace(/\s*\(\d{4}\)\s*$/, '')).replace(/-/g, '');
    for (const j of due) {
      if (Date.now() > deadline) break;
      let hit = null;
      for (const slug of [...new Set([j.slug, wds[j.appId]?.mc, slugify(j.title)].filter(Boolean))]) {
        let r;
        try { r = await gameScore(slug); } catch { continue; }
        if (r && r.score != null && norm(r.title) === norm(j.title) && (!j.year || !r.year || Math.abs(r.year - j.year) <= 2)) { hit = { ...r, slug }; break; }
      }
      mcg[j.key] = hit ? { score: hit.score, n: hit.n, slug: hit.slug, at: Date.now() } : { none: true, at: Date.now() };
    }
    saveCache('mc-games', mcg);
  }),
  step('books', async () => {
    // New books from Goodreads' genre lists (re-crawled about monthly), then rolling re-verification.
    await crawlGenreLists({ listsPerGenre: 2, pages: 3 });
    const order = before.books.slice().sort((a, b) => (b.ratings || 0) - (a.ratings || 0));
    await refreshBooks(order, { budgetMin: BUDGET, olOnlyMissing: true });
    await refreshEditionCovers(readData('books'), { budgetMin: 15 });
  }),
]);

await step('gameart', async () => {
  // Non-Steam games: the lead image of their Wikipedia article.
  const gimg = loadCache('images-games');
  const missing = before.games.filter((g) => !g.steamId && !g.img && !gimg[g.id]);
  for (const g of missing.slice(0, 300)) {
    const hits = await searchArticle(`${g.title} video game`);
    const hit = hits.find((h) => articleMatches(h, g.title));
    gimg[g.id] = hit ? { wiki: hit, at: Date.now() } : { wiki: null, img: null, at: Date.now() };
  }
  saveCache('images-games', gimg);
  const items = Object.entries(gimg).filter(([, v]) => v.wiki && !v.img).map(([key, v]) => ({ key, wiki: v.wiki }));
  if (items.length) await resolveImages(items, { cacheName: 'images-games' });
});

/* ------------------------------------------------------------------ merge */
if (arg('no-merge', false)) { health(); log('fetch only: data/ left as it was'); process.exit(0); }
const { movies, shows, tmdb } = await mergeScreen(before.movies, before.shows);
writeMeta({ tmdbTrailers: tmdb });
const games = mergeGames(before.games, { newApps: loadCache('steam-popular', []).filter((a) => a.reviews >= MIN_STEAM_REVIEWS) });
const books = mergeBooks(before.books);

function diff(kind, a, b) {
  // Compared as written, so a field that is empty either way is not a change.
  const old = new Map(a.map((r) => [r.id, JSON.stringify(compact(r))]));
  let added = 0, changed = 0;
  for (const r of b) { const o = old.get(r.id); if (o == null) added++; else if (o !== JSON.stringify(compact(r))) changed++; }
  const removed = a.length - (b.length - added);
  return { kind, added, changed, removed, total: b.length };
}
const report = [diff('games', before.games, games), diff('books', before.books, books), diff('films', before.movies, movies), diff('series', before.shows, shows)];

// Never write a catalogue that shrank sharply: that is a source failing, not the world changing.
const out = { games, books, movies, shows };
const refused = [];
for (const [k, rows] of Object.entries(out)) {
  if (before[k].length > 500 && rows.length < before[k].length * 0.8) {
    log(`${k}: refusing to shrink from ${before[k].length} to ${rows.length}; keeping the previous file`);
    refused.push(`${k}: would have shrunk from ${before[k].length} to ${rows.length}, kept the previous file`);
    continue;
  }
  writeData(k, rows);
}
health(refused);

const parts = report.filter((r) => r.added || r.changed || r.removed)
  .map((r) => `${r.kind} ${[r.added && `+${r.added}`, r.changed && `${r.changed} updated`, r.removed && `-${r.removed}`].filter(Boolean).join(' ')}`);
const summary = parts.length ? `Refresh scores: ${parts.join(', ')}` : 'Refresh scores: no changes';
fs.writeFileSync(path.join(CACHE, 'summary.txt'), summary + '\n');
log(summary);
