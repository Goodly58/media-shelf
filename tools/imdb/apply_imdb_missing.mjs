/**
 * Apply the ids found by tools/imdb/fetch_imdb_missing.mjs to the catalogue.
 *
 *   node tools/imdb/apply_imdb_missing.mjs                    report only — DEFAULT
 *   node tools/imdb/apply_imdb_missing.mjs --only-high        report only, high confidence alone
 *   node tools/imdb/apply_imdb_missing.mjs --apply            write data/movies.json + data/shows.json
 *
 * Selection flags (each widens what is eligible; none of them writes anything
 * on its own — --apply is always required to touch a file):
 *   --only-high             status=resolved AND confidence=high        (146 rows)
 *   (default)               status=resolved, high + medium             (165 rows)
 *   --include-review        also the 3 rows the fetcher flagged for review
 *   --include-kind-mismatch also the 2 rows IMDb files under another kind
 *
 * The last two exist so the numbers can be inspected, not because they are safe.
 * A REVIEW row means a specific piece of evidence disagreed and a person is
 * supposed to look at it; a KIND MISMATCH row means IMDb calls the work a film
 * and this catalogue calls it a show, so writing the id also endorses a
 * classification nobody has agreed to. Read the `note` on each before using
 * either flag.
 *
 * WHAT IT WRITES per matched row:  imdbId, imdb, imdbVotes, imdbVerified=true
 * Ratings come from title.ratings.tsv as captured in _imdb-missing.json; re-run
 * the fetcher if that file is old.
 */
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const ONLY_HIGH = process.argv.includes('--only-high');
const WITH_REVIEW = process.argv.includes('--include-review');
const WITH_KIND = process.argv.includes('--include-kind-mismatch');

const RESULTS = JSON.parse(fs.readFileSync('_imdb-missing.json', 'utf8'));

const SETS = {
  film: { file: 'data/movies.json', key: 'movies' },
  show: { file: 'data/shows.json', key: 'shows' },
};
for (const s of Object.values(SETS)) {
  const raw = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  s.raw = raw;
  s.rows = Array.isArray(raw) ? raw : raw[s.key] || [];
  s.index = new Map(s.rows.map((r) => [`${r.title}|${r.year}`, r]));
}

const eligible = (r) => {
  if (!r.newId) return false;
  if (r.status === 'resolved') return ONLY_HIGH ? r.confidence === 'high' : true;
  if (r.status === 'review') return WITH_REVIEW;
  if (r.status === 'kind-mismatch') return WITH_KIND;
  return false;
};

/* --------------------------------------------------------- safety checks */

const chosen = RESULTS.filter(eligible);
const skipped = RESULTS.filter((r) => !eligible(r));
const problems = [];

/* An id must not already be in the catalogue, and must not be claimed twice in
   this batch. Both were live faults during the search: two American Crime Story
   rows landed on the anthology's single id, and O.J.: Made in America resolved
   to an id the film list already owns. Writing either would put one work under
   two entries and make the ratings join ambiguous forever. */
const existing = new Map();
for (const [kind, s] of Object.entries(SETS)) {
  for (const r of s.rows) if (r.imdbId) existing.set(r.imdbId, `${kind}: ${r.title} (${r.year})`);
}
const claims = new Map();
for (const r of chosen) {
  if (!claims.has(r.newId)) claims.set(r.newId, []);
  claims.get(r.newId).push(r);
}
for (const [id, rs] of claims) {
  if (rs.length > 1) problems.push(`${id} claimed by ${rs.length} entries: ${rs.map((r) => `"${r.title}" (${r.year})`).join(', ')}`);
  if (existing.has(id)) problems.push(`${id} is already on ${existing.get(id)} — proposed again for "${rs[0].title}" (${rs[0].year})`);
}

/* The target row must still exist and must still be missing an id. If another
   pass has filled it in since the fetch, this one stays out of the way. */
const plan = [];
for (const r of chosen) {
  const s = SETS[r.kind];
  if (!s) { problems.push(`unknown kind "${r.kind}" for "${r.title}"`); continue; }
  const row = s.index.get(`${r.title}|${r.year}`);
  if (!row) { problems.push(`no row in ${s.file} for "${r.title}" (${r.year}) — catalogue changed since the fetch`); continue; }
  if (row.imdbId) { problems.push(`"${r.title}" (${r.year}) already has ${row.imdbId} — someone else filled it in; skipping`); continue; }
  plan.push({ r, row, s });
}

/* ------------------------------------------------------------------ report */

const bucket = (s) => RESULTS.filter((r) => r.status === s).length;
console.log('='.repeat(78));
console.log(`_imdb-missing.json holds ${RESULTS.length} entries: `
  + `${bucket('resolved')} resolved, ${bucket('review')} review, ${bucket('kind-mismatch')} kind-mismatch, ${bucket('unresolved')} unresolved`);
console.log(`selection: ${ONLY_HIGH ? 'high confidence only' : 'resolved (high + medium)'}`
  + `${WITH_REVIEW ? ' + review' : ''}${WITH_KIND ? ' + kind-mismatch' : ''}`);
console.log(`${plan.length} rows would be written, ${skipped.length} left alone`);
console.log('='.repeat(78));

for (const { r, row } of plan.slice(0, 30)) {
  const ratingChange = row.imdb !== r.rating ? `  imdb ${row.imdb ?? '—'} -> ${r.rating ?? '—'}` : '';
  console.log(`  ${r.kind.padEnd(4)} ${r.newId}  ${r.title} (${r.year})`
    + `${r.imdbName && r.imdbName !== r.title ? `  ["${r.imdbName}"]` : ''}${ratingChange}`);
}
if (plan.length > 30) console.log(`  … and ${plan.length - 30} more`);

const notWritten = skipped.filter((r) => r.status !== 'resolved');
if (notWritten.length) {
  console.log(`\nleft for a human (${notWritten.length}):`);
  for (const r of notWritten) {
    console.log(`  ${r.status.padEnd(14)} ${r.kind.padEnd(4)} ${r.title} (${r.year})  ${r.newId ? '-> ' + r.newId + ' "' + r.imdbName + '"' : '(nothing found)'}`);
    if (r.note) console.log(`                 ${r.note}`);
  }
}

if (problems.length) {
  console.log(`\n!! ${problems.length} problems — nothing will be written until these are resolved:`);
  for (const p of problems) console.log(`   ${p}`);
}

if (!APPLY) {
  console.log(`\n(report only — pass --apply to write)`);
  process.exit(0);
}
if (problems.length) {
  console.error(`\nrefusing to write: ${problems.length} problems above. Fix the selection or the data first.`);
  process.exit(1);
}

/* ------------------------------------------------------------------- write */

for (const { r, row } of plan) {
  row.imdbId = r.newId;
  if (r.rating != null) { row.imdb = r.rating; row.imdbVotes = r.votes; row.imdbVerified = true; }
  else row.imdbVerified = false;   // id is good, IMDb simply has no rating yet
}
for (const s of Object.values(SETS)) {
  const out = Array.isArray(s.raw) ? s.rows : { ...s.raw, [s.key]: s.rows };
  fs.writeFileSync(s.file, JSON.stringify(out));
  console.log(`wrote ${s.file}`);
}
console.log(`${plan.length} entries given an imdbId`);
