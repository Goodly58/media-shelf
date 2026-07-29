/**
 * Exercise the backlog engine against realistic exports before any UI is built
 * on it. The fixtures reproduce the awkward parts of the real formats: commas
 * inside quoted titles, Goodreads' Excel-wrapped ISBNs, empty ratings, a
 * watchlist row with no rating beside a diary row with one.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const B = require('./assets/backlog.js');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass += 1; return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
}

/* ------------------------------- fixtures -------------------------------- */

const GOODREADS = [
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies',
  '234225,Dune,Frank Herbert,"Herbert, Frank",,="0441013597",="9780441013593",0,4.27,Ace,Paperback,544,2005,1965,,2024/01/03,"sci-fi, to-read","sci-fi (#1)",to-read,,,,0,0',
  '4671,"The Great Gatsby, Annotated",F. Scott Fitzgerald,"Fitzgerald, F. Scott",,="0743273567",="9780743273565",5,3.93,Scribner,Paperback,180,2004,1925,2023/06/01,2023/05/02,classics,classics (#2),read,"Loved it, oddly.",,,1,1',
  '54493401,Piranesi,Susanna Clarke,"Clarke, Susanna",,="1635575630",="9781635575637",0,4.24,Bloomsbury,Hardcover,272,2020,2020,,2024/02/11,to-read,,to-read,,,,0,0',
  '11297,"Convenience Store Woman",Sayaka Murata,"Murata, Sayaka",,="",="",0,3.99,Grove,Paperback,163,2018,2016,,2024/03/01,to-read,,to-read,,,,0,0',
  '99999,A Book Nobody Has Heard Of,Some Author,"Author, Some",,="",="",0,4.60,Indie,Paperback,120,2021,2021,,2024/04/01,to-read,,to-read,,,,0,0',
].join('\n');

const LETTERBOXD_WATCHLIST = [
  'Date,Name,Year,Letterboxd URI',
  '2024-01-05,Aftersun,2022,https://boxd.it/a',
  '2024-01-06,"Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb",1964,https://boxd.it/b',
  '2024-01-07,Psycho,1960,https://boxd.it/c',
].join('\n');

const LETTERBOXD_RATINGS = [
  'Date,Name,Year,Letterboxd URI,Rating',
  '2024-02-01,Whiplash,2014,https://boxd.it/d,4.5',
].join('\n');

/* ------------------------------- CSV ------------------------------------- */

console.log('CSV');
const rows = B.parseCsvObjects(GOODREADS);
ok('parses every data row', rows.length === 5, `got ${rows.length}`);
ok('keeps a comma inside a quoted title', rows[1].Title === 'The Great Gatsby, Annotated', rows[1].Title);
ok('keeps a comma inside a quoted review', rows[1]['My Review'] === 'Loved it, oddly.', rows[1]['My Review']);
ok('unwraps the Excel-armoured ISBN', B.readExport(GOODREADS).items[0].isbn === '9780441013593');

/* ----------------------------- detection --------------------------------- */

console.log('detection');
const gr = B.readExport(GOODREADS);
ok('recognises Goodreads by its columns', gr.source && gr.source.id === 'goodreads');
const lb = B.readExport(LETTERBOXD_WATCHLIST);
ok('recognises Letterboxd by its columns', lb.source && lb.source.id === 'letterboxd');
ok('declines an unknown shape', B.readExport('a,b,c\n1,2,3').source === null);
ok('survives an empty file', B.readExport('').items.length === 0);

/* ------------------------------ parsing ---------------------------------- */

console.log('parsing');
const dune = gr.items.find((b) => b.title === 'Dune');
ok('reads the page count', dune.pages === 544, String(dune.pages));
ok('reads the community rating', dune.theirRating === 4.27, String(dune.theirRating));
ok('prefers the original publication year', dune.year === 1965, String(dune.year));
ok('reads the shelf as a status', dune.status === 'todo', dune.status);
ok('marks a read book as done', gr.items.find((b) => b.title.startsWith('The Great Gatsby')).status === 'done');
ok('keeps a book with no ISBN', gr.items.some((b) => b.title === 'Convenience Store Woman'));

const watch = B.readExport(LETTERBOXD_WATCHLIST).items;
ok('a watchlist row is todo', watch.every((m) => m.status === 'todo'));
const rated = B.readExport(LETTERBOXD_RATINGS).items;
ok('a rated film is already watched', rated[0].status === 'done');

