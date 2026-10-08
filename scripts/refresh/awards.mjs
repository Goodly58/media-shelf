/* Major awards for films, series, books and games, from Wikidata. Each award is a family
   of categories there ("Academy Award for Best Picture" is part of the Academy Awards); a
   work holds the awards it won, and an actor's or author's award names the work it was
   for, so both count. Films and series are matched by IMDb id, games by Steam id, books
   by title and author.

   A title's awards: aw = [[key, years, category, ...], ...], one entry per award, with the
   year or years it won ("2017", "2008–2014") and the categories ("" where the award has none). */
import { get, log, loadCache, saveCache, fold } from './lib.mjs';

const SPARQL = 'https://query.wikidata.org/sparql';
const DAY = 864e5;

// [key, Wikidata item of the award (or family of awards)], per shelf, most prestigious first.
export const AWARDS = {
  movies: [['oscar', 'Q19020'], ['palme', 'Q179808'], ['lion', 'Q209459'], ['bear', 'Q154590'], ['bafta', 'Q732997'], ['globe', 'Q1011547']],
  shows: [['emmy', 'Q1044427'], ['globe', 'Q1011547']],
  books: [['pulitzer', 'Q46525'], ['booker', 'Q160082'], ['intbooker', 'Q2052291'], ['nba', 'Q572316'], ['hugo', 'Q188914'], ['nebula', 'Q194285'], ['womens', 'Q18884'], ['newbery', 'Q622813']],
  games: [['tga', 'Q18642757'], ['baftag', 'Q546692'], ['dice', 'Q1665849'], ['gdc', 'Q1493055'], ['joystick', 'Q2627776']],
};
// Not prizes for a work: the Academy's science, technical and honorary awards and the like.
const NOT_WORK = /scientific|technical|technical achievement|award of merit|honorary|special award|special citation|humanitarian|thalberg|hersholt|lifetime|cecil b\.? demille|carol burnett|governors|hall of fame|pioneer|ambassador|fellowship|industry icon|outstanding contribution/i;
// Each family's own words in front of a category ("Academy Award for Best Picture" is "Best Picture").
const PREFIX = /^.*?\b(award|awards|prize|medal)\b( for| –| -| −|:)\s*/i;

/** A category's short name from its full one; "" for an award that has no categories. */
export function category(label, family) {
  const s = String(label || '').trim();
  if (!s || fold(s) === fold(family)) return '';
  const m = s.match(PREFIX);
  return m ? s.slice(m[0].length) : s;
}

function query(qid) {
  return `SELECT DISTINCT ?item ?imdb ?steam ?title ?author ?awardLabel ?year WHERE {
  ?award (wdt:P361|wdt:P31|wdt:P279)* wd:${qid} .
  { ?item p:P166 ?st . ?st ps:P166 ?award . } UNION { ?who p:P166 ?st . ?st ps:P166 ?award ; pq:P1686 ?item . }
  OPTIONAL { ?st pq:P585 ?date . }
  BIND(YEAR(?date) AS ?year)
  OPTIONAL { ?item wdt:P345 ?imdb . }
  OPTIONAL { ?item wdt:P1733 ?steam . }
  OPTIONAL { ?item rdfs:label ?title . FILTER(LANG(?title) = "en") }
  OPTIONAL { ?item wdt:P50 ?a . ?a rdfs:label ?author . FILTER(LANG(?author) = "en") }
  ?award rdfs:label ?awardLabel . FILTER(LANG(?awardLabel) = "en")
}`;
}

/**
 * Every win of every award in AWARDS, a query per award, again after a month.
 * Cache 'awards': { qid: { label, wins: [[item, imdb, steam, title, author, award name, year], ...], at } }.
 */
export async function refreshAwards({ maxAgeDays = 30 } = {}) {
  const cache = loadCache('awards');
  const stale = Date.now() - maxAgeDays * DAY;
  const qids = [...new Set(Object.values(AWARDS).flat().map((a) => a[1]))];
  let n = 0;
  for (const qid of qids) {
    if (cache[qid] && cache[qid].at > stale) continue;
    let json, family = qid;
    try {
      const lab = await get(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { paceMs: 1000 });
      family = lab?.entities?.[qid]?.labels?.en?.value || qid;
      json = await get(SPARQL, {
        method: 'POST', paceMs: 2000, timeout: 120000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
        body: new URLSearchParams({ query: query(qid) }).toString(),
      });
    } catch (e) { log(`awards: ${qid}: ${e.message}`); continue; }
    const v = (b, k) => (b[k] ? b[k].value : null);
    const wins = [];
    for (const b of json.results.bindings) {
      const label = v(b, 'awardLabel');
      if (NOT_WORK.test(label || '')) continue;
      wins.push([v(b, 'item').replace(/^.*\//, ''), v(b, 'imdb'), v(b, 'steam'), v(b, 'title'), v(b, 'author'), label, Number(v(b, 'year')) || null]);
    }
    cache[qid] = { label: family, wins, at: Date.now() };
    n++;
    log(`awards: ${family}, ${wins.length} wins`);
  }
  saveCache('awards', cache);
  log(`awards: ${n} awards asked about`);
}

const main = (t) => fold(String(t).split(/[:(]/)[0]);
const last = (a) => fold(a || '').split(' ').pop();

/** Each title's awards (row.aw), for one shelf's rows. Returns how many titles won something. */
export function attachAwards(kind, rows) {
  const cache = loadCache('awards');
  const byImdb = new Map(), bySteam = new Map(), byBook = new Map();
  if (kind === 'books') for (const r of rows) byBook.set(main(r.title) + '|' + last(r.author), r);
  else for (const r of rows) { if (kind === 'games') { if (r.steamId) bySteam.set(String(r.steamId), r); } else byImdb.set(r.id, r); }
  const found = new Map();   // row -> Map(key -> { year, cats: Set })
  for (const [key, qid] of AWARDS[kind] || []) {
    const c = cache[qid];
    if (!c) continue;
    for (const [, imdb, steam, title, author, label, year] of c.wins) {
      const cat = category(label, c.label);
      const r = kind === 'books' ? byBook.get(main(title || '') + '|' + last(author))
        : kind === 'games' ? (steam && bySteam.get(String(steam)))
        : imdb && byImdb.get(imdb);
      if (!r) continue;
      if (!found.has(r)) found.set(r, new Map());
      const m = found.get(r);
      if (!m.has(key)) m.set(key, { from: null, to: null, cats: new Set() });
      const e = m.get(key);
      if (year) { e.from = Math.min(e.from || year, year); e.to = Math.max(e.to || year, year); }
      e.cats.add(cat);
    }
  }
  for (const r of rows) {
    const m = found.get(r);
    // Awards in the order of AWARDS, each with its categories (an award with none keeps "").
    r.aw = m ? (AWARDS[kind] || []).filter(([k]) => m.has(k)).map(([k]) => {
      const e = m.get(k);
      const cats = [...e.cats].filter(Boolean);
      const years = e.from ? (e.from === e.to ? String(e.from) : e.from + '–' + e.to) : '';
      return [k, years, ...(cats.length ? cats.sort() : [''])];
    }) : null;
  }
  const n = rows.filter((r) => r.aw).length;
  log(`awards: ${n} ${kind} have won something`);
  return n;
}
