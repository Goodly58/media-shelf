/**
 * Fetch IGN editorial review scores.  RUN THIS YOURSELF:
 *
 *     node _fetch_ign.mjs            fetch (resumable — safe to stop and rerun)
 *     node _fetch_ign.mjs --status   what is done, what is left
 *
 * Writes _ign-scores.json. Nothing touches the catalogue; `node _apply_ign.mjs`
 * does that afterwards, with the usual report-first default.
 *
 * WHY YOU RUN IT AND NOT ME
 * -------------------------
 * ign.com/robots.txt names ClaudeBot, Claude-User, Claude-Web, Claude-SearchBot
 * and anthropic-ai in a group ending `Disallow: /`. That file governs automated
 * clients; it says nothing about a person. Running this is your call to make,
 * and it is a real one rather than a formality — so it sends an honest
 * user-agent below rather than pretending to be Chrome. Put your own contact in
 * it if you like.
 *
 * WHAT IT READS, AND WHY THAT EXACT FIELD
 * ---------------------------------------
 * Every page embeds <script id="__NEXT_DATA__">. Inside, props.pageProps.page:
 *
 *   page.primaryReview  -> { score, scoreText, articleUrl, scoreSummary }
 *                          IGN'S OWN REVIEW. This is the one we want.
 *   page.hl2bData.review-> { count, score }
 *                          the COMMUNITY aggregate, 0-100. Confusable, and the
 *                          reason an earlier attempt read 6.3 for Stellaris and
 *                          I wrongly "corrected" it — 6.3 is the editorial score
 *                          and 80 is the crowd. Addressed by key name so the two
 *                          can never be swapped again.
 *
 * SLUGS ARE THE REAL WORK
 * -----------------------
 * The catalogue says "Arizona Sunshine 2"; IGN's page is "arizona-sunshine-ii".
 * 256 of 2,169 pages 404'd on a naive slug. Variants are generated for arabic
 * and roman numerals, subtitle on and off, & against and, and edition words
 * dropped. A page is only accepted when its own canonical name matches the
 * title we asked for.
 */
import fs from 'node:fs';

const STATUS_ONLY = process.argv.includes('--status');
const CACHE = '_ign-cache.json';
const OUT = '_ign-scores.json';

/* An honest identity. Change the contact if you want it to be yours. */
const UA = 'media-shelf-personal/1.0 (personal catalogue project; +https://github.com/Goodly58/media-shelf)';
const PACE_MS = 1100;

function readArray(file, name) {
  const h = fs.readFileSync(file, 'utf8');
  const at = h.search(new RegExp('const ' + name + '\\s*=\\s*\\['));
  const s = h.indexOf('[', at);
  let d = 0, e = -1, q = false, esc = false;
  for (let i = s; i < h.length; i++) {
    const c = h[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { e = i + 1; break; } }
  }
  return JSON.parse(h.slice(s, e));
}

const GAMES = readArray('games.html', 'GAMES');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

/* ------------------------------------------------------------------- slugs */

const ROMAN = { 2: 'ii', 3: 'iii', 4: 'iv', 5: 'v', 6: 'vi', 7: 'vii', 8: 'viii', 9: 'ix', 10: 'x' };
const ARABIC = Object.fromEntries(Object.entries(ROMAN).map(([a, r]) => [r, a]));
const EDITION = /\b(definitive|complete|game of the year|goty|remastered|remaster|enhanced|deluxe|gold|anniversary|redux|hd|edition|the final cut)\b/gi;

