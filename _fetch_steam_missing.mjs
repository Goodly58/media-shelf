/**
 * Find a steamAppId for the 457 games in games.html that have none.
 *
 *   node _fetch_steam_missing.mjs            fetch + judge -> _steam-missing.json
 *   node _fetch_steam_missing.mjs --offline  re-judge the cache, fetch nothing
 *
 * NETWORK ONLY. This script never opens games.html for writing; applying is
 * _apply_steam_missing.mjs, and that is report-only unless given --apply.
 *
 * ROBOTS
 * ------
 * Checked before the first fetch, on 2026-08-18:
 *   store.steampowered.com/robots.txt      200. One `User-Agent: *` group
 *     disallowing /share/, /news/externalpost/, /email/, /widget/, /account/
 *     ackgift/ and four token/redirect query forms. /api/ is not disallowed,
 *     so storesearch and appdetails are both allowed. No Crawl-delay is set;
 *     we pace ourselves at ~1 req/sec anyway.
 *   cdn.cloudflare.steamstatic.com/robots.txt   404, nginx default. Nothing
 *     disallowed. header.jpg is a plain image fetch, and we send HEAD.
 * Anthropic agents are not named anywhere in either file.
 *
 * WHY A MISSING ID IS NOT THE SAME PROBLEM AS A WRONG ONE
 * ------------------------------------------------------
 * The repair pass had a stored id to corroborate against: if Steam's own search
 * for the title handed back the id already on the row, the row was fine and the
 * name was merely spelled differently. Here there is nothing to corroborate
 * with. Every match has to be earned from the name and the year alone, so the
 * gates are the same and the benefit of the doubt is smaller. A missing cover is
 * a gap; another game's cover is a lie, and the reader cannot tell.
 *
 * TWO THINGS THE REPAIR PASS DID NOT NEED
 * ---------------------------------------
 * 1. THE YEAR IN THE SEARCH NAME. storesearch labels re-released games with
 *    their original year: app 1238020 comes back as "Mass Effect™ 3 N7 Digital
 *    Deluxe Edition (2012)", while appdetails reports its store date, Jun 11
 *    2020 — the day EA moved it to Steam. Judged on the store date alone, a
 *    correct match looks eight years wrong. The parenthesised year is the better
 *    year, and it is used first.
 * 2. LATE PORTS ARE NORMAL HERE. These 457 rows skew to console games, and a
 *    console game reaching Steam years later is the ordinary case, not a
 *    suspicious one. So a Steam year AFTER the catalogue year is tolerated at
 *    reduced confidence, while a Steam year BEFORE it stays disqualifying — an
 *    app older than the game we are looking for is a different game.
 *
 * ABSENCE IS AN ANSWER
 * --------------------
 * Plenty of these are not on Steam and never will be: Switch and PlayStation
 * exclusives, Blizzard's Battle.net titles, delisted games, itch-only releases.
 * "Astral Chain" returns total:0 — that is a finding about the game, and it is
 * reported as such. What is NOT an answer is a throttle, so 202-with-empty-body,
 * 429, 403, 5xx and timeouts are retried and never written to the cache.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(HERE, f);

const OFFLINE = process.argv.includes('--offline');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > 0 ? Number(process.argv[i + 1]) : Infinity;
})();

const GAMES_FILE = at('games.html');
const OUT_FILE = at('_steam-missing.json');
const REPORT_FILE = at('_steam-missing-report.json');
/* Our own cache, so a concurrent job writing _steam-cache.json cannot lose our
   work or we theirs. The old cache is still read, so every search and app id it
   already holds is free. */
const CACHE_FILE = at('_steam-missing-cache.json');
const SEED_FILE = at('_steam-cache.json');

/* ------------------------------------------------------------------ arrays */

function readArray(file, name) {
  const h = fs.readFileSync(file, 'utf8');
  const a = h.search(new RegExp('const ' + name + '\\s*=\\s*\\['));
  if (a < 0) throw new Error(`${name} not found in ${file}`);
  const s = h.indexOf('[', a);
  let d = 0, e = -1, q = false, esc = false;
  for (let i = s; i < h.length; i++) {
    const c = h[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { e = i + 1; break; } }
  }
  if (e < 0) throw new Error(`${name} array never closes`);
  return { array: JSON.parse(h.slice(s, e)), start: s, end: e, html: h };
}

