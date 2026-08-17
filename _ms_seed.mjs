/**
 * Seed the API cache with the ABSENCES the earlier passes already established.
 *
 * Only absences. Their positive results are three weeks old and a score can
 * move, so anything that will become a number in this report is re-fetched
 * live. A slug that 404s, on the other hand, is a stable fact about the site's
 * URL space and re-asking costs a request for no information.
 *
 * Note their absences are trustworthy *as absences* despite rule 6: those
 * caches recorded HTTP status, and a throttle would have been stored as
 * status 429/5xx, not as the status-200-with-nested-404 that a real miss
 * produces. Only the status-200 misses are seeded; anything else is left for a
 * live retry.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const API_CACHE = '.verify-cache/ms-api.json';
const api = existsSync(API_CACHE) ? JSON.parse(readFileSync(API_CACHE, 'utf8')) : {};
let seeded = 0;
let skipped = 0;

for (const [file, kind] of [['.verify-cache/games-v2.json', 'games'], ['.verify-cache/movies.json', 'movies']]) {
  if (!existsSync(file)) continue;
  const old = JSON.parse(readFileSync(file, 'utf8'));
  for (const [slug, v] of Object.entries(old)) {
    if (!v || !v.missing) continue;
    if (v.status !== 200 && v.status !== 404) { skipped += 1; continue; } // could have been a throttle
    const key = `${kind}/${slug}`;
    if (api[key] !== undefined) continue;
    api[key] = { absent: true, seededFrom: file };
    seeded += 1;
  }
}

writeFileSync(API_CACHE, JSON.stringify(api));
console.log(`seeded ${seeded} known absences, skipped ${skipped} non-404 statuses, cache now ${Object.keys(api).length}`);