const slugify = (s) => s.toLowerCase()
  .replace(/['’´`]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/** Every plausible IGN slug for a title, most likely first. */
function slugVariants(title) {
  const out = [];
  const push = (s) => { const v = slugify(s); if (v && !out.includes(v)) out.push(v); };

  const base = title.replace(/[™®]/g, '').trim();
  push(base);

  // trailing/embedded arabic numeral -> roman  ("Arizona Sunshine 2" -> "...-ii")
  const toRoman = base.replace(/\b(\d{1,2})\b/g, (m, n) => ROMAN[Number(n)] || m);
  if (toRoman !== base) push(toRoman);

  // roman -> arabic, for the reverse case
  const toArabic = base.replace(/\b(ii|iii|iv|vi{0,3}|ix|x)\b/gi, (m) => ARABIC[m.toLowerCase()] || m);
  if (toArabic !== base) push(toArabic);

  // drop the subtitle after a colon or dash
  const noSub = base.split(/\s*[:–-]\s+/)[0];
  if (noSub !== base) { push(noSub); push(noSub.replace(/\b(\d{1,2})\b/g, (m, n) => ROMAN[Number(n)] || m)); }

  // drop edition words
  const noEd = base.replace(EDITION, ' ').replace(/\s+/g, ' ').trim();
  if (noEd && noEd !== base) { push(noEd); push(noEd.replace(/\b(\d{1,2})\b/g, (m, n) => ROMAN[Number(n)] || m)); }

  // "and" spelled out both ways
  push(base.replace(/\band\b/gi, '&'));

  return out.slice(0, 8);
}

/* ------------------------------------------------------------------ parsing */

const fold = (s) => String(s || '').toLowerCase()
  .replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'")
  .replace(/[^a-z0-9]+/g, '');

function parsePage(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let page;
  try { page = JSON.parse(m[1])?.props?.pageProps?.page; } catch { return null; }
  if (!page) return null;

  const pr = page.primaryReview || null;
  const names = page.metadata?.names || {};
  return {
    canonical: names.name || null,
    alts: Array.isArray(names.alt) ? names.alt : [],
    // BY KEY NAME. Never "the number that looks like a score".
    score: pr && typeof pr.score === 'number' ? pr.score : null,
    scoreText: pr?.scoreText ?? null,
    articleUrl: pr?.articleUrl ?? null,
    summary: pr?.scoreSummary ?? null,
    community: page.hl2bData?.review?.score ?? null,   // recorded, never used as the score
  };
}

/** The page must be about the game we asked for. */
function namesMatch(title, got) {
  if (!got) return false;
  const want = fold(title);
  const cands = [got.canonical, ...(got.alts || [])].filter(Boolean).map(fold);
  return cands.some((c) => c === want || c.includes(want) || want.includes(c));
}

/* ----------------------------------------------------------------- fetching */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 404) return { status: 404 };
    // Throttling is NOT an answer and must never be cached as one.
    if (res.status === 429 || res.status >= 500 || res.status === 202) return { status: res.status, retry: true };
    if (!res.ok) return { status: res.status };
    const html = await res.text();
    if (!html.length) return { status: 'empty', retry: true };
    return { status: 200, html };
  } catch (e) {
    return { status: String(e.name || e), retry: true };
  }
}

/* -------------------------------------------------------------------- main */

const todo = GAMES.filter((g) => !cache[g.title] || cache[g.title].retry);

if (STATUS_ONLY) {
  const done = GAMES.length - todo.length;
  const hit = Object.values(cache).filter((v) => v && v.score != null).length;
  const none = Object.values(cache).filter((v) => v && v.status === 'no-review').length;
  console.log(`${done}/${GAMES.length} resolved · ${hit} with a review · ${none} confirmed to have none · ${todo.length} left`);
  process.exit(0);
}

console.log(`${GAMES.length} games, ${todo.length} to fetch (~${Math.round(todo.length * PACE_MS * 1.4 / 60000)} min)`);
console.log(`user-agent: ${UA}\n`);

let done = 0, found = 0, noReview = 0, unresolved = 0, backoff = PACE_MS;

for (const g of todo) {
  let result = null;

  for (const slug of slugVariants(g.title)) {
    const r = await get(`https://www.ign.com/games/${slug}`);

    if (r.retry) {
      // Back off and retry this same slug once, then give up for this run so a
      // rerun picks it up rather than burning it as a failure.
      backoff = Math.min(backoff * 2, 30000);
      console.log(`  throttled (${r.status}) — backing off ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      const again = await get(`https://www.ign.com/games/${slug}`);
      if (again.retry) { result = { retry: true, status: again.status }; break; }
      if (again.status === 200) r.html = again.html, r.status = 200;
    } else {
      backoff = PACE_MS;
    }

    if (r.status !== 200) { await sleep(PACE_MS); continue; }

    const got = parsePage(r.html);
    await sleep(PACE_MS);
    if (!got) continue;
    if (!namesMatch(g.title, got)) continue;      // right page, wrong game

    result = got.score == null
      ? { status: 'no-review', canonical: got.canonical, slug }
      : { status: 'ok', slug, ...got };
    break;
  }

  cache[g.title] = result || { status: 'unresolved' };
  if (result?.status === 'ok') found += 1;
  else if (result?.status === 'no-review') noReview += 1;
  else if (!result) unresolved += 1;

  done += 1;
  if (done % 20 === 0) {
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    process.stdout.write(`  ${done}/${todo.length} — ${found} scored, ${noReview} no review, ${unresolved} unresolved\r`);
  }
}
fs.writeFileSync(CACHE, JSON.stringify(cache));

const rows = GAMES.map((g) => ({ title: g.title, ours: g.ign ?? null, ...(cache[g.title] || {}) }))
  .filter((r) => r.status === 'ok' || r.status === 'no-review');
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));

console.log(`\n\n${found} scores, ${noReview} confirmed to have no IGN review, ${unresolved} unresolved`);
console.log(`wrote ${OUT}\n`);
console.log('next:  node _apply_ign.mjs          (report)');
console.log('       node _apply_ign.mjs --apply  (write games.html)');