/* ------------------------------------------------------------ title folding */

const ENTITIES = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', shy: '',
  ndash: '-', mdash: '-', minus: '-', hellip: '...', middot: '.',
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', sbquo: "'", bdquo: '"',
  trade: '', reg: '', copy: '', deg: ' ', sect: '', para: '', bull: '.',
  eacute: 'e', egrave: 'e', agrave: 'a', ccedil: 'c', uuml: 'u', ouml: 'o',
  auml: 'a', ntilde: 'n', oslash: 'o', aring: 'a', szlig: 'ss', iexcl: '',
};

/** Entities first, always — "Preludes &amp; Nocturnes" folded straight to
 *  alphanumerics yields the token "amp", which matches nothing. */
function decodeEntities(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, g) => {
    if (g[0] === '#') {
      const n = (g[1] === 'x' || g[1] === 'X') ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    const k = g.toLowerCase();
    return k in ENTITIES ? ENTITIES[k] : m;
  });
}

const NUMBERS = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18,
  xix: 19, xx: 20,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const INSTALMENT = new Set(['episode', 'chapter', 'part', 'act', 'season', 'volume', 'vol', 'book']);

const EDITION = new Set([
  'edition', 'editions', 'definitive', 'complete', 'deluxe', 'gold', 'goty',
  'premium', 'ultimate', 'enhanced', 'remastered', 'remaster', 'redux',
  'special', 'anniversary', 'collection', 'collectors', 'collector',
  'directors', 'cut', 'hd', 'standard', 'digital',
  'reloaded', 'classic', 'legacy', 'game', 'year', 'of', 'the',
]);

/** A trailing "(2012)" on a storesearch name is Steam's own note of the
 *  original release year, and it is stripped from the name before comparing. */
const NAME_YEAR = /\s*[([]\s*((?:19|20)\d{2})\s*[)\]]\s*$/;
const nameYear = (s) => {
  const m = decodeEntities(s).replace(/[™®©℠]/g, ' ').trim().match(NAME_YEAR);
  return m ? Number(m[1]) : null;
};

/**
 * Greek letters are used as words in game titles and NFKD does not touch them,
 * so they fall out at the [^a-z0-9] strip and take a whole word with them.
 * Konami ships Metal Gear Solid Δ: Snake Eater; the catalogue writes it "Metal
 * Gear Solid Delta: Snake Eater". Dropping the Δ leaves the Steam name one word
 * short of the title, which scored 82/100 — under the bar — and threw away an
 * otherwise exact match on the right year.
 */
const GREEK = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta',
  η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu',
  ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma', ς: 'sigma',
  τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};

function strict(s) {
  const t = decodeEntities(s)
    .replace(/[™®©℠]/g, ' ')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[α-ω]/g, (c) => (c in GREEK ? ` ${GREEK[c]} ` : c))
    .replace(NAME_YEAR, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = t.split(' ').filter(Boolean).map((w) => (w in NUMBERS ? String(NUMBERS[w]) : w));
  if (words[0] === 'the') words.shift();
  return words.join(' ');
}

const loose = (s) => strict(s).split(' ').filter((w) => w && !EDITION.has(w)).join(' ');
const tokens = (s) => new Set(strict(s).split(' ').filter(Boolean));
const looseTokens = (s) => new Set(loose(s).split(' ').filter(Boolean));

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return (2 * hit) / (a.size + b.size);
}

