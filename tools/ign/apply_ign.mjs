/**
 * Apply _ign-scores.json to games.html.  Run after tools/ign/fetch_ign.mjs.
 *
 *     node tools/ign/apply_ign.mjs           report only
 *     node tools/ign/apply_ign.mjs --apply   write games.html
 *
 * This is the half I can do: no network, just matching and validation.
 *
 * The existing ign values are not a baseline to defer to. 679 of them were in
 * the very first commit of the catalogue, before anything was ever fetched, and
 * they cluster impossibly — 184 games at exactly 8, 160 at exactly 9, out of 679
 * across 36 distinct values. They were generated with the catalogue, like the
 * 131 fabricated imdbIds and the 395 wrong steamAppIds. So a disagreement here
 * means the old value was invented, not that the new one is suspect.
 *
 * A game IGN never reviewed gets null rather than keeping its invented score.
 * An empty field is honest; a made-up 8 is not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Resolve everything against the script's own folder, not the shell's cwd, so
   this runs correctly from anywhere — including a bare `node tools/ign/fetch_ign.mjs`
   typed in the home directory, which is exactly how it was first tried. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (f) => path.join(ROOT, f);

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

if (!fs.existsSync(at('_ign-scores.json'))) {
  console.error('_ign-scores.json not found — run `node tools/ign/fetch_ign.mjs` first.');
  process.exit(1);
}

const { array: GAMES, start, end, html } = readArray(at('games.html'), 'GAMES');
const rows = JSON.parse(fs.readFileSync(at('_ign-scores.json'), 'utf8'));
const byTitle = new Map(rows.map((r) => [r.title, r]));

let scored = 0, agreed = 0, corrected = 0, cleared = 0, untouched = 0;
const moves = [];

for (const g of GAMES) {
  const r = byTitle.get(g.title);
  if (!r) { untouched += 1; continue; }

  if (r.status === 'no-review') {
    // IGN has no review. Whatever number is sitting there did not come from IGN.
    if (g.ign != null) { moves.push([g.title, g.ign, null]); cleared += 1; }
    delete g.ign;
    delete g.ignVerified;
    continue;
  }

  if (typeof r.score !== 'number' || r.score < 0 || r.score > 10) { untouched += 1; continue; }

  scored += 1;
  const before = g.ign ?? null;
  g.ign = r.score;
  g.ignVerified = true;
  g.ignUrl = r.articleUrl || undefined;
  if (before != null && Math.abs(before - r.score) < 0.05) agreed += 1;
  else { moves.push([g.title, before, r.score]); corrected += 1; }
}

console.log(`${scored} games given a verified IGN score`);
console.log(`  ${agreed} matched what was already there, ${corrected} differed`);
console.log(`${cleared} invented scores cleared (IGN has no review for them)`);
console.log(`${untouched} untouched (not in the fetch, or unresolved)\n`);

console.log('biggest disagreements — the OLD value is the doubtful one here:');
for (const [t, o, n] of moves.filter((m) => m[2] != null)
  .sort((a, b) => Math.abs((b[1] ?? 0) - b[2]) - Math.abs((a[1] ?? 0) - a[2])).slice(0, 15)) {
  console.log(`  ${String(o ?? '—').padStart(4)} -> ${String(n).padStart(4)}  ${t}`);
}

if (!APPLY) { console.log('\n(report only — pass --apply to write)'); process.exit(0); }
fs.writeFileSync(at('games.html'), html.slice(0, start) + JSON.stringify(GAMES) + html.slice(end));
console.log('\nwrote games.html — now run:');
console.log('  npm run build && npm run validate');
