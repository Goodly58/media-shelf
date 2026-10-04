/**
 * Apply the two audited result sets: Rotten Tomatoes scores and Goodreads
 * ratings. No network — both were fetched and independently audited already.
 *
 *   node tools/apply_verified.mjs          report
 *   node tools/apply_verified.mjs --apply  write data/movies.json and books.html
 *
 * FILMS — only rows the harvester marked status "ok", which means it confirmed
 * the page on title AND year, with the director used to break ties between rival
 * films of the same name and year. That guard is the whole point: an earlier
 * pass matched on title alone and produced Carrie 92->51 (the 2013 remake),
 * RoboCop 88->50 (2014) and Pinocchio 97->0. Those now land on 94, 84 and 96.
 *
 * BOOKS — ratings only. `ratingsCount` is deliberately NOT overwritten: the UI
 * sorts on it, Goodreads' figure moves daily, and swapping a sort key is a
 * product decision rather than a correctness fix. The audit raised exactly this
 * and it is left for a human.
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

/* ------------------------------------------------------------------- films */
const rawM = JSON.parse(fs.readFileSync('data/movies.json', 'utf8'));
const movies = Array.isArray(rawM) ? rawM : rawM.movies;
const rtRows = JSON.parse(fs.readFileSync('_rt-scores.json', 'utf8'));
const byTitle = new Map(rtRows.filter((r) => r.status === 'ok').map((r) => [r.title, r]));

let fApplied = 0, fChanged = 0, fSame = 0;
const fMoves = [];
for (const m of movies) {
  const r = byTitle.get(m.title);
  if (!r || typeof r.score !== 'number') continue;
  // Belt and braces: re-assert the year agreement rather than trust the flag.
  if (m.year && r.rtYear && Math.abs(m.year - r.rtYear) > 1) continue;
  fApplied += 1;
  m.rtVerified = true;
  m.rtReviews = r.reviewCount;
  m.rtUrl = r.url;
  if (m.rt === r.score) { fSame += 1; continue; }
  fMoves.push([m.title, m.rt, r.score, r.reviewCount]);
  m.rt = r.score;
  fChanged += 1;
}
console.log(`FILMS  ${fApplied} applied — ${fSame} already correct, ${fChanged} corrected`);
for (const [t, o, n, c] of fMoves.sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2])).slice(0, 10)) {
  console.log(`  ${String(o ?? '—').padStart(3)} -> ${String(n).padStart(3)}  ${t}  (${c} reviews)`);
}

/* ------------------------------------------------------------------- books */
const { array: BOOKS, start, end, html } = readArray('books.html', 'BOOKS');
const bookRows = JSON.parse(fs.readFileSync('_book-ratings.json', 'utf8'));
const rows = Array.isArray(bookRows) ? bookRows : (bookRows.rows || []);
const byIsbn = new Map(rows.filter((r) => r.isbn && typeof r.theirs === 'number').map((r) => [String(r.isbn), r]));

let bApplied = 0, bChanged = 0, bSame = 0;
const bMoves = [];
const DRIFT = 0.25;
for (const b of BOOKS) {
  const r = b.isbn ? byIsbn.get(String(b.isbn)) : null;
  if (!r) continue;
  bApplied += 1;
  b.ratingVerified = true;
  const gap = b.rating == null ? Infinity : Math.abs(b.rating - r.theirs);
  // Inside the drift band the stored value is confirmed, not wrong: a Goodreads
  // average moves daily and rewriting it would be same-day noise.
  if (gap < DRIFT) { bSame += 1; continue; }
  bMoves.push([b.title, b.rating, r.theirs]);
  b.rating = Math.round(r.theirs * 100) / 100;
  bChanged += 1;
}
console.log(`\nBOOKS  ${bApplied} confirmed — ${bSame} inside the drift band, ${bChanged} corrected`);
console.log('       ratingsCount deliberately NOT overwritten (the UI sorts on it)');
for (const [t, o, n] of bMoves.sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2])).slice(0, 10)) {
  console.log(`  ${String(o ?? '—').padStart(5)} -> ${n.toFixed(2)}  ${t}`);
}

if (!APPLY) { console.log('\n(report only — pass --apply to write)'); process.exit(0); }
fs.writeFileSync('data/movies.json', JSON.stringify(Array.isArray(rawM) ? movies : { ...rawM, movies }));
fs.writeFileSync('books.html', html.slice(0, start) + JSON.stringify(BOOKS) + html.slice(end));
console.log('\nwrote data/movies.json and books.html');
