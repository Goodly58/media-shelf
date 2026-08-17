/**
 * Repair the wrong steamAppIds in games.html.
 *
 *   node _repair_steam_ids.mjs                    report only -> _steam-id-repairs.json
 *   node _repair_steam_ids.mjs --offline          re-judge the cache, fetch nothing
 *   node _repair_steam_ids.mjs --apply            write the confirmed ids into games.html
 *   node _repair_steam_ids.mjs --apply --clear    also delete the ids nothing could confirm
 *
 * Every fetch is cached in _steam-cache.json keyed by search term or app id, so a
 * second run resumes instead of refetching. Applying changes only steamAppId
 * values: the array is re-serialised from the same JSON it was parsed from, and
 * round-trips byte-identical when nothing is changed.
 *
 * After --apply, the tags keyed by these ids are stale, so the genre pass wants
 * re-running too: node _fetch_tags.mjs && node _reclassify.mjs.
 *
 * WHY A WRONG ID IS THE WORST KIND
 * --------------------------------
 * The card art is fetched from the app id, so a wrong id is not a dead link, it
 * is another game's cover sitting on this game's card. Age of Wonders:
 * Planetfall was showing Resident Evil 2's artwork because its id was 883710.
 * The correct id is 718850. Nothing on the page tells the reader it is wrong.
 *
 * SOURCE
 * ------
 * store.steampowered.com/api/storesearch — keyless, and it returns the NAME
 * beside the id, so a candidate is never an id we guessed and hoped about. The
 * old ISteamApps/GetAppList is gone ("Method 'GetAppList' not found").
 *
 * FOUR GATES, and a candidate has to pass all of them
 * --------------------------------------------------
 *   name   storesearch's name must be this game's name, after entities, case,
 *          punctuation and II-vs-2 are folded away — and with the sequel number
 *          required to agree, so Tomb Raider never becomes Tomb Raider I-III.
 *   name   again, from appdetails, a different endpoint keyed by the id itself.
 *   year   appdetails' release date against the catalogue year, because a
 *          matching name is not enough where remakes exist: Tomb Raider 1996 and
 *          Tomb Raider 2013 are both on Steam under exactly that name.
 *   type   released, and type "game". "HITMAN 3 - Deluxe Pack" is a perfect name
 *          match and a DLC; its id on the card is the bug, not the fix.
 * Then the art the reader will actually see, header.jpg on the CDN, must exist.
 *
 * THE FALSE-ALARM TEST
 * --------------------
 * Most of the 395 suspects are not broken. The flag was raised by comparing the
 * stored id's name to the title, and those disagree for harmless reasons —
 * "Assassin's Creed II" vs "Assassin's Creed 2", or Hitman 3, which IO renamed
 * to "HITMAN World of Assassination" without changing app 1659040. So the first
 * question asked of every suspect is not "do the names match" but "does Steam's
 * own search for this title return the id we already have". If it does, the id
 * is right and the name is just written differently, and nothing is proposed.
 *
 * WHAT "NO REPAIR" MEANS
 * ---------------------
 * Three different things, and the report keeps them apart. A game that was never
 * on Steam (13 Sentinels) or has been delisted from it (Devotion, WildStar) has
 * no id to find, and that is a finished answer. A game whose candidates are all
 * DLC has an answer too. A lookup that was throttled has no answer at all, and
 * re-running resolves it — those are never cached and never let --clear delete
 * anything.
 */
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const CLEAR = process.argv.includes('--clear');
/** Judge only what the cache already holds — no network, no cache writes. Lets
 *  the matching rules be re-tuned and re-scored in a second instead of an hour. */
const OFFLINE = process.argv.includes('--offline');
const GAMES_FILE = 'games.html';
const BAD_FILE = '_bad-steam-ids.json';
const CACHE_FILE = '_steam-cache.json';
const OUT_FILE = '_steam-id-repairs.json';

/* ------------------------------------------------------------------ arrays */

/** Locate a `const NAME = [...]` array in a page by bracket matching. */
function findArray(html, name) {
  const at = html.search(new RegExp(`const ${name}\\s*=\\s*\\[`));
  if (at < 0) throw new Error(`${name} not found`);
  const start = html.indexOf('[', at);
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (!depth) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error(`${name} array never closes`);
  return { start, end, rows: JSON.parse(html.slice(start, end)) };
}

