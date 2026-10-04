/**
 * Diagnostic (report only): is the ISBN check digit valid?
 *
 * An ISBN-13's last digit is a mod-10 checksum over the first twelve.  A digit
 * that fails it cannot be a real ISBN - it is a corrupted or invented number,
 * and no amount of retrying will make goodreads find it.  This separates
 * "goodreads does not have this book" from "this is not an ISBN".
 */
import fs from 'node:fs';
import { readArray } from './gr_lib.mjs';

const { array: BOOKS } = readArray('books.html', 'BOOKS');
const cache = JSON.parse(fs.readFileSync('_gr-rest-cache.json', 'utf8'));

function valid13(d) {
  if (!/^[0-9]{13}$/.test(d)) return null;
  let s = 0;
  for (let i = 0; i < 12; i++) s += (i % 2 ? 3 : 1) * Number(d[i]);
  return d[12] === String((10 - (s % 10)) % 10);
}

let allGood = 0; let allBad = 0; let allOther = 0;
for (const b of BOOKS) {
  if (!b.isbn) continue;
  const v = valid13(String(b.isbn));
  if (v === true) allGood += 1; else if (v === false) allBad += 1; else allOther += 1;
}
console.log('WHOLE CATALOGUE');
console.log(`  ${allGood} valid check digit`);
console.log(`  ${allBad} INVALID check digit  (cannot be a real ISBN)`);
console.log(`  ${allOther} not a 13-digit string`);

let cg = 0; let cb = 0; let og = 0; let ob = 0;
for (const b of BOOKS) {
  if (!b.isbn) continue;
  const v = valid13(String(b.isbn));
  if (b.ratingVerified === true) { if (v) cg += 1; else cb += 1; } else if (v) og += 1; else ob += 1;
}
console.log(`\nalready confirmed (${cg + cb}):  ${cg} valid, ${cb} invalid`);
console.log(`outstanding       (${og + ob}):  ${og} valid, ${ob} invalid`);

const tab = {};
for (const b of BOOKS) {
  if (b.ratingVerified === true || !b.isbn) continue;
  const i = String(b.isbn);
  const v = cache[i];
  const st = !v ? 'unsettled'
    : v.ok === true ? 'page-with-a-rating'
      : v.status === 404 ? 'goodreads-404' : 'page-without-a-rating';
  const k = `${st.padEnd(22)} check digit ${valid13(i) ? 'VALID  ' : 'INVALID'}`;
  tab[k] = (tab[k] || 0) + 1;
}
console.log('\nOUTCOME x CHECK DIGIT (the 406)');
for (const [k, n] of Object.entries(tab).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}
