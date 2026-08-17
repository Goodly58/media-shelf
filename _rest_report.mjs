/**
 * Build _books-rest.json - the outcome for every book NOT already confirmed
 * against Goodreads: the 406 that carry an ISBN and the 185 that do not.
 *
 * REPORT ONLY.  This script has no --apply and writes no catalogue file.
 * Nothing here touches books.html; applying is done centrally elsewhere.
 *
 * Identity is decided the same way the confirmed pass decided it, using the
 * shared helpers in _gr_lib.mjs:
 *   RULE 3  the page's NAME is compared to our title before any number is
 *           believed - an ISBN that resolves is not an ISBN that is right.
 *   RULE 4  title alone is not enough; where the title matches only weakly the
 *           AUTHOR must agree too, which is what separates two different books
 *           that share a name.
 *   RULE 5  HTML entities are decoded before comparing, so "Preludes &amp;
 *           Nocturnes" does not fold to a token "amp" and stop matching itself.
 *   DRIFT   a Goodreads average moves daily.  Only a gap of >= 0.25 is an error;
 *           anything under that is normal movement, not a correction.
 *
 *   node _rest_report.mjs
 */
import fs from 'node:fs';
import { readArray, decodeEntities, titleMatch, authorMatch } from './_gr_lib.mjs';

const DRIFT = 0.25;
const CACHE = '_gr-rest-cache.json';

const { array: BOOKS } = readArray('books.html', 'BOOKS');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

// A strong title match on an exact ISBN outweighs the author field, because
// Goodreads routinely credits a co-author, translator or editor as the primary
// author.  So the author only vetoes a WEAK title match.
const STRONG = new Set(['exact', 'prefix', 'substring', 'main-title', 'no-page-title', 'empty']);

// RULE 4, the book form of Carrie-1976-vs-Carrie-2013: a series name in
// parentheses makes one volume look like another.  "Swallowdale (Swallows and
// Amazons)" CONTAINS the title "Swallows and Amazons", and "The Return of the
// Indian (The Indian in the Cupboard)" contains "The Indian in the Cupboard" -
// both matched on 'substring' and both are the SECOND book of their series, not
// the one we hold.  Containment is only believed if it survives with the trailing
// parenthetical removed.  stripSeries in _gr_lib only strips "(... #N)" forms, so
// a parenthetical without a '#' slips through.
const deparen = (s) => String(s || '')
  .replace(/\s*\([^()]*\)\s*$/, '')
  .replace(/\s*\([^()]*\)\s*$/, '')
  .trim();
const CONTAINMENT = new Set(['substring', 'our-tokens-in-page', 'page-tokens-in-ours', 'truncated-tail']);

// The page title is sometimes literally "Goodreads" - that is the site chrome of
// a non-book page, not a book, and must never be treated as one.
const NOT_A_BOOK = (t) => !t || /^goodreads$/i.test(String(t).trim());

// Our entry is series-level ("A Bride's Story") but the page is one volume
// ("A Bride's Story, Vol. 1").  Worth flagging rather than rejecting.
const VOLUMEY = /\b(vol\.?|volume|book)\s*\d+|#\d+/i;

const round = (n) => Math.round(n * 1000) / 1000;

// An ISBN-13's last digit is a mod-10 checksum over the first twelve.  A digit
// that fails it cannot be a real ISBN, and no retry will make goodreads find it.
// Converting 13->10 DISCARDS the stored check digit and recomputes it, which is
// why the alternate-form retry repairs a mistyped last digit and then resolves.
function valid13(d) {
  if (!/^[0-9]{13}$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 12; i++) s += (i % 2 ? 3 : 1) * Number(d[i]);
  return d[12] === String((10 - (s % 10)) % 10);
}
function isbn10to13(i10) {
  const d = String(i10).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (d.length !== 10) return null;
  const core = `978${d.slice(0, 9)}`;
  let s = 0;
  for (let i = 0; i < 12; i++) s += (i % 2 ? 3 : 1) * Number(core[i]);
  return core + String((10 - (s % 10)) % 10);
}

/**
 * Is the page goodreads returned actually OUR book?
 * Used for rated AND unrated pages alike - an unrated page still has to be the
 * right book before "this book has no rating" is the correct finding.
 */
