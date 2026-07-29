/**
 * Build data/backlog-index.json — the slice of every catalogue that the backlog
 * page needs to match an export against.
 *
 * The page cannot simply embed the four datasets: together they are well over a
 * megabyte, most of which is blurbs and ids it never reads. This keeps title,
 * year, one quality figure and one length figure, which is all the matcher and
 * the ranker touch, and ships a fraction of the bytes.
 *
 *   node build-backlog-index.js
 */

const fs = require('fs');

/** Pull a `const NAME = [...]` array out of a page by bracket matching. */
function readArray(file, name) {
  const html = fs.readFileSync(file, 'utf8');
  const at = html.search(new RegExp(`const ${name}\\s*=\\s*\\[`));
  if (at < 0) throw new Error(`${name} not found in ${file}`);
  const start = html.indexOf('[', at);
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
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
    else if (ch === ']') {
      depth--;
      if (!depth) { end = i + 1; break; }
    }
  }
  return JSON.parse(html.slice(start, end));
}

function load(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : raw.movies || raw.shows || [];
}

// Short keys: this file is fetched by a browser and the names are read once, by
// code, in one place.
//   t title · y year · s score 0-100 · m minutes · v verified · g genre
const out = {
  built: new Date().toISOString().slice(0, 10),
  kinds: {},
};

const games = readArray('games.html', 'GAMES');
out.kinds.games = games.map((g) => ({
  t: g.title, y: g.year, s: g.metacritic, g: g.genre,
  v: g.verified ? 1 : 0,
  // No length source survived the check: HowLongToBeat's API is closed and
  // nothing else covers 2,164 PC games. Better absent than invented.
  m: null,
}));

const books = readArray('books.html', 'BOOKS');
out.kinds.books = books.map((b) => ({
  t: b.title, y: b.year,
  // Goodreads-style 0-5 put on the same 0-100 scale as everything else.
  s: b.rating != null ? Math.round((b.rating / 5) * 100) : null,
  g: b.genre, v: 0,
  // Page counts are not in the catalogue; a Goodreads export carries its own,
  // which is where the page gets them.
  m: null,
}));

const movies = load('data/movies.json');
out.kinds.movies = movies.map((m) => ({
  t: m.title, y: m.year, s: m.metacritic, g: m.genre,
  v: m.verified ? 1 : 0,
  m: m.runtime || null,
}));

const shows = load('data/shows.json');
out.kinds.shows = shows.map((s) => ({
  t: s.title, y: s.year, s: s.metacritic, g: s.genre,
  v: s.verified ? 1 : 0,
  // A series is its whole run. Episode counts are not in the data, so ten an
  // hour-or-half-hour season is the estimate, and the page says it is one.
  m: s.runtime ? Math.round(s.runtime * 10 * (s.seasons || 1)) : null,
}));

fs.mkdirSync('data', { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync('data/backlog-index.json', json);

const kb = Math.round(Buffer.byteLength(json) / 1024);
let total = 0;
for (const [k, v] of Object.entries(out.kinds)) {
  const scored = v.filter((x) => x.s != null).length;
  const timed = v.filter((x) => x.m != null).length;
  total += v.length;
  console.log(`  ${k.padEnd(7)} ${String(v.length).padStart(5)}  scored ${String(scored).padStart(5)}  with a length ${String(timed).padStart(5)}`);
}
console.log(`  backlog-index.json  ${total} entries, ${kb} KB`);
