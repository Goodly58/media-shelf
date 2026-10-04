/**
 * Fetch the 406 outstanding books against the AUTHORITATIVE route:
 *   https://www.goodreads.com/book/isbn/<isbn>  ->  redirects to /book/show/<id>-<slug>
 * whose JSON-LD carries name, author, isbn, ratingValue and ratingCount.
 *
 * This is a lookup, not a search.  robots.txt (User-agent: *) disallows /search,
 * /work, /api and /book/reviews/ - it does NOT disallow /book/isbn or /book/show.
 *
 * RULE 6 - THROTTLING IS NOT AN ANSWER.  Goodreads sits behind AWS WAF: after
 * roughly 500 requests it answers HTTP 202 with a zero-length body.  That is not
 * "this book has no rating"; caching it as one is what capped the last pass.
 * classify() marks 202 / empty / short / WAF-marker / 429 / 5xx as RETRYABLE and
 * the cache is never written for them.  Only a rating, a real 404, or a real book
 * page that genuinely carries no rating is ever stored.
 *
 * RULE 7 - a 404 is a finding, not a failure.  Before believing one, the same
 * ISBN is retried in its other form (13 <-> 10), because Goodreads' ISBN index
 * sometimes holds only one of the two.
 *
 * Cache: _gr-rest-cache.json, keyed by the ISBN as it appears in the catalogue,
 * so a rerun resumes and never refetches a settled answer.
 *
 *   node tools/goodreads/rest_fetch.mjs [--limit N]
 */
import fs from 'node:fs';

const CACHE = '_gr-rest-cache.json';
const QUEUE = '_gr-rest-queue.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;

// ---------------------------------------------------------------- ISBN forms
const digits = (s) => String(s).replace(/[^0-9Xx]/g, '').toUpperCase();

function isbn13to10(i13) {
  const d = digits(i13);
  if (d.length !== 13 || !d.startsWith('978')) return null;
  const core = d.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const r = (11 - (sum % 11)) % 11;
  return core + (r === 10 ? 'X' : String(r));
}
function isbn10to13(i10) {
  const d = digits(i10);
  if (d.length !== 10) return null;
  const core = `978${d.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 ? 3 : 1) * Number(core[i]);
  return core + String((10 - (sum % 10)) % 10);
}
const altForm = (i) => (digits(i).length === 13 ? isbn13to10(i) : isbn10to13(i));

// ---------------------------------------------------------------- extraction
function parseLd(body) {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(body))) {
    try {
      const j = JSON.parse(m[1]);
      if (j && (j['@type'] === 'Book' || j.bookFormat || j.numberOfPages)) return j;
    } catch { /* next block */ }
  }
  return null;
}
const ogTitle = (b) => (b.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || null;

/**
 * -> { final, entry }.  final === false means RETRYABLE: nothing is written.
 * A real Goodreads book page is ~700 KB; anything under 20 KB is an
 * interstitial, a challenge or a truncated response, never a book.
 */
function classify(status, body, finalUrl) {
  if (status === 404) return { final: true, entry: { ok: false, status: 404 } };
  if (status === 202) return { final: false, why: 'http-202-waf' };
  if (status === 429 || status >= 500) return { final: false, why: `http-${status}` };
  if (status === 0) return { final: false, why: 'network' };
  if (!body || !body.length) return { final: false, why: 'empty-body' };
  if (body.includes('awsWafCookieDomainList') || body.includes('x-amzn-waf')) {
    return { final: false, why: 'waf-challenge' };
  }
  if (body.length < 20000) return { final: false, why: `short-body-${body.length}` };
  if (status !== 200) return { final: false, why: `http-${status}` };

  const ld = parseLd(body);
  const og = ogTitle(body);
  const bookId = (String(finalUrl || '').match(/\/book\/show\/(\d+)/) || [])[1] || null;

  if (ld && ld.aggregateRating && Number(ld.aggregateRating.ratingValue) > 0
      && Number(ld.aggregateRating.ratingCount) > 0) {
    return {
      final: true,
      entry: {
        ok: true,
        rating: Number(ld.aggregateRating.ratingValue),
        count: Number(ld.aggregateRating.ratingCount),
        title: ld.name || og,
        author: Array.isArray(ld.author) ? (ld.author[0] || {}).name || null : null,
        pageIsbn: ld.isbn ? String(ld.isbn) : null,
        bookId,
        url: finalUrl || null,
        via: 'book/isbn',
      },
    };
  }
  if (ld || og) {
    // a real book page that genuinely carries no rating - RULE 7, a real result
    return {
      final: true,
      entry: {
        ok: false,
        status: 'no-rating-confirmed',
        title: (ld && ld.name) || og,
        author: ld && Array.isArray(ld.author) ? (ld.author[0] || {}).name || null : null,
        pageIsbn: ld && ld.isbn ? String(ld.isbn) : null,
        bookId,
        url: finalUrl || null,
        via: 'book/isbn',
      },
    };
  }
  return { final: false, why: 'no-ld-no-og' };
}

const isFinal = (v) => !!v && typeof v === 'object'
  && (v.ok === true || v.status === 404 || v.status === 'no-rating-confirmed');

// ---------------------------------------------------------------- one request
async function get(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(45000),
    });
    const body = await r.text();
    return { status: r.status, body, url: r.url };
  } catch {
    return { status: 0, body: '', url };
  }
}

/**
 * Try one ISBN until it settles or the backoff budget runs out.
 * Backoff is exponential and capped; a retryable answer is NEVER returned as
 * a result.  -> entry | null (null = still unsettled, leave it for a rerun)
 */
async function resolveIsbn(isbn, log) {
  const url = `https://www.goodreads.com/book/isbn/${isbn}`;
  for (let attempt = 0; attempt < 7; attempt++) {
    const res = await get(url);
    const c = classify(res.status, res.body, res.url);
    if (c.final) return c.entry;
    const back = Math.min(240, 5 * 2 ** attempt);
    log(`    ${isbn} retryable (${c.why}) -> backoff ${back}s [attempt ${attempt + 1}/7]`);
    await sleep(back * 1000);
  }
  return null;
}

