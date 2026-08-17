/**
 * Build the Metacritic slug universe from the sitemaps robots.txt advertises.
 *
 * Why this and not slug guessing: the remainder the earlier passes could not
 * match is dominated by titles whose real slug differs from the naive one. The
 * choices are to guess variants (610 titles x ~9 shapes = thousands of requests
 * against the API, nearly all 404s) or to read the index the site publishes for
 * exactly this purpose. robots.txt names games.xml / movies.xml / tvshows.xml
 * as sitemaps and disallows none of them, so this is both cheaper and the
 * sanctioned route.
 *
 * ~330 requests at 1/sec, cached per sub-sitemap so a rerun resumes.
 *
 *   node _ms_sitemap.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { UA } from './_ms_lib.mjs';

const CACHE_DIR = '.verify-cache';
const CACHE = `${CACHE_DIR}/ms-sitemap.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(CACHE_DIR, { recursive: true });
/** @type {Record<string,string[]>} sub-sitemap url -> slugs */
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

/**
 * Fetch with backoff. Rule 6: a throttle is never cached as a result.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function get(url) {
  for (let a = 0; a < 5; a += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' } });
      const text = await res.text();
      // 202-with-empty-body, 429 and 5xx are all "come back later", never data.
      if (res.status === 202 || res.status === 429 || res.status >= 500 || (res.status === 200 && text.trim() === '')) {
        const wait = 2000 * 2 ** a;
        process.stdout.write(`      throttled ${res.status} on ${url}, waiting ${wait}ms\n`);
        await sleep(wait);
        continue;
      }
      if (res.status !== 200) return null;
      return text;
    } catch (e) {
      await sleep(2000 * 2 ** a);
    }
  }
  return null; // exhausted: an unknown, not a result
}

const kinds = [
  ['games', 'game'],
  ['movies', 'movie'],
];

for (const [index] of kinds) {
  const idxText = await get(`https://www.metacritic.com/${index}.xml`);
  if (!idxText) {
    console.error(`could not read ${index}.xml`);
    continue;
  }
  const subs = [...idxText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`${index}.xml: ${subs.length} sub-sitemaps`);
  let n = 0;
  for (const sub of subs) {
    n += 1;
    if (cache[sub]) continue;
    const xml = await get(sub);
    if (xml == null) {
      console.error(`  MISS ${sub} (left uncached so a rerun retries it)`);
      continue;
    }
    cache[sub] = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => m[1].replace(/^https?:\/\/www\.metacritic\.com\//, '').replace(/\/$/, ''));
    if (n % 20 === 0) {
      writeFileSync(CACHE, JSON.stringify(cache));
      console.log(`  ${n}/${subs.length}`);
    }
    await sleep(1000);
  }
  writeFileSync(CACHE, JSON.stringify(cache));
}

writeFileSync(CACHE, JSON.stringify(cache));
const total = Object.values(cache).reduce((a, b) => a + b.length, 0);
console.log(`done: ${Object.keys(cache).length} sub-sitemaps, ${total} urls`);