function levSim(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const prev = new Array(b.length + 1), cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const subset = (a, b) => { for (const t of a) if (!b.has(t)) return false; return a.size > 0; };
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Numbers come in two kinds and they do not mean the same thing.
 *
 * A standalone number is an instalment: "Mass Effect 3" against "Mass Effect 2"
 * is two games, so these must match exactly, and roman numerals have already
 * been folded to digits by strict().
 *
 * A number welded inside a word is branding — "N7", "2K23", "BIT.TRIP". Here
 * only a CONTRADICTION counts: "PGA TOUR 2K23" against "PGA TOUR 2K25" is two
 * games and one character apart, so when both names carry welded numbers and
 * they disagree, that is decisive. But one side merely ADDING one is an extra
 * word, not a different game — which is the whole of the difference between
 * "Mass Effect 3" and Steam's "Mass Effect™ 3 N7 Digital Deluxe Edition".
 * Treating that "7" as a contradicting instalment number scored the correct
 * app at 70/100 and threw it away.
 */
const numParts = (s) => {
  const pure = new Set(), welded = new Set();
  for (const w of strict(s).split(' ')) {
    if (!w) continue;
    if (/^\d+$/.test(w)) pure.add(w);
    else if (/\d/.test(w)) welded.add(w);
  }
  return { pure, welded };
};

function numbersAgree(title, name) {
  const a = numParts(title), b = numParts(name);
  if (!sameSet(a.pure, b.pure)) return false;
  // Only a two-sided disagreement is a contradiction.
  if (a.welded.size && b.welded.size && !sameSet(a.welded, b.welded)) return false;
  return true;
}

/** 0-100. 100 only when the two names are the same name. */
function score(title, name) {
  const ts = strict(title), ns = strict(name);
  if (!ts || !ns) return 0;
  if (ts === ns) return 100;
  const tl = loose(title), nl = loose(name);
  if (tl && tl === nl) return 95;

  const tt = looseTokens(title), nt = looseTokens(name);
  const extra = [...nt].filter((w) => !tt.has(w));
  const clean = numbersAgree(title, name) && !extra.some((w) => INSTALMENT.has(w));

  if (clean && subset(tt, nt)) {
    const add = nt.size - tt.size;
    if (add >= tt.size) return 76;
    return Math.max(78, 87 - 3 * add);
  }
  if (clean && subset(nt, tt)) return Math.max(76, 85 - 3 * Math.max(0, tt.size - nt.size));

  const sim = Math.max(dice(tt, nt), levSim(ts, ns));
  return Math.min(clean ? 84 : 70, Math.round(sim * 100));
}

/**
 * Is one of these two names the other one plus a ": subtitle" tail?
 *
 * The 76-point floor exists to stop "DOOM" matching "DOOM Eternal", where the
 * extra word is part of a different game's name. But it also silently discarded
 * a whole class of correct matches, because Steam very often carries a
 * descriptive subtitle the catalogue does not:
 *     Audica            -> "AUDICA: Rhythm Shooter"
 *     Infinitode 2      -> "Infinitode 2 - Infinite Tower Defense"
 * and sometimes the reverse, where the catalogue is the longer one:
 *     "Through the Ages: A New Story of Civilization" -> "Through the Ages"
 * Reporting those as "not on Steam" would be false; they are plainly there.
 *
 * The separator is what tells the two cases apart. A subtitle is introduced by
 * one — a colon or a dash — and "DOOM Eternal" has none, so it stays out. The
 * extra words must also come AFTER the shared part: "Grisaia: Phantom Trigger"
 * has a separator but puts its extra word first, and that is a different game.
 *
 * Even so this only ever earns low confidence, which is reported and never
 * applied — it is the difference between a wrong answer and an unanswered
 * question, not a licence to write an id.
 */
function subtitled(a, b) {
  const sa = strict(a), sb = strict(b);
  if (!sa || !sb || sa === sb) return false;
  const [shortS, longS, longRaw] = sa.length <= sb.length ? [sa, sb, b] : [sb, sa, a];
  if (!longS.startsWith(shortS + ' ')) return false;
  return /[:\-–—]/.test(decodeEntities(longRaw));
}

/** Things that share a franchise name but are not the game. */
function isJunk(title, name) {
  const t = strict(title), n = strict(name);
  const words = /\b(demo|playtest|beta|alpha|soundtrack|ost|artbook|season pass|dlc|upgrade|trailer|server|sdk|prologue|teaser|wallpaper|test|expansion|bonus|skin|costume|avatar|theme|pack|bundle)\b/;
  const m = n.match(words);
  if (!m) return false;
  return !t.includes(m[1]);
}

/* ------------------------------------------------------------------- cache */

/** A cached failure must not be permanent. Throttles are never written here —
 *  only a real reply from Steam, including an honest "no results". */
const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
const seed = fs.existsSync(SEED_FILE) ? JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) : {};
let seedHits = 0;
const look = (k) => {
  if (k in cache) return cache[k];
  if (k in seed) { seedHits++; return seed[k]; }
  return undefined;
};
const has = (k) => k in cache || k in seed;

