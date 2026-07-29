/**
 * Build data/similar.json — the cross-medium "if you liked this" index, plus the
 * adaptation map that keeps adaptations OUT of it.
 *
 *   node build-similar.js
 *
 * ---------------------------------------------------------------------------
 * WHY NOT TF-IDF OVER THE BLURBS
 * ---------------------------------------------------------------------------
 * Measured on the real corpus:
 *
 *   blurb length                                      median 11 words (5-16)
 *   vocabulary                                        13,017 types, 6,401 hapax
 *   mean cross-medium partners sharing >=2 content words   3.5
 *   items with fewer than 9 such partners                  87%
 *
 * For seven items in eight there is nothing to recommend from text alone. Fill
 * those slots and you are matching on a single shared word — and with half the
 * vocabulary appearing exactly once, that word carries enormous IDF. The metric
 * would pair a samurai film with a samurai cookbook and be confident about it.
 *
 * ---------------------------------------------------------------------------
 * THE HARDER PROBLEM: THE FOUR MEDIA ARE WRITTEN IN DIFFERENT REGISTERS
 * ---------------------------------------------------------------------------
 *                    mechanics jargon    blurbs naming a human subject
 *   games                   9.3%                     8.3%
 *   books                   0.2%                    27.3%
 *   movies                  0.1%                    30.8%
 *   shows                   0.2%                    30.5%
 *
 * Game blurbs describe WHAT YOU DO. The other three describe WHO IT HAPPENS TO.
 * So the bridge cannot be built on subject matter at all. It has to be built on
 * stance toward the experience — which, happily, game blurbs state unusually
 * plainly ("agonizing moral drama", "cozy", "brutal").
 *
 * Hence: every item is placed on named axes of APPEAL, from a hand-written prior
 * over all 60 genre labels (dense, 100% coverage) modulated by blurb lexicons
 * (specific). Naming the axes also lets the page say WHY, which is the whole
 * difference between a recommendation a reader can check and one they must take
 * on faith.
 *
 * ---------------------------------------------------------------------------
 * FIELDS DELIBERATELY NOT USED, AND WHY
 * ---------------------------------------------------------------------------
 *   year          A catalogue artifact, not a property of taste. Games span
 *                 2010-2026 (the Steam era); books span -700 to 2026. Any
 *                 year-proximity term therefore FORBIDS the best cross-medium
 *                 pairs in the catalogue outright. An earlier cut of this file
 *                 had one. It was wrong.
 *   verified      Records whether the build could confirm a row against an API.
 *                 Pure plumbing, zero editorial content.
 *   ratingsCount  Fame, not quality (r = 0.08 against rating). Used ONLY as a
 *                 floor, so we never recommend something nobody can find.
 *   score         Not comparable across media and not a similarity signal at all
 *                 — |score difference| would pair Dwarf Fortress with The
 *                 Godfather on the grounds that both are good. Gate and
 *                 tiebreaker only.
 *   ids           steamAppId/isbn/imdbId/tmdbId/posterPath are plumbing luck.
 */

const fs = require('fs');

/* ------------------------------------------------------------------ loading */

function readArray(file, name) {
  const h = fs.readFileSync(file, 'utf8');
  const at = h.search(new RegExp('const ' + name + '\\s*=\\s*\\['));
  if (at < 0) throw new Error(name + ' not found in ' + file);
  const s = h.indexOf('[', at);
  let d = 0, e = -1, q = false, esc = false;
  for (let i = s; i < h.length; i++) {
    const c = h[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { e = i + 1; break; } }
  }
  return JSON.parse(h.slice(s, e));
}
function load(file, key) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : raw[key] || [];
}

/* The global order MUST match build-backlog-index.js: the browser reads display
   fields out of backlog-index.json using the indices stored here. validate.js
   asserts the two agree, because a silent drift would mislabel every card. */
const KINDS = ['games', 'books', 'movies', 'shows'];
const SETS = {
  games: readArray('games.html', 'GAMES'),
  books: readArray('books.html', 'BOOKS'),
  movies: load('data/movies.json', 'movies'),
  shows: load('data/shows.json', 'shows'),
};

const items = [];
const offsets = {};
for (const k of KINDS) {
  offsets[k] = items.length;
  for (const x of SETS[k]) items.push({ ...x, kind: k });
}
const N = items.length;

/* ------------------------------------------------------------------- axes */

/* Non-negative facets, compared by cosine. Tone and scale are signed and handled
   separately below — a signed quantity inside a cosine is meaningless. */