/* ------------------------------------------------------------- title folding */

const ENTITIES = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', shy: '',
  ndash: '-', mdash: '-', minus: '-', hellip: '...', middot: '.',
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', sbquo: "'", bdquo: '"',
  trade: '', reg: '', copy: '', deg: ' ', sect: '', para: '', bull: '.',
  eacute: 'e', egrave: 'e', agrave: 'a', ccedil: 'c', uuml: 'u', ouml: 'o',
  auml: 'a', ntilde: 'n', oslash: 'o', aring: 'a', szlig: 'ss', iexcl: '',
};

/**
 * Entities first, always. "Preludes &amp; Nocturnes" folded straight to
 * alphanumerics yields the token "amp", which matches nothing and silently
 * discards a row that was never wrong.
 */
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

/**
 * Sequel markers get folded to one spelling so that II / 2 / two are the same
 * number, and — more importantly — so that a DIFFERENT number is visible as a
 * difference. Assassin's Creed II and Assassin's Creed 2 are one game; The Room
 * and The Room Two are not.
 */
const NUMBERS = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18,
  xix: 19, xx: 20,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Extra words that mark a different instalment rather than a different label. */
const INSTALMENT = new Set(['episode', 'chapter', 'part', 'act', 'season', 'volume', 'vol', 'book', 'act']);

/** Edition/packaging noise. Dropped only in the loose form, never the strict
 *  one — Skyrim and Skyrim Special Edition are two different app ids. */
const EDITION = new Set([
  'edition', 'editions', 'definitive', 'complete', 'deluxe', 'gold', 'goty',
  'premium', 'ultimate', 'enhanced', 'remastered', 'remaster', 'redux',
  'special', 'anniversary', 'collection', 'collectors', 'collector',
  'directors', 'cut', 'hd', 'standard', 'digital',
  'reloaded', 'classic', 'legacy', 'game', 'year', 'of', 'the',
  // "pack" and "bundle" are deliberately NOT here. Erasing them made
  // "HITMAN 3 - Deluxe Pack" fold onto "Hitman 3" and score as the same name,
  // and it is a DLC. They are treated as DLC markers below instead.
]);

/** Strict fold: case, punctuation, accents, entities and sequel numbers only. */
function strict(s) {
  const t = decodeEntities(s)
    // Before NFKD, which would otherwise expand ™ into the letters "tm" and
    // make "Need for Speed™" read as "speedtm".
    .replace(/[™®©℠]/g, ' ')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // A disambiguating year the catalogue appends, "Most Wanted (2012)", is
    // shelving notation rather than part of the name Steam prints.
    .replace(/\s*[([]\s*(19|20)\d{2}\s*[)\]]\s*$/, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/&/g, ' and ')
    // Apostrophes close up rather than split, so "Director's Cut" folds to the
    // one token the edition list knows and "Baldur's Gate" equals "Baldurs Gate".
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = t.split(' ').filter(Boolean).map((w) => (w in NUMBERS ? String(NUMBERS[w]) : w));
  if (words[0] === 'the') words.shift();
  return words.join(' ');
}

/** Loose fold: strict, minus edition/packaging words. */
function loose(s) {
  const words = strict(s).split(' ').filter((w) => w && !EDITION.has(w));
  return words.join(' ');
}

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
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
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

/**
 * Every run of digits, including the ones welded inside a word. A sports title
 * carries its year as part of the name — PGA TOUR 2K23 against PGA TOUR 2K25 is
 * two games and one character, and a whole-token test cannot see the difference.
 */
