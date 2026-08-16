/**
 * Compare the scraped IGN scores with the catalogue. Parse only — the fetching
 * already happened into _ign-cache.json.
 *
 *   node _verify_ign.mjs          report
 *   node _verify_ign.mjs --apply  write into games.html
 *
 * Each page yields up to two numbers, e.g. [94, 10]: a 0-100 figure and IGN's
 * own review score out of ten. The catalogue stores the ten-point one, so that
 * is what is read — and the page title is checked against the game's name first,
 * because the URL is a guessed slug and a guessed slug can land anywhere.
 */
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');

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
  return { array: JSON.parse(h.slice(s, e)), start: s, end: e, html: h };
}

const { array: GAMES, start, end, html } = readArray('games.html', 'GAMES');
const cache = JSON.parse(fs.readFileSync('_ign-cache.json', 'utf8'));
const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

let checked = 0, agree = 0, fixed = 0, added = 0, wrongPage = 0, noScore = 0;
const moves = [];

for (const g of GAMES) {
  const v = cache[g.title];
  if (!v || !v.ok) continue;

  // The slug was guessed, so confirm the page is about this game.
  const pageTitle = (v.title || '').replace(/\s*-\s*IGN\s*$/i, '');
  const a = fold(g.title), b = fold(pageTitle);
  if (!b || (!b.includes(a) && !a.includes(b))) { wrongPage += 1; continue; }

  // IGN's own score is the ten-point one. Take the last such value: the 0-100
  // figure always precedes it on these pages.
  const tens = (v.scores || []).filter((n) => n > 0 && n <= 10);
  if (!tens.length) { noScore += 1; continue; }
  const theirs = tens[tens.length - 1];

  checked += 1;
  const ours = g.ign == null ? null : Number(g.ign);
  if (ours == null) { g.ign = theirs; g.ignVerified = true; added += 1; continue; }
  if (Math.abs(ours - theirs) < 0.05) { agree += 1; g.ignVerified = true; continue; }
  moves.push([g.title, ours, theirs]);
  g.ign = theirs;
  g.ignVerified = true;
  fixed += 1;
}

console.log(`IGN cache: ${Object.keys(cache).length} pages, ${Object.values(cache).filter((v) => v && v.ok).length} resolved`);
console.log(`${checked} comparable — ${agree} already correct, ${fixed} corrected, ${added} newly filled`);
console.log(`${wrongPage} pages were about a different game, ${noScore} had no ten-point score\n`);
moves.sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]));
console.log('biggest corrections:');
for (const [t, o, n] of moves.slice(0, 15)) console.log(`  ${String(o).padStart(4)} -> ${String(n).padStart(4)}  ${t}`);

const withIgn = GAMES.filter((g) => g.ign != null).length;
const verified = GAMES.filter((g) => g.ignVerified).length;
console.log(`\ncoverage: ${withIgn} of ${GAMES.length} games have an IGN score (was 703), ${verified} verified`);

if (!APPLY) { console.log('\n(report only — pass --apply to write)'); process.exit(0); }
fs.writeFileSync('games.html', html.slice(0, start) + JSON.stringify(GAMES) + html.slice(end));
console.log('\nwrote games.html');