const AXES = [
  'moral',      // consequence-bearing. Separates the war game from the war novel.
  'interior',   // lived from inside a head
  'system',     // the antagonist is a structure, not a person
  'uncanny',    // the ground is not solid
  'youth',      // life-stage posture
  'deduction',  // structure: reconstructing what happened
  'making',     // structure: building, tending, managing
  'journey',    // structure: accumulation across distance or time
  'confine',    // structure: pressure in a closed space
  'violence',
  'wonder',
  'history',
  'future',
];
const AI = {};
AXES.forEach((a, i) => { AI[a] = i; });

/* Completes the sentence "Both are ...". */
const AXIS_PHRASE = {
  moral: 'about choices that cost something',
  interior: 'lived from inside one head',
  system: 'about people up against an institution',
  uncanny: 'built on ground that will not stay solid',
  youth: 'about being young',
  deduction: 'about reconstructing what happened',
  making: 'about building and tending something',
  journey: 'journeys across distance and time',
  confine: 'about pressure in a closed space',
  violence: 'driven by conflict',
  wonder: 'built on strangeness and myth',
  history: 'rooted in a real past',
  future: 'set beyond the present',
};

/* Sixty genre labels, judged once each. Genre is a PRIOR and a fallback, never a
   similarity key — "Drama" matching "Drama" is a within-medium move and there is
   no Drama in the games vocabulary anyway.
   tone: warm(+) .. bleak(-)   scale: epic(+) .. domestic(-)   both -1..1 */
const GENRE_PRIOR = {
  // ---- games (14)
  'Strategy / 4X / RTS':         { system: 3, history: 2, violence: 2, tone: -0.1, scale: 0.8 },
  'Narrative / Adventure':       { interior: 2, moral: 2, deduction: 1, tone: -0.1, scale: -0.4 },
  'Simulation / Management':     { making: 3, system: 1, tone: 0.3, scale: -0.1 },
  'Shooter (FPS/TPS)':           { violence: 3, tone: -0.2, scale: 0.2 },
  'Action RPG':                  { wonder: 2, violence: 2, journey: 1, scale: 0.4 },
  'Indie / Platformer':          { wonder: 2, youth: 1, tone: 0.3, scale: -0.4 },
  'Roguelike / Metroidvania':    { confine: 2, violence: 1, wonder: 1, scale: -0.2 },
  'Horror / Survival':           { confine: 3, uncanny: 2, violence: 1, tone: -0.8, scale: -0.3 },
  'Racing / Sports':             { making: 1, tone: 0.3, scale: -0.2 },
  'Multiplayer / MOBA / Co-op':  { violence: 2, tone: 0.1, scale: 0 },
  'JRPG / Turn-based RPG':       { wonder: 3, journey: 2, youth: 2, scale: 0.5 },
  'Fighting':                    { violence: 3, tone: 0.1, scale: -0.2 },
  'Open-World Action-Adventure': { journey: 2, violence: 2, scale: 0.6 },
  'Stealth / Immersive Sim':     { confine: 2, system: 2, deduction: 1, tone: -0.3, scale: -0.1 },
  // ---- books (22)
  'Literary Fiction':            { interior: 3, moral: 2, tone: -0.3, scale: -0.5 },
  'Philosophy & Psychology':     { interior: 3, system: 1, scale: 0.1 },
  'Poetry & Essays':             { interior: 3, tone: -0.1, scale: -0.5 },
  'History & Politics':          { history: 3, system: 3, moral: 2, tone: -0.3, scale: 0.8 },
  'Memoir & Biography':          { interior: 3, moral: 1, scale: -0.4 },
  'Travel & Food':               { journey: 2, making: 2, tone: 0.6, scale: -0.1 },
  'Science & Nature':            { system: 1, wonder: 1, scale: 0.5 },
  'Art, Music & Film':           { making: 3, interior: 1, scale: -0.2 },
  'Historical Fiction':          { history: 3, journey: 1, scale: 0.3 },
  'Science Fiction':             { future: 3, wonder: 2, scale: 0.7 },
  'Manga & Comics':              { wonder: 2, youth: 2, scale: 0.1 },
  'Classics':                    { interior: 2, history: 2, scale: -0.1 },
  'Crime & Detective':           { deduction: 3, violence: 2, tone: -0.4, scale: -0.2 },
  'Fantasy':                     { wonder: 3, journey: 2, scale: 0.7 },
  'Business & Self-Help':        { making: 2, system: 1, tone: 0.4, scale: 0 },
  'Children & Middle Grade':     { youth: 3, wonder: 2, tone: 0.8, scale: -0.4 },
  'Horror':                      { uncanny: 3, confine: 2, violence: 2, tone: -0.8, scale: -0.3 },
  'Mystery & Thriller':          { deduction: 3, confine: 1, tone: -0.3, scale: -0.2 },
  'Health & Wellbeing':          { interior: 2, making: 1, tone: 0.5, scale: -0.5 },
  'Graphic Novels':              { wonder: 2, interior: 1, scale: 0 },
  'Romance':                     { interior: 2, tone: 0.6, scale: -0.6 },
  'Young Adult':                 { youth: 3, interior: 1, scale: -0.1 },
  // ---- films and series (shared vocabulary + series-only labels)
  'Action & Adventure':          { violence: 3, journey: 1, scale: 0.4 },
  'Sci-Fi & Fantasy':            { future: 2, wonder: 3, scale: 0.7 },
  'Drama':                       { interior: 3, moral: 2, tone: -0.3, scale: -0.4 },
  'Documentary':                 { system: 3, history: 2, moral: 2, tone: -0.3, scale: 0.3 },
  'Horror ':                     { uncanny: 3, confine: 2, tone: -0.8, scale: -0.3 },
  'Comedy':                      { tone: 0.7, scale: -0.4 },
  'Crime':                       { deduction: 2, violence: 2, system: 1, tone: -0.4, scale: -0.1 },
  'Animation':                   { wonder: 2, youth: 2, tone: 0.5, scale: 0 },
  'War & History':               { history: 3, violence: 3, system: 2, moral: 2, tone: -0.6, scale: 0.7 },
  'Musical & Music':             { making: 3, tone: 0.5, scale: -0.2 },
  'Thriller & Mystery':          { deduction: 3, confine: 2, tone: -0.3, scale: -0.1 },
  'Anime':                       { wonder: 3, youth: 2, scale: 0.4 },
  'Reality & Competition':       { making: 1, tone: 0.5, scale: -0.3 },
  'Kids & Family':               { youth: 3, wonder: 2, tone: 0.9, scale: -0.4 },
  'Limited Series':              { moral: 2, interior: 2, deduction: 1, tone: -0.3, scale: -0.1 },
  'Crime & Mystery':             { deduction: 3, violence: 2, tone: -0.4, scale: -0.1 },
};
// 'Horror' is shared by books, films and series; the stray key above with a
// trailing space would never match. Fold it in and delete it.
GENRE_PRIOR.Horror = { uncanny: 3, confine: 2, violence: 2, tone: -0.8, scale: -0.3 };
delete GENRE_PRIOR['Horror '];