const numerals = (s) => new Set(strict(s).match(/\d+/g) || []);
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** 0-100. 100 only when the two names are the same name. */
function score(title, name) {
  const ts = strict(title), ns = strict(name);
  if (!ts || !ns) return 0;
  if (ts === ns) return 100;
  const tl = loose(title), nl = loose(name);
  if (tl && tl === nl) return 95;

  /* Below here the names differ in substance, not just in packaging. Two
     guards apply before any partial credit is given:
       - the sequel numbers must agree. Tomb Raider is not Tomb Raider I-III,
         and The Room is not The Room Two.
       - the candidate must not add an instalment word the title never had.
         Half-Life 2 is not Half-Life 2: Episode One. */
  const tt = looseTokens(title), nt = looseTokens(name);
  const extra = [...nt].filter((w) => !tt.has(w));
  const clean = sameSet(numerals(title), numerals(name)) && !extra.some((w) => INSTALMENT.has(w));

  /* A containment match caps below the exact-name band on purpose. Any extra
     word here is substantive, because the packaging words are already gone —
     "DOOM" contained in "DOOM Eternal" is a different game, not a different
     label for the same one. These only become a repair when the year agrees
     exactly, which is decided further down. */
  if (clean && subset(tt, nt)) {
    const add = nt.size - tt.size;
    // As many new words as the title had of its own is a different product with
    // a shared prefix: DOOM inside DOOM Eternal, Guacamelee! inside Guacamelee!
    // Super Turbo Championship.
    if (add >= tt.size) return 76;
    return Math.max(78, 87 - 3 * add);
  }
  if (clean && subset(nt, tt)) return Math.max(76, 85 - 3 * Math.max(0, tt.size - nt.size));

  const sim = Math.max(dice(tt, nt), levSim(ts, ns));
  return Math.min(clean ? 84 : 70, Math.round(sim * 100));
}

/** Things that share a franchise name but are not the game. */
function isJunk(title, name) {
  const t = strict(title), n = strict(name);
  const words = /\b(demo|playtest|beta|alpha|soundtrack|ost|artbook|season pass|dlc|upgrade|trailer|server|sdk|prologue|teaser|wallpaper|test|expansion|bonus|skin|costume|avatar|theme|pack|bundle)\b/;
  const m = n.match(words);
  if (!m) return false;
  return !t.includes(m[1]); // a word the real title also carries is not junk
}

/* ------------------------------------------------------------------- cache */

/**
 * Rule: a cached failure must not be permanent. Throttling is not an answer, so
 * 202-with-empty-body, 429, 5xx and network errors are never written here. Only
 * a real reply from Steam — including an honest "no results" — becomes cache.
 */
