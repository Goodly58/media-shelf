/**
 * Exercise the backlog engine against realistic exports before any UI is built
 * on it. The fixtures reproduce the awkward parts of the real formats: commas
 * inside quoted titles, Goodreads' Excel-wrapped ISBNs, empty ratings, a
 * watchlist row with no rating beside a diary row with one.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const B = require('../assets/backlog.js');

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

const BOOKS = JSON.parse(readFileSync('data/books.json', 'utf8'));
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

/* ------------------------------ finished ---------------------------------- */

console.log('already finished');
const IMDB_RATINGS = [
  'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors',
  'tt0111161,10,2024-01-01,The Shawshank Redemption,The Shawshank Redemption,https://www.imdb.com/title/tt0111161/,Movie,9.3,142,1994,Drama,3000000,1994-09-23,Frank Darabont',
  'tt0903747,9,2024-01-02,Breaking Bad,Breaking Bad,https://www.imdb.com/title/tt0903747/,TV Series,9.5,49,2008,Drama,2000000,2008-01-20,',
  'tt2301451,10,2024-01-03,Breaking Bad: Ozymandias,Ozymandias,https://www.imdb.com/title/tt2301451/,TV Episode,9.5,47,2013,Drama,500000,2013-09-15,Rian Johnson',
].join('\n');
const IMDB_WATCHLIST = IMDB_RATINGS.replace('Const,Your Rating,', 'Const,Position,').replace(/^(tt\d+),(\d+),/gm, '$1,,');
const CATS = {
  movies: [{ id: 'tt0111161', title: 'The Shawshank Redemption', year: 1994 }, { id: 'tt2582802', title: 'Whiplash', year: 2014 },
    { id: 'tt0054215', title: 'Psycho', year: 1960 }, { id: 'tt0155975', title: 'Psycho', year: 1998 }, { id: 'tt0245429', title: 'Spirited Away', alt: 'Sen to Chihiro no kamikakushi', year: 2001 }],
  shows: [{ id: 'tt0903747', title: 'Breaking Bad', year: 2008 }],
  books: [{ id: 'gatsby', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', gr: '4671', year: 1925 },
    { id: 'kings', title: 'The Way of Kings', author: 'Brandon Sanderson', gr: '7235533', year: 2010 },
    { id: 'emma-a', title: 'Emma', author: 'Jane Austen', year: 1815 }],
};
const fromImdb = B.readFinished(IMDB_RATINGS, 'ratings.csv');
const imdbIds = B.matchFinished(fromImdb, CATS);
ok('IMDb ratings: rated films and series are watched, by IMDb id', String(imdbIds.movies) === 'tt0111161' && String(imdbIds.shows) === 'tt0903747', JSON.stringify(imdbIds));
ok('an IMDb list that rates nothing says so', B.readFinished(IMDB_WATCHLIST, 'watchlist.csv').error === 'unrated');
ok('a Letterboxd watchlist is not what was watched', B.readFinished(LETTERBOXD_WATCHLIST, 'watchlist.csv').error === 'watchlist');
const LETTERBOXD_WATCHED = LETTERBOXD_WATCHLIST + '\n2024-01-08,Whiplash,2014,https://boxd.it/d\n2024-01-09,Sen to Chihiro no kamikakushi,2001,https://boxd.it/e';
const lbIds = B.matchFinished(B.readFinished(LETTERBOXD_WATCHED, 'watched.csv'), CATS);
ok('Letterboxd watched: every film, matched by title and year', lbIds.movies.indexOf('tt2582802') >= 0 && lbIds.movies.indexOf('tt0054215') >= 0, JSON.stringify(lbIds));
ok('the year tells Psycho (1960) from Psycho (1998)', lbIds.movies.indexOf('tt0155975') < 0);
ok('a film is found under its original title too', lbIds.movies.indexOf('tt0245429') >= 0);
const GR_READ = GOODREADS + '\n7235533,"The Way of Kings (The Stormlight Archive, #1)",Brandon Sanderson,"Sanderson, Brandon",,="",="",5,4.65,Tor,Hardcover,1007,2010,2010,2024/05/01,2024/04/01,,,read,,,,1,1' +
  '\n1,"Emma",Jane Austen,"Austen, Jane",,="",="",4,4.0,Penguin,Paperback,474,2003,1815,2024/06/01,2024/05/01,,,read,,,,1,1';
const grIds = B.matchFinished(B.readFinished(GR_READ, 'goodreads_library_export.csv'), CATS);
ok('Goodreads: only the read shelf', grIds.books.indexOf('gatsby') >= 0 && grIds.books.indexOf('kings') >= 0 && grIds.books.length === 3, JSON.stringify(grIds));
ok('Goodreads: a book with another id is found by title (series dropped) and author', grIds.books.indexOf('emma-a') >= 0);
const HOBBITS = { books: [{ id: 'hobbit', title: 'The Hobbit', author: 'J. R. R. Tolkien', gr: '228531324' }, { id: 'hobbit-dixon', title: 'The Hobbit', author: 'Chuck Dixon', gr: '659469' },
  { id: 'sapiens', title: 'Sapiens: A Brief History of Humankind', author: 'Yuval Noah Harari' }, { id: 'sapiens-graphic', title: 'Sapiens: A Graphic History', author: 'Yuval Noah Harari' }] };
const grHead = GOODREADS.split('\n')[0];
const hob = B.matchFinished(B.readFinished(grHead + '\n5907,"The Hobbit, or There and Back Again",J.R.R. Tolkien,"Tolkien, J.R.R.",,="",="",5,4.3,Mariner,Paperback,366,2012,1937,2024/05/01,2024/04/01,,,read,,,,1,1' +
  '\n9,"Sapiens",Yuval Noah Harari,"Harari, Yuval Noah",,="",="",5,4.3,Harper,Paperback,443,2015,2011,2024/05/01,2024/04/01,,,read,,,,1,1', 'x.csv'), HOBBITS);
ok('Goodreads: the title before its subtitle, by the same author', String(hob.books) === 'hobbit', JSON.stringify(hob));
ok('Goodreads: a short title two of the author\'s books share matches neither', hob.books.indexOf('sapiens') < 0 && hob.books.indexOf('sapiens-graphic') < 0);
ok('a file that is no export says so', B.readFinished('a,b\n1,2', 'x.csv').error === 'unknown');

// A Letterboxd export in miniature: a ZIP with a stored and a deflated CSV, built here.
function zipOf(files) {
  const parts = [], dir = [];
  let off = 0;
  files.forEach(([name, text, deflate]) => {
    const raw = Buffer.from(text), body = deflate ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(off, 42);
    parts.push(local, nm, body); dir.push(cen, nm); off += 30 + nm.length + body.length;
  });
  const cd = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const all = Buffer.concat([...parts, cd, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}
const zip = zipOf([['watched.csv', LETTERBOXD_WATCHED, true], ['watchlist.csv', LETTERBOXD_WATCHLIST, false], ['ratings.csv', LETTERBOXD_RATINGS, false], ['lists/x.csv', 'junk', true]]);
const files = await B.readZip(zip);
ok('reads the CSVs inside a ZIP, stored or deflated', files.length === 4 && files[0].text === LETTERBOXD_WATCHED, JSON.stringify(files.map((f) => f.name)));
const zipped = B.finishedFromZip(files);
ok('a Letterboxd ZIP gives its watched films, not its watchlist', zipped.source === 'letterboxd' && zipped.items.length === 5, zipped.items.map((i) => i.title).join(', '));
ok('a ZIP with no export in it says so', B.finishedFromZip([{ name: 'profile.csv', text: 'a,b\n1,2' }]).error === 'unknown');
let threw = false;
try { await B.readZip(new ArrayBuffer(10)); } catch { threw = true; }
ok('a file that is not a ZIP is refused', threw);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