/* Lexicons. Prefix matching was tried and abandoned: at five characters
   "colonial" and "colony" are the same word, which filed a Chernobyl documentary
   beside a game about cats founding a colony. Matching is exact, against
   pre-expanded inflections. */
const SEEDS = {
  moral: 'moral complicity complicit guilt guilty conscience agonizing reckoning atrocity culpable betrayal testimony witness injustice systemic unbearable sacrifice forgiveness redemption consequence blame responsibility shame remorse',
  interior: 'memory memories consciousness mind psyche identity self loneliness solitude longing doubt faith meditation reflection confession diary journal narrates recounts remembers obsession delusion madness unreliable interior inward introspective',
  system: 'empire state government bureaucracy bureaucrat clerk institution corporate corporation capitalism economy industry colonial occupation regime dictatorship fascism revolution class inequality racism policy court trial prison police surveillance propaganda military censorship',
  uncanny: 'strange surreal uncanny dreamlike hallucination eerie unsettling bizarre inexplicable impossible liminal distorted haunting spectral cosmic unknowable ambiguous cryptic labyrinth doppelganger nightmare apparition',
  youth: 'teenage teenager adolescent schoolgirl schoolboy student childhood youth college graduate apprentice classmate preschool',
  deduction: 'investigation investigates detective clue uncovers deciphers unravels puzzle riddle evidence testimony documents suspect mystery reconstructs',
  making: 'building crafting cultivate manage managing farm cook chef restore repair tend design bakery workshop garden orchestra kitchen',
  journey: 'journey wanders treks pilgrimage voyage odyssey decades generations saga expedition migration road caravan',
  confine: 'trapped besieged stranded locked isolated hostage siege confined claustrophobic quarantine bunker island lighthouse',
  violence: 'war soldier gun kill killer murder blood violence battle combat weapon assassin revenge vengeance massacre army warrior gang torture',
  wonder: 'magic magical marvel myth mythic enchanted spirit ghost god dragon witch wizard fairy curse miracle prophecy legend demon',
  history: 'century medieval victorian ancient wartime postwar samurai roman soviet nazi dynasty renaissance frontier feudal plantation slavery',
  // Deliberately narrow. An earlier cut had science, colony, nuclear and
  // experiment here; the axis became a magnet that dragged a border-checkpoint
  // game toward a gynaecology book because both blurbs mentioned science.
  // "dystopian" lived here too and was just as wrong — a dystopia is a statement
  // about an oppressive structure, not about spaceships, and it was pulling
  // Papers, Please toward WALL-E.
  future: 'space alien robot spaceship planet cyber android galaxy interstellar clone virtual simulation orbit martian cyberpunk',
};
SEEDS.system += ' dystopia dystopian totalitarian authoritarian border checkpoint passport permit document paperwork official ministry informant lie cover-up negligence scandal inquiry whistleblower';
SEEDS.deduction += ' secret secrets hidden riddle cipher archive';

