/**
 * Re-resolves the rows where the first pass accepted a page whose title is not
 * actually our title.
 *
 *   node tools/rotten-tomatoes/rt_tv_reresolve.mjs        fetch + report (resumable)
 *
 * REPORT ONLY. Writes _rt-tv-reresolve.json. Nothing else is touched.
 *
 * THE BUG THIS ANSWERS
 * --------------------
 * tools/rotten-tomatoes/rt_tv.mjs accepts the first slug whose page title merely *contains* ours:
 *
 *     titleAgrees: a === b || a.includes(b) || b.includes(a)
 *
 * and it tries the bare slug before the year-qualified one. For "Warrior" (2019)
 * that means:
 *
 *     /tv/warrior       -> "Warriors of the Mongkon", 2015, 0 reviews   ACCEPTED
 *     /tv/warrior_2019  -> "Warrior (2019)", 2019, score 93 (41 reviews)  NEVER TRIED
 *
 * so the show was filed as unscored while a real 93 sat one slug further down the
 * list the pass had already generated. The substring rule costs coverage, not
 * just accuracy — fold("oz") is inside fold("frozen planet") too, and 227 pairs
 * of catalogue titles contain one another.
 *
 * The fix is not a looser or tighter rule, it is to stop taking the first
 * acceptable slug: try the candidates, score them, keep the best. Exact title
 * beats substring, and RT's own dateCreated decides the year rather than the hero
 * strip, which is frequently absent.
 *
 * Only rows whose accepted page title differs from ours are re-examined, so shows
 * that already matched exactly cost nothing. robots.txt allows /tv/<slug>;
 * /search is disallowed and is not used here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (f) => path.join(ROOT, f);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PACE = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);

const ENT = { amp: '&', quot: '"', apos: "'", lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', nbsp: ' ', hellip: '...', mdash: '-', ndash: '-' };
const decode = (s) => String(s == null ? '' : s)
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)));
const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const fold = (s) => deaccent(decode(s)).toLowerCase().replace(/[^a-z0-9]+/g, '');
/* RT titles a disambiguated page "Warrior (2019)"; strip that before comparing or
   the correct page looks like a worse match than the wrong one. */
const bare = (t) => decode(t).replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').replace(/\s*:\s*(season|series)\s+\d+.*$/i, '').trim();

function tvSlugs(title, year) {
  const clean = deaccent(decode(bare(title))).toLowerCase()
    .replace(/['’´`.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const words = clean.split(' ').filter(Boolean);
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  push(words.join('_')); push(words.join('-'));
  if (['the', 'a', 'an'].includes(words[0])) { push(words.slice(1).join('_')); push(words.slice(1).join('-')); }
  if (year) { push(`${words.join('_')}_${year}`); push(`${words.join('-')}_${year}`); }
  return out.slice(0, 6);
}

const RETRYABLE = (s) => s === 202 || s === 429 || s === 408 || (s >= 500 && s < 600);
async function grab(url, tries = 4) {
  let wait = 2000;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (RETRYABLE(res.status)) { await sleep(wait); wait *= 2; continue; }
      if (!res.ok) return { status: res.status };
      const html = await res.text();
      if (!html.length) { await sleep(wait); wait *= 2; continue; }
      return { status: 200, html, url: res.url };
    } catch { await sleep(wait); wait *= 2; }
  }
  return { retry: true, status: 'throttled' };
}