/* ------------------------------ pasted ----------------------------------- */

console.log('pasted list');
const pasted = B.readPasted('Hades\nDisco Elysium (2019)\nOuter Wilds  2019\n\n   \n');
ok('drops blank lines', pasted.items.length === 3, String(pasted.items.length));
ok('pulls a bracketed year off the title', pasted.items[1].title === 'Disco Elysium' && pasted.items[1].year === 2019, JSON.stringify(pasted.items[1]));
ok('pulls a bare trailing year off too', pasted.items[2].title === 'Outer Wilds' && pasted.items[2].year === 2019, JSON.stringify(pasted.items[2]));

/* ------------------------------ matching --------------------------------- */

console.log('matching against the real catalogue');

function readArray(file, name) {
  const html = readFileSync(file, 'utf8');
  const at = html.search(new RegExp(`const ${name}\\s*=\\s*\\[`));
  const start = html.indexOf('[', at);
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') { depth -= 1; if (!depth) { end = i + 1; break; } }
  }
  return JSON.parse(html.slice(start, end));
}

const BOOKS = readArray('books.html', 'BOOKS');
const MOVIES = JSON.parse(readFileSync('data/movies.json', 'utf8'));

const bookIdx = B.indexCatalogue(BOOKS);
const movieIdx = B.indexCatalogue(MOVIES);

ok('finds Dune in the book catalogue', !!B.matchOne(dune, bookIdx));
ok('ignores punctuation and articles', !!B.matchOne({ title: 'the great gatsby', year: 1925 }, bookIdx));

// The guard that matters: a remake must not match its original.
const psycho1960 = B.matchOne({ title: 'Psycho', year: 1960 }, movieIdx);
const psycho1998 = B.matchOne({ title: 'Psycho', year: 1998 }, movieIdx);
ok('matches Psycho (1960) if the catalogue has it', psycho1960 ? psycho1960.year === 1960 : true);
ok('refuses Psycho (1998) against the 1960 entry', !psycho1998 || psycho1998.year !== 1960);

ok('a title we do not stock returns null', B.matchOne({ title: 'A Book Nobody Has Heard Of', year: 2021 }, bookIdx) === null);

/* -------------------------------- build ---------------------------------- */

console.log('the answer');

const built = B.build({ items: gr.items, catalogue: BOOKS, kind: 'books', status: 'todo' });
ok('only unread books are considered', built.stats.considered === 4, String(built.stats.considered));
ok('an unmatched book still appears', built.rows.some((r) => r.title === 'A Book Nobody Has Heard Of'));
ok('an unmatched book is scored from the export', built.rows.find((r) => r.title === 'A Book Nobody Has Heard Of').basis === 'community');
ok('results are ordered by quality', built.rows.every((r, i, a) => i === 0 || (a[i - 1].score ?? -1) >= (r.score ?? -1)));

const short = B.build({ items: gr.items, catalogue: BOOKS, kind: 'books', status: 'todo', minutes: 200 });
ok('a time budget excludes the long ones', short.rows.every((r) => r.minutes <= 200), JSON.stringify(short.rows.map((r) => [r.title, r.minutes])));
ok('a 544-page Dune does not fit in 200 minutes', !short.rows.some((r) => r.title === 'Dune'));
ok('a 163-page novella does', short.rows.some((r) => r.title === 'Convenience Store Woman'));

const floored = B.build({ items: gr.items, catalogue: BOOKS, kind: 'books', status: 'todo', minScore: 85 });
ok('a quality floor filters', floored.rows.every((r) => r.score >= 85));

const films = B.build({
  items: B.readExport(LETTERBOXD_WATCHLIST).items,
  catalogue: MOVIES, kind: 'movies', status: 'todo', minutes: 120,
});
ok('films are timed by runtime', films.rows.every((r) => r.minutes == null || r.minutes <= 120));
ok('a film with no runtime is dropped under a budget', films.rows.every((r) => r.minutes != null));

/* -------------------------------- edges ---------------------------------- */

console.log('edges');
ok('no items is not a crash', B.build({ items: [], catalogue: BOOKS, kind: 'books' }).rows.length === 0);
ok('no catalogue is not a crash', B.build({ items: gr.items, catalogue: [], kind: 'books', status: 'todo' }).rows.length > 0);
ok('junk in does not throw', (() => { try { B.build({ items: [{}], catalogue: BOOKS, kind: 'books', status: 'todo' }); return true; } catch { return false; } })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
