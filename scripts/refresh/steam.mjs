/* Steam: review scores from the store's own public review endpoint, player
   tags from SteamSpy, and the list of popular PC games for discovering
   titles the catalogue is missing. */
import { get, log, loadCache, saveCache } from './lib.mjs';

/** Share of positive reviews and the review count, straight from Steam. */
export async function steamReviews(appId) {
  const j = await get(`https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`, { paceMs: 1600 });
  const q = j?.query_summary;
  if (!j?.success || !q || !q.total_reviews) return { score: null, n: 0 };
  return { score: Math.round((q.total_positive / q.total_reviews) * 100), n: q.total_reviews };
}

export async function refreshReviews(appIds, { budgetMin = 60, maxAgeDays = 14 } = {}) {
  const cache = loadCache('steam-reviews');
  const stale = Date.now() - maxAgeDays * 864e5;
  const deadline = Date.now() + budgetMin * 60e3;
  const todo = appIds.filter((id) => !cache[id] || cache[id].at < stale);
  log(`steam reviews: ${todo.length} of ${appIds.length} due`);
  let done = 0;
  for (const id of todo) {
    if (Date.now() > deadline) break;
    try { cache[id] = { ...(await steamReviews(id)), at: Date.now() }; }
    catch (e) { log(`steam ${id}: ${e.message}`); continue; }
    if (++done % 100 === 0) { saveCache('steam-reviews', cache); log(`steam reviews: ${done}/${todo.length}`); }
  }
  saveCache('steam-reviews', cache);
  return cache;
}

/** Player tags (most-voted first) for one app, from SteamSpy. */
export async function steamTags(appId) {
  const j = await get(`https://steamspy.com/api.php?request=appdetails&appid=${appId}`, { paceMs: 1100 });
  if (!j || !j.appid) return null;
  const tags = Object.entries(j.tags || {}).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { tags, name: j.name, positive: j.positive, negative: j.negative };
}

export async function refreshTags(appIds, { budgetMin = 60, maxAgeDays = 90 } = {}) {
  const cache = loadCache('steam-tags');
  const stale = Date.now() - maxAgeDays * 864e5;
  const deadline = Date.now() + budgetMin * 60e3;
  const todo = appIds.filter((id) => !cache[id] || cache[id].at < stale);
  log(`steam tags: ${todo.length} of ${appIds.length} due`);
  let done = 0;
  for (const id of todo) {
    if (Date.now() > deadline) break;
    try { const r = await steamTags(id); cache[id] = { ...(r || { tags: [] }), at: Date.now() }; }
    catch (e) { log(`steamspy ${id}: ${e.message}`); continue; }
    if (++done % 100 === 0) { saveCache('steam-tags', cache); log(`steam tags: ${done}/${todo.length}`); }
  }
  saveCache('steam-tags', cache);
  return cache;
}

/**
 * Popular apps from SteamSpy's owner-sorted listing (1,000 per page; SteamSpy
 * asks for one such request a minute).
 */
export async function popularApps({ pages = 6 } = {}) {
  const out = [];
  for (let p = 0; p < pages; p++) {
    const j = await get(`https://steamspy.com/api.php?request=all&page=${p}`, { paceMs: 61000, timeout: 120000 });
    if (!j) break;
    for (const a of Object.values(j)) out.push({ appId: a.appid, name: a.name, reviews: (a.positive || 0) + (a.negative || 0) });
    log(`steamspy page ${p}: ${out.length} apps`);
  }
  return out;
}

/** Store metadata: is it a game, when did it release, is it still listed. */
export async function appDetails(appId) {
  const j = await get(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`, { paceMs: 1600 });
  const d = j?.[appId];
  if (!d?.success) return null;
  const x = d.data;
  const year = Number((x.release_date?.date || '').match(/\d{4}/)?.[0]) || null;
  return {
    type: x.type, name: x.name, year, comingSoon: Boolean(x.release_date?.coming_soon),
    genres: (x.genres || []).map((g) => g.description),
    isFree: Boolean(x.is_free),
  };
}

/* Exact artwork paths from the store's own browse API, 50 apps per request.
   Art uploaded since 2024 lives under hashed folders, so the old fixed
   /steam/apps/<id>/library_600x900.jpg address 404s for new games. */
const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';
export async function refreshAssets(appIds, { maxAgeDays = 30 } = {}) {
  const cache = loadCache('steam-assets');
  const stale = Date.now() - maxAgeDays * 864e5;
  const todo = appIds.filter((id) => !cache[id] || cache[id].at < stale);
  log(`steam assets: ${todo.length} of ${appIds.length} due`);
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50);
    const input = { ids: chunk.map((appid) => ({ appid })), context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } };
    let j;
    try { j = await get(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, { paceMs: 1500 }); }
    catch (e) { log(`steam assets batch ${i}: ${e.message}`); continue; }
    const seen = new Set();
    for (const it of j?.response?.store_items || []) {
      const a = it.assets;
      const url = (f) => (a && f ? ASSET_BASE + a.asset_url_format.replace('${FILENAME}', f).replace(/\?.*$/, '') : null);
      cache[it.appid] = { lib: url(a?.library_capsule), header: url(a?.header), at: Date.now() };
      seen.add(it.appid);
    }
    for (const id of chunk) if (!seen.has(id)) cache[id] = { lib: null, header: null, at: Date.now() };
  }
  saveCache('steam-assets', cache);
  return cache;
}
