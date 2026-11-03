/* When a film reaches cinemas, digital (to rent, buy or stream) and Blu-ray or DVD: TMDB's release
   dates, asked with the same key as the trailers. They are the US dates, or, for a film released
   at home only in its own country (an Indian film on Prime Video, say), that country's. The same
   answer gives every film its release day, and a series its premiere, which order the shelves'
   Newest and Oldest within a year.

   Cache 'tmdb-releases': { imdbId: { rel: {...} | null, day, tm, at, v } }, rel as releaseInfo
   makes it, day as primaryDay (version v: a change to either bumps VERSION, so every title is
   asked again once). */
import { get, loadCache, saveCache, log } from './lib.mjs';

const DAY = 864e5;
export const VERSION = 3;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* Subscription services as TMDB's notes name them ("Netflix", "HBO Max", "Paramount+ with
   Showtime"), and the name the site gives each. A note naming none ("Premium VOD", "4K UHD",
   "Apple TV", the store) is plain digital. HBO, the TV channel, airs a film the day after Max
   streams it, so it is not counted. */
const SERVICES = [
  [/netflix/i, 'Netflix'],
  [/prime video|amazon prime/i, 'Prime Video'],
  [/disney\s*(\+|plus)/i, 'Disney+'],
  [/paramount\s*(\+|plus)/i, 'Paramount+'],
  [/apple\s*tv\s*(\+|plus)/i, 'Apple TV+'],
  [/\b(hbo\s*)?max\b/i, 'Max'],
  [/hulu/i, 'Hulu'],
  [/peacock/i, 'Peacock'],
  [/starz/i, 'Starz'],
  [/showtime/i, 'Showtime'],
  [/mgm\s*(\+|plus)/i, 'MGM+'],
  [/amc\s*(\+|plus)/i, 'AMC+'],
  [/shudder/i, 'Shudder'],
  [/\bmubi\b/i, 'MUBI'],
  [/criterion channel/i, 'Criterion Channel'],
  [/crunchyroll/i, 'Crunchyroll'],
  [/(jio\s*)?hotstar/i, 'JioHotstar'],
  [/\bzee\s*5\b/i, 'ZEE5'],
  [/sony\s*liv/i, 'SonyLIV'],
  [/\btubi\b/i, 'Tubi'],
];
export function service(note) {
  const n = String(note || '');
  for (const [re, name] of SERVICES) if (re.test(n)) return name;
  return null;
}

/**
 * A film's releases from a TMDB /movie answer with release_dates appended, as the site keeps them:
 * { c: country, t: cinemas (tl: 1 when only a limited release), d: digital (dn: the service it
 * premieres on), p: Blu-ray and DVD, s: [[service, date], ...] streaming after that }, or null when
 * TMDB has none of these. One country throughout: the US, or failing that the first of the film's
 * own countries with a release at home, then the first with one in cinemas.
 */
export function releaseInfo(j) {
  const by = new Map();
  for (const r of (j && j.release_dates && j.release_dates.results) || []) {
    if (!r || typeof r.iso_3166_1 !== 'string') continue;
    const list = (r.release_dates || []).map((x) => ({ type: x && x.type, date: String((x && x.release_date) || '').slice(0, 10), note: (x && x.note) || '' }))
      // 2 limited and 3 wide in cinemas, 4 digital, 5 Blu-ray and DVD, 6 TV (premieres, 1, say nothing here).
      .filter((x) => DATE.test(x.date) && x.type >= 2 && x.type <= 6);
    if (list.length) by.set(r.iso_3166_1, list.sort((a, b) => a.date.localeCompare(b.date)));
  }
  const own = [...(Array.isArray(j && j.origin_country) ? j.origin_country : []), ...((j && j.production_countries) || []).map((c) => c && c.iso_3166_1)];
  const order = [...new Set(['US', ...own.filter((c) => typeof c === 'string')])];
  const has = (c, types) => (by.get(c) || []).some((x) => types.includes(x.type));
  const c = order.find((x) => has(x, [4, 5])) || order.find((x) => has(x, [2, 3]));
  if (!c) return null;
  const list = by.get(c), first = (type) => list.find((x) => x.type === type);
  const out = { c };
  const wide = first(3), limited = first(2);
  if (wide || limited) { out.t = (wide || limited).date; if (!wide) out.tl = 1; }
  const dig = first(4);
  if (dig) { out.d = dig.date; const s = service(dig.note); if (s) out.dn = s; }
  const disc = first(5);
  if (disc) out.p = disc.date;
  // Streaming after the first digital release (Peacock four months on, say): a date per service.
  const later = [];
  for (const x of list) {
    const s = (x.type === 4 || x.type === 6) && x !== dig ? service(x.note) : null;
    if (s && s !== out.dn && !later.some((l) => l[0] === s)) later.push([s, x.date]);
  }
  if (later.length) out.s = later.slice(0, 3);
  return out;
}