let dirty = 0;
const saveCache = () => { if (!OFFLINE) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); dirty = 0; } };
const remember = (k, v) => { cache[k] = v; if (++dirty >= 15) saveCache(); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** parsed json, or undefined when the failure is retryable (never cached). */
async function getJson(url, tries = 4) {
  for (let n = 0; n < tries; n++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en-US,en', 'User-Agent': 'media-shelf-id-repair/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      const body = await res.text();
      if (res.status === 429 || res.status === 403 || res.status === 408
        || res.status >= 500 || (res.status === 202 && !body.trim())) {
        await sleep(4000 * (n + 1));
        continue;
      }
      if (!res.ok) return null;
      if (!body.trim()) { await sleep(4000 * (n + 1)); continue; }
      try { return JSON.parse(body); } catch { return null; }
    } catch {
      await sleep(3000 * (n + 1));
    }
  }
  return undefined;
}

let searchCalls = 0, appCalls = 0, artCalls = 0, throttles = 0;

async function search(term) {
  const key = `search:${term.toLowerCase().trim()}`;
  if (has(key)) return look(key);
  if (OFFLINE) return null;
  await sleep(1100);
  searchCalls++;
  const j = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=en`);
  if (j === undefined) { throttles++; return null; }
  const items = (j && Array.isArray(j.items) ? j.items : [])
    .filter((i) => i && i.id && i.name)
    .map((i) => ({ id: i.id, name: i.name }));
  remember(key, items);
  return items;
}

async function appInfo(id) {
  const key = `app:${id}`;
  if (has(key)) return look(key);
  if (OFFLINE) return null;
  await sleep(1600); // appdetails throttles harder than storesearch
  appCalls++;
  const url = `https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=en&filters=basic,release_date`;
  let j = await getJson(url);
  if (j === undefined) { throttles++; return null; }
  let d = j && j[id];
  /* A 200 carrying {"success":false} means both "this is a package, not an app"
     and, sometimes, "ask me again later". Caching the second as the first is
     what caps coverage at a number our own bug chose, so it is asked twice. */
  if (!d || !d.success || !d.data) {
    await sleep(2500);
    appCalls++;
    j = await getJson(url);
    if (j === undefined) { throttles++; return null; }
    d = j && j[id];
  }
  if (!d || !d.success || !d.data) { remember(key, { ok: false }); return cache[key]; }
  const date = d.data.release_date && d.data.release_date.date;
  const ym = date && String(date).match(/\b(19|20)\d{2}\b/);
  const info = {
    ok: true,
    name: d.data.name,
    type: d.data.type,
    year: ym ? Number(ym[0]) : null,
    coming: !!(d.data.release_date && d.data.release_date.coming_soon),
  };
  remember(key, info);
  return info;
}

/**
 * Where Steam itself says the cover lives. Only asked when the legacy path
 * above has already 404ed, so it costs almost nothing.
 *
 * Steam has been migrating store art to a content-hashed path:
 *     shared.akamai.steamstatic.com/store_item_assets/steam/apps/<id>/<sha>/header.jpg
 * Older apps still answer on the bare legacy path — Red Dead Redemption 2 (app
 * 1174180) serves 200 there — but newer ones do not exist on it at all, on any
 * CDN host, under HEAD or GET. So "no header.jpg" splits into two different
 * findings, and only one of them is about the game:
 *   - Steam genuinely publishes no cover.
 *   - Steam publishes one, but at a hashed URL that the hardcoded pattern in
 *     games.html cannot construct from an app id alone.
 * The second is a bug in the page's art URL, not a reason to reject a correct
 * id, and it will silently affect every recently released game added from here
 * on. Recording the real URL is what lets a human tell the two apart.
 */
async function headerImage(id) {
  const key = `img:${id}`;
  if (has(key)) return look(key);
  if (OFFLINE) return null;
  await sleep(1600);
  appCalls++;
  const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=en&filters=basic`);
  if (j === undefined) { throttles++; return null; }
  const d = j && j[id];
  const url = d && d.success && d.data ? (d.data.header_image || null) : null;
  remember(key, url);
  return url;
}

/** The gate that matches what the reader sees: games.html draws every card from
 *  cdn.cloudflare.steamstatic.com/steam/apps/<id>/header.jpg. */