const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
let dirty = 0;
const saveCache = () => { if (!OFFLINE) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); dirty = 0; } };
const remember = (k, v) => { cache[k] = v; if (++dirty >= 15) saveCache(); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Returns parsed json, or null when the failure is retryable (never cached). */
async function getJson(url, tries = 4) {
  for (let n = 0; n < tries; n++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en-US,en', 'User-Agent': 'media-shelf-id-repair/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      const body = await res.text();
      // 202 with an empty body is Steam throttling, not an answer. Neither is a
      // 403 soft block or a timeout. None of these may be cached as a result.
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
  return undefined; // undefined = retryable, do not cache; null = a real "no"
}

let searchCalls = 0, appCalls = 0;

async function search(term) {
  const key = `search:${term.toLowerCase().trim()}`;
  if (key in cache) return cache[key];
  if (OFFLINE) return null;
  await sleep(1100);
  searchCalls++;
  const j = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=en`);
  if (j === undefined) return null; // throttled: leave uncached so a re-run retries
  const items = (j && Array.isArray(j.items) ? j.items : [])
    .filter((i) => i && i.id && i.name)
    .map((i) => ({ id: i.id, name: i.name }));
  remember(key, items);
  return items;
}

async function appInfo(id) {
  const key = `app:${id}`;
  if (key in cache) return cache[key];
  if (OFFLINE) return null;
  await sleep(1600); // appdetails throttles harder than storesearch
  appCalls++;
  const url = `https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=en&filters=basic,release_date`;
  let j = await getJson(url);
  if (j === undefined) return null;
  let d = j && j[id];
  /* A 200 carrying {"success":false} is Steam's way of saying both "this is a
     package id, not an app" and, sometimes, "ask me again later". Since caching
     the second as the first is what caps coverage at a number our own bug chose,
     it is asked twice before the answer is written down. */
  if (!d || !d.success || !d.data) {
    await sleep(2500);
    appCalls++;
    j = await getJson(url);
    if (j === undefined) return null;
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
 * The last gate, and the one that matches what the reader sees. games.html draws
 * every card from
 *   cdn.cloudflare.steamstatic.com/steam/apps/<id>/header.jpg
 * so an id with no header.jpg is a broken card however well its name matched.
 */
async function hasArt(id) {
  const key = `art:${id}`;
  if (key in cache) return cache[key];
  if (OFFLINE) return null;
  await sleep(400);
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
  return null; // retryable, uncached
}

/* -------------------------------------------------------------------- main */

const html = fs.readFileSync(GAMES_FILE, 'utf8');
const { start, end, rows: GAMES } = findArray(html, 'GAMES');
const BAD = JSON.parse(fs.readFileSync(BAD_FILE, 'utf8'));

const byTitle = new Map();
for (const g of GAMES) {
  const k = strict(g.title);
  if (!byTitle.has(k)) byTitle.set(k, []);
  byTitle.get(k).push(g);
}

console.log(`${GAMES.length} games, ${BAD.length} suspect ids\n`);

const falseAlarms = [];
const repairs = [];
const unmatched = [];

for (let i = 0; i < BAD.length; i++) {
  const [title, oldId, storedName, genre] = BAD[i];
  const mates = byTitle.get(strict(title)) || [];
  const row = mates.find((g) => g.steamAppId === oldId) || mates[0];
  const year = row ? row.year : null;
  process.stdout.write(`  ${String(i + 1).padStart(3)}/${BAD.length}  ${title.slice(0, 46).padEnd(46)}\r`);

  /* Steam's store search is close to a literal match, so the full title often
     returns nothing at all for a game that is plainly there: "PlayerUnknown's
     Battlegrounds" finds zero, "Battlegrounds" finds app 578080. So the ladder
     goes from the exact title down to its distinctive fragments, and stops as
     soon as one of them answers. Most titles never leave the first rung. */
  const clean = decodeEntities(title).replace(/\s*[([]\s*(19|20)\d{2}\s*[)\]]\s*$/, '').trim();
  const terms = [];
  const push = (t) => { const c = String(t || '').trim(); if (c && c.length > 2 && !terms.includes(c)) terms.push(c); };
  push(clean);
  push(clean.replace(/[,:—–-]?\s*\b(definitive|complete|deluxe|gold|goty|premium|ultimate|enhanced|remastered|special|anniversary|collector'?s?|director'?s?)\b.*$/i, '').trim());
  const parts = clean.split(/\s*(?::|\s+[-–—]\s+)\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) { push(parts[0]); push(parts[parts.length - 1]); }
  const words = clean.replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !EDITION.has(w.toLowerCase()));
  if (words.length > 2) { push(words.slice(0, 2).join(' ')); push(words.slice(-2).join(' ')); }
  // Down to one distinctive word. "Hitman" returns app 1659040, which is the id
  // already stored — the whole reason Hitman 3 is a false alarm and not a fault.
  if (words.length) { push(words[0]); push(words[words.length - 1]); }

  let items = [];
  const seen = new Set();
  let searchWorked = false;
  for (const t of terms) {
    const got = await search(t);
    if (got === null) continue;
    searchWorked = true;
    for (const it of got) if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
    // Stop early once the title itself produced a convincing name.
    if (items.some((it) => score(title, it.name) >= 95) || items.some((it) => it.id === oldId)) break;
  }

  /* 1. The decisive false alarm: the stored id's own name, as recorded by the
        scan, is this title written another way — "Assassin's Creed II" against
        "Assassin's Creed 2". Nothing beats an identity of names. */
  if (score(title, storedName) >= 95) {
    falseAlarms.push({ title, oldId, steamName: storedName, why: 'stored id names the same game, spelled differently' });
    continue;
  }

  if (!searchWorked) {
    unmatched.push({
      title, oldId, storedName, year,
      reason: OFFLINE ? 'not in the cache yet — run without --offline' : 'every search attempt was throttled — re-run to retry',
    });
    continue;
  }

  /* 2. Rank what came back. */
  const ranked = items
    .filter((it) => !isJunk(title, it.name))
    .map((it) => ({ ...it, s: score(title, it.name) }))
    .sort((a, b) => b.s - a.s);

  /* 3. The other false alarm: Steam's own search for this title hands back the
        id already stored, which is how Hitman 3 is recognised as app 1659040
        under a new name. Two guards, because the search ladder ends in single
        words and a broad enough rung returns a whole franchise:

        - the instalment numbers must not contradict. A rename may drop the
          number (Hitman 3 -> HITMAN World of Assassination) or add one (the
          catalogue's "Expeditions: Clair Obscur" -> Clair Obscur: Expedition
          33), so an empty set on either side is fine. But 13 against '98 is
          two different games, and searching "King of Fighters" returns both.
        - no other candidate may be a far better name for this title. */
  const selfItem = items.find((it) => it.id === oldId);
  if (selfItem) {
    const tn = numerals(title), sn = numerals(selfItem.name);
    const numbersAgree = !tn.size || !sn.size || sameSet(tn, sn);
    const rival = ranked.find((c) => c.id !== oldId);
    const beaten = rival && rival.s >= 84 && rival.s > score(title, selfItem.name) + 20;
    if (numbersAgree && !beaten) {
      falseAlarms.push({ title, oldId, steamName: selfItem.name, why: 'steam search for this title returns the stored id' });
      continue;
    }
  }

  const best = ranked.find((c) => c.id !== oldId);
  if (!best || best.s < 78) {
    unmatched.push({
      title, oldId, storedName, year,
      reason: best ? `nothing on Steam matches (closest "${best.name}", ${best.s}/100)` : 'no Steam search results at all',
    });
    continue;
  }

  /* 3. A name match is not enough where remakes exist. Ask appdetails for the
        release year of every candidate tied at the top, and let the catalogue
        year choose between them. */
  /* Wide enough that a DLC sitting at the top cannot hide the real game beneath
     it, narrow enough not to spend a lookup on every search result — and the
     best candidate is always in, because a floor that can exclude everything
     turns "we never looked" into a confident-sounding "Steam has no details". */
  const contenders = [best, ...ranked.filter((c) => c !== best && c.id !== oldId && c.s >= Math.max(84, best.s - 12))].slice(0, 5);
  for (const c of contenders) {
    const info = await appInfo(c.id);
    c.info = info;
    c.year = info && info.ok ? info.year : null;
    // Confirm once more against the name appdetails reports, not just search.
    if (info && info.ok && info.name && score(title, info.name) < c.s) c.s = score(title, info.name);
  }

  /* Only a released app of type "game" may be proposed, with no fallback to the
     rest. "HITMAN 3 - Deluxe Pack" folds onto Hitman 3 and reads as a perfect
     name match; it is a DLC, and putting its id on the card is the same class of
     error we are here to remove. */
  const pool = contenders.filter((c) => c.info && c.info.ok && c.info.type === 'game' && !c.info.coming);
  if (!pool.length) {
    const why = contenders.filter((c) => c.info && c.info.ok).map((c) => `${c.name} is ${c.info.coming ? 'unreleased' : c.info.type}`);
    unmatched.push({
      title, oldId, storedName, year,
      reason: why.length ? `no candidate is a released game (${why.slice(0, 2).join('; ')})` : `Steam has no details for "${best.name}" (${best.id})`,
    });
    continue;
  }

  const gap = (c) => (year && c.year ? Math.abs(c.year - year) : null);
  pool.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    const ga = gap(a), gb = gap(b);
    if (ga == null) return 1;
    if (gb == null) return -1;
    return ga - gb;
  });

  const pick = pool[0];
  const tiedNames = pool.filter((c) => c.id !== pick.id && strict(c.name) === strict(pick.name));
  const d = gap(pick);

  /* Two apps with literally the same name — Tomb Raider 1996 and Tomb Raider
     2013. Only the year separates them, so without a usable year, stop. */
  if (tiedNames.length && (d == null || d > 3)) {
    unmatched.push({
      title, oldId, storedName, year,
      reason: `${pool.length} Steam apps share the name "${pick.name}" and the year cannot tell them apart`,
    });
    continue;
  }

  /* The ladder. The exact-name band can stand on its own; the containment band
     has to buy its place with a year that agrees almost exactly. */
  let confidence;
  if (pick.s >= 95 && d != null && d <= 2) confidence = 'high';
  else if (pick.s >= 95 && d == null) confidence = 'medium'; // no year to check against
  else if (pick.s >= 95 && d <= 5) confidence = 'medium';
  else if (pick.s >= 84 && d != null && d <= 1) confidence = 'medium';
  else if (pick.s >= 84 && d != null && d <= 3) confidence = 'low';
  // A longer Steam name that contains every word of the title, released in the
  // very same year, is probably this game wearing its publisher's prefix —
  // "BIT.TRIP Presents... Runner2: Future Legend of Rhythm Alien". Probably is
  // not good enough to apply, so it is reported at low for a human to confirm.
  // The containment has to run title-inside-name and not the reverse: "Phantom
  // Trigger" sits inside "Grisaia: Phantom Trigger" and is a different game.
  else if (pick.s >= 78 && d === 0 && subset(looseTokens(title), looseTokens(pick.name))) confidence = 'low';
  // An old game re-released on Steam years later is a legitimate late date.
  else if (pick.s >= 95 && pick.year && year && pick.year > year) confidence = 'low';
  else confidence = null;

  if (!confidence) {
    unmatched.push({
      title, oldId, storedName, year,
      reason: `"${pick.name}" (${pick.id}) scores ${pick.s}/100 and released ${pick.year ?? '?'} against a catalogue year of ${year ?? '?'}`,
    });
    continue;
  }

  if (pick.id === oldId) {
    falseAlarms.push({ title, oldId, steamName: pick.name, why: 'best Steam match is the stored id' });
    continue;
  }

  /* Last gate: the card art the reader will actually see must exist. */
  const art = await hasArt(pick.id);
  if (art === false) {
    unmatched.push({
      title, oldId, storedName, year,
      reason: `"${pick.name}" (${pick.id}) matches but has no header.jpg, so the card would show nothing`,
    });
    continue;
  }
  if (art === null && !OFFLINE) {
    unmatched.push({ title, oldId, storedName, year, reason: 'the cover-art check was throttled — re-run to retry' });
    continue;
  }

  repairs.push({
    title,
    oldId,
    newId: pick.id,
    steamName: pick.name,
    confidence,
    oldName: storedName,
    catalogueYear: year,
    steamYear: pick.year ?? null,
    steamType: pick.info && pick.info.ok ? pick.info.type : null,
    genre,
    match: pick.s,
  });
}

saveCache();
process.stdout.write(' '.repeat(70) + '\r');

/* ------------------------------------------------------------------ report */

const byConf = (c) => repairs.filter((r) => r.confidence === c);
console.log(`fetched ${searchCalls} searches and ${appCalls} app lookups this run\n`);
console.log(`  ${String(falseAlarms.length).padStart(3)} false alarms  — the stored id was right, only the name is spelled differently`);
console.log(`  ${String(repairs.length).padStart(3)} repairs       — high ${byConf('high').length}, medium ${byConf('medium').length}, low ${byConf('low').length}`);
console.log(`  ${String(unmatched.length).padStart(3)} unresolved    — no id proposed; a missing id beats a wrong one\n`);

for (const r of repairs.slice(0, 25)) {
  console.log(`  ${r.confidence.padEnd(6)} ${r.title} (${r.catalogueYear ?? '?'})  ${r.oldId} -> ${r.newId}  "${r.steamName}" (${r.steamYear ?? '?'})`);
}
if (repairs.length > 25) console.log(`  … ${repairs.length - 25} more in ${OUT_FILE}`);

if (unmatched.length) {
  /* Why we gave up matters: "never on Steam" is a real answer about the game,
     while "throttled" is a fact about this run and clears on a re-run. */
  const kind = (r) => (
    /throttled|not in the cache/.test(r) ? 'never actually asked — re-run to retry'
      : /no Steam search results/.test(r) ? 'Steam search knows no such game'
        : /nothing on Steam matches/.test(r) ? 'results came back, none is this game'
          : /share the name/.test(r) ? 'same-name apps the year cannot separate'
            : /released game|no details/.test(r) ? 'only DLC, demos or unreleased apps matched'
              : /header\.jpg/.test(r) ? 'name matched but the card art is gone'
                : 'close but the name or year did not hold up'
  );
  const groups = new Map();
  for (const u of unmatched) {
    const k = kind(u.reason);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(u);
  }
  console.log(`\nunresolved, by reason:`);
  for (const [k, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${list.length}  ${k}`);
    for (const u of list.slice(0, 8)) console.log(`      ${u.title} (${u.year ?? '?'}) — ${u.reason}`);
    if (list.length > 8) console.log(`      … ${list.length - 8} more`);
  }
}