function jsonBlob(html, id) {
  const m = html.match(new RegExp('<script[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</script>'));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
function parse(html) {
  const sc = jsonBlob(html, 'media-scorecard-json') || {};
  const hero = (jsonBlob(html, 'media-hero-json') || {}).content || {};
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .find((j) => j && j['@type'] === 'TVSeries') || {};
  const cs = sc.criticsScore || null;
  const reviews = cs && cs.reviewCount != null ? Number(cs.reviewCount) : 0;
  const score = cs && cs.score != null && reviews > 0 ? Number(cs.score) : null;
  const dc = String(ld.dateCreated || '');
  return {
    name: hero.title || ld.name || null,
    score: Number.isFinite(score) ? score : null,
    reviews,
    ldYear: Number((dc.match(/^((?:19|20)\d{2})/) || [])[1]) || null,
  };
}

const cache = readJson(at('_rt-tv-reresolve-cache.json'), {});
const flush = () => fs.writeFileSync(at('_rt-tv-reresolve-cache.json'), JSON.stringify(cache));

async function page(url) {
  if (cache[url] && !cache[url].retry) return cache[url];
  const r = await grab(url);
  await sleep(PACE);
  cache[url] = r.status === 200 ? { ok: true, finalUrl: r.url, ...parse(r.html) } : { ok: false, status: r.status, retry: !!r.retry };
  return cache[url];
}

const rows = readJson(at('_rt-tv-scores.json'), null);
if (!rows) { console.error('no _rt-tv-scores.json — run node tools/rotten-tomatoes/rt_tv.mjs first'); process.exit(1); }

/* Only the rows whose accepted page is not titled what we asked for. */
const suspects = rows.filter((r) => r.pageName && fold(bare(r.title)) !== fold(bare(r.pageName)));
console.log(`${suspects.length} rows were accepted on a substring title match — re-examining\n`);

const out = [];
let improved = 0, n = 0;

for (const r of suspects) {
  const cands = [];
  for (const slug of tvSlugs(r.title, r.ourYear)) {
    const p = await page(`https://www.rottentomatoes.com/tv/${slug}`);
    if (!p.ok || !p.name) continue;
    const exact = fold(bare(r.title)) === fold(bare(p.name));
    const contains = fold(bare(p.name)).includes(fold(bare(r.title))) || fold(bare(r.title)).includes(fold(bare(p.name)));
    if (!exact && !contains) continue;
    const gap = r.ourYear != null && p.ldYear != null ? Math.abs(r.ourYear - p.ldYear) : null;
    cands.push({ slug, url: p.finalUrl, name: p.name, score: p.score, reviews: p.reviews, ldYear: p.ldYear, exact, gap });
  }

  /* Rank: exact title first, then closest year, then having a score at all.
     Never rank by the score itself — that would be picking the flattering page. */
  cands.sort((a, b) => (Number(b.exact) - Number(a.exact))
    || ((a.gap ?? 99) - (b.gap ?? 99))
    || (Number(b.score != null) - Number(a.score != null)));

  const best = cands[0] || null;
  const wasCand = cands.find((c) => c.url === r.url) || null;

  /* Ranking exact-title first is right for Warrior, where /tv/warrior is a
     different show entirely. It is NOT right for The Traitors (2022), where
     /tv/the_traitors_2022 ("The Traitors") and /tv/the_traitors ("The Traitors UK")
     are BOTH dated 2022 — the year cannot separate them, and preferring the exact
     title silently trades a 90 backed by 40 reviews for a page with no score.
     Losing a real score to a tie-break is not an improvement, so that case is
     reported as ambiguous and the original is left alone for a human. */
  let verdict = 'unchanged';
  if (best && best.url !== r.url) {
    const tradesAwayAScore = r.score != null && best.score == null
      && (best.gap ?? 99) >= (wasCand ? wasCand.gap ?? 99 : 99);
    verdict = tradesAwayAScore ? 'ambiguous' : 'improved';
  }
  if (verdict === 'improved') improved += 1;

  out.push({
    title: r.title, ourYear: r.ourYear,
    was: { url: r.url, pageName: r.pageName, score: r.score ?? null, status: r.status },
    now: best ? { url: best.url, pageName: best.name, score: best.score, reviews: best.reviews, rtYear: best.ldYear, exactTitle: best.exact, yearGap: best.gap } : null,
    verdict,
    changed: verdict === 'improved',
    candidates: cands,
  });

  n += 1;
  if (n % 5 === 0) { flush(); process.stdout.write(`  ${n}/${suspects.length}\r`); }
}
flush();
fs.writeFileSync(at('_rt-tv-reresolve.json'), JSON.stringify(out, null, 1));

console.log(`\n${improved} of ${suspects.length} resolve to a strictly better page\n`);
for (const r of out.filter((x) => x.verdict === 'improved')) {
  console.log(`  ${r.title} (${r.ourYear})`);
  console.log(`      was: ${r.was.pageName} ${r.was.score ?? '-'}  ${r.was.url}`);
  console.log(`      now: ${r.now.pageName} ${r.now.score ?? '-'}  ${r.now.url}`);
}

const amb = out.filter((x) => x.verdict === 'ambiguous');
if (amb.length) {
  console.log(`\n${amb.length} ambiguous — two RT pages fit equally well and picking one loses a real score.`);
  console.log(`Left as the first pass had them; these need a human, not a tie-break:`);
  for (const r of amb) {
    console.log(`  ${r.title} (${r.ourYear})  kept: ${r.was.pageName} ${r.was.score ?? '-'}  ${r.was.url}`);
    for (const c of r.candidates) console.log(`      candidate: "${c.name}" ${c.ldYear} score=${c.score ?? '-'} (${c.reviews} rev)  ${c.url}`);
  }
}
console.log(`\nwrote _rt-tv-reresolve.json (report only)`);
