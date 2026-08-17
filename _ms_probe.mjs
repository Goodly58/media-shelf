/** Probe: what do known-good, known-bad and sitemap URLs actually return? */
import { UA, KEY } from './_ms_lib.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(url, label) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  const text = await res.text();
  console.log(`--- ${label}\n    ${url}\n    ${res.status} ${res.headers.get('content-type')} len=${text.length}`);
  return { status: res.status, text, headers: res.headers };
}

// 1. a slug that certainly exists
let r = await probe(
  `https://backend.metacritic.com/composer/metacritic/pages/games/disco-elysium-the-final-cut/web?apiKey=${KEY}`,
  'games: known good (disco elysium)',
);
{
  const j = JSON.parse(r.text);
  const item = j?.components?.[0]?.data?.item;
  console.log('    title=', item?.title, ' headline=', item?.criticScoreSummary?.score);
  console.log('    platforms=', JSON.stringify((item?.platforms ?? []).map((p) => [p.name, p.criticScoreSummary?.score, p.releaseDate])));
  console.log('    top-level keys=', Object.keys(j), ' components=', j.components?.length);
  console.log('    item keys=', Object.keys(item ?? {}).join(','));
}
await sleep(1100);

// 2. a slug that certainly does not exist
r = await probe(
  `https://backend.metacritic.com/composer/metacritic/pages/games/zzz-not-a-real-game-at-all-9999/web?apiKey=${KEY}`,
  'games: known bad slug',
);
console.log('    body head:', r.text.slice(0, 300));
await sleep(1100);

// 3. movies known good
r = await probe(
  `https://backend.metacritic.com/composer/metacritic/pages/movies/psycho/web?apiKey=${KEY}`,
  'movies: psycho (ambiguous title)',
);
{
  const item = JSON.parse(r.text)?.components?.[0]?.data?.item;
  console.log('    title=', item?.title, 'score=', item?.criticScoreSummary?.score, 'releaseDate=', item?.releaseDate, 'premiereDate=', item?.premiereDate);
}
await sleep(1100);

// 4. sitemaps — robots.txt advertises these explicitly
for (const sm of ['games.xml', 'movies.xml']) {
  const res = await fetch(`https://www.metacritic.com/${sm}`, { headers: { 'User-Agent': UA } });
  const t = await res.text();
  console.log(`--- sitemap ${sm}: ${res.status} ${res.headers.get('content-type')} len=${t.length}`);
  console.log(t.slice(0, 700));
  await sleep(1100);
}
