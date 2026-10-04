// Shared helpers for the Goodreads sweep.
import fs from 'node:fs';

// Bracket-matching array extractor (copied from tools/imdb/verify_imdb.mjs / scripts/build-backlog-index.js)
export function readArray(file, name) {
  const h = fs.readFileSync(file, 'utf8');
  const at = h.search(new RegExp(`const ${name}\\s*=\\s*\\[`));
  const s = h.indexOf('[', at);
  let d = 0, e = -1, q = false, esc = false;
  for (let i = s; i < h.length; i++) {
    const c = h[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { e = i + 1; break; } }
  }
  return { array: JSON.parse(h.slice(s, e)), start: s, end: e, html: h };
}

// RULE 4: decode HTML entities before comparing titles.
// "Preludes &amp; Nocturnes" must not fold to a token "amp".
export function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&(amp|#38|#x26);/gi, '&')
    .replace(/&(quot|#34|#x22);/gi, '"')
    .replace(/&(apos|#39|#x27|rsquo|lsquo|#8217|#8216);/gi, "'")
    .replace(/&(lt|#60|#x3c);/gi, '<')
    .replace(/&(gt|#62|#x3e);/gi, '>')
    .replace(/&(nbsp|#160);/gi, ' ')
    .replace(/&(ndash|#8211|mdash|#8212);/gi, '-')
    .replace(/&(hellip|#8230);/gi, '...')
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, d) => { try { return String.fromCodePoint(parseInt(d, 16)); } catch { return ' '; } })
    .replace(/&[a-z]+;/gi, ' ');
}

// British/American variants are the same title, so normalise them before
// comparing. Only known pairs are merged - nothing heuristic.
const SPELLING = [
  [/colour/g, 'color'], [/honour/g, 'honor'], [/favour/g, 'favor'],
  [/behaviour/g, 'behavior'], [/neighbour/g, 'neighbor'], [/labour/g, 'labor'],
  [/theatre/g, 'theater'], [/centre/g, 'center'], [/metre/g, 'meter'],
  [/defence/g, 'defense'], [/offence/g, 'offense'], [/practise/g, 'practice'],
  [/travelling/g, 'traveling'], [/traveller/g, 'traveler'], [/grey/g, 'gray'],
  [/ise(s|d|r)?\b/g, 'ize$1'], [/isation/g, 'ization'],
];
const spell = (s) => SPELLING.reduce((acc, [re, to]) => acc.replace(re, to), s);

// NFKD does not decompose these, so they must be mapped by hand or
// "Jo Nesbo" and "Jo Nesbo" (with slashed o) never match.
const LETTERS = [[/ø/g, 'o'], [/æ/g, 'ae'], [/œ/g, 'oe'], [/ð/g, 'd'],
  [/þ/g, 'th'], [/ł/g, 'l'], [/ß/g, 'ss'], [/đ/g, 'd'], [/ı/g, 'i']];
const letters = (s) => LETTERS.reduce((acc, [re, to]) => acc.replace(re, to), s);

export const fold = (s) => spell(letters(decodeEntities(s)
  .toLowerCase())
  .normalize('NFKD').replace(/[̀-ͯ]/g, ''))
  .replace(/[^a-z0-9]+/g, '');

// "Confessions of a Buddhist Atheist" and "Confession of a Buddhist Atheist"
// are one book; compare tokens with a trailing plural tolerated.
const singular = (t) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
export const sameToken = (x, y) => x === y || singular(x) === singular(y);

// Goodreads titles carry series suffixes: "The Way of Kings (The Stormlight Archive, #1)"
export const stripSeries = (s) => decodeEntities(s)
  .replace(/\s*\([^()]*#[^()]*\)\s*$/, '')
  .replace(/\s*\((?:paperback|hardcover|kindle edition|audiobook|boxed set|illustrated)\)\s*$/i, '')
  .trim();

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'vol', 'volume', 'book']);

// tokens with entities decoded, diacritics folded, stopwords dropped
export function tokens(s) {
  return spell(letters(decodeEntities(s)
    .toLowerCase())
    .normalize('NFKD').replace(/[̀-ͯ]/g, ''))
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t));
}

/**
 * Do two author strings name the same person?
 * The autocomplete endpoint gives us the author, which the og:title route did
 * not. This is the guard that catches a same-title different-book collision -
 * the book equivalent of Carrie 1976 vs Carrie 2013.
 * Formats vary a lot ("Thich Nhat Hanh" / "Thich Nhat Hanh", "J.R.R. Tolkien" /
 * "J. R. R. Tolkien", trailing "Jr."), so a shared surname-length token is
 * enough. Missing data never rejects.
 */
const NON_AUTHOR = /^(unknown|anonymous|various|uncredited|n\/a)|(?:^|\s)(press|publishing|publishers|publications|group|editors|verlag)(?:\s|$)/i;

export function authorMatch(ourRaw, theirRaw) {
  if (!ourRaw || !theirRaw) return { ok: true, why: 'missing' };
  // "Anonymous", "Unknown Author", "Hamlyn Publishing Group" identify nobody
  if (NON_AUTHOR.test(String(ourRaw)) || NON_AUTHOR.test(String(theirRaw))) {
    return { ok: true, why: 'placeholder-credit' };
  }
  const drop = new Set(['jr', 'sr', 'phd', 'md', 'trans', 'translator', 'editor', 'ed', 'von', 'van', 'de', 'la', 'del', 'dr']);
  const t = (s) => tokens(s).filter((x) => x.length >= 3 && !drop.has(x));
  const a = t(ourRaw), b = t(theirRaw);
  if (!a.length || !b.length) return { ok: true, why: 'no-tokens' };
  for (const x of a) for (const y of b) {
    if (x === y) return { ok: true, why: 'shared-name' };
    if (x.length >= 5 && y.length >= 5 && (x.startsWith(y) || y.startsWith(x))) {
      return { ok: true, why: 'shared-name-prefix' };
    }
  }
  return { ok: false, why: `ours="${ourRaw}" theirs="${theirRaw}"` };
}

/**
 * Do two titles describe the same work?
 * Goodreads truncates og:title near 60 chars with an ellipsis, and freely
 * differs on leading articles, subtitles and alternate titles. Exclusion is the
 * safe default (a false exclusion only costs coverage; a false match imports a
 * rating from the wrong book) - so every rule here has to be one that cannot
 * merge two genuinely different works.
 */
export function titleMatch(ourRaw, pageRaw) {
  if (!pageRaw) return { ok: true, why: 'no-page-title' };
  const page = stripSeries(pageRaw);
  const truncated = /(…|\.\.\.)\s*$/.test(page);

  const A = fold(ourRaw);
  const T = fold(page).replace(/\.*$/, '');
  if (!A || !T) return { ok: true, why: 'empty' };

  if (A === T) return { ok: true, why: 'exact' };
  if (T.startsWith(A) || A.startsWith(T)) return { ok: true, why: 'prefix' };
  if (!truncated && (T.includes(A) || A.includes(T))) return { ok: true, why: 'substring' };

  // main title only, i.e. the part before a subtitle colon
  const mainA = fold(String(ourRaw).split(':')[0]);
  const mainT = fold(page.split(':')[0]);
  // a generic one-word main title ("Nothing", "Home") must not merge two works
  if (mainA && mainT && mainA.length >= 10 && tokens(String(ourRaw).split(':')[0]).length >= 2) {
    if (mainA === mainT || mainT.startsWith(mainA) || mainA.startsWith(mainT)) {
      return { ok: true, why: 'main-title' };
    }
  }

  // token containment, ignoring articles. For a truncated page title the final
  // token may be cut mid-word, so it is matched as a prefix instead.
  const ta = tokens(ourRaw);
  const tt = tokens(page).filter((t) => t !== '');
  if (ta.length && tt.length) {
    const last = truncated ? tt[tt.length - 1] : null;
    const whole = truncated ? tt.slice(0, -1) : tt;
    const inOther = (tok, arr) => arr.some((x) => sameToken(x, tok));

    // every token we hold appears in the page title
    if (ta.every((t) => inOther(t, whole) || (last && (t.startsWith(last) || last.startsWith(t))))) {
      return { ok: true, why: 'our-tokens-in-page' };
    }
    // every (complete) page token appears in ours
    if (whole.length >= 1 && whole.every((t) => inOther(t, ta))) {
      return { ok: true, why: 'page-tokens-in-ours' };
    }
    // truncation can hide the matching part entirely: "Shobogenzo" vs
    // "Treasury of the True Dharma Eye: Zen Master Dogen's Sho…"
    if (last && last.length >= 3 && ta.some((t) => t.startsWith(last))) {
      return { ok: true, why: 'truncated-tail' };
    }
  }
  return { ok: false, why: 'no-match' };
}

// A cache entry is FINAL only if it is a real answer.
// RULE 5: throttling is never a final answer.
export function isFinal(v) {
  if (!v || typeof v !== 'object') return false;
  if (v.ok === true) return true;
  return v.status === 404 || v.status === 'no-rating-confirmed';
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
