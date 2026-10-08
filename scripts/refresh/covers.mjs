/* Book covers, served with the site. Open Library's cover server has no CDN and is slow (a
   second or more a cover, about half of them bounced twice to Internet Archive storage),
   and a browser asks one server for only six at a time, so a screen of covers filled in
   over many seconds, in whatever order the server answered. So each cover is fetched from
   it once, shrunk to the size the grid shows (WebP), and kept in covers/, from where
   GitHub's CDN serves it with the rest of the site; that also spares Open Library every
   visitor's requests. Books it has no cover for take the one on their Goodreads page.

   A file is named for its source (Open Library's cover id, or g + the Goodreads id), so a
   changed cover is a new address and no cache ever serves a stale one. */
import fs from 'node:fs';
import path from 'node:path';
import { get, log, loadCache, saveCache, ROOT } from './lib.mjs';
import { goodreadsById } from './books.mjs';

export const COVER_DIR = path.join(ROOT, 'covers');
const WIDTH = 240;          // the grid shows covers about 170px wide
const DAY = 864e5;

/** The name a book's cover is kept under (no extension), or null when it has none to keep. */
export function coverStem(book, grCovers = {}) {
  if (book.cover) return String(book.cover);
  const g = book.gr && grCovers[book.gr];
  return g && g.img ? 'g' + book.gr : null;
}
export const coverFile = (stem) => path.join(COVER_DIR, stem + '.webp');

/** A cover image shrunk to the grid's size as WebP, or null for a placeholder. */
export async function shrink(buf) {
  const sharp = (await import('sharp')).default;
  const img = sharp(buf, { failOn: 'none' });
  const meta = await img.metadata();
  // Open Library answers a missing cover with a 1x1 image rather than a 404.
  if (!meta.width || meta.width < 40) return null;
  return img.rotate().resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 78, effort: 5 }).toBuffer();
}

async function download(url, paceMs) {
  const res = await get(url, { type: 'response', paceMs, timeout: 60000 });
  return res ? Buffer.from(await res.arrayBuffer()) : null;
}

// A few at a time from one queue.
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/**
 * Store every cover the books need that covers/ lacks, most-rated books first, until the
 * budget runs out. Open Library is asked three at a time (each answer takes a second or more),
 * Goodreads one page at a time. Caches: 'gr-covers' { goodreadsId: { img } | { none } } and
 * 'cover-misses' { stem: when }, a source that had nothing usable, asked again after 60 days.
 */
export async function storeCovers(books, { budgetMin = 60 } = {}) {
  const deadline = Date.now() + budgetMin * 60e3;
  const grCovers = loadCache('gr-covers');
  const misses = loadCache('cover-misses');
  const missed = (stem) => misses[stem] && misses[stem] > Date.now() - 60 * DAY;
  fs.mkdirSync(COVER_DIR, { recursive: true });
  const order = books.slice().sort((a, b) => (b.ratings || 0) - (a.ratings || 0));
  let stored = 0, failed = 0;
  const keep = async (stem, url, paceMs) => {
    if (Date.now() > deadline) return;
    try {
      const buf = await download(url, paceMs);
      const webp = buf && await shrink(buf);
      if (webp) { fs.writeFileSync(coverFile(stem), webp); stored++; } else { misses[stem] = Date.now(); failed++; }
    } catch (e) { log(`covers: ${stem}: ${e.message}`); failed++; }
    if ((stored + failed) % 250 === 0) { saveCache('cover-misses', misses); log(`covers: ${stored} stored, ${failed} missing`); }
  };
  const ol = order.filter((b) => b.cover && !fs.existsSync(coverFile(String(b.cover))) && !missed(String(b.cover)));
  const gr = order.filter((b) => !b.cover && b.gr && !(grCovers[b.gr] && (grCovers[b.gr].none || fs.existsSync(coverFile('g' + b.gr)) || missed('g' + b.gr))));
  log(`covers: ${ol.length} from Open Library and ${gr.length} from Goodreads to fetch`);
  await Promise.all([
    pool(ol, 3, (b) => keep(String(b.cover), `https://covers.openlibrary.org/b/id/${b.cover}-L.jpg`, 600)),
    pool(gr, 1, async (b) => {
      if (Date.now() > deadline) return;
      if (!grCovers[b.gr]) {
        let page = null;
        try { page = await goodreadsById(b.gr); } catch (e) { log(`covers: goodreads ${b.gr}: ${e.message}`); return; }
        grCovers[b.gr] = page && page.img ? { img: page.img, at: Date.now() } : { none: true, at: Date.now() };
      }
      if (grCovers[b.gr].img) await keep('g' + b.gr, grCovers[b.gr].img, 300);
    }),
  ]);
  saveCache('gr-covers', grCovers);
  saveCache('cover-misses', misses);
  log(`covers: ${stored} stored, ${failed} with nothing usable; ${fs.readdirSync(COVER_DIR).length} on file`);
  await colourCovers();
}

/** A cover's average colour as hex ("3a2f1e"): the card shows it while the picture is on its way. */
export async function colourOf(file) {
  const sharp = (await import('sharp')).default;
  const { channels } = await sharp(file).stats();
  return channels.slice(0, 3).map((c) => Math.round(c.mean).toString(16).padStart(2, '0')).join('');
}

/** The colour of every kept cover that has none yet. Cache 'cover-colours': { stem: hex }. */
export async function colourCovers() {
  if (!fs.existsSync(COVER_DIR)) return;
  const colours = loadCache('cover-colours');
  let n = 0;
  for (const f of fs.readdirSync(COVER_DIR)) {
    const stem = f.replace(/\.webp$/, '');
    if (stem === f || colours[stem]) continue;
    try { colours[stem] = await colourOf(path.join(COVER_DIR, f)); n++; } catch (e) { log(`covers: colour of ${f}: ${e.message}`); }
  }
  saveCache('cover-colours', colours);
  if (n) log(`covers: ${n} colours worked out`);
}

/** Remove covers no book uses any more (one replaced by its edition's, a book dropped). */
export function pruneCovers(books) {
  if (!fs.existsSync(COVER_DIR)) return 0;
  const keep = new Set(books.map((b) => b.cv).filter(Boolean));
  let n = 0;
  for (const f of fs.readdirSync(COVER_DIR)) {
    if (f.endsWith('.webp') && !keep.has(f.slice(0, -5))) { fs.unlinkSync(path.join(COVER_DIR, f)); n++; }
  }
  if (n) log(`covers: removed ${n} no book uses`);
  return n;
}