function identify(book, v) {
  const page = decodeEntities(v.title || '');
  if (NOT_A_BOOK(page)) {
    return { ok: false, why: 'not-a-book-page', kind: 'unrelated-book' };
  }
  const tm = titleMatch(book.title, v.title);
  if (!tm.ok) {
    const am0 = authorMatch(book.author, v.author);
    return { ok: false, why: 'title', kind: sameAuthorKind(am0) };
  }
  // containment that only holds because of a trailing "(Series Name)"
  if (CONTAINMENT.has(tm.why)) {
    const bare = deparen(page);
    if (bare && bare !== page && !titleMatch(book.title, bare).ok) {
      return { ok: false, why: `different-volume-of-${JSON.stringify(bare)}`,
        kind: 'same-author-different-volume' };
    }
  }
  const am = authorMatch(book.author, v.author);
  if (!STRONG.has(tm.why) && !am.ok) {
    return { ok: false, why: `author:${am.why}`, kind: sameAuthorKind(am) };
  }
  return { ok: true, why: tm.why, volumeCaveat: VOLUMEY.test(page) && !VOLUMEY.test(book.title) };
}

const sameAuthorKind = (am) => (am.ok && !['missing', 'no-tokens', 'placeholder-credit'].includes(am.why)
  ? 'same-author-different-volume' : 'unrelated-book');

const rows = [];
const tally = {};
const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };

for (const b of BOOKS) {
  if (b.ratingVerified === true) continue;           // already confirmed elsewhere
  const ours = b.rating == null ? null : Number(b.rating);

  // ---- the 185 with no ISBN ------------------------------------------------
  if (!b.isbn) {
    rows.push({
      title: b.title, isbn: null, ours, theirs: null, count: null, gap: null,
      status: 'no-isbn-search-disallowed',
      note: 'goodreads robots.txt: "User-agent: * / Disallow: /search" - the only '
          + 'title+author route is off-limits, so this book cannot be joined',
    });
    bump('no-isbn-search-disallowed');
    continue;
  }

  const isbn = String(b.isbn);
  const v = cache[isbn];

  if (!v) {
    rows.push({ title: b.title, isbn, ours, theirs: null, count: null, gap: null,
      status: 'unsettled', note: 'never returned a final answer - rerun _rest_fetch.py' });
    bump('unsettled');
    continue;
  }

  if (v.ok !== true) {
    if (v.status === 404) {
      rows.push({ title: b.title, isbn, ours, theirs: null, count: null, gap: null,
        status: 'isbn-404',
        note: v.altTried
          ? `goodreads has no record of this ISBN, nor of its other form ${v.altTried}`
          : 'goodreads has no record of this ISBN' });
      bump('isbn-404');
    } else if (v.status === 'no-rating-confirmed') {
      // A page with no rating still has to BE our book before "this book is
      // unrated" is the right finding.  Most of these are not: the ISBN lands on
      // some unrelated obscure title that happens to carry no rating, and calling
      // that "our book is unrated" would bury a wrong-ISBN finding as a shrug.
      const t = decodeEntities(v.title || '');
      const ident = identify(b, v);
      if (ident.ok) {
        rows.push({ title: b.title, isbn, ours, theirs: null, count: null, gap: null,
          status: 'page-has-no-rating',
          note: `real goodreads page "${t}" for this book, genuinely carrying no rating` });
        bump('page-has-no-rating');
      } else {
        rows.push({ title: b.title, isbn, ours, theirs: null, count: null, gap: null,
          status: 'isbn-names-a-different-book',
          note: `/book/isbn/${isbn} resolves to "${t}"${v.author ? ` by ${v.author}` : ''}`
              + ' - not this book (and that page carries no rating either)',
          reject: ident.why,
          kind: ident.kind,
          isbnEchoedByPage: v.pageIsbn != null && String(v.pageIsbn) === isbn,
          pageIsbn: v.pageIsbn ?? null,
          theirTitle: t,
          theirAuthor: v.author || null,
          theirRating: null,
          theirCount: null });
        bump('isbn-names-a-different-book');
      }
    } else {
      rows.push({ title: b.title, isbn, ours, theirs: null, count: null, gap: null,
        status: 'unsettled', note: String(v.status) });
      bump('unsettled');
    }
    continue;
  }

  // ---- a rating came back: is it OUR book? --------------------------------
  const theirs = Number(v.rating);
  const count = v.count ?? null;
  const ident = identify(b, v);

  if (!ident.ok) {
    // Whose error is it - ours or Goodreads'?  The destination page's own JSON-LD
    // carries an "isbn" field.  When that field echoes the ISBN we asked for,
    // Goodreads is not fuzzy-matching or drifting through a redirect: its record
    // positively asserts that this ISBN belongs to that other book.  The ISBN in
    // our catalogue is then the thing that is wrong.
    const echoed = v.pageIsbn != null && String(v.pageIsbn) === isbn;
    rows.push({
      title: b.title, isbn, ours, theirs: null, count: null, gap: null,
      // A same-author rejection is genuinely AMBIGUOUS and must not be reported as
      // a wrong ISBN.  The page can be a neighbouring work ("The Wisdom of No
      // Escape" -> "When Things Fall Apart"), but it can equally be the SAME work
      // under a translated or alternate title - "The Hunchback of Notre-Dame" ->
      // "Notre-Dame de Paris", "The Family of Pascual Duarte" -> "La familia de
      // Pascual Duarte", "Off the Map" -> "Unruly Places" (UK/US retitling),
      // "Ninety-Nine Percent Invisible City" -> "The 99% Invisible City" (words vs
      // numerals).  No title comparison can separate those two cases, so this
      // bucket is flagged for review rather than asserted against.
      status: ident.kind === 'same-author-different-volume'
        ? 'isbn-same-author-needs-review'
        : 'isbn-names-a-different-book',
      note: `/book/isbn/${isbn} resolves to "${decodeEntities(v.title || '')}"`
          + `${v.author ? ` by ${v.author}` : ''}`
          + (ident.kind === 'same-author-different-volume'
            ? ' - same author, different title: either a neighbouring work or an'
              + ' alternate/translated title of this same work. Titles alone cannot decide.'
            : ' - not this book')
          + `${v.url ? ` (${v.url})` : ''}`,
      reject: ident.why,
      // Two very different kinds of wrong hide in this bucket:
      //   author still matches -> the ISBN is for a neighbouring volume, an
      //     omnibus or a collection by the same writer (recoverable, ISBN fix)
      //   author does not match -> the ISBN belongs to an unrelated book entirely
      kind: ident.kind,
      // evidence of WHOSE error this is
      isbnEchoedByPage: echoed,
      verdict: ident.kind === 'same-author-different-volume'
        ? 'AMBIGUOUS - needs a human: same author, so this is either the wrong ISBN or the same work retitled'
        : echoed
          ? 'our ISBN is wrong: goodreads\' own record ties this exact ISBN to that other book'
          : 'weaker: the page does not echo the ISBN we asked for, so the redirect may have drifted',
      pageIsbn: v.pageIsbn ?? null,
      theirTitle: decodeEntities(v.title || ''),
      theirAuthor: v.author || null,
      theirRating: theirs,
      theirCount: count,
    });
    bump('isbn-names-a-different-book');
    continue;
  }

  const gap = ours == null ? null : round(Math.abs(ours - theirs));
  rows.push({
    title: b.title, isbn, ours, theirs, count, gap,
    status: gap != null && gap >= DRIFT ? 'rating-wrong' : 'confirmed',
    matchedOn: ident.why,
    ...(ident.volumeCaveat
      ? { volumeCaveat: 'our entry is series-level, the page is a single volume' }
      : {}),
    theirTitle: decodeEntities(v.title || ''),
    theirAuthor: v.author || null,
    ...(v.viaAlt ? { viaAlt: v.viaAlt } : {}),
    // Reported, never applied.  Where our stored ISBN fails its own check digit
    // and the repaired form resolves to this very book, the corrected ISBN-13 is
    // a fact worth handing over - but writing it is somebody else's pass.
    ...((() => {
      if (!v.viaAlt) return {};
      const fixed = isbn10to13(v.viaAlt);
      if (!fixed || fixed === isbn) return {};
      return {
        isbnCheckDigitValid: valid13(isbn),
        suggestedIsbn: fixed,
        suggestedIsbnWhy: valid13(isbn)
          ? 'our ISBN-13 validates but goodreads only indexes the ISBN-10 form'
          : 'our ISBN-13 fails its own check digit; this is the repaired form that resolved',
      };
    })()),
  });
  bump(gap != null && gap >= DRIFT ? 'rating-wrong' : 'confirmed');
}

rows.sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1));
fs.writeFileSync('_books-rest.json', JSON.stringify(rows, null, 2));

// ------------------------------------------------------------------ summary
console.log(`_books-rest.json - ${rows.length} rows (the books not already confirmed)\n`);
console.log('OUTCOMES');
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}