/* Tone is signed and lexical on both ends, because a genre prior cannot see it:
   film Comedy scores 17% on the bleak lexicon (comedies say "murders eight
   relatives") — higher than film Crime at 8%. */
const WARM = 'charming delightful whimsical cosy cozy gentle warmth heartwarming wholesome quirky playful sweet joyful cheerful relaxing peaceful idyllic kindness comfort lighthearted romp jaunty tender hopeful funny comic hilarious';
const GRIM = 'bleak grim brutal despair grief dying death mourning ruin decay collapse cruel harrowing desolate misery suffering doomed tragedy tragic disaster catastrophe devastated trauma unbearable dread nightmare savage bitter';
const EPIC = 'epic sprawling vast sweeping colossal continent galaxy interstellar civilization centuries decades generations dynasty saga kingdom empire';
const SMALL = 'quiet small intimate village neighbourhood apartment household domestic everyday ordinary mundane';

function inflect(w) {
  const out = new Set([w]);
  if (/[^aeiou]y$/.test(w)) out.add(w.slice(0, -1) + 'ies');
  else if (/(s|x|z|ch|sh)$/.test(w)) out.add(w + 'es');
  else out.add(w + 's');
  if (w.endsWith('e')) { out.add(w + 'd'); out.add(w.slice(0, -1) + 'ing'); }
  else { out.add(w + 'ed'); out.add(w + 'ing'); }
  out.add(w + 'ly');
  return out;
}
const expand = (str) => {
  const set = new Set();
  for (const w of str.split(/\s+/).filter(Boolean)) for (const f of inflect(w)) set.add(f);
  return set;
};
const SEED_SET = AXES.map((a) => expand(SEEDS[a] || ''));
const WARM_SET = expand(WARM), GRIM_SET = expand(GRIM);
const EPIC_SET = expand(EPIC), SMALL_SET = expand(SMALL);

/* Game-register jargon. These terms are 100% games / 0% everything else, so they
   can never bridge — they only add noise and make games cluster with games. */
const JARGON = new Set(('shooter rpg rpgs sim sims coop turnbased roguelike roguelite tactical tactics openworld '
  + 'platformer metroidvania sandbox rts racer multiplayer singleplayer arcade mode modes branching campaign '
  + 'sequel prequel remake remaster remastered deckbuilder soulslike fps tps mmo moba dlc expansion gameplay '
  + 'mechanics respec loadout hitbox questline grindy microtransactions').split(/\s+/));

const STOP = new Set(('a an the and or of in on to with for from as by into across that where is are was were his her '
  + 'its their this at after before over under out up down it he she they them who what when how but not no all one '
  + 'two his her s t through then than each its own more most other some such only same so very can will just').split(/\s+/));

const tok = (s) => (s || '').toLowerCase().match(/[a-z]+/g) || [];
const contentWords = (item) =>
  tok(item.blurb).filter((w) => w.length > 2 && !STOP.has(w) && !JARGON.has(w));

/* ---------------------------------------------------------------- weighting */

const GENRE_W = 0.42;  // a floor that keeps an item from floating, never a vote
const BLURB_W = 2.30;  // words the author actually chose outrank a category default
const RARE_W  = 0.85;
const QUAL_W  = 0.10;  // tiebreaker among already-similar items
const SCALE_W = 0.30;
const MIN_SIM = 0.22;  // below this we show nothing rather than pad

let AXIS_IDF = new Array(AXES.length).fill(1);

