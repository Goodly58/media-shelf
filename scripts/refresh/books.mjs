/* Books: Open Library finds the edition (and its cover), Goodreads supplies
   the rating. Goodreads has no API, but /book/isbn/<isbn> redirects to the
   book's page, whose JSON-LD carries ratingValue and ratingCount; its
   robots.txt does not disallow that route. Its /search is disallowed, which
   is why editions are found through Open Library instead. */
import { get, log, loadCache, saveCache, fold, decode } from './lib.mjs';

const OL = 'https://openlibrary.org';

const words = (s) => fold(s).split(' ').filter((w) => w.length > 2);
function titleMatch(a, b) {
  const A = fold(String(a).split(/[:(]/)[0]), B = fold(String(b).split(/[:(]/)[0]);
  if (!A || !B) return false;
  if (A === B || A.startsWith(B) || B.startsWith(A)) return true;
  const wa = new Set(words(A)), wb = words(B);
  const hit = wb.filter((w) => wa.has(w)).length;
  return hit >= Math.max(1, Math.ceil(Math.min(wa.size, wb.length) * 0.75));
}
function authorMatch(a, b) {
  const last = (s) => fold(s).split(' ').pop();
  return Boolean(a && b) && (last(a) === last(b) || fold(a).includes(last(b)) || fold(b).includes(last(a)));
}

/** Best Open Library work for a book: cover id, first year and ISBNs. */
export async function openLibrary(book) {
  const q = new URLSearchParams({
    title: book.title.split(/[:(]/)[0].trim(),
    author: book.author || '',
    fields: 'key,title,author_name,cover_i,isbn,first_publish_year,edition_count,subject',
    limit: '5',
  });
  const j = await get(`${OL}/search.json?${q}`, { paceMs: 1100 });
  const docs = (j?.docs || []).filter((d) => titleMatch(d.title, book.title) && (!book.author || (d.author_name || []).some((a) => authorMatch(a, book.author))));
  if (!docs.length) return null;
  docs.sort((a, b) => (b.edition_count || 0) - (a.edition_count || 0));
  const d = docs[0];
  const isbns = (d.isbn || []).filter((x) => x.length === 13 && /^97[89]/.test(x));
  return { key: d.key, cover: d.cover_i || null, year: d.first_publish_year || null, isbns: isbns.slice(0, 40), subjects: (d.subject || []).slice(0, 40) };
}

/** Goodreads rating for one ISBN, with the page's own title and author. */
export async function goodreadsByIsbn(isbn) {
  return goodreadsPage(`https://www.goodreads.com/book/isbn/${isbn}`);
}

/** The same, straight from a known Goodreads book id. */
export async function goodreadsById(id) {
  return goodreadsPage(`https://www.goodreads.com/book/show/${id}`);
}

async function goodreadsPage(url) {
  const res = await get(url, { type: 'response', paceMs: 2200, headers: { Accept: 'text/html' } });
  if (!res) return null;
  const html = await res.text();
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let ld;
  try { ld = JSON.parse(m[1]); } catch { return null; }
  const ar = ld.aggregateRating;
  if (!ar || !(Number(ar.ratingValue) > 0)) return null;
  const id = (res.url.match(/\/book\/show\/(\d+)/) || [])[1] || null;
  const author = Array.isArray(ld.author) ? ld.author[0]?.name : ld.author?.name;
  // The page's own genre shelves, most-shelved first: the best genre source for a book.
  const genres = [...new Set([...html.matchAll(/BookPageMetadataSection__genreButton"><a href="https:\/\/www\.goodreads\.com\/genres\/[^"]+"[^>]*><span class="Button__labelItem">([^<]+)</g)].map((m) => decode(m[1])))];
  return { rating: Number(ar.ratingValue), count: Number(ar.ratingCount), title: decode(ld.name || ''), author: decode(author || ''), id, isbn: ld.isbn || null, genres };
}

/**
 * Verify books against Goodreads. Tries the stored ISBN, then Open Library's
 * ISBNs for the same work, accepting a page only when its title and author
 * agree with ours.
 */
export async function refreshBooks(books, { budgetMin = 60, maxAgeDays = 45, olOnlyMissing = false } = {}) {
  const ol = loadCache('openlibrary');
  const gr = loadCache('goodreads');
  const stale = Date.now() - maxAgeDays * 864e5;
  const deadline = Date.now() + budgetMin * 60e3;
  const key = (b) => fold(b.title) + '|' + fold(b.author || '');
  let n = 0, ok = 0;
  for (const b of books) {
    if (Date.now() > deadline) break;
    const k = key(b);
    // Fresh and complete (a rating with its genre shelves, or a confirmed miss): nothing to do.
    if (gr[k] && gr[k].at > stale && (gr[k].none || gr[k].genres)) continue;
    // Open Library supplies the cover and first-publication year, and ISBNs when there is no Goodreads id.
    if ((!b.gr || !b.cover || !b.year) && (!ol[k] || (!olOnlyMissing && ol[k].at < stale))) {
      try { ol[k] = { ...(await openLibrary(b)), at: Date.now() }; } catch (e) { log(`openlibrary ${b.title}: ${e.message}`); }
    }
    const isbns = [...new Set([b.isbn, ...(ol[k]?.isbns || [])].filter(Boolean))].slice(0, 4);
    let hit = null;
    // A known Goodreads id is exact; ISBNs are the fallback.
    if (b.gr) {
      try { const r = await goodreadsById(b.gr); if (r) hit = { ...r, isbn: r.isbn || b.isbn || null }; } catch (e) { log(`goodreads ${b.gr}: ${e.message}`); }
    }
    for (const isbn of hit ? [] : isbns) {
      let r;
      try { r = await goodreadsByIsbn(isbn); } catch (e) { log(`goodreads ${isbn}: ${e.message}`); continue; }
      if (r && titleMatch(r.title, b.title) && authorMatch(r.author, b.author)) { hit = { ...r, isbn }; break; }
    }
    gr[k] = hit ? { ...hit, at: Date.now() } : { none: true, at: Date.now() };
    n++; if (hit) ok++;
    if (n % 25 === 0) { saveCache('openlibrary', ol); saveCache('goodreads', gr); log(`books: ${n} checked, ${ok} verified`); }
  }
  saveCache('openlibrary', ol); saveCache('goodreads', gr);
  log(`books: ${n} checked, ${ok} verified`);
  return { ol, gr, key };
}

/** Cover ids only (no Goodreads), for books that already have a rating. */
export async function refreshCovers(books, { budgetMin = 60, cacheName = 'openlibrary' } = {}) {
  const ol = loadCache(cacheName);
  const seen = loadCache('openlibrary');
  const deadline = Date.now() + budgetMin * 60e3;
  const key = (b) => fold(b.title) + '|' + fold(b.author || '');
  let n = 0;
  for (const b of books) {
    if (Date.now() > deadline) break;
    const k = key(b);
    if (ol[k] || seen[k]) continue;
    try { ol[k] = { ...(await openLibrary(b)), at: Date.now() }; } catch (e) { log(`openlibrary ${b.title}: ${e.message}`); continue; }
    if (++n % 100 === 0) { saveCache(cacheName, ol); log(`covers: ${n}`); }
  }
  saveCache(cacheName, ol);
  return ol;
}

/* The cover of the exact edition behind the verified ISBN. A work's default
   cover is often a translation (Kristin Hannah's The Women came back in
   Spanish); the English edition we matched on Goodreads is the right one. */
export async function editionCover(isbn) {
  const j = await get(`${OL}/isbn/${isbn}.json`, { paceMs: 1100 });
  const id = (j?.covers || []).find((c) => c > 0);
  return id || null;
}

export async function refreshEditionCovers(books, { budgetMin = 60, maxAgeDays = 180 } = {}) {
  const cache = loadCache('ol-editions');
  const stale = Date.now() - maxAgeDays * 864e5;
  const deadline = Date.now() + budgetMin * 60e3;
  let n = 0;
  for (const b of books) {
    if (Date.now() > deadline) break;
    if (!b.isbn || (cache[b.isbn] && cache[b.isbn].at > stale)) continue;
    try { cache[b.isbn] = { cover: await editionCover(b.isbn), at: Date.now() }; } catch (e) { log(`edition ${b.isbn}: ${e.message}`); continue; }
    if (++n % 100 === 0) { saveCache('ol-editions', cache); log(`edition covers: ${n}`); }
  }
  saveCache('ol-editions', cache);
  return cache;
}