async function hasArt(id) {
  const key = `art:${id}`;
  if (has(key)) return look(key);
  if (OFFLINE) return null;
  await sleep(400);
  artCalls++;
  for (let n = 0; n < 3; n++) {
    try {
      const res = await fetch(`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`, {
        method: 'HEAD', signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status >= 500) { await sleep(3000 * (n + 1)); continue; }
      remember(key, res.status === 200);
      return cache[key];
    } catch { await sleep(2000 * (n + 1)); }
  }
  throttles++;
  return null;
}

/* -------------------------------------------------------------------- main */

const { array: GAMES } = readArray(GAMES_FILE, 'GAMES');
const missing = GAMES.filter((g) => !g.steamAppId).slice(0, LIMIT);

/* Every id already spoken for. A proposal landing on one of these would put an
   existing game's cover on this card — the exact failure we are avoiding. */
const taken = new Map();
for (const g of GAMES) if (g.steamAppId) taken.set(g.steamAppId, g.title);

console.log(`${GAMES.length} games, ${missing.length} without a steamAppId`);
console.log(`cache: ${Object.keys(cache).length} own entries, ${Object.keys(seed).length} seeded from _steam-cache.json\n`);

const found = [];
const absent = [];
const RESUME = at('_steam-missing.partial.json');
const done = fs.existsSync(RESUME) ? JSON.parse(fs.readFileSync(RESUME, 'utf8')) : { found: [], absent: [], at: 0 };
if (done.at) {
  found.push(...done.found); absent.push(...done.absent);
  console.log(`resuming from row ${done.at}\n`);
}

for (let i = done.at || 0; i < missing.length; i++) {
  const row = missing[i];
  const { title, year } = row;
  process.stdout.write(`  ${String(i + 1).padStart(3)}/${missing.length}  ${title.slice(0, 46).padEnd(46)}\r`);

  /* Steam's store search is close to a literal match, so the full title often
     returns nothing for a game that is plainly there. The ladder walks from the
     exact title down to its distinctive fragments; most titles never leave the
     first rung. Broad rungs are only spent when the narrow ones came back with
     nothing at all, which keeps the cost of proving absence down. */
  const clean = decodeEntities(title).replace(NAME_YEAR, '').trim();
  const terms = [];
  const push = (t) => { const c = String(t || '').trim(); if (c && c.length > 2 && !terms.includes(c)) terms.push(c); };
  push(clean);
  push(clean.replace(/[,:—–-]?\s*\b(definitive|complete|deluxe|gold|goty|premium|ultimate|enhanced|remastered|special|anniversary|collector'?s?|director'?s?)\b.*$/i, '').trim());
  const parts = clean.split(/\s*(?::|\s+[-–—]\s+)\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) { push(parts[0]); push(parts[parts.length - 1]); }
  const words = clean.replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !EDITION.has(w.toLowerCase()));
  if (words.length > 2) { push(words.slice(0, 2).join(' ')); push(words.slice(-2).join(' ')); }
  if (words.length) { push(words[0]); push(words[words.length - 1]); }

  let items = [];
  const seen = new Set();
  let searchWorked = false;
  let sawAnyResult = false;
  let rungs = 0;
  for (const t of terms) {
    const got = await search(t);
    rungs++;
    if (got === null) continue;
    searchWorked = true;
    if (got.length) sawAnyResult = true;
    for (const it of got) if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
    const best = Math.max(0, ...items.map((it) => score(title, it.name)));
    if (best >= 95) break;
    // A rung that already produced a plausible name does not need broadening;
    // broadening from here only adds franchise noise for the gates to reject.
    if (best >= 84 && rungs >= 2) break;
    // Once four rungs have all come back empty, the game is not on this store
    // under any spelling we can construct, and more rungs will not change that.
    if (!sawAnyResult && rungs >= 4) break;
  }

  if (!searchWorked) {
    absent.push({ title, year, kind: 'retry', reason: OFFLINE ? 'not in the cache yet — run without --offline' : 'every search attempt was throttled — re-run to retry' });
    continue;
  }

  if (!sawAnyResult) {
    absent.push({ title, year, kind: 'not-on-steam', reason: `Steam search returns nothing for this title (${rungs} search terms tried)` });
    continue;
  }

  const ranked = items
    .filter((it) => !isJunk(title, it.name))
    .map((it) => ({ ...it, s: score(title, it.name) }))
    .sort((a, b) => b.s - a.s);

  /* The floor is 76 rather than 78 so that the subtitle band above is actually
     reachable; everything in it still has to pass the type, year and art gates
     below, and can only come out at low confidence. */
  const best = ranked[0];
  if (!best || best.s < 76) {
    absent.push({
      title, year, kind: 'no-match',
      reason: best ? `results came back but none is this game (closest "${best.name}", ${best.s}/100)` : 'results came back, all of them DLC or merchandise',
    });
    continue;
  }

  const contenders = [best, ...ranked.filter((c) => c !== best && c.s >= Math.max(84, best.s - 12))].slice(0, 5);
  for (const c of contenders) {
    const info = await appInfo(c.id);
    c.info = info;
    /* The parenthesised year in the search name is the original release; the
       appdetails date is when the store page went up. Prefer the first. */
    c.nameYear = nameYear(c.name);
    c.storeYear = info && info.ok ? info.year : null;
    c.year = c.nameYear ?? c.storeYear;
    if (info && info.ok && info.name && score(title, info.name) < c.s) c.s = score(title, info.name);
  }

  /* Only type "game". A DLC whose name folds onto the title — "HITMAN 3 -
     Deluxe Pack" — is a perfect name match and the wrong id. Unreleased apps
     are kept, because a 2026 row in this catalogue may legitimately be a Steam
     page that has not opened yet, but they are labelled and capped. */
  const pool = contenders.filter((c) => c.info && c.info.ok && c.info.type === 'game');
  if (!pool.length) {
    const why = contenders.filter((c) => c.info && c.info.ok).map((c) => `"${c.name}" is ${c.info.type}`);
    const anyAsked = contenders.some((c) => c.info);
    absent.push({
      title, year,
      kind: anyAsked ? (why.length ? 'not-a-game' : 'no-details') : 'retry',
      reason: why.length
        ? `no candidate is an app of type "game" (${why.slice(0, 2).join('; ')})`
        : anyAsked ? `Steam returns no details for "${best.name}" (${best.id})` : 'the appdetails lookup was throttled — re-run to retry',
    });
    continue;
  }

  /* A Steam year AFTER the catalogue year is a late port and normal for this
     set. A Steam year BEFORE it is a different, older game. */
  const gapOf = (c) => {
    if (!year || c.year == null) return null;
    return c.year - year;
  };
  pool.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    const ga = gapOf(a), gb = gapOf(b);
    if (ga == null) return 1;
    if (gb == null) return -1;
    return Math.abs(ga) - Math.abs(gb);
  });

  const pick = pool[0];
  const g = gapOf(pick);
  const ahead = g == null ? null : Math.abs(g);

  /* Two apps under literally the same name — Tomb Raider 1996 and Tomb Raider
     2013. Only the year separates them, so without a usable year, stop. */
  const tiedNames = pool.filter((c) => c.id !== pick.id && strict(c.name) === strict(pick.name));
  if (tiedNames.length && (ahead == null || ahead > 3)) {
    absent.push({
      title, year, kind: 'ambiguous',
      reason: `${pool.length} Steam apps share the name "${pick.name}" and the year cannot tell them apart`,
    });
    continue;
  }

  /* Anything below 95 got there by containment: every word of the title is in
     the Steam name and the name has more. WHERE the extra words sit decides
     whether that is the same game or a different one.

       trailing   "Mass Effect 3"   inside "Mass Effect 3 N7 Digital Deluxe
                  Edition" — the name begins with the title and the rest is
                  branding. The same game.
       leading    "Phantom Trigger" inside "Grisaia: Phantom Trigger" — the
                  extra word is a series the title never claimed, and these are
                  two different games. So is "Runner2" inside "BIT.TRIP
                  Presents... Runner2".

     A leading extra is therefore never better than low, however exactly the
     years agree — the year agreeing is precisely what a game and its
     same-year series-mate would do. */
  const trailing = loose(pick.name).startsWith(loose(title));

  let confidence = null;
  if (g != null && g < -1) {
    /* Steam app predates the game. Usually that means a different, older game
       wearing a similar name, and it stays disqualified.
       But an EXACT name match can be earlier for an honest reason: a re-release
       shipped onto the publisher's existing app id rather than a new one, so
       the store page keeps its original date. "DOOM + DOOM II" is app 2280,
       whose page still reads 2007, against a catalogue year of 2024 for the
       2024 compilation. Silently dropping a 100/100 name match is the kind of
       non-answer this pass is supposed to avoid, so it is reported at low for a
       human instead of thrown away. */
    confidence = pick.s >= 95 ? 'low' : null;
  } else if (pick.s >= 95 && ahead != null && ahead <= 2) confidence = 'high';
  else if (pick.s >= 95 && g != null && g > 2 && g <= 12) confidence = 'medium'; // late port
  else if (pick.s >= 95 && ahead == null) confidence = 'medium';
  else if (pick.s >= 95) confidence = 'low';
  else if (pick.s >= 84 && ahead != null && ahead <= 1) confidence = trailing ? 'medium' : 'low';
  else if (pick.s >= 84 && g != null && g > 1 && g <= 12) confidence = 'low';
  else if (pick.s >= 78 && g === 0 && subset(looseTokens(title), looseTokens(pick.name))) confidence = 'low';
  // Title plus a subtitle, or minus one, with the year agreeing. Low only.
  else if (pick.s >= 76 && ahead != null && ahead <= 1 && subtitled(title, pick.name)) confidence = 'low';

  // An unreleased store page is real art and real tags, but it is not the same
  // claim as a shipped game, so it never rises above medium.
  if (confidence === 'high' && pick.info.coming) confidence = 'medium';

  /* An id another row already holds is the strongest possible warning. One app
     id names one game, so a second row claiming it is either a duplicate of the
     first or — far more likely — this title's page does not exist and the
     search has handed back its successor's. The catalogue's "Overwatch" (2016)
     resolves this way to app 2357570, which is the row already sitting on
     "Overwatch 2": Blizzard renamed Overwatch 2 to plain "Overwatch", so the
     name matches perfectly and the id is still the wrong game's art. Never
     applied, always reported. */
  const clash = taken.get(pick.id);
  if (clash) confidence = 'low';

  if (!confidence) {
    absent.push({
      title, year, kind: 'no-match',
      reason: `"${pick.name}" (${pick.id}) scores ${pick.s}/100 and dates to ${pick.year ?? '?'} against a catalogue year of ${year ?? '?'}`,
    });
    continue;
  }

  /* The point of the whole job: the cover must exist — at the URL games.html
     actually builds. A correct id whose art 404s there is still a correct id,
     so it is reported with headerOk false rather than thrown away; what it
     buys is tags and a genre signal, not a cover. */
  const art = await hasArt(pick.id);
  if (art === null && !OFFLINE) {
    absent.push({ title, year, kind: 'retry', reason: 'the cover-art check was throttled — re-run to retry' });
    continue;
  }
  const hosted = art === false ? await headerImage(pick.id) : null;

  found.push({
    title,
    year,
    newId: pick.id,
    steamName: pick.name,
    type: pick.info.type,
    headerOk: art === true,
    confidence,
    match: pick.s,
    steamYear: pick.year ?? null,
    nameYear: pick.nameYear ?? null,
    storeYear: pick.storeYear ?? null,
    comingSoon: !!pick.info.coming,
    genre: row.genre ?? null,
    collidesWith: clash || null,
    // Only set when the legacy path 404ed: where Steam really serves the cover.
    hostedArt: hosted || null,
  });

  if ((i + 1) % 10 === 0) {
    saveCache();
    fs.writeFileSync(RESUME, JSON.stringify({ found, absent, at: i + 1 }));
  }
}