function rawParts(item) {
  const g = new Array(AXES.length).fill(0);
  const b = new Array(AXES.length).fill(0);
  const prior = GENRE_PRIOR[item.genre];
  if (prior) for (const a in prior) if (AI[a] != null) g[AI[a]] += prior[a];
  for (const w of contentWords(item)) {
    for (let a = 0; a < SEED_SET.length; a++) if (SEED_SET[a].has(w)) b[a] += 1;
  }
  // A year written into the blurb ("The 1986 nuclear disaster", "1970s Mexico
  // City") is among the strongest period signals in the corpus.
  // Half a hit, not a whole one: at full strength a single date outvoted
  // everything else in the sentence, which filed Chernobyl beside Wolfenstein
  // purely because both mention a decade.
  if (/\b(1[0-9]\d\d|20[0-2]\d)s?\b/.test(item.blurb || '')) b[AI.history] += 0.5;
  return { g, b };
}

/* Learned word -> axis profiles, filled in below.
 *
 * Hand lexicons alone leave the vector far too spiky: a blurb has ~9 content
 * words and a lexicon catches one or two, so whichever axis happens to fire owns
 * the item outright. That is how Outer Wilds — one word, "cosmic" — ended up
 * beside Uncut Gems, and how a 1986 date filed Chernobyl next to Resident Evil 7
 * on the strength of "history" alone.
 *
 * So instead of extending the word lists forever, the 60 genre judgements are
 * used as SUPERVISION. Every word takes the average axis profile of the items it
 * appears in, minus the corpus baseline — what the word tells you over and above
 * base rates. That is 6,217 labelled examples doing the work, it covers the whole
 * vocabulary rather than the part I thought to list, and every one of the nine
 * content words now contributes instead of at most two. */
const learned = new Map();
const LEARN_W = 1.45;
const SHRINK = 8;   // a word seen 3 times is evidence; it is not 30 times' worth

function facetVector(item) {
  const { g, b } = rawParts(item);
  const v = new Array(AXES.length).fill(0);
  for (let k = 0; k < v.length; k++) {
    // sqrt damping: a blurb saying "war" three times is not three times as
    // martial, and undamped one repeated word owns the vector.
    v[k] = GENRE_W * Math.sqrt(Math.max(0, g[k])) + BLURB_W * Math.sqrt(b[k]);
  }
  for (const w of contentWords(item)) {
    const lv = learned.get(w);
    if (lv) for (let k = 0; k < v.length; k++) v[k] += LEARN_W * lv[k];
  }
  for (let k = 0; k < v.length; k++) v[k] = Math.max(0, v[k]) * AXIS_IDF[k];
  return v;
}

/** Signed scalars, -1..1: genre prior, plus an explicit lexicon, plus what the
 *  corpus has learned about each word. */
const learnedTone = new Map();
const learnedScale = new Map();
const TONE_LEARN_W = 1.3;

function toneOf(item) {
  let t = 0, l = 0;
  for (const w of contentWords(item)) {
    if (WARM_SET.has(w)) t += 1;
    if (GRIM_SET.has(w)) t -= 1;
    const lt = learnedTone.get(w);
    if (lt) l += lt;
  }
  const prior = GENRE_PRIOR[item.genre];
  const base = prior && prior.tone != null ? prior.tone : 0;
  return Math.max(-1, Math.min(1, base + t * 0.55 + TONE_LEARN_W * l));
}
function scaleOf(item) {
  let s = 0, l = 0;
  for (const w of contentWords(item)) {
    if (EPIC_SET.has(w)) s += 1;
    if (SMALL_SET.has(w)) s -= 1;
    const ls = learnedScale.get(w);
    if (ls) l += ls;
  }
  const prior = GENRE_PRIOR[item.genre];
  const base = prior && prior.scale != null ? prior.scale : 0;
  return Math.max(-1, Math.min(1, base + s * 0.45 + TONE_LEARN_W * l));
}

function norm(v) {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s);
  return s ? v.map((x) => x / s) : v;
}

/* --------------------------------------------------------------- features */

const vecs = new Array(N), rare = new Array(N), scores = new Array(N);
const tones = new Array(N), scales = new Array(N);
const titleKey = new Array(N), baseKey = new Array(N), maker = new Array(N);

const df = new Map();
for (let i = 0; i < N; i++) for (const w of new Set(contentWords(items[i]))) df.set(w, (df.get(w) || 0) + 1);

{
  const hits = new Array(AXES.length).fill(0);
  for (const it of items) {
    const { g, b } = rawParts(it);
    for (let k = 0; k < AXES.length; k++) if (g[k] || b[k]) hits[k] += 1;
  }
  // An axis firing on a sixth of the shelf says far less than one firing on a
  // twentieth; untreated, the common axes dominate every cosine.
  AXIS_IDF = hits.map((h) => Math.log(N / Math.max(1, h)) / Math.log(20));
}

