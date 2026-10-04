/**
 * Replace the fourteen compound game genres with flat, single categories,
 * classified from Steam user tags.
 *
 *   node tools/steam/reclassify.mjs          report only
 *   node tools/steam/reclassify.mjs --apply  rewrite the genre field in games.html
 *
 * WHY THE OLD ONES HAD TO GO
 * --------------------------
 * Every bucket was a compound — "Horror / Survival", "Strategy / 4X / RTS",
 * "Multiplayer / MOBA / Co-op" — because they were built as a filter chip row,
 * fourteen chips over 2,164 games. That was defensible while genre was only a
 * browse control. It stopped being defensible when genre became a semantic input
 * to the cross-medium recommender, which reads a hand-written prior per genre.
 *
 * The cost was measurable: "Horror / Survival" carries tone -0.8, so Palworld
 * (a cheerful creature-collector) was recommending Frankenstein and Carrie, and
 * Breathedge — whose own blurb says "comedic" — was recommending 28 Days Later.
 *
 * WHERE THE NEW ONES COME FROM
 * ----------------------------
 * Not invented. Steam's own user tags, which are the folk taxonomy players
 * actually use, and which list Horror and Survival as separate tags — the
 * compound was never how anyone describes these games.
 *
 * The catch is that the commonest tags are not genres at all: Singleplayer,
 * Atmospheric, Story Rich, Great Soundtrack, Difficult, Indie, 2D. A naive
 * "top tag wins" files half the catalogue under Singleplayer. So only the
 * genre-bearing tags below are read, in priority order, most specific first.
 */
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');

function readArray(file, name) {
  const h = fs.readFileSync(file, 'utf8');
  const at = h.search(new RegExp(`const ${name}\\s*=\\s*\\[`));
  const s = h.indexOf('[', at);
  let d = 0, e = -1, q = false, esc = false;
  for (let i = s; i < h.length; i++) {
    const c = h[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { e = i + 1; break; } }
  }
  return { array: JSON.parse(h.slice(s, e)), start: s, end: e, html: h };
}

const cache = fs.existsSync('_tags-cache.json')
  ? JSON.parse(fs.readFileSync('_tags-cache.json', 'utf8')) : {};

/* The ORIGINAL compound genres, captured from the commit before this script
   first ran. Needed because the script is now re-run over its own output: a game
   whose Steam id turned out to name a different game already has a genre derived
   from that wrong game's tags, and keeping it would preserve the error forever.
   Age of Wonders: Planetfall carries Resident Evil 2's id, was classified Horror
   from RE2's tags, and is really "Strategy / 4X / RTS". */
const ORIGINAL = fs.existsSync('_orig-genres.json')
  ? JSON.parse(fs.readFileSync('_orig-genres.json', 'utf8')) : {};

/* Priority order: the FIRST rule that matches wins, so the list runs from most
   specific to most general. Horror sits above Survival deliberately — a survival
   horror game is a horror game, while Palworld carries Survival and no Horror
   tag at all, which is exactly the distinction the old compound could not make. */