saveCache();
fs.writeFileSync(RESUME, JSON.stringify({ found, absent, at: missing.length }));
process.stdout.write(' '.repeat(72) + '\r');

/* ------------------------------------------------------------------ report */

const byConf = (c) => found.filter((r) => r.confidence === c);
console.log(`fetched ${searchCalls} searches, ${appCalls} app lookups, ${artCalls} art checks (${seedHits} answers reused from the old cache)`);
if (throttles) console.log(`${throttles} requests were throttled and retried`);
console.log();
console.log(`  ${String(found.length).padStart(3)} ids found      — high ${byConf('high').length}, medium ${byConf('medium').length}, low ${byConf('low').length}`);
console.log(`  ${String(absent.length).padStart(3)} not proposed   — a missing id beats a wrong one\n`);

/* The cover was the point, so say plainly how many of the finds deliver one. */
const noArt = found.filter((r) => !r.headerOk);
const hashed = noArt.filter((r) => r.hostedArt);
console.log(`  of the ${found.length} finds, ${found.length - noArt.length} render a cover at the URL games.html builds`);
if (noArt.length) {
  console.log(`  ${noArt.length} do not — ${hashed.length} because Steam has moved that app's art to a content-hashed path`);
  console.log(`     (games.html hardcodes steamstatic.com/steam/apps/<id>/header.jpg, which cannot be`);
  console.log(`      built from an app id for those apps — a page bug, not a bad id)`);
  for (const r of hashed.slice(0, 6)) console.log(`       ${r.title} (${r.year}) -> ${r.newId}`);
  if (hashed.length > 6) console.log(`       … ${hashed.length - 6} more`);
  const truly = noArt.filter((r) => !r.hostedArt);
  if (truly.length) {
    console.log(`  ${truly.length} have no cover published by Steam at all:`);
    for (const r of truly.slice(0, 6)) console.log(`       ${r.title} (${r.year}) -> ${r.newId}`);
  }
}
console.log();

