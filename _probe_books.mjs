/**
 * Can book ratings be verified against anything free and keyless?
 *
 * The catalogue stores a Goodreads-style 0-5 rating and a ratings count.
 * Goodreads retired its public API in 2020, so the question is whether Open
 * Library — which does expose ratings — agrees closely enough to be called a
 * verification, or whether it is simply a different number about the same book.
 *
 * Answering this honestly matters more than answering it yes.
 */

const UA = 'Mozilla/5.0 (compatible; MediaShelf/1.0; +https://goodly58.github.io/media-shelf/)';

/** A spread: canonical classics, modern bestsellers, and something obscure. */
const SAMPLE = [
  { title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', stored: 4.27 },
  { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', isbn: '9780743273565', stored: 3.93 },
  { title: 'Project Hail Mary', author: 'Andy Weir', isbn: '9780593135204', stored: 4.52 },
  { title: 'Beloved', author: 'Toni Morrison', isbn: '9781400033416', stored: 3.94 },
  { title: 'Piranesi', author: 'Susanna Clarke', isbn: '9781635575637', stored: 4.24 },
  { title: 'The Bluest Eye', author: 'Toni Morrison', isbn: '9780307278449', stored: 4.0 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} isbn */
async function openLibraryByIsbn(isbn) {
  // The ISBN endpoint gives the edition; ratings hang off the WORK, so resolve
  // the work key first.
  const ed = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, { headers: { 'User-Agent': UA } });
  if (ed.status !== 200) return { status: ed.status };
  const edition = await ed.json();
  const workKey = edition?.works?.[0]?.key;
  if (!workKey) return { status: 200, note: 'edition has no work' };

  const r = await fetch(`https://openlibrary.org${workKey}/ratings.json`, { headers: { 'User-Agent': UA } });
  if (r.status !== 200) return { status: r.status, workKey };
  const j = await r.json();
  return {
    status: 200,
    workKey,
    average: j?.summary?.average ?? null,
    count: j?.summary?.count ?? null,
  };
}

console.log('title                     stored   openlibrary   n      delta');
console.log('-'.repeat(66));

let compared = 0;
let within = 0;
const deltas = [];

for (const b of SAMPLE) {
  const res = await openLibraryByIsbn(b.isbn);
  let line = b.title.padEnd(26);
  if (res.status !== 200 || res.average == null) {
    line += `${String(b.stored).padStart(5)}    ${String(res.status).padStart(3)} no rating`;
  } else {
    const d = res.average - b.stored;
    deltas.push(Math.abs(d));
    compared += 1;
    if (Math.abs(d) <= 0.15) within += 1;
    line +=
      `${String(b.stored).padStart(5)}   ${res.average.toFixed(2).padStart(6)}  ` +
      `${String(res.count).padStart(6)}  ${(d >= 0 ? '+' : '') + d.toFixed(2)}`;
  }
  console.log(line);
  await sleep(700);
}

const mean = deltas.length ? deltas.reduce((a, c) => a + c, 0) / deltas.length : NaN;
console.log('-'.repeat(66));
console.log(`compared ${compared}/${SAMPLE.length}, within 0.15 of stored: ${within}`);
console.log(`mean absolute difference: ${Number.isNaN(mean) ? 'n/a' : mean.toFixed(2)} stars`);
console.log(
  '\nVerdict test: a source is a verification only if it is the SAME measure.\n' +
    'A different population rating the same book is a second opinion, not a check.',
);