const RULES = [
  ['Visual Novel',   ['Visual Novel', 'Dating Sim', 'Otome']],
  ['Rhythm',         ['Rhythm', 'Music', 'Music-Based Procedural Generation']],
  ['Card & Board',   ['Card Game', 'Deckbuilding', 'Board Game', 'Card Battler', 'Roguelike Deckbuilder', 'Traditional Roguelike']],
  ['Racing',         ['Racing', 'Driving', 'Automobile Sim', 'Motorbike']],
  ['Sports',         ['Sports', 'Football', 'Soccer', 'Basketball', 'Golf', 'Fishing', 'Skateboarding']],
  ['Fighting',       ['Fighting', 'Beat em up', '2D Fighter', '3D Fighter', 'Martial Arts']],
  ['MMO',            ['MMORPG', 'Massively Multiplayer', 'MMO']],
  ['Horror',         ['Horror', 'Psychological Horror', 'Survival Horror', 'Lovecraftian', 'Gore', 'Zombies']],
  ['Survival',       ['Survival', 'Open World Survival Craft', 'Survival Craft', 'Base Building', 'Crafting']],
  ['Metroidvania',   ['Metroidvania']],
  ['Roguelike',      ['Roguelike', 'Roguelite', 'Rogue-like', 'Rogue-lite', 'Action Roguelike', 'Roguevania', 'Dungeon Crawler']],
  ['Platformer',     ['Platformer', 'Precision Platformer', 'Puzzle Platformer', '2D Platformer', '3D Platformer']],
  ['Stealth',        ['Stealth', 'Immersive Sim']],
  ['Shooter',        ['Shooter', 'FPS', 'First-Person Shooter', 'Third-Person Shooter', 'Twin Stick Shooter', 'Bullet Hell', 'Shoot Em Up', 'Looter Shooter', 'Tactical Shooter', 'Battle Royale']],
  ['JRPG',           ['JRPG', 'Turn-Based JRPG', 'Anime RPG']],
  ['RPG',            ['RPG', 'Action RPG', 'CRPG', 'Tactical RPG', 'Party-Based RPG', 'Souls-like', 'Role Playing Game', 'Turn-Based RPG']],
  ['Strategy',       ['Strategy', 'Turn-Based Strategy', 'Real Time Strategy', 'RTS', 'Grand Strategy', '4X', 'Tower Defense', 'Wargame', 'Auto Battler', 'Turn-Based Tactics', 'Tactical']],
  ['Simulation',     ['Simulation', 'Management', 'City Builder', 'Colony Sim', 'Farming Sim', 'Life Sim', 'Economy', 'Business Sim', 'Building', 'Flight', 'Space Sim', 'Transportation']],
  ['Puzzle',         ['Puzzle', 'Sokoban', 'Hidden Object', 'Word Game', 'Trivia', 'Logic', 'Match 3']],
  ['Mystery',        ['Detective', 'Mystery', 'Point & Click', 'Investigation']],
  /* 'Story Rich' deliberately absent: it is the third commonest tag in the whole
     corpus (186 of the first 391 games) and describes how a game feels, not what
     it is. With it in, Expeditions: Clair Obscur came out Adventure on Story Rich
     (661) despite RPG (478) being its top actual genre tag. */
  ['Adventure',      ['Adventure', 'Interactive Fiction', 'Walking Simulator', 'Choose Your Own Adventure']],
  ['Action',         ['Action', 'Hack and Slash', 'Arcade', 'Character Action Game', 'Beat em up']],
];

/**
 * For games with no Steam id, or none that SteamSpy knows. Mapping the compound
 * buckets one-to-one is fine for thirteen of them, but "Horror / Survival" is
 * the bucket that started this and cannot be resolved by lookup — the whole
 * complaint is that it holds both. So it is decided from the blurb instead, and
 * the default when the blurb is silent is Survival rather than Horror: mislabel
 * a horror game as survival and you understate it; mislabel a cheerful crafting
 * game as horror and the recommender starts offering Frankenstein.
 */
const HORROR_WORDS = /horror|zombie|undead|monster|nightmare|haunt|ghost|demon|cult|terror|dread|scare|slasher|gore|mutant|xenomorph|necromorph|parasit|creep|eerie|macabre|lovecraft/i;

const FLAT = new Set(RULES.map(([n]) => n));

function fallbackFor(game) {
  // Prefer the original compound label over whatever a bad id already wrote.
  const was = ORIGINAL[game.title];
  if (was && FALLBACK[was]) {
    if (was === 'Horror / Survival') return HORROR_WORDS.test(game.blurb || '') ? 'Horror' : 'Survival';
    return FALLBACK[was];
  }
  if (game.genre === 'Horror / Survival') {
    return HORROR_WORDS.test(game.blurb || '') ? 'Horror' : 'Survival';
  }
  if (FALLBACK[game.genre]) return FALLBACK[game.genre];
  /* Already a flat category — this script has run before. Keep it. Defaulting to
     'Action' here put 1,056 of 2,169 games under Action on the second run,
     because the FALLBACK table is keyed on the OLD compound names and matches
     nothing once they are gone. A migration that is not safe to run twice is a
     migration that will be run twice. */
  if (FLAT.has(game.genre)) return game.genre;
  return 'Action';
}

/** Old genre -> best flat guess, for the 21% of games with no Steam id. */
const FALLBACK = {
  'Strategy / 4X / RTS': 'Strategy',
  'Narrative / Adventure': 'Adventure',
  'Simulation / Management': 'Simulation',
  'Shooter (FPS/TPS)': 'Shooter',
  'Action RPG': 'RPG',
  'Indie / Platformer': 'Platformer',
  'Roguelike / Metroidvania': 'Roguelike',
  'Horror / Survival': 'Horror',
  'Racing / Sports': 'Racing',
  'Multiplayer / MOBA / Co-op': 'Action',
  'JRPG / Turn-based RPG': 'JRPG',
  Fighting: 'Fighting',
  'Open-World Action-Adventure': 'Action',
  'Stealth / Immersive Sim': 'Stealth',
};

