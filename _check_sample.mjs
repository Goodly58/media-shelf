/**
 * 1,108 score changes is a lot to apply on trust. This spreads a sample across
 * the whole corrected set and prints the per-platform breakdown beside it, so
 * the PC number can be seen to be the PC number rather than assumed.
 */
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('.verify-cache/report.json', 'utf8'));
const cache = JSON.parse(readFileSync('.verify-cache/games-v2.json', 'utf8'));
const updates = new Map(report.updates);

const html = readFileSync('games.html', 'utf8');
const at = html.search(/const GAMES\s*=\s*\[/);
const start = html.indexOf('[', at);
let depth = 0;
let end = -1;
let inStr = false;
let esc = false;
for (let i = start; i < html.length; i += 1) {
  const ch = html[i];
  if (inStr) {
    if (esc) esc = false;
    else if (ch === '\\') esc = true;
    else if (ch === '"') inStr = false;
    continue;
  }
  if (ch === '"') inStr = true;
  else if (ch === '[') depth += 1;
  else if (ch === ']') {
    depth -= 1;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
const GAMES = JSON.parse(html.slice(start, end));

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const changed = GAMES.filter((g) => updates.has(g.title) && updates.get(g.title).score !== g.metacritic);
console.log(`corrections: ${changed.length}`);

console.log('\nspread sample — stored -> new, with the platform breakdown:');
for (let i = 0; i < 12; i += 1) {
  const g = changed[Math.floor((i * changed.length) / 12)];
  const hit = cache[slug(g.title)];
  const u = updates.get(g.title);
  console.log(
    `  ${g.title.slice(0, 32).padEnd(33)} ${String(g.metacritic).padStart(3)} -> ${String(u.score).padStart(3)} (${u.source})  headline=${String(hit.headline).padStart(3)}`,
  );
  console.log(`      ${hit.platforms.map((p) => `${p.name}=${p.score ?? '—'}`).join(', ').slice(0, 108)}`);
}

const deltas = changed.map((g) => updates.get(g.title).score - g.metacritic);
const down = deltas.filter((d) => d < 0).length;
const up = deltas.filter((d) => d > 0).length;
const mean = (deltas.reduce((a, c) => a + c, 0) / deltas.length).toFixed(2);
const big = deltas.filter((d) => Math.abs(d) > 10).length;
console.log(`\ndirection: ${down} down, ${up} up, mean ${mean} points`);
console.log(`changes larger than 10 points: ${big}`);

// A PC catalogue showing console scores should skew DOWN when corrected to PC,
// because PC ports usually score at or below the lead platform. A large upward
// skew would mean the mapping is wrong.
const sourcePc = changed.filter((g) => updates.get(g.title).source === 'pc').length;
console.log(`corrections taken from a real PC score: ${sourcePc}/${changed.length}`);