/* Learn word -> axis from the genre labels. */
{
  const genreVec = (item) => {
    const v = new Array(AXES.length).fill(0);
    const p = GENRE_PRIOR[item.genre];
    if (p) for (const a in p) if (AI[a] != null) v[AI[a]] = p[a];
    return norm(v);
  };
  const baseline = new Array(AXES.length).fill(0);
  const gv = items.map((it) => {
    const v = genreVec(it);
    for (let k = 0; k < v.length; k++) baseline[k] += v[k] / N;
    return v;
  });

  const sums = new Map();
  for (let i = 0; i < N; i++) {
    for (const w of new Set(contentWords(items[i]))) {
      let s = sums.get(w);
      if (!s) { s = { n: 0, v: new Array(AXES.length).fill(0) }; sums.set(w, s); }
      s.n += 1;
      for (let k = 0; k < AXES.length; k++) s.v[k] += gv[i][k];
    }
  }
  for (const [w, s] of sums) {
    // Words appearing once carry no evidence, and words appearing everywhere
    // carry no information — both are excluded rather than shrunk to noise.
    if (s.n < 3 || s.n > N * 0.05) continue;
    const shrink = s.n / (s.n + SHRINK);
    const v = new Array(AXES.length);
    for (let k = 0; k < AXES.length; k++) v[k] = (s.v[k] / s.n - baseline[k]) * shrink;
    learned.set(w, v);
  }
  console.log('  learned axis profiles for ' + learned.size + ' words from ' + N + ' genre-labelled items');

  /* Tone and scale are learned the same way, and for the same reason the axes
     are. Left purely to hand lexicons plus a genre prior, Hades came out WARM —
     its blurb is nearly all jargon, so nothing matched, and "Indie / Platformer"
     carries a cheerful default. It was being recommended alongside Schitt's Creek
     and Flight of the Conchords. Words like underworld, dungeon and escaping
     occur overwhelmingly in grim company, and the corpus already knows that. */
  let tb = 0, sb = 0;
  const tone1 = items.map((it) => { const p = GENRE_PRIOR[it.genre]; return p && p.tone != null ? p.tone : 0; });
  const scale1 = items.map((it) => { const p = GENRE_PRIOR[it.genre]; return p && p.scale != null ? p.scale : 0; });
  for (let i = 0; i < N; i++) { tb += tone1[i] / N; sb += scale1[i] / N; }

  const acc = new Map();
  for (let i = 0; i < N; i++) {
    for (const w of new Set(contentWords(items[i]))) {
      let a = acc.get(w);
      if (!a) { a = { n: 0, t: 0, s: 0 }; acc.set(w, a); }
      a.n += 1; a.t += tone1[i]; a.s += scale1[i];
    }
  }
  for (const [w, a] of acc) {
    if (a.n < 3 || a.n > N * 0.05) continue;
    const shrink = a.n / (a.n + SHRINK);
    learnedTone.set(w, (a.t / a.n - tb) * shrink);
    learnedScale.set(w, (a.s / a.n - sb) * shrink);
  }
}

const normTitle = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const baseTitle = (t) => normTitle(t).replace(/^(the|a|an) /, '').split(/ (?:vol|volume|part|book|season|episode) /)[0]
  .split(':')[0].replace(/\s+\d+$/, '').trim();

for (let i = 0; i < N; i++) {
  const it = items[i];
  vecs[i] = norm(facetVector(it));
  tones[i] = toneOf(it);
  scales[i] = scaleOf(it);
  // Rare = present in 2..40 docs. Below 2 it can never match; above 40 it is a
  // genre word wearing a disguise.
  rare[i] = new Set(contentWords(it).filter((w) => { const d = df.get(w); return d >= 2 && d <= 40; }));
  scores[i] = it.kind === 'books'
    ? (it.rating != null ? (it.rating / 5) * 100 : null)
    : (it.metacritic != null ? it.metacritic : null);
  titleKey[i] = normTitle(it.title);
  baseKey[i] = baseTitle(it.title);
  maker[i] = normTitle(it.author || it.creator || '');
}

const inv = new Map();
for (let i = 0; i < N; i++) for (const w of rare[i]) {
  if (!inv.has(w)) inv.set(w, []);
  inv.get(w).push(i);
}

/* --------------------------------------------------------- adaptation map */

