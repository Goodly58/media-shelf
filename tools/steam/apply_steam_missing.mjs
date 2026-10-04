/**
 * Apply _steam-missing.json to games.html. Run after tools/steam/fetch_steam_missing.mjs.
 *
 *     node tools/steam/apply_steam_missing.mjs           report only  (default)
 *     node tools/steam/apply_steam_missing.mjs --apply   write games.html
 *     node tools/steam/apply_steam_missing.mjs --low     include the low-confidence rows
 *
 * No network. This half is only matching and validation, and it re-checks every
 * safety property against the catalogue as it stands right now rather than
 * trusting the state the fetch pass saw — other passes touch games.html between
 * the two, and an id that was free an hour ago may not be free now.
 *
 * WHAT GETS WRITTEN
 * -----------------
 * Only `steamAppId`, only onto rows that currently have none, and only from
 * high- and medium-confidence proposals. The array is re-serialised from the
 * same JSON it was parsed out of, so a run that changes nothing round-trips the
 * file byte-identical.
 *
 * FIVE REFUSALS, all of them re-tested here
 * -----------------------------------------
 *   1. The row must still be missing its id. If something else filled it in
 *      since the fetch pass ran, that value stays; this pass fills gaps and
 *      never overwrites.
 *   2. Title AND year must both match the proposal. Title alone is not enough
 *      where remakes exist — Carrie 1976 and Carrie 2013 share a title, and so
 *      do Tomb Raider 1996 and Tomb Raider 2013.
 *   3. The id must not already be on another row. One app id names one game, so
 *      a collision means one of the two cards is about to show the other's art.
 *   4. Two proposals must not want the same id. Same reason, caught before the
 *      write rather than after it.
 *   5. Low confidence is never applied without --low being asked for
 *      explicitly, and --low still refuses everything rules 1-4 refuse.
 *
 * A NOTE ON headerOk:false
 * ------------------------
 * Those rows are applied. The id is right; what is missing is the cover, and it
 * is missing because games.html builds art URLs as
 *     cdn.cloudflare.steamstatic.com/steam/apps/<id>/header.jpg
 * while Steam now serves newer apps' art from a content-hashed path that cannot
 * be derived from an app id. The id still buys tags, genre and a working store
 * link, so it is worth having — but the card stays blank until that URL pattern
 * is fixed, and this script says exactly which rows those are rather than
 * letting them look done.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (f) => path.join(ROOT, f);

const APPLY = process.argv.includes('--apply');
const WITH_LOW = process.argv.includes('--low');

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

const SRC = at('_steam-missing.json');
if (!fs.existsSync(SRC)) {
  console.error('_steam-missing.json not found — run `node tools/steam/fetch_steam_missing.mjs` first.');
  process.exit(1);
}

const { array: GAMES, start, end, html } = readArray(at('games.html'), 'GAMES');
const proposals = JSON.parse(fs.readFileSync(SRC, 'utf8'));

/* Rows are keyed on title AND year together, because title alone is not a key
   in a catalogue that can hold a game and its remake. */
const key = (t, y) => `${t}\0${y}`;
const rows = new Map();
for (const g of GAMES) {
  const k = key(g.title, g.year);
  if (!rows.has(k)) rows.set(k, []);
  rows.get(k).push(g);
}

/** Every id currently spoken for, and by whom. */
const taken = new Map();
for (const g of GAMES) if (g.steamAppId) taken.set(g.steamAppId, g.title);

const TIERS = WITH_LOW ? ['high', 'medium', 'low'] : ['high', 'medium'];

const accepted = [];
const refused = [];

/* Proposals wanting an id another proposal also wants. Counted first so the
   refusal can name both sides. */
const wantCount = new Map();
for (const p of proposals) {
  if (!TIERS.includes(p.confidence)) continue;
  if (!wantCount.has(p.newId)) wantCount.set(p.newId, []);
  wantCount.get(p.newId).push(p.title);
}

