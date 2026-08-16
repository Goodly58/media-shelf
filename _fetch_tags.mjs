/**
 * Pull user tags from SteamSpy for every catalogue game that has a Steam id.
 *
 *   node _fetch_tags.mjs
 *
 * Why SteamSpy and not Steam's own appdetails: Steam's `genres` field is four
 * words wide and useless for classification — Palworld comes back "Action,
 * Adventure, Indie, RPG", which describes nothing. SteamSpy exposes the USER
 * tags, and those are the actual folk taxonomy: Palworld reads "Survival,
 * Creature Collector, Open World Survival Craft, Crafting, Base-Building".
 *
 * Cached to _tags-cache.json so a rerun costs nothing and an interrupted run
 * resumes. SteamSpy asks for one request a second; that is respected.
 */
import fs from 'node:fs';

const CACHE = '_tags-cache.json';

function readArray(file, name) {
  const h = fs.readFileSync(file, 'utf8');
  const at = h.search(new RegExp(`const ${name}\\s*=\\s*\\[`));
  const s = h.indexOf('[', at);
  let d = 0, e = -1, q = false, esc = false;
  for (let i = s; i < h.length; i++) {
    const c = h[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { e = i + 1; break; } }
  }
  return JSON.parse(h.slice(s, e));
}

const GAMES = readArray('games.html', 'GAMES');
const withId = GAMES.filter((g) => g.steamAppId);
console.log(`${withId.length} of ${GAMES.length} games carry a Steam id`);

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const todo = withId.filter((g) => !(String(g.steamAppId) in cache));
console.log(`${Object.keys(cache).length} cached, ${todo.length} to fetch (~${Math.round(todo.length * 1.1 / 60)} min)`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let done = 0;
let failed = 0;

for (const g of todo) {
  const id = String(g.steamAppId);
  try {
    const res = await fetch(`https://steamspy.com/api.php?request=appdetails&appid=${id}`, {
      headers: { 'user-agent': 'media-shelf/1.0 (catalogue tagging, contact via github Goodly58)' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const j = await res.json();
      const tags = j && j.tags && !Array.isArray(j.tags) ? j.tags : {};
      cache[id] = { name: j?.name ?? null, tags };
    } else {
      cache[id] = { name: null, tags: {} };
      failed += 1;
    }
  } catch {
    cache[id] = { name: null, tags: {} };
    failed += 1;
  }
  done += 1;
  if (done % 50 === 0) {
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    process.stdout.write(`  ${done}/${todo.length} (${failed} empty)\r`);
  }
  await sleep(1100); // SteamSpy asks for one call a second
}

fs.writeFileSync(CACHE, JSON.stringify(cache));
const withTags = Object.values(cache).filter((v) => Object.keys(v.tags || {}).length).length;
console.log(`\ncached ${Object.keys(cache).length} apps, ${withTags} of them with usable tags`);