/**
 * Only PROMINENT tags count.
 *
 * The first version scored every matching tag and gave specific rules a large
 * multiplier, on the theory that a specific tag is more informative. It let
 * minority tags hijack the result: Grand Theft Auto V came out Racing on a small
 * "Driving" tag, Persona 5 Royal came out Visual Novel, and Half-Life: Alyx came
 * out Horror. Each of those tags is genuinely present and genuinely a minority
 * opinion.
 *
 * So a tag is only considered if a meaningful share of taggers chose it —
 * measured against that game's own top tag, since tag counts vary by three
 * orders of magnitude between a hit and an obscurity. Specificity then breaks
 * ties among tags that are all prominent, which is the job it should have had.
 */
const PROMINENCE = 0.30;

function classify(tags) {
  if (!tags || !Object.keys(tags).length) return null;
  const max = Math.max(...Object.values(tags));
  if (!Number.isFinite(max) || max <= 0) return null;
  const floor = max * PROMINENCE;

  /* Score a rule by its BEST tag, never by the sum of its tags.
     Summing rewards a rule for having many near-synonyms in it. Persona 5 Royal
     carries Dating Sim (574) and Visual Novel (428), which sum to 1,002 and all
     but tie its actual top tag, JRPG (1,033) — so the game came out a visual
     novel. Taking the maximum asks the right question: which single genre did
     the most players actually pick?

     Rule order breaks exact ties only. It is deliberately NOT a multiplier:
     Half-Life: Alyx sits at Shooter 1,994 against Horror 1,966, a 1.4% gap that
     any specificity bonus would overturn — and it is a shooter. */
  let best = null;
  let bestScore = 0;
  for (const [name, keys] of RULES) {
    let score = 0;
    for (const k of keys) {
      const n = tags[k];
      if (n && n >= floor && n > score) score = n;
    }
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best;
}

const { array: GAMES, start, end, html } = readArray('games.html', 'GAMES');

let fromTags = 0, fromFallback = 0;
const counts = {};
const moved = [];

/* A quarter of the catalogue's steamAppIds name a different game — Age of
   Wonders: Planetfall carries Resident Evil 2's id, which is why its card shows
   RE2 art. Trusting the id meant classifying Planetfall, a 4X strategy game,
   from Resident Evil's tags: it came out Horror. Steam returns the game's name
   alongside the tags and this never checked it, exactly the mistake the IMDb ids
   had already taught once.

   The check is lenient on purpose, because real variants abound: "Assassin's
   Creed II" against "Assassin's Creed 2", "Hitman 3" against "HITMAN World of
   Assassination". It asks whether the two names share most of their meaningful
   words, not whether they are identical. */
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/iii/g, '3').replace(/ii/g, '2').replace(/iv/g, '4')
  .replace(/xi/g, '11').replace(/x/g, '10')
  .split(/\s+/).filter((w) => w && !['the', 'a', 'of', 'edition', 'definitive', 'remastered', 'gold', 'complete', 'goty', 'hd'].includes(w));

function idLooksRight(title, steamName) {
  if (!steamName) return false;
  const a = norm(title), b = norm(steamName);
  if (!a.length || !b.length) return false;
  const setB = new Set(b);
  const shared = a.filter((w) => setB.has(w)).length;
  // Most of the shorter title's words must appear in the other.
  return shared / Math.min(a.length, b.length) >= 0.6;
}

let idRejected = 0;
for (const g of GAMES) {
  let entry = g.steamAppId ? cache[String(g.steamAppId)] : null;
  if (entry && entry.name && !idLooksRight(g.title, entry.name)) { entry = null; idRejected += 1; }
  let next = entry ? classify(entry.tags) : null;
  if (next) fromTags += 1;
  else { next = fallbackFor(g); fromFallback += 1; }
  counts[next] = (counts[next] || 0) + 1;
  if (next !== g.genre) moved.push([g.title, g.genre, next]);
  g.genre = next;
}

console.log(`classified ${GAMES.length} games — ${fromTags} from Steam tags, ${fromFallback} from the old bucket\n`);
console.log('new taxonomy:');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
console.log(`\n${moved.length} games changed category. A sample:`);
for (const [t, from, to] of moved.slice(0, 20)) console.log(`  ${t.padEnd(34)} ${from}  ->  ${to}`);

/* The whole point of the exercise. */
console.log('\nthe games that started this:');
for (const t of ['Palworld', 'Breathedge', 'Subnautica', 'This War of Mine', 'Raft', 'Resident Evil 4', 'Alien: Isolation', 'Conan Exiles']) {
  const g = GAMES.find((x) => x.title === t);
  if (g) console.log(`  ${t.padEnd(20)} -> ${g.genre}`);
}

if (!APPLY) { console.log('\n(report only — pass --apply to write)'); process.exit(0); }
const out = html.slice(0, start) + JSON.stringify(GAMES) + html.slice(end);
fs.writeFileSync('games.html', out);
console.log('\nwrote games.html');
