/** Probe 2: sitemap shape and size. */
import { UA } from './_ms_lib.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const sm of ['games', 'movies', 'tvshows']) {
  const res = await fetch(`https://www.metacritic.com/${sm}.xml`, { headers: { 'User-Agent': UA } });
  const t = await res.text();
  const subs = [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`${sm}.xml -> ${subs.length} sub-sitemaps; first=${subs[0]} last=${subs.at(-1)}`);
  await sleep(1100);
  // one sub-sitemap to see the entry shape
  const r2 = await fetch(subs[0], { headers: { 'User-Agent': UA } });
  const t2 = await r2.text();
  const locs = [...t2.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`   ${subs[0]}: ${r2.status}, len=${t2.length}, ${locs.length} urls`);
  console.log('   sample entry xml:', t2.slice(t2.indexOf('<url>'), t2.indexOf('</url>') + 6));
  console.log('   sample locs:', locs.slice(0, 5).join('\n                '));
  await sleep(1100);
}
