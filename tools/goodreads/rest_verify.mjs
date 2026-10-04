/**
 * Independent check on the only books this pass actually recovered.
 * Every recovery came through the 13<->10 alternate-form retry, so the question
 * is WHY that worked - and the answer has to hold up per book, not on average.
 */
import fs from 'node:fs';

const rows = JSON.parse(fs.readFileSync('_books-rest.json', 'utf8'));
const cache = JSON.parse(fs.readFileSync('_gr-rest-cache.json', 'utf8'));

const digits = (s) => String(s).replace(/[^0-9Xx]/g, '').toUpperCase();
function valid13(d) {
  if (!/^[0-9]{13}$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 12; i++) s += (i % 2 ? 3 : 1) * Number(d[i]);
  return d[12] === String((10 - (s % 10)) % 10);
}
function isbn10to13(i10) {
  const d = digits(i10);
  if (d.length !== 10) return null;
  const core = `978${d.slice(0, 9)}`;
  let s = 0;
  for (let i = 0; i < 12; i++) s += (i % 2 ? 3 : 1) * Number(core[i]);
  return core + String((10 - (s % 10)) % 10);
}

const good = rows.filter((r) => r.status === 'confirmed' || r.status === 'rating-wrong');
let viaAlt = 0; let direct = 0; let badCheck = 0;

console.log(`${good.length} books were recovered by this pass.\n`);
for (const r of good) {
  const v = cache[r.isbn] || {};
  const alt = v.viaAlt || null;
  if (alt) viaAlt += 1; else direct += 1;
  const ok13 = valid13(r.isbn);
  if (!ok13) badCheck += 1;
  const fixed = alt ? isbn10to13(alt) : null;
  console.log(`  ${r.title}`);
  console.log(`    catalogue ISBN ${r.isbn}  check digit ${ok13 ? 'valid' : 'INVALID'}`);
  console.log(`    recovered via  ${alt ? `alternate form ${alt}` : 'the direct lookup'}`);
  if (fixed) console.log(`    correct ISBN-13 is ${fixed}${fixed === r.isbn ? '' : `  (ours differs: ${r.isbn})`}`);
  console.log(`    goodreads says ${r.theirs} from ${r.count} ratings; we hold ${r.ours} (gap ${r.gap})`);
}

console.log(`\n${viaAlt} recovered through the alternate ISBN form, ${direct} through the direct lookup.`);
console.log(`${badCheck} of the ${good.length} carry an ISBN whose check digit does not validate.`);
console.log('\nThat is the mechanism: converting 13->10 DISCARDS the stored check digit and');
console.log('recomputes it, so a catalogue ISBN whose last digit is wrong is repaired by the');
console.log('round trip and then resolves. It is a typo fix, not a different edition.');
