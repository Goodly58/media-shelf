/**
 * Fetch IGN, Metacritic user scores and Rotten Tomatoes — all at once.
 *
 *   node tools/scrape.mjs ign
 *   node tools/scrape.mjs mcuser
 *   node tools/scrape.mjs rt
 *
 * One target per process so all three can run at the same time. They are three
 * different hosts, so parallelism costs no politeness — the rate limit that
 * matters is per-host, and each worker still paces itself. Running them one
 * after another was a habit, not a constraint.
 *
 * FETCH IS SEPARATE FROM PARSE. This only stores the candidate matches into a
 * cache; the comparison and the corrections happen in a second pass. Extraction
 * from someone else's markup is guesswork that needs iterating, and iterating
 * must never mean re-fetching thousands of pages.
 */
import fs from 'node:fs';

const TARGET = process.argv[2];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function readArray(file, name) {
  const h = fs.readFileSync(file, 'utf8');
  const at = h.search(new RegExp('const ' + name + '\\s*=\\s*\\['));
  const s = h.indexOf('[', at);
  let d = 0, e = -1, q = false, esc = false;
  for (let i = s; i < h.length; i++) {
    const c = h[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { e = i + 1; break; } }
  }
  return JSON.parse(h.slice(s, e));
}
const load = (f, k) => { const r = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(r) ? r : r[k] || []; };
const slug = (t) => String(t).toLowerCase().replace(/['’.:!?,]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function grab(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, html: await res.text(), url: res.url };
  } catch (e) { return { ok: false, status: String(e.name || e) }; }
}

/* Each target says where to look and what to keep. Keeping several candidate
   matches rather than one committed guess is deliberate — the right one is
   decided in the parse pass, against real examples. */
const TARGETS = {
  ign: {
    cache: '_ign-cache.json',
    items: () => readArray('games.html', 'GAMES').map((g) => ({ key: g.title, url: `https://www.ign.com/games/${slug(g.title)}` })),
    pace: 900,
    keep: (h) => ({
      scores: [...h.matchAll(/"score":\s*([0-9.]+)/g)].map((m) => Number(m[1])).slice(0, 8),
      summary: (h.match(/"scoreSummary":"([^"]{0,200})"/) || [])[1] || null,
      title: (h.match(/<title>([^<]{0,120})/) || [])[1] || null,
    }),
  },
  mcuser: {
    cache: '_mcuser-cache.json',
    items: () => readArray('games.html', 'GAMES').map((g) => ({ key: g.title, url: `https://www.metacritic.com/game/${slug(g.title)}/` })),
    pace: 1200,
    keep: (h) => ({
      // The API exposes only the critic score; the page carries both, so the
      // surrounding object is kept and untangled in the parse pass.
      blocks: [...h.matchAll(/"userScoreSummary":\s*\{[^}]{0,240}\}/g)].map((m) => m[0]).slice(0, 3),
      loose: [...h.matchAll(/"score":\s*([0-9.]+)[^}]{0,60}"reviewCount"/g)].map((m) => Number(m[1])).slice(0, 4),
      title: (h.match(/<title>([^<]{0,120})/) || [])[1] || null,
    }),
  },
  rt: {
    cache: '_rt-cache.json',
    items: () => load('data/movies.json', 'movies').map((m) => ({ key: m.title, url: `https://www.rottentomatoes.com/m/${slug(m.title)}` })),
    pace: 900,
    keep: (h) => ({
      critics: (h.match(/"criticsScore":\s*\{[^}]{0,300}\}/) || [])[0] || null,
      audience: (h.match(/"audienceScore":\s*\{[^}]{0,300}\}/) || [])[0] || null,
      percents: [...h.matchAll(/"scorePercent":"(\d+)%"/g)].map((m) => Number(m[1])).slice(0, 4),
      title: (h.match(/<title>([^<]{0,120})/) || [])[1] || null,
    }),
  },
};

const T = TARGETS[TARGET];
if (!T) { console.error(`usage: node tools/scrape.mjs [${Object.keys(TARGETS).join('|')}]`); process.exit(1); }

const cache = fs.existsSync(T.cache) ? JSON.parse(fs.readFileSync(T.cache, 'utf8')) : {};
const items = T.items();
const todo = items.filter((i) => !(i.key in cache));
console.log(`${TARGET}: ${items.length} items, ${Object.keys(cache).length} cached, ${todo.length} to fetch (~${Math.round(todo.length * T.pace / 60000)} min)`);

let done = 0, hit = 0;
for (const it of todo) {
  const r = await grab(it.url);
  cache[it.key] = r.ok ? { ok: true, ...T.keep(r.html), url: r.url } : { ok: false, status: r.status };
  if (cache[it.key].ok) hit += 1;
  done += 1;
  if (done % 25 === 0) {
    fs.writeFileSync(T.cache, JSON.stringify(cache));
    process.stdout.write(`  ${TARGET} ${done}/${todo.length} (${hit} ok)\r`);
  }
  await sleep(T.pace);
}
fs.writeFileSync(T.cache, JSON.stringify(cache));
const ok = Object.values(cache).filter((v) => v && v.ok).length;
console.log(`\n${TARGET}: ${ok} of ${Object.keys(cache).length} pages resolved -> ${T.cache}`);