/** The day a title first came out, as TMDB has it: a film's release date, a series' first air date. */
export function primaryDay(j, kind) {
  const d = j && (kind === 'shows' ? j.first_air_date : j.release_date);
  return typeof d === 'string' && DATE.test(d) ? d : null;
}

/** Whether a title's dates are due another look: never asked (or asked by an older VERSION); a
    recent film every run while it is new or not yet at home (dates are announced, and move, in
    those weeks), monthly once it has been at home for two months; any other title once a year. */
export function releaseDue(c, now = Date.now(), recent = true) {
  if (!c || c.v !== VERSION) return true;
  if (!recent) return now - c.at > 365 * DAY;
  const home = c.rel && (c.rel.d || c.rel.p);
  const settled = home && Date.parse(home) < now - 60 * DAY;
  return now - c.at > (settled ? 30 : 0.5) * DAY;
}

/**
 * Ask TMDB about each title ({ id, kind, votes, recent }) due a look, recent films first, then the
 * most voted, until the budget runs out: a film's release dates and day, a series' premiere.
 */
export async function refreshReleases(titles, { budgetMin = 15 } = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) { log('releases: no TMDB_API_KEY, skipped'); return; }
  const cache = loadCache('tmdb-releases'), videos = loadCache('tmdb-videos'), cast = loadCache('tmdb-cast');
  const deadline = Date.now() + budgetMin * 60e3;
  const order = titles.filter((t) => releaseDue(cache[t.id], Date.now(), t.recent))
    .sort((a, b) => (b.recent ? 1 : 0) - (a.recent ? 1 : 0) || (b.votes || 0) - (a.votes || 0));
  const api = (p) => `https://api.themoviedb.org/3${p}${p.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`;
  let n = 0, found = 0, errors = 0;
  for (const t of order) {
    if (Date.now() > deadline) break;
    // A bad key fails every request: stop rather than run through the whole list.
    if (errors >= 20) { log('releases: tmdb keeps failing; stopping'); break; }
    try {
      const tv = t.kind === 'shows';
      // TMDB's own id, kept by the trailers and cast steps, saves the lookup by IMDb id.
      let tm = cache[t.id]?.tm || videos[t.id]?.tm || cast[t.id]?.tm || null;
      if (!tm) {
        const hit = await get(api(`/find/${t.id}?external_source=imdb_id`), { paceMs: 120 });
        tm = (tv ? hit?.tv_results : hit?.movie_results)?.[0]?.id || null;
      }
      const j = tm ? await get(api(tv ? `/tv/${tm}` : `/movie/${tm}?append_to_response=release_dates`), { paceMs: 120 }) : null;
      const rel = tv ? null : releaseInfo(j), day = primaryDay(j, t.kind);
      cache[t.id] = { rel, day, tm, at: Date.now(), v: VERSION };
      n++; errors = 0;
      if (rel || day) found++;
      if (n % 500 === 0) saveCache('tmdb-releases', cache);
    } catch (e) { errors++; log(`releases: tmdb ${t.id}: ${e.message}`); }
  }
  saveCache('tmdb-releases', cache);
  log(`releases: asked TMDB about ${n} of ${order.length} due, ${found} with dates`);
}