for (const p of proposals) {
  const say = (why) => refused.push({ ...p, why });

  if (!TIERS.includes(p.confidence)) { say(`confidence "${p.confidence}" is below the applied tier`); continue; }
  if (!Number.isInteger(p.newId) || p.newId <= 0) { say('newId is not a positive integer'); continue; }
  if (p.type !== 'game') { say(`type is "${p.type}", not "game"`); continue; }

  const mates = rows.get(key(p.title, p.year));
  if (!mates || !mates.length) { say('no row in games.html has this title and year'); continue; }
  if (mates.length > 1) { say(`${mates.length} rows share this title and year — cannot tell them apart`); continue; }

  const row = mates[0];
  if (row.steamAppId) { say(`the row already has steamAppId ${row.steamAppId} — this pass only fills gaps`); continue; }

  const owner = taken.get(p.newId);
  if (owner) { say(`app ${p.newId} is already on "${owner}"`); continue; }

  const rivals = wantCount.get(p.newId) || [];
  if (rivals.length > 1) { say(`app ${p.newId} is also proposed for ${rivals.filter((t) => t !== p.title).join(', ')}`); continue; }

  accepted.push({ p, row });
  taken.set(p.newId, p.title); // so a later proposal cannot double-book it
}

/* ------------------------------------------------------------------ report */

const tier = (c) => accepted.filter((a) => a.p.confidence === c).length;
const blank = accepted.filter((a) => a.p.headerOk === false);

console.log(`${GAMES.length} games in the catalogue, ${GAMES.filter((g) => !g.steamAppId).length} of them with no steamAppId`);
console.log(`${proposals.length} proposals in _steam-missing.json\n`);
console.log(`  ${String(accepted.length).padStart(3)} would be applied  — high ${tier('high')}, medium ${tier('medium')}${WITH_LOW ? `, low ${tier('low')}` : ''}`);
console.log(`  ${String(refused.length).padStart(3)} refused\n`);

if (accepted.length) {
  console.log(`of those ${accepted.length}, ${accepted.length - blank.length} will show a cover immediately.`);
  if (blank.length) {
    console.log(`${blank.length} will not: the id is right but games.html's art URL cannot reach Steam's`);
    console.log(`hashed asset path, so these gain tags and genre while the card stays blank —`);
    for (const a of blank.slice(0, 10)) console.log(`   ${a.p.title} (${a.p.year}) -> ${a.p.newId}`);
    if (blank.length > 10) console.log(`   … ${blank.length - 10} more`);
  }
  console.log();
  for (const a of accepted.slice(0, 30)) {
    console.log(`  ${a.p.confidence.padEnd(6)} ${a.p.title.slice(0, 42).padEnd(42)} (${a.p.year})  -> ${String(a.p.newId).padEnd(8)} "${a.p.steamName}"${a.p.headerOk ? '' : '   [no cover at the site URL]'}`);
  }
  if (accepted.length > 30) console.log(`  … ${accepted.length - 30} more`);
}

if (refused.length) {
  const groups = new Map();
  for (const r of refused) {
    const k = r.why.replace(/\d+/g, 'N').replace(/"[^"]*"/g, '"…"');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  console.log(`\nrefused, by reason:`);
  for (const [k, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${String(list.length).padStart(3)}  ${k}`);
    for (const r of list.slice(0, 6)) console.log(`       ${r.title} (${r.year}) — ${r.why}`);
    if (list.length > 6) console.log(`       … ${list.length - 6} more`);
  }
}

if (!APPLY) {
  console.log(`\n(report only — nothing written to games.html; pass --apply to do that)`);
  process.exit(0);
}

/* ------------------------------------------------------------------- apply */

for (const { p, row } of accepted) row.steamAppId = p.newId;

fs.writeFileSync(at('games.html'), html.slice(0, start) + JSON.stringify(GAMES) + html.slice(end));
console.log(`\n${accepted.length} ids written into games.html`);
console.log('the tags keyed by these ids are now stale — run:');
console.log('   node tools/steam/fetch_tags.mjs && node tools/steam/reclassify.mjs && node scripts/build-version.js');
