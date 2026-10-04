/**
 * Shared helpers for the Metascore remainder pass.
 *
 * Read-only: nothing in here writes to the catalogue.
 */

import { readFileSync } from 'node:fs';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/** Public key the site's own front end uses; no account, no secret. */
export const KEY = '1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u';

/* -------------------------------------------------------------------------- */
/* Reading the catalogue                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Pull a top-level `const NAME = [...]` array out of an HTML file by bracket
 * matching. A regex cannot do this safely — blurbs contain brackets.
 *
 * @param {string} file
 * @param {string} name
 * @returns {object[]}
 */
export function readArray(file, name) {
  const html = readFileSync(file, 'utf8');
  const at = html.search(new RegExp(`const ${name}\\s*=\\s*\\[`));
  if (at < 0) throw new Error(`${name} array not found in ${file}`);
  const start = html.indexOf('[', at);
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`${name} array is unterminated in ${file}`);
  return JSON.parse(html.slice(start, end));
}

/* -------------------------------------------------------------------------- */
/* Titles                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Decode the HTML entities the catalogue actually carries.
 *
 * This is rule 5 and it is not hypothetical: "Preludes &amp; Nocturnes" folded
 * to alphanumerics becomes "preludesampnocturnes", which matches nothing —
 * least of all its own title. Entities must die before any comparison or any
 * slug is built from a title.
 *
 * @param {string} s
 */
export function decodeEntities(s) {
  return String(s)
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, body) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      const named = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
        ndash: '–',
        mdash: '—',
        hellip: '…',
        rsquo: '’',
        lsquo: '‘',
        ldquo: '“',
        rdquo: '”',
        eacute: 'é',
        egrave: 'è',
        uuml: 'ü',
        ouml: 'ö',
        auml: 'ä',
        ntilde: 'ñ',
        iexcl: '¡',
        deg: '°',
      };
      return Object.prototype.hasOwnProperty.call(named, body.toLowerCase())
        ? named[body.toLowerCase()]
        : m;
    })
    .replace(/&amp;/g, '&');
}