/* ---------------------------------------------------- what an apply would do */

/* Defined once, here, so the collision check below measures the same catalogue
   that --apply would actually produce. high and medium go in; low is written to
   the json for a human to read and is never applied by this script. */
const wanted = new Map();
for (const r of repairs) if (r.confidence !== 'low') wanted.set(`${r.title}|${r.oldId}`, r.newId);

/* --clear removes an id we could not confirm — but only where the reason was an
   answer about the game. A request that was throttled or never made is not
   evidence of anything, and deleting an id on that basis would let a transport
   failure edit the catalogue. */
const retryable = (u) => /throttled|not in the cache|was never asked/.test(u.reason);
const clearable = unmatched.filter((u) => !retryable(u));
const drop = new Set(CLEAR ? clearable.map((u) => `${u.title}|${u.oldId}`) : []);

/* One id must name one game, so two rows landing on the same app id after an
   apply is worth saying out loud even when it is harmless — "Guacamelee!" and
   "Guacamelee! Gold Edition" really are one Steam app. What this has to be
   measured against is the catalogue as it will be AFTER the apply, and using the
   set the apply uses: a row whose own repair sits at low stays where it is, and
   a repair moving onto that id then collides with it. */
const after = new Map();
for (const g of GAMES) {
  const k = `${g.title}|${g.steamAppId}`;
  const id = wanted.has(k) ? wanted.get(k) : (drop.has(k) ? null : g.steamAppId);
  if (!id) continue;
  if (!after.has(id)) after.set(id, []);
  after.get(id).push(g.title);
}
const collisions = [...after]
  .filter(([, titles]) => titles.length > 1)
  .map(([id, titles]) => ({
    id,
    titles,
    movedHere: titles.filter((t) => repairs.some((r) => r.title === t && r.newId === id && r.confidence !== 'low')),
    stayedHere: titles.filter((t) => !repairs.some((r) => r.title === t && r.newId === id && r.confidence !== 'low')),
  }))
  .filter((c) => c.movedHere.length);