/* Left alone, adaptations own slot 1 for about a hundred of the most-browsed
   items — a naive metric ranks the Dune book against the Dune film at 2.5x the
   next hit. That is not a recommendation, it is the same story again. Suppress
   from the neighbour list and surface separately, because it IS worth knowing. */
const byBase = new Map();
for (let i = 0; i < N; i++) {
  if (!baseKey[i]) continue;
  if (!byBase.has(baseKey[i])) byBase.set(baseKey[i], []);
  byBase.get(baseKey[i]).push(i);
}
const adaptations = {};
for (const [, group] of byBase) {
  if (group.length < 2) continue;
  const kinds = new Set(group.map((i) => items[i].kind));
  if (kinds.size < 2) continue;                     // same-medium duplicates are not adaptations
  for (const i of group) {
    const others = group.filter((j) => j !== i && items[j].kind !== items[i].kind);
    if (others.length) adaptations[i] = others.slice(0, 4);
  }
}

/* Compared on every one of 38.6M pairs, so it must be O(1). An earlier version
   walked the two titles character by character and turned a 7-second build into
   a multi-minute one; the shared-prefix test is precomputed instead. */
const pre8 = new Array(N);
for (let i = 0; i < N; i++) pre8[i] = titleKey[i].slice(0, 8);

function relatedTitles(i, j) {
  return titleKey[i] === titleKey[j]
    || (baseKey[i] !== '' && baseKey[i] === baseKey[j])
    // Franchise families: Batman: Arkham City vs Batman: Year One.
    || (pre8[i].length === 8 && pre8[i] === pre8[j]);
}

/* ------------------------------------------------------------------ scoring */

const K_PER_MEDIUM = 3;
const MIN_QUALITY = 60;
const MIN_RATINGS = 250;   // do not send anyone toward a book nobody can find

function pairScore(i, j, rareShared) {
  let sim = 0;
  const a = vecs[i], b = vecs[j];
  for (let k = 0; k < a.length; k++) sim += a[k] * b[k];

  if (rareShared) sim += RARE_W * Math.min(rareShared, 3) / 3;
  sim -= SCALE_W * Math.abs(scales[i] - scales[j]);

  const sj = scores[j];
  if (sj != null) sim += QUAL_W * ((sj - 60) / 40);

  /* Tone is a near-veto, and multiplicative rather than subtractive on purpose.
     Two things can share every topic word and share no readers: The Road and a
     charming post-apocalyptic crafting game are both about surviving the end of
     the world. Cosine cannot see the clash — both vectors are non-negative, so
     opposite tones merely fail to add. */
  const gap = Math.abs(tones[i] - tones[j]);
  sim *= Math.max(0, 1 - 0.62 * gap * gap);

  return sim;
}

