/** Does a sitemap-listed slug that the API 404s actually have a page? */
import { UA, KEY } from './_ms_lib.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [kind, path, slug] of [
  ['movies', 'movie', 'vertigo'],
  ['movies', 'movie', 'taxi-driver'],
  ['movies', 'movie', 'lawrence-of-arabia'],
  ['games', 'game', 'sid-meiers-civilization-vi'],
]) {
  const page = `https://www.metacritic.com/${path}/${slug}/`;
  const res = await fetch(page, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const html = await res.text();
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  const sc = html.match(/"criticScoreSummary":\s*\{[^}]*"score":\s*(\d+)/);
  console.log(`PAGE ${page} -> ${res.status}, len=${html.length}, title="${title.slice(0, 70)}", firstScore=${sc?.[1] ?? 'none'}`);
  await sleep(1200);

  const api = `https://backend.metacritic.com/composer/metacritic/pages/${kind}/${slug}/web?apiKey=${KEY}`;
  const r2 = await fetch(api, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const j = await r2.json().catch(() => null);
  const comp = j?.components?.find((c) => c?.meta?.componentType === 'Product') ?? j?.components?.[0];
  console.log(`  API -> http ${r2.status}, component status ${comp?.status}, title="${comp?.data?.item?.title ?? ''}"`);
  await sleep(1200);
}