// ---------------------------------------------------------------- main
const queue0 = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
const queue = LIMIT ? queue0.slice(0, LIMIT) : queue0;
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

const log = (s) => console.log(s);
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));

let done = 0; let rated = 0; let dead = 0; let norate = 0; let stuck = 0;
const t0 = Date.now();

for (let i = 0; i < queue.length; i++) {
  const it = queue[i];
  if (isFinal(cache[it.isbn])) continue;

  let entry = await resolveIsbn(it.isbn, log);

  // RULE 7: before believing a 404, try the ISBN's other form.
  if (entry && entry.status === 404) {
    const alt = altForm(it.isbn);
    if (alt && alt !== it.isbn) {
      await sleep(1100);
      const e2 = await resolveIsbn(alt, log);
      if (e2 && e2.ok === true) {
        entry = { ...e2, viaAlt: alt, note: `13<->10 alternate form of ${it.isbn}` };
        log(`    ${it.isbn} 404 but alternate ${alt} resolved -> "${entry.title}"`);
      } else if (e2 && e2.status === 'no-rating-confirmed') {
        entry = { ...e2, viaAlt: alt, note: `13<->10 alternate form of ${it.isbn}` };
      } else {
        entry.altTried = alt;
      }
    }
  }

  if (!entry) { stuck += 1; log(`  ${it.isbn} UNSETTLED - left for a rerun (never cached)`); continue; }

  cache[it.isbn] = entry;
  done += 1;
  if (entry.ok) rated += 1; else if (entry.status === 404) dead += 1; else norate += 1;

  if (done % 20 === 0) {
    save();
    const rate = done / Math.max(1, (Date.now() - t0) / 1000);
    log(`  ${i + 1}/${queue.length}  rated=${rated} 404=${dead} unrated=${norate} stuck=${stuck}  ~${((queue.length - i) / Math.max(rate, 0.01) / 60).toFixed(0)}min left`);
  }
  await sleep(1100);           // ~1 req/sec per host
}

save();
console.log(`\npass complete: ${done} settled (${rated} rated, ${dead} 404, ${norate} genuinely unrated), ${stuck} left unsettled`);
if (stuck) console.log('rerun to resume - unsettled entries were never written to the cache');