function sharedAxis(i, j) {
  let best = -1, bestVal = 0;
  for (let k = 0; k < AXES.length; k++) {
    const v = Math.min(vecs[i][k], vecs[j][k]);
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return best;
}

/* A note on what did NOT work, so it is not tried again.
 *
 * The first attempt at the hub problem was a hubness correction: charge each
 * item for its mean similarity to a probe sample, on the standard theory that
 * hubs sit near the data centroid. It made things measurably worse — the worst
 * hub went from 537 inbound recommendations to 646 — because the theory does not
 * describe this corpus. Rhythm + Flow is not a bland central point; it is a
 * near-pure exemplar of `making`, the most frequently cited axis, so its mean
 * similarity to random items is LOW and the correction paid it a bonus.
 *
 * The hubs here are canonical, not average. That calls for a capacity limit
 * rather than a similarity penalty. */
const eligible = new Array(N);
for (let j = 0; j < N; j++) {
  eligible[j] = scores[j] != null && scores[j] >= MIN_QUALITY
    && !(items[j].kind === 'books' && items[j].ratingsCount != null && items[j].ratingsCount < MIN_RATINGS);
}

/* Capacity: no item may be recommended more than this many times across the whole
   catalogue. With 55,953 slots over 6,217 items the mean is 9, so 40 still lets a
   genuinely central work be four times more recommended than average — it just
   stops one music-competition show from occupying 646 slots while 31% of the
   shelf is recommended to nobody. */
const CAP = 40;
const inbound = new Int32Array(N);

const neighbours = new Array(N);
let thin = 0;
let capped = 0;

/* Candidates are gathered wider than needed, then assigned under the cap. The
   order is interleaved across the four media rather than games-first, so no
   medium gets systematically first pick of the shared budget. */
const WIDE = 8;
const order = [];
{
  const cursors = KINDS.map((k) => ({ at: offsets[k], end: offsets[k] + SETS[k].length }));
  let left = N;
  while (left > 0) {
    for (const c of cursors) if (c.at < c.end) { order.push(c.at++); left--; }
  }
}

for (const i of order) {
  const shared = new Map();
  for (const w of rare[i]) for (const j of inv.get(w)) if (j !== i) shared.set(j, (shared.get(j) || 0) + 1);

  /* A bounded insert per medium rather than collect-then-sort. Pushing every
     candidate and sorting turned the build into a 43-second job; only nine
     survive, so only nine are ever held. */
  const top = {};
  for (const k of KINDS) top[k] = [];
  const offer = (arr, j, s) => {
    if (arr.length === WIDE && s <= arr[arr.length - 1][1]) return;
    let p = arr.length;
    while (p > 0 && arr[p - 1][1] < s) p--;
    arr.splice(p, 0, [j, s]);
    if (arr.length > WIDE) arr.pop();
  };

  for (let j = 0; j < N; j++) {
    const kj = items[j].kind;
    if (kj === items[i].kind) continue;              // cross-medium only: the point of the thing
    if (!eligible[j]) continue;
    if (relatedTitles(i, j)) continue;               // adaptations go in their own map
    if (maker[i] && maker[i] === maker[j]) continue; // same author is a fact, not a taste match
    const s = pairScore(i, j, shared.get(j) || 0);
    if (s >= MIN_SIM) offer(top[kj], j, s);
  }

  const picked = [];
  for (const k of KINDS) {
    if (k === items[i].kind) continue;
    let taken = 0;
    for (const [j] of top[k]) {
      if (taken === K_PER_MEDIUM) break;
      if (inbound[j] >= CAP) { capped++; continue; }   // already carrying its share
      inbound[j] += 1;
      picked.push([j, sharedAxis(i, j)]);
      taken++;
    }
  }
  /* Roughly a quarter of game blurbs are pure mechanics with no appeal content
     ("Sequel platform fighter adding a slime meter"). Those items genuinely have
     no cross-medium neighbours, and showing three anyway would be inventing
     them. Fewer honest rows beat nine confident wrong ones. */
  if (picked.length < 3) thin++;
  neighbours[i] = picked;

  if (i % 1000 === 0) process.stdout.write('  scoring ' + i + '/' + N + '\r');
}

/* ------------------------------------------------------------------ packing */

/* Fixed-width base36: three characters for the global index (36^3 = 46,656, well
   above 6,217) and one for the axis. A flat delimiter-free string is about a
   third the size of the equivalent JSON array of numbers and decodes by slice. */
function b36(n, w) { return n.toString(36).padStart(w, '0'); }

const STRIDE = K_PER_MEDIUM * 3;
let packed = '';
for (let i = 0; i < N; i++) {
  const row = neighbours[i];
  for (let s = 0; s < STRIDE; s++) {
    const e = row[s];
    packed += e ? b36(e[0], 3) + b36(e[1] + 1, 1) : '0000';
  }
}

const out = {
  built: new Date().toISOString().slice(0, 10),
  kinds: KINDS,
  offsets,
  counts: KINDS.reduce((o, k) => { o[k] = SETS[k].length; return o; }, {}),
  axes: AXES,
  phrases: AXIS_PHRASE,
  stride: STRIDE,
  n: packed,
  adapt: adaptations,
};

fs.mkdirSync('data', { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync('data/similar.json', json);

/* ------------------------------------------------------------------ report */

const kb = Math.round(Buffer.byteLength(json) / 1024);
const filled = neighbours.reduce((a, r) => a + r.length, 0);
console.log('  similar.json'.padEnd(22) + N + ' items, ' + kb + ' KB');
console.log('  neighbours filled'.padEnd(22) + filled + ' of ' + N * STRIDE + ' slots ('
  + Math.round(filled / (N * STRIDE) * 100) + '%)');
console.log('  items with <3 neighbours'.padEnd(22) + thin + ' (' + Math.round(thin / N * 100)
  + '%) — shown as "nothing close enough" rather than padded');
console.log('  adaptations mapped'.padEnd(22) + Object.keys(adaptations).length);

const missing = [...new Set(items.filter((x) => !GENRE_PRIOR[x.genre]).map((x) => x.kind + ':' + x.genre))];
if (missing.length) {
  console.log('  !! genres with no prior: ' + missing.join(', '));
  process.exitCode = 1;
} else {
  console.log('  every genre has a prior, so every item has a position');
}
