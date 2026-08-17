/** Validate platform extraction + nested-404 detection on known-hard cases. */
import { UA, KEY } from './_ms_lib.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cases = [
  ['games', 'divinity-original-sin-ii'],
  ['games', 'civilization-v'],
  ['games', 'sid-meiers-civilization-v'],
  ['games', 'horizon-zero-dawn-complete-edition'],
  ['games', 'hearthstone-heroes-of-warcraft'],
  ['movies', 'psycho-1960'],
  ['movies', 'vertigo'],
  ['movies', 'taxi-driver'],
];

for (const [kind, slug] of cases) {
  const url = `https://backend.metacritic.com/composer/metacritic/pages/${kind}/${slug}/web?apiKey=${KEY}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  const comp = j?.components?.find((c) => c?.meta?.componentType === 'Product') ?? j?.components?.[0];
  const item = comp?.data?.item;
  if (comp?.status === 404 || !item) {
    console.log(`${kind}/${slug}: ABSENT (http ${res.status}, component status ${comp?.status})`);
  } else {
    const pc = (item.platforms ?? []).find((p) => /^PC$/i.test(p.name));
    console.log(`${kind}/${slug}: "${item.title}" date=${item.releaseDate ?? item.premiereDate} headline=${item.criticScoreSummary?.score} PC=${pc?.criticScoreSummary?.score ?? 'n/a'} pcDate=${pc?.releaseDate ?? '-'}`);
  }
  await sleep(1100);
}