if (collisions.length) {
  console.log(`\n${collisions.length} app ids would end up on more than one row after --apply — check by hand:`);
  for (const c of collisions.slice(0, 15)) {
    console.log(`  ${c.id}  moved here [${c.movedHere.join(', ')}]${c.stayedHere.length ? `  already there [${c.stayedHere.join(', ')}]` : ''}`);
  }
  if (collisions.length > 15) console.log(`  … ${collisions.length - 15} more`);
}

/* The deliverable keeps the five agreed keys; the rest is working detail. An
   --offline pass is judging a partial cache, so it writes beside the real
   answer rather than over it. */
const outFile = OFFLINE ? '_steam-id-repairs.offline.json' : OUT_FILE;
fs.writeFileSync(outFile, JSON.stringify(
  repairs.map((r) => ({ title: r.title, oldId: r.oldId, newId: r.newId, steamName: r.steamName, confidence: r.confidence })),
  null, 1,
));
const reportFile = OFFLINE ? '_steam-id-report.offline.json' : '_steam-id-report.json';
fs.writeFileSync(reportFile, JSON.stringify({ repairs, falseAlarms, unmatched, collisions }, null, 1));
console.log(`\nwrote ${outFile} (${repairs.length}) and ${reportFile} (full working detail)`);

/* ------------------------------------------------------------------- apply */

if (APPLY && OFFLINE) {
  console.log('\nrefusing to apply an --offline pass: it has only seen part of the cache');
  process.exit(1);
}
if (!APPLY) {
  console.log('\n(report only — nothing written to games.html; pass --apply to do that)');
  process.exit(0);
}

console.log(`\napplying ${wanted.size} repairs (high + medium; ${byConf('low').length} low left for a human)`);
if (CLEAR) {
  console.log(`clearing ${drop.size} unconfirmable ids, keeping ${unmatched.length - clearable.length} whose lookup never completed`);
}

let changed = 0, cleared = 0;
for (const g of GAMES) {
  const k = `${g.title}|${g.steamAppId}`;
  if (wanted.has(k)) { g.steamAppId = wanted.get(k); changed++; }
  else if (drop.has(k)) { delete g.steamAppId; cleared++; }
}

fs.writeFileSync(GAMES_FILE, html.slice(0, start) + JSON.stringify(GAMES) + html.slice(end));
console.log(`\n${changed} ids repointed, ${cleared} removed — wrote ${GAMES_FILE}`);
console.log('run node build-version.js before committing');
