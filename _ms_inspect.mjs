/** Inspect the old cache's shape for the awkward buckets. */
import { readFileSync } from 'node:fs';
import { readArray, slugify, titlesAgree } from './_ms_lib.mjs';

const GAMES = readArray('games.html', 'GAMES');
const gc = JSON.parse(readFileSync('.verify-cache/games-v2.json', 'utf8'));
const rem = GAMES.filter((g) => g.metacritic != null && !g.verified);

const noScore = [];
const noPcButHeadline = [];
for (const g of rem) {
  const hit = gc[slugify(g.title)];
  if (!hit || hit.missing) continue;
  if (!titlesAgree(g.title, hit.title)) continue;
  if ((hit.pc ?? hit.headline) == null) noScore.push([g, hit]);
  else if (hit.pc == null) noPcButHeadline.push([g, hit]);
}
console.log(`no score at all: ${noScore.length}`);
for (const [g, h] of noScore.slice(0, 12)) {
  console.log(`  ${g.title} (${g.year}) ours=${g.metacritic} | mc title="${h.title}" headline=${h.headline} pc=${h.pc} reviews=${h.reviews} date=${h.date}`);
  console.log(`     platforms: ${JSON.stringify(h.platforms)}`);
}
console.log(`\nPC absent but headline present: ${noPcButHeadline.length}`);
for (const [g, h] of noPcButHeadline.slice(0, 10)) {
  console.log(`  ${g.title} ours=${g.metacritic} headline=${h.headline} platforms=${JSON.stringify((h.platforms ?? []).map((p) => [p.name, p.score]))}`);
}
