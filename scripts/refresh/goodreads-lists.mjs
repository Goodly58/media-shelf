/* New books from Goodreads' own genre lists ("Listopia"). Each list row
   carries the book's Goodreads id, title, author, average rating and number
   of ratings, so a book enters the catalogue with a rating read straight
   from Goodreads. /list/ is not disallowed by Goodreads' robots.txt. */
import { get, log, loadCache, saveCache, decode } from './lib.mjs';

const GR = 'https://www.goodreads.com';

/* Shelf genre -> Goodreads list tags, and the words a list's title must
   contain to count as that genre's list. Most specific genres first: a book
   on both a manga list and a fantasy list is filed as manga. */
export const GENRE_LISTS = [
  ['Graphic Novels', ['graphic-novels', 'comics'], /graphic novel|comic/i],
  ['Manga & Comics', ['manga'], /manga/i],
  ['Children & Middle Grade', ['middle-grade', 'childrens'], /middle.grade|children/i],
  ['Young Adult', ['young-adult'], /young adult|\bya\b/i],
  ['Horror', ['horror'], /horror/i],
  ['Science Fiction', ['science-fiction'], /science fiction|sci-fi|scifi/i],
  ['Fantasy', ['fantasy'], /fantasy/i],
  ['Romance', ['romance'], /romance/i],
  ['Crime & Detective', ['crime', 'detective'], /crime|detective/i],
  ['Mystery & Thriller', ['thriller', 'mystery'], /thriller|mystery|mysteries|suspense/i],
  ['Historical Fiction', ['historical-fiction'], /historical fiction/i],
  ['Poetry & Essays', ['poetry', 'essays'], /poetry|poems|essays/i],
  ['Memoir & Biography', ['memoir', 'biography'], /memoir|biograph/i, true],
  ['History & Politics', ['history', 'politics'], /history|politic/i, true],
  ['Science & Nature', ['science', 'nature'], /science|nature/i, true],
  ['Philosophy & Psychology', ['philosophy', 'psychology'], /philosoph|psycholog/i, true],
  ['Business & Self-Help', ['self-help', 'business'], /self.help|business/i, true],
  ['Health & Wellbeing', ['health', 'nutrition'], /health|nutrition|wellness/i, true],
  ['Travel & Food', ['travel', 'food'], /travel|food|cooking/i, true],
  ['Art, Music & Film', ['art', 'music'], /\bart\b|\bmusic|film/i, true],
  ['Classics', ['classics'], /classic/i],
  ['Literary Fiction', ['literary-fiction'], /literary fiction/i],
];

/* Lists that are about something else: a year, a debut crop, cover art,
   a season, a reading challenge, a single author. */
const OFF_TOPIC = /\b(19|20)\d\ds?\b|debut|anticipated|upcoming|cover|protagonist|retelling|challenge|giveaway|to.read|tbr|summer|winter|spring|autumn|beach|book club|books? i |\bmy\b|series about|for (girls|boys|kids who)/i;

function listScore(title, genre) {
  const [, , re, nonfiction] = GENRE_LISTS.find((g) => g[0] === genre);
  if (!re.test(title) || OFF_TOPIC.test(title)) return -1;
  // A list that names a second genre ("Science Fiction & Fantasy") cannot file a book as either.
  if (GENRE_LISTS.some(([g, , other]) => g !== genre && other.test(title.replace(re, '')))) return -1;
  if (nonfiction && /fiction|novel/i.test(title) && !/non.?fiction/i.test(title)) return -1;
  return /^(the )?(best|greatest|top|essential|must.read|favou?rite|all.time)/i.test(title) ? 3 : 1;
}

async function listsForTag(tag, genre, take) {
  const out = [];
  for (const page of [1, 2]) {
    const html = await get(`${GR}/list/tag/${tag}?page=${page}`, { type: 'text', paceMs: 2200 });
    if (!html) break;
    let order = out.length;
    for (const m of html.matchAll(/href="\/list\/show\/(\d+)\.[^"]*"[^>]*>([^<]+)</g)) {
      const [, id, raw] = m;
      const title = decode(raw).trim();
      if (out.some((x) => x.id === id)) continue;
      const score = listScore(title, genre);
      if (score > 0) out.push({ id, title, score, order: order++ });
    }
  }
  // Best-named lists first; within a score, the tag page's own popularity order.
  return out.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, take);
}

function parseList(html) {
  const rows = [];
  for (const tr of html.split('<tr itemscope itemtype="http://schema.org/Book">').slice(1)) {
    const id = (tr.match(/href="\/book\/show\/(\d+)/) || [])[1];
    const title = (tr.match(/<span itemprop='name' role='heading'[^>]*>([^<]+)</) || [])[1];
    const author = (tr.match(/class="authorName"[^>]*><span itemprop="name">([^<]+)</) || [])[1];
    const m = tr.match(/([\d.]+) avg rating &mdash; ([\d,]+) rating/);
    if (!id || !title || !m) continue;
    rows.push({ gr: id, title: decode(title).trim(), author: decode(author || '').trim(), rating: Number(m[1]), count: Number(m[2].replace(/,/g, '')) });
  }
  return rows;
}

/**
 * Crawl the best-matching lists for every genre. Returns the cache:
 * { books: { <gr id>: { title, author, rating, count, genre, at } }, lists: {...}, at }
 */
export async function crawlGenreLists({ listsPerGenre = 2, pages = 3, maxAgeDays = 25, force = false } = {}) {
  const cache = loadCache('goodreads-lists', { books: {}, lists: {} });
  if (!force && cache.at && Date.now() - cache.at < maxAgeDays * 864e5) return cache;
  const books = {};
  for (const [genre, tags] of GENRE_LISTS) {
    const lists = [];
    for (const tag of tags) {
      try { for (const l of await listsForTag(tag, genre, listsPerGenre)) if (!lists.some((x) => x.id === l.id)) lists.push(l); }
      catch (e) { log(`goodreads tag ${tag}: ${e.message}`); }
    }
    cache.lists[genre] = lists.sort((a, b) => b.score - a.score).slice(0, listsPerGenre);
    for (const l of cache.lists[genre]) {
      for (let p = 1; p <= pages; p++) {
        let html;
        try { html = await get(`${GR}/list/show/${l.id}?page=${p}`, { type: 'text', paceMs: 2200 }); }
        catch (e) { log(`goodreads list ${l.id} p${p}: ${e.message}`); break; }
        const rows = html ? parseList(html) : [];
        if (!rows.length) break;
        // First genre to claim a book keeps it: the order above runs most specific first.
        for (const r of rows) if (!books[r.gr]) books[r.gr] = { ...r, genre, at: Date.now() };
      }
    }
    log(`goodreads lists: ${genre} via ${cache.lists[genre].map((l) => l.title).join(' / ') || 'nothing'}; ${Object.keys(books).length} books so far`);
  }
  cache.books = books;
  cache.at = Date.now();
  saveCache('goodreads-lists', cache);
  return cache;
}