const kinds = new Map();
for (const a of absent) {
  if (!kinds.has(a.kind)) kinds.set(a.kind, []);
  kinds.get(a.kind).push(a);
}
const LABEL = {
  'not-on-steam': 'Steam has no such game — console exclusive, delisted or never released there',
  'no-match': 'results came back, none of them is this game',
  'not-a-game': 'only DLC, demos or soundtracks matched',
  'ambiguous': 'same-name apps the year cannot separate',
  'no-art': 'name matched but the card art is gone',
  'no-details': 'Steam returns no details for the matched app',
  retry: 'never actually asked — re-run to retry',
};
console.log('not proposed, by reason:');
for (const [k, list] of [...kinds].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ${String(list.length).padStart(3)}  ${LABEL[k] || k}`);
  for (const u of list.slice(0, 6)) console.log(`       ${u.title} (${u.year ?? '?'})`);
  if (list.length > 6) console.log(`       … ${list.length - 6} more`);
}

const collisions = found.filter((r) => r.collidesWith);
if (collisions.length) {
  console.log(`\n${collisions.length} proposals land on an app id another row already uses — check by hand:`);
  for (const c of collisions.slice(0, 15)) {
    console.log(`  ${c.newId}  ${c.title} (${c.year}) -> already on "${c.collidesWith}"`);
  }
}

const dupes = new Map();
for (const r of found) {
  if (!dupes.has(r.newId)) dupes.set(r.newId, []);
  dupes.get(r.newId).push(r.title);
}
const internal = [...dupes].filter(([, t]) => t.length > 1);
if (internal.length) {
  console.log(`\n${internal.length} app ids proposed for more than one of these rows:`);
  for (const [id, titles] of internal.slice(0, 10)) console.log(`  ${id}  ${titles.join(' | ')}`);
}

console.log('\nhighest-confidence finds:');
for (const r of [...found].sort((a, b) => b.match - a.match).slice(0, 20)) {
  console.log(`  ${r.confidence.padEnd(6)} ${r.title.slice(0, 40).padEnd(40)} (${r.year})  -> ${String(r.newId).padEnd(8)} "${r.steamName}" (${r.steamYear ?? '?'})`);
}

/* The deliverable keeps the seven agreed keys; working detail goes beside it. */
const outFile = OFFLINE ? at('_steam-missing.offline.json') : OUT_FILE;
fs.writeFileSync(outFile, JSON.stringify(
  found.map((r) => ({
    title: r.title, year: r.year, newId: r.newId, steamName: r.steamName,
    type: r.type, headerOk: r.headerOk, confidence: r.confidence,
  })),
  null, 1,
));
fs.writeFileSync(OFFLINE ? at('_steam-missing-report.offline.json') : REPORT_FILE, JSON.stringify({
  generated: new Date().toISOString(),
  totals: {
    missing: missing.length,
    found: found.length,
    high: byConf('high').length,
    medium: byConf('medium').length,
    low: byConf('low').length,
    notProposed: absent.length,
    byReason: Object.fromEntries([...kinds].map(([k, v]) => [k, v.length])),
    coverRenders: found.length - noArt.length,
    coverMissingAtSiteUrl: noArt.length,
    coverMovedToHashedPath: hashed.length,
  },
  found, absent, collisions, internalDuplicates: internal,
}, null, 1));

console.log(`\nwrote ${path.basename(outFile)} (${found.length}) and ${path.basename(REPORT_FILE)} (full working detail)`);
console.log('nothing was written to games.html — that is _apply_steam_missing.mjs, and it needs --apply');
