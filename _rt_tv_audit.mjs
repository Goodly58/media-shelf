/**
 * Audit of _rt-tv-scores.json. REPORT ONLY — writes nothing but its own JSON.
 *
 * The pass matches a show to an RT page with a *substring* title rule and a
 * +/-25y window. Both are deliberately loose so long-running shows resolve, but
 * loose rules mis-fire in predictable ways and this looks for exactly those:
 *
 *  A. substring-only matches   "Planet Earth" folds into "Planet Earth II",
 *                              so a prefix title can capture its own sequel.
 *  B. URL collisions           two different shows resolving to one RT page.
 *  C. duplicate catalogue titles  the pass keys its cache AND its apply map by
 *                              title alone, so One Piece 1999/2023 and
 *                              Doctor Who 1963/2005 share one answer.
 *  D. wide year gaps           matched, but our year and RT's are far apart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(HERE, f);

const ENT = { amp: '&', quot: '"', apos: "'", lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', nbsp: ' ', hellip: '...', mdash: '-', ndash: '-' };
const decode = (s) => String(s == null ? '' : s)
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)));
const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const fold = (s) => deaccent(decode(s)).toLowerCase().replace(/[^a-z0-9]+/g, '');
/* RT disambiguates same-name shows in the title itself ("Warrior (2019)"), so the
   suffix has to come off before comparing or a correctly-resolved page reads as a
   substring mismatch. */
const bare = (t) => decode(t).replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim();

const rows = JSON.parse(fs.readFileSync(at('_rt-tv-scores.json'), 'utf8'));
const shows = JSON.parse(fs.readFileSync(at('data/shows.json'), 'utf8'));

const flags = [];

// A. matched, but only because one title contains the other
for (const r of rows) {
  if (!r.pageName) continue;
  const a = fold(bare(r.title)), b = fold(bare(r.pageName));
  if (a !== b) {
    flags.push({
      kind: 'substring-match', title: r.title, ourYear: r.ourYear,
      pageName: r.pageName, rtYear: r.rtYear ?? null, score: r.score ?? null,
      url: r.url, status: r.status,
    });
  }
}

// B. two shows, one RT page
const byUrl = new Map();
for (const r of rows) {
  if (!r.url) continue;
  const k = r.url.replace(/\/$/, '');
  if (!byUrl.has(k)) byUrl.set(k, []);
  byUrl.get(k).push(r);
}
for (const [url, rs] of byUrl) {
  if (rs.length > 1) {
    flags.push({
      kind: 'url-collision', url,
      titles: rs.map((r) => `${r.title} (${r.ourYear})`),
      scores: rs.map((r) => r.score ?? null),
    });
  }
}

// C. catalogue titles that appear more than once — one cache key, one answer
const byTitle = new Map();
for (const s of shows) {
  if (!byTitle.has(s.title)) byTitle.set(s.title, []);
  byTitle.get(s.title).push(s.year);
}
for (const [t, years] of byTitle) {
  if (years.length > 1) {
    const r = rows.find((x) => x.title === t);
    flags.push({
      kind: 'duplicate-catalogue-title', title: t, years,
      resolvedTo: r ? (r.url || r.status) : null,
      note: 'pass keys cache and apply-map by title alone; both entries get one answer',
    });
  }
}

// D. matched but the years are far apart
for (const r of rows) {
  if (r.status !== 'ok' || r.ourYear == null || r.rtYear == null) continue;
  const gap = Math.abs(r.ourYear - r.rtYear);
  if (gap > 12) {
    flags.push({
      kind: 'wide-year-gap', title: r.title, ourYear: r.ourYear,
      rtYear: r.rtYear, gap, score: r.score, pageName: r.pageName, url: r.url,
    });
  }
}

// E. matched with NO year evidence at all. The pass prints "matched on title AND
// year", but its year guard is skipped whenever RT's hero carries no year (Bluey's
// metadataProps are ["TV-G","Next Ep Sep 29","3 Seasons"] — no year in sight), so
// these rows are title-only matches wearing a year-checked label.
for (const r of rows) {
  if (r.status !== 'ok') continue;
  if (r.rtYear == null) {
    flags.push({
      kind: 'no-year-evidence', title: r.title, ourYear: r.ourYear,
      score: r.score, pageName: r.pageName, url: r.url,
    });
  }
}

const counts = {};
for (const f of flags) counts[f.kind] = (counts[f.kind] || 0) + 1;

fs.writeFileSync(at('_rt-tv-audit.json'), JSON.stringify({ counts, flags }, null, 1));

console.log('audit of', rows.length, 'rows');
for (const [k, v] of Object.entries(counts)) console.log(' ', String(v).padStart(4), k);
console.log('\nwrote _rt-tv-audit.json (report only)');

for (const kind of ['url-collision', 'duplicate-catalogue-title', 'wide-year-gap']) {
  const sub = flags.filter((f) => f.kind === kind);
  if (!sub.length) continue;
  console.log(`\n--- ${kind} ---`);
  for (const f of sub.slice(0, 40)) console.log(' ', JSON.stringify(f));
}
const subs = flags.filter((f) => f.kind === 'substring-match');
if (subs.length) {
  console.log(`\n--- substring-match (first 40 of ${subs.length}) ---`);
  for (const f of subs.slice(0, 40)) {
    console.log(`  "${f.title}" (${f.ourYear}) -> "${f.pageName}" ${f.score ?? '-'}  ${f.url}`);
  }
}