const conf = rows.filter((r) => r.status === 'confirmed' || r.status === 'rating-wrong');
const cmp = conf.filter((r) => r.gap != null);
if (cmp.length) {
  const wrong = cmp.filter((r) => r.gap >= DRIFT);
  console.log(`\nAGREEMENT on the ${conf.length} newly confirmed`);
  console.log(`  drift rule: a gap under ${DRIFT} is normal daily movement, not an error`);
  console.log(`  ${cmp.length - wrong.length} agree within ${DRIFT}`);
  console.log(`  ${wrong.length} are genuinely wrong (gap >= ${DRIFT})`);
  console.log(`  mean drift ${(cmp.reduce((s, r) => s + r.gap, 0) / cmp.length).toFixed(3)}`);
  if (wrong.length) {
    console.log('\n  WORST GAPS');
    for (const r of wrong.slice(0, 25)) {
      console.log(`    ${String(r.ours).padStart(5)} -> ${String(r.theirs).padEnd(5)} gap ${String(r.gap).padEnd(5)} ${r.title}`);
    }
  }
  const fix = conf.filter((r) => r.suggestedIsbn);
  if (fix.length) {
    console.log(`\n  ${fix.length} of these carry a CORRECTABLE ISBN (reported, not applied):`);
    for (const r of fix) {
      console.log(`    ${r.isbn} -> ${r.suggestedIsbn}  ${r.title}`);
      console.log(`      ${r.suggestedIsbnWhy}`);
    }
  }
  const cav = conf.filter((r) => r.volumeCaveat);
  if (cav.length) {
    console.log(`\n  ${cav.length} carry a volume caveat - our entry is series-level, the page is one volume:`);
    for (const r of cav) console.log(`    "${r.title}" -> "${r.theirTitle}"`);
  }
}

const diff = rows.filter((r) => r.status === 'isbn-names-a-different-book');
if (diff.length) {
  const echoed = diff.filter((r) => r.isbnEchoedByPage).length;
  console.log(`\nISBNs THAT NAME A DIFFERENT BOOK (${diff.length}) - reported, never applied`);
  console.log(`  ${echoed} of ${diff.length} destination pages echo the exact ISBN we asked for in`);
  console.log('  their own JSON-LD, so goodreads is asserting the ISBN belongs to that other');
  console.log('  book - the ISBN in our catalogue is the thing that is wrong, not the lookup.');
  for (const r of diff.slice(0, 12)) {
    console.log(`    ${r.isbn}  "${r.title}" -> "${r.theirTitle}" (${r.theirAuthor || '?'})`);
  }
}

const amb = rows.filter((r) => r.status === 'isbn-same-author-needs-review');
if (amb.length) {
  console.log(`\nSAME AUTHOR, DIFFERENT TITLE (${amb.length}) - AMBIGUOUS, needs a human`);
  console.log('  These land on a book by the same author. That is two different situations');
  console.log('  wearing one shape, and no title comparison can tell them apart:');
  console.log('    (a) the ISBN really is wrong and points at a neighbouring work, or');
  console.log('    (b) the ISBN is right and goodreads files this work under another title');
  console.log('        - a translation, a UK/US retitling, or numerals instead of words.');
  console.log('  Inspection of this list found clear (b) cases, so it must NOT be applied as');
  console.log('  a block of ISBN corrections:');
  console.log('    "The Hunchback of Notre-Dame"        -> "Notre-Dame de Paris"');
  console.log('    "The Family of Pascual Duarte"       -> "La familia de Pascual Duarte"');
  console.log('    "Ninety-Nine Percent Invisible City" -> "The 99% Invisible City: A Field Guide..."');
  console.log('    "Off the Map"                        -> "Unruly Places" (UK/US retitling)');
  console.log('  and clear (a) cases in the same list:');
  console.log('    "The Wisdom of No Escape"            -> "When Things Fall Apart"');
  console.log('    "Swallows and Amazons"               -> "Swallowdale" (book 2 of the series)');
  console.log('    "The Indian in the Cupboard"         -> "The Return of the Indian" (book 2)');
}

const four = rows.filter((r) => r.status === 'isbn-404');
if (four.length) {
  console.log(`\nISBNs GOODREADS HAS NO RECORD OF (${four.length})`);
  console.log('  each was retried in its other ISBN form (13 <-> 10) before being believed.');
  console.log('  This is a real result, not a failure: goodreads simply has no such edition.');
}

const none = rows.filter((r) => r.status === 'no-isbn-search-disallowed');
if (none.length) {
  console.log(`\nNO ISBN, AND NOT JOINABLE (${none.length})`);
  console.log('  goodreads robots.txt, User-agent: * -> "Disallow: /search".');
  console.log('  The title+author search route is off-limits, so these stop here.');
}

const unsettled = rows.filter((r) => r.status === 'unsettled');
if (unsettled.length) {
  console.log(`\nUNSETTLED (${unsettled.length}) - never given a final answer.`);
  console.log('  RULE: a throttle is not a result. These were left uncached; rerun _rest_fetch.py.');
}