/** Fold a title to the form two spellings of the same work share. */
export function fold(s) {
  return decodeEntities(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * Do these two titles name the same work?
 *
 * Deliberately strict. Metacritic often carries an edition suffix the catalogue
 * does not ("Game of the Year Edition"), so a prefix match counts — but only in
 * that direction and only when the shared part is substantial.
 *
 * @param {string} stored
 * @param {string} found
 */
export function titlesAgree(stored, found) {
  const pairs = [
    [stored, found],
    [stripBrand(stored), found],
    [stored, stripBrand(found)],
    [stripEdition(stored), stripEdition(found)],
  ];
  // Three normalisers, because the same two names can differ by punctuation
  // ("S.T.A.L.K.E.R." / "STALKER"), by numeral system ("Original Sin 2" /
  // "Original Sin II"), or by a leading article. All three must still obey the
  // sequel-tail guard below.
  const norms = [fold, (s) => foldNum(s, true), (s) => foldNum(s, false)];
  for (const [x, y] of pairs) {
    for (const n of norms) {
      const a = n(x);
      const b = n(y);
      if (!a || !b) continue;
      if (a === b) return true;
      const [short, long] = a.length <= b.length ? [a, b] : [b, a];
      if (short.length >= 8 && long.startsWith(short) && !isSequelTail(long.slice(short.length))) return true;
    }
  }
  return false;
}

/**
 * Is the extra tail on the longer title a sequel number rather than an edition?
 *
 * The prefix rule exists so "Disco Elysium" can match "Disco Elysium: The Final
 * Cut". Left ungoverned it also matches "Overwatch" to "Overwatch 2" and
 * "Divinity: Original Sin" to "Divinity: Original Sin II" — different games,
 * and exactly the kind of confident wrong answer that has to be designed out
 * rather than caught later. A tail that is a bare number or a bare roman
 * numeral is a sequel, so it is refused.
 *
 * @param {string} tail already folded
 */
function isSequelTail(tail) {
  return /^\d/.test(tail) || /^(i{1,3}|iv|vi{0,3}|ix|xi{0,2}|x)$/.test(tail);
}

/** Drop a trailing edition/re-release marker. */
export function stripEdition(s) {
  return decodeEntities(s).replace(
    /\s*[:\-–—]?\s*\b(the\s+)?(game of the year|goty|definitive|complete|enhanced|remastered|redux|director'?s cut|final cut|special|deluxe|ultimate|anniversary|extended|gold|hd|remake|reloaded|classic|legacy)\b\s*(edition|collection|version)?\s*$/i,
    '',
  ).trim() || decodeEntities(s);
}

/**
 * Drop a leading possessive brand the catalogue omits and Metacritic keeps.
 *
 * We store "Civilization V"; the page is "Sid Meier's Civilization V". Same for
 * Tom Clancy's, American McGee's, Walt Disney's. Restricted to a genuine
 * possessive of at most three words so it cannot eat a real title — the guard
 * that matters is that "Dawn" must never be allowed to match "Horizon Zero
 * Dawn", and a possessive-only rule keeps that impossible.
 *
 * @param {string} s
 */
export function stripBrand(s) {
  const t = decodeEntities(s);
  const m = t.match(/^((?:[A-Za-z.]+\s+){0,2}[A-Za-z.]+['’]s)\s+(.{6,})$/);
  return m ? m[2] : t;
}

/**
 * @param {number|string|null|undefined} storedYear
 * @param {string|number|null|undefined} foundYear
 * @param {number} slack
 */
export function yearsAgree(storedYear, foundYear, slack) {
  const a = Number(storedYear);
  const b = Number(String(foundYear ?? '').slice(0, 4));
  // No date to check against is not a pass — rule 4. An unverifiable entry
  // stays unverified rather than being trusted on the strength of its name.
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < 1880) return false;
  return Math.abs(a - b) <= slack;
}

/**
 * Fold, with standalone roman numerals normalised to arabic.
 *
 * Needed to match a title against the site's own slug: we store "Divinity:
 * Original Sin 2" and the site's slug is `divinity-original-sin-ii`, we store
 * "Civilization V" and the slug may be `civilization-5`. Plain fold() puts
 * those in different buckets. Both sides go through the same transform, so a
 * word like "I" in "I Am Alive" becoming "1" is harmless — it happens
 * identically on both sides.
 *
 * @param {string} s
 */
export function foldNum(s, dropArticles = true) {
  const arabic = {
    i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7',
    viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13',
    xiv: '14', xv: '15', xvi: '16', xvii: '17', xviii: '18', xix: '19', xx: '20',
  };
  return decodeEntities(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => (dropArticles ? !['the', 'a', 'an'].includes(w) : true))
    .map((w) => arabic[w] ?? w)
    .join('');
}

/**
 * The keys a title should be indexed and looked up under.
 *
 * Two, because article stripping helps ("The Last of Us" vs "last-of-us") and
 * also hurts: "S.T.A.L.K.E.R." spells out to tokens s,t,a,l,k,e,r and loses its
 * "a". Indexing under both forms costs nothing and catches both shapes.
 *
 * @param {string} s
 * @returns {string[]}
 */
export function keysFor(s) {
  const a = foldNum(s, true);
  const b = foldNum(s, false);
  return a === b ? [a] : [a, b];
}

/* -------------------------------------------------------------------------- */
/* Slugs                                                                       */
/* -------------------------------------------------------------------------- */

/** The slug shape the earlier passes used, and the one the site mostly uses. */
export function slugify(s) {
  return decodeEntities(s)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Every slug worth trying for a title, best guess first.
 *
 * The earlier passes tried exactly one shape. The remainder they left behind is
 * dominated by titles whose real slug differs in punctuation, subtitle
 * handling, edition suffix or article placement, so this generates those
 * variants rather than giving up after one miss.
 *
 * @param {string} raw
 * @returns {string[]} deduped, order preserved
 */
export function slugVariants(raw) {
  const t = decodeEntities(raw).trim();
  const out = [];
  const push = (s) => {
    const v = String(s)
      .toLowerCase()
      .replace(/['’‘]/g, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (v && !out.includes(v)) out.push(v);
  };

  // 1. the baseline both earlier passes used
  push(t.replace(/&/g, ' and '));
  // 2. ampersand dropped rather than spelled out
  push(t.replace(/&/g, ' '));
  // 3. apostrophes kept as separators ("assassins-creed" vs "assassin-s-creed")
  push(t.replace(/&/g, ' and ').replace(/['’]/g, '-'));

  // 4. roman/arabic numeral swaps, both directions
  for (const swapped of numeralSwaps(t)) push(swapped.replace(/&/g, ' and '));

  // 5. subtitle handling: "Game: The Subtitle"
  const colon = t.match(/^(.*?)\s*[:–—-]\s+(.*)$/);
  if (colon) {
    push(colon[1].replace(/&/g, ' and ')); // main title alone
    push(`${colon[1]} ${colon[2]}`.replace(/&/g, ' and ')); // colon as space
  }

  // 6. edition / re-release suffixes the catalogue keeps and the site drops
  const stripped = t.replace(
    /\s*[:\-–]?\s*\b(the\s+)?(game of the year|goty|definitive|complete|enhanced|remastered|redux|director'?s cut|final cut|special|deluxe|ultimate|anniversary|extended|gold|hd|remake|reloaded|classic|legacy)\b\s*(edition|collection|version)?\s*$/i,
    '',
  );
  if (stripped !== t && stripped.trim()) push(stripped.replace(/&/g, ' and '));

  // 7. trailing parenthetical, e.g. "Title (2019)" or "Title (US)"
  const paren = t.replace(/\s*\([^)]*\)\s*$/, '');
  if (paren !== t && paren.trim()) push(paren.replace(/&/g, ' and '));

  // 8. leading article moved to the tail, the shape a few catalogue entries
  //    are stored in ("Last of Us, The")
  const trailingArticle = t.match(/^(.*),\s*(the|a|an)$/i);
  if (trailingArticle) push(`${trailingArticle[2]} ${trailingArticle[1]}`.replace(/&/g, ' and '));

  // 9. leading article dropped entirely
  const noArticle = t.replace(/^(the|a|an)\s+/i, '');
  if (noArticle !== t) push(noArticle.replace(/&/g, ' and '));

  return out;
}

/**
 * Roman <-> arabic variants of a title's standalone numerals.
 * @param {string} t
 */
function numeralSwaps(t) {
  const roman = {
    1: 'i', 2: 'ii', 3: 'iii', 4: 'iv', 5: 'v', 6: 'vi', 7: 'vii',
    8: 'viii', 9: 'ix', 10: 'x', 11: 'xi', 12: 'xii', 13: 'xiii',
  };
  const arabic = Object.fromEntries(Object.entries(roman).map(([k, v]) => [v, k]));
  const out = [];
  const toRoman = t.replace(/\b(\d{1,2})\b/g, (m, d) => roman[Number(d)] ?? m);
  if (toRoman !== t) out.push(toRoman);
  const toArabic = t.replace(/\b([ivx]{1,5})\b/gi, (m) => arabic[m.toLowerCase()] ?? m);
  if (toArabic !== t) out.push(toArabic);
  return out;
}
