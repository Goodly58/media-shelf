/* Assemble the four catalogue files from the source caches.

   A score is written only if it came from its source: fetched by this
   pipeline, or confirmed against the source by an earlier verification pass
   (and not yet re-fetched). Anything else is dropped, so every number on the
   site traces back to IMDb, Metacritic, Rotten Tomatoes, Steam or Goodreads. */
import { loadCache, readData, writeData, fold, decode, log } from './lib.mjs';
import { matchScreen } from './metacritic.mjs';
import { loadEpisodes } from './imdb.mjs';


export function slugify(s) {
  return decode(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
/* ------------------------------------------------------------- tags */

const GENERIC = new Set(('drama comedy action adventure thriller horror fantasy sci-fi animation animated documentary family ' +
  'musical music war western crime mystery romance romantic biographical biography historical history sport sports short ' +
  'television feature comedy-drama drama comedy science fiction film reality reality television news talk show game show ' +
  'adaptation literary adaptation film adaptation black-and-white color 3d children television special variety ' +
  'action-adventure action adventure suspense melodrama').split(' '));
const GENERIC_PHRASES = new Set(['science fiction', 'comedy drama', 'drama comedy', 'action adventure', 'reality television',
  'talk show', 'game show', 'film based on literature', 'film based on a novel', 'film based on a book', 'based on a novel',
  'film based on a play', 'film based on a short story', 'black and white', 'feature', 'television special',
  'film adaptation', 'literary adaptation', 'action thriller', 'crime drama', 'war drama', 'historical drama', 'sports drama',
  'teen drama', 'drama television', 'comedy television', 'animated television', 'animated', 'adult animated',
  'computer animated', 'traditionally animated', 'live action', 'live-action', 'serial', 'web', 'miniseries', 'mini-series',
  'limited', 'anthology television', 'fiction', 'nonfiction', 'non-fiction', 'genre', 'remake', 'sequel', 'prequel', 'spin-off']);
const RENAME = {
  'lgbt-related': 'LGBTQ', 'lgbtq-related': 'LGBTQ', 'lgbt': 'LGBTQ', 'lgbtq': 'LGBTQ', 'lgbtqia+': 'LGBTQ',
  'children s': 'Kids', 'childrens': 'Kids', "children's": 'Kids', 'teen': 'Teen', 'anime': 'Anime',
  'independent': 'Indie', 'art': 'Arthouse', 'silent': 'Silent', 'neo-noir': 'Neo-Noir', 'film noir': 'Film Noir', 'noir': 'Film Noir',
  'black comedy': 'Dark Comedy', 'comedy horror': 'Horror Comedy', 'science fiction comedy': 'Sci-Fi Comedy',
  'science fiction action': 'Sci-Fi Action', 'science fiction horror': 'Sci-Fi Horror', 'christmas': 'Christmas',
  'coming-of-age': 'Coming of Age', 'coming of age': 'Coming of Age', 'superhero': 'Superhero', 'film based on comics': 'Comic Book',
  'film based on a comic': 'Comic Book', 'comic book': 'Comic Book', 'film based on a video game': 'Video Game Adaptation',
  'film based on actual events': 'True Story', 'based on actual events': 'True Story', 'docudrama': 'True Story',
  'true crime': 'True Crime', 'police procedural': 'Police Procedural', 'medical drama': 'Medical', 'legal drama': 'Legal',
  'prime time soap opera': 'Soap', 'soap opera': 'Soap', 'stand-up comedy': 'Stand-Up', 'sketch comedy': 'Sketch Comedy',
  'mockumentary': 'Mockumentary', 'sitcom': 'Sitcom', 'animated sitcom': 'Animated Sitcom', 'nature documentary': 'Nature',
  'post-apocalyptic': 'Post-Apocalyptic', 'dystopian': 'Dystopian', 'cyberpunk': 'Cyberpunk', 'space opera': 'Space Opera',
  'found footage': 'Found Footage', 'slasher': 'Slasher', 'zombie': 'Zombie', 'vampire': 'Vampire', 'heist': 'Heist',
  'spy': 'Spy', 'martial arts': 'Martial Arts', 'kaiju': 'Kaiju', 'disaster': 'Disaster', 'monster': 'Monster',
  'psychological thriller': 'Psychological Thriller', 'psychological horror': 'Psychological Horror',
  'supernatural horror': 'Supernatural Horror', 'supernatural': 'Supernatural', 'folk horror': 'Folk Horror',
  'body horror': 'Body Horror', 'gothic horror': 'Gothic Horror', 'erotic thriller': 'Erotic Thriller',
  'political thriller': 'Political Thriller', 'legal thriller': 'Legal Thriller', 'conspiracy': 'Conspiracy',
  'gangster': 'Gangster', 'crime thriller': 'Crime Thriller', 'romantic comedy': 'Romantic Comedy',
  'romantic drama': 'Romantic Drama', 'period drama': 'Period Drama', 'costume drama': 'Period Drama', 'epic': 'Epic',
  'swashbuckler': 'Swashbuckler', 'sword and sorcery': 'Sword and Sorcery', 'high fantasy': 'High Fantasy',
  'dark fantasy': 'Dark Fantasy', 'urban fantasy': 'Urban Fantasy', 'fairy tale': 'Fairy Tale', 'road': 'Road Movie',
  'buddy': 'Buddy', 'buddy cop': 'Buddy Cop', 'satire': 'Satire', 'political satire': 'Satire', 'parody': 'Parody',
  'slapstick': 'Slapstick', 'screwball comedy': 'Screwball', 'teen comedy': 'Teen Comedy', 'sex comedy': 'Sex Comedy',
  'action comedy': 'Action Comedy', 'crime comedy': 'Crime Comedy', 'fantasy comedy': 'Fantasy Comedy', 'giallo': 'Giallo',
  'exploitation': 'Exploitation', 'splatter': 'Splatter', 'spaghetti western': 'Spaghetti Western', 'samurai': 'Samurai',
  'jidaigeki': 'Samurai', 'wuxia': 'Wuxia', 'jukebox musical': 'Jukebox Musical', 'dance': 'Dance', 'concert': 'Concert',
  'stop-motion': 'Stop-Motion', 'stop motion': 'Stop-Motion', 'adult animation': 'Adult Animation', 'experimental': 'Experimental',
  'avant-garde': 'Experimental', 'telenovela': 'Telenovela', 'k-drama': 'K-Drama', 'korean drama': 'K-Drama', 'anthology': 'Anthology',
  'time travel': 'Time Travel', 'alien invasion': 'Alien Invasion', 'mecha': 'Mecha', 'isekai': 'Isekai', 'shōnen': 'Shonen',
  'shonen': 'Shonen', 'shōjo': 'Shojo', 'seinen': 'Seinen', 'slice of life': 'Slice of Life', 'iyashikei': 'Slice of Life',
  'magical girl': 'Magical Girl', 'cooking': 'Cooking', 'travel': 'Travel', 'historical fiction': 'Period Drama',
  'war film': null, 'erotic': 'Erotic', 'cult': 'Cult', 'b movie': 'B-Movie', 'monster movie': 'Monster', 'creature feature': 'Monster',
  'action horror': 'Action Horror', 'survival': 'Survival', 'survival horror': 'Survival', 'techno-thriller': 'Techno-Thriller',
  'military science fiction': 'Military Sci-Fi', 'hard science fiction': 'Hard Sci-Fi', 'soft science fiction': null,
  'family drama': 'Family Drama', 'social drama': 'Social Drama', 'political drama': 'Political Drama', 'courtroom drama': 'Legal',
  'prison': 'Prison', 'boxing': 'Boxing', 'heist comedy': 'Heist', 'hood': 'Hood', 'mumblecore': 'Mumblecore',
  'mystery thriller': null, 'whodunit': 'Whodunit', 'detective fiction': 'Detective', 'detective': 'Detective',
  'police': 'Police', 'teen horror': 'Teen Horror', 'natural horror': 'Creature', 'religious': 'Religious', 'christian': 'Religious',
  'biblical': 'Religious', 'surrealist': 'Surreal', 'surrealism': 'Surreal', 'magic realism': 'Magic Realism', 'magical realism': 'Magic Realism',
};

export function cleanTag(label) {
  let s = decode(label).toLowerCase().trim();
  if (s in RENAME) return RENAME[s];
  s = s.replace(/\b(television|tv) (series|program|programme|drama|comedy|show)s?\b/g, (m, a, b) => (b === 'drama' || b === 'comedy') ? b : '')
    .replace(/\b(feature )?(films?|movies?)\b/g, '').replace(/\bseries\b$/g, '').replace(/\s+/g, ' ').trim();
  if (s in RENAME) return RENAME[s];
  if (!s || GENERIC.has(s) || GENERIC_PHRASES.has(s)) return null;
  if (/^film based on|^based on|^films? about|adaptation of|^works? |^television series based/.test(s)) return null;
  if (s.length > 28 || s.split(' ').length > 3) return null;
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/* Wikidata's broad genres, in IMDb's names. IMDb's dataset now lists some
   titles under a single genre (Batman Begins is only "Crime"), so these
   fill the gaps that would otherwise hide a film from a genre filter. */
const BROAD = {
  action: 'Action', adventure: 'Adventure', animated: 'Animation', animation: 'Animation', biographical: 'Biography',
  comedy: 'Comedy', crime: 'Crime', documentary: 'Documentary', drama: 'Drama', family: 'Family', fantasy: 'Fantasy',
  historical: 'History', 'history': 'History', horror: 'Horror', musical: 'Musical', music: 'Music', mystery: 'Mystery',
  romance: 'Romance', romantic: 'Romance', 'science fiction': 'Sci-Fi', sports: 'Sport', sport: 'Sport',
  thriller: 'Thriller', war: 'War', western: 'Western', 'film noir': 'Film-Noir', superhero: 'Action',
  'action-adventure': 'Adventure', 'romantic comedy': 'Romance', 'comedy-drama': 'Comedy', 'comedy drama': 'Comedy',
  'crime thriller': 'Thriller', 'psychological thriller': 'Thriller', 'horror comedy': 'Horror', 'slasher': 'Horror',
  'supernatural horror': 'Horror', 'psychological horror': 'Horror', 'science fiction horror': 'Horror',
  'spy': 'Thriller', 'heist': 'Crime', 'gangster': 'Crime', 'neo-noir': 'Crime', 'war drama': 'War', 'sitcom': 'Comedy',
  'police procedural': 'Crime', 'teen drama': 'Drama', 'medical drama': 'Drama', 'legal drama': 'Drama',
};
export function broadGenres(labels) {
  const out = [];
  for (const raw of labels || []) {
    const s = decode(raw).toLowerCase().replace(/\b(television|tv) (series|program|programme|show)s?\b/g, '')
      .replace(/\b(feature )?(films?|movies?)\b/g, '').replace(/\s+/g, ' ').trim();
    const g = BROAD[s];
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/* -------------------------------------------------------------- screen */

export async function mergeScreen(prevMovies, prevShows) {
  const selected = loadCache('imdb-selected', []);
  const wd = loadCache('wikidata');
  const images = loadCache('images');
  const tvmaze = loadCache('tvmaze');
  const rt = { ...loadCache('rt-b'), ...loadCache('rt') };
  const mcMovies = loadCache('mc-movies', []);
  const mcTv = loadCache('mc-tv', []);
  const prev = {};
  for (const r of [...prevMovies, ...prevShows]) prev[r.id] = r;

  const films = selected.filter((t) => t.kind === 'movies');
  const series = selected.filter((t) => t.kind === 'shows');
  const mcFilm = matchScreen(films, mcMovies, wd, 'movie');
  const mcShow = matchScreen(series, mcTv, wd, 'tv');
  const eps = await loadEpisodes(new Set(series.map((t) => t.id)));

  const build = (t, mc) => {
    const o = prev[t.id] || {};
    const known = Boolean(wd[t.id]);
    const w = wd[t.id] || {};
    const m = mc.get(t.id);
    const r = rt[t.id];
    const wikiImg = images[t.id]?.img ? images[t.id].img.split('?')[0] : null;
    const row = {
      id: t.id,
      title: t.title,
      alt: t.original && fold(t.original) !== fold(t.title) ? t.original : null,
      year: t.year,
      runtime: t.runtime,
      // Without a Wikidata answer this run, keep what the last run derived from it.
      // IMDb's genres are curated; Wikidata over-tags (it files Memento as horror). So
      // Wikidata only fills in where IMDb gives a single genre, and adds at most two.
      genres: (t.genres.length > 1 ? t.genres
        : known ? [...new Set([...t.genres, ...broadGenres(w.genres).slice(0, 2)])]
        : [...new Set([...t.genres, ...(o.genres || [])])]).filter((g) => g !== 'Short' && g !== 'News').slice(0, 3),
      tags: known ? [...new Set((w.genres || []).map(cleanTag).filter(Boolean))] : (o.tags || []),
      by: (t.kind === 'movies' ? (t.directors || []).slice(0, 2).join(', ')
        : known && w.creators && w.creators.length ? w.creators.slice(0, 2).join(', ') : (o.by || (t.directors || []).slice(0, 2).join(', '))) || null,
      imdb: t.imdb, votes: t.votes,
      mc: null, mcN: null, mcSlug: null,
      rt: null, rtN: null, rtPath: null,
      // Series: TVmaze's portrait art first; Wikipedia's lead image is often a logo.
      img: (t.kind === 'shows' && (tvmaze[t.id]?.img || (/tvmaze/.test(o.img || '') ? o.img : null))) || wikiImg || o.img || null,
      wiki: w.wiki || o.wiki || null,
      blurb: o.blurb || null,
    };
    if (m) { row.mc = m.score; row.mcN = m.n; row.mcSlug = m.slug; }
    else if (o.mc != null) { row.mc = o.mc; row.mcN = o.mcN || null; row.mcSlug = o.mcSlug || null; }
    if (r) {
      if (!r.missing && !r.mismatch && r.score != null) { row.rt = r.score; row.rtN = r.n; row.rtPath = r.path; }
    } else if (o.rt != null) { row.rt = o.rt; row.rtN = o.rtN || null; row.rtPath = o.rtPath || null; }
    if (t.kind === 'shows') {
      row.end = t.end;
      row.mini = t.type === 'tvMiniSeries' || null;
      const e = eps.get(t.id);
      if (e) { row.seasons = e.seasons || null; row.eps = e.eps; }
    }
    return row;
  };

  const movies = films.map((t) => build(t, mcFilm));
  const shows = series.map((t) => build(t, mcShow));
  pruneTags(movies, 12, 'movies');
  pruneTags(shows, 8, 'shows');
  for (const list of [movies, shows]) list.sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const count = (l, k) => l.filter((r) => r[k] != null).length;
  log(`movies ${movies.length}: mc ${count(movies, 'mc')}, rt ${count(movies, 'rt')}, img ${count(movies, 'img')}`);
  log(`shows ${shows.length}: mc ${count(shows, 'mc')}, rt ${count(shows, 'rt')}, img ${count(shows, 'img')}`);
  return { movies, shows };
}

/* Second pass over cleaned tags: merge near-duplicates and drop labels that
   are vague, editorial or belong to the other medium. */
const TAG_ALIAS = {
  'Time-Travel': 'Time Travel', 'Psychological Horror Fiction': 'Psychological Horror', 'Female Buddy': 'Buddy',
  'Cinematic Fairy Tale': 'Fairy Tale', 'Sword-And-Sandal': 'Sword and Sandal', 'Rape And Revenge': 'Rape and Revenge',
  'Arthouse Science Fiction': 'Arthouse Sci-Fi', 'Satirical': 'Satire', 'Magic Realist': 'Magic Realism',
  'Samurai Cinema': 'Samurai', 'Science Fiction Anime': 'Anime', 'Thriller Anime': 'Anime', 'Mystery Anime': 'Anime',
  'Supernatural Anime': 'Anime', 'Lesbian-Related': 'LGBTQ', 'Association Football': 'Football', 'American Football': 'Football',
  'Girls With Guns': 'Girls with Guns', 'Trial': 'Courtroom', 'Legal': 'Courtroom', 'Crossover Fiction': 'Crossover',
  'Teen Drama Television': 'Teen', 'Teen Sitcom': 'Teen', 'Youth': 'Teen', 'Police Drama': 'Police Procedural',
  'Espionage': 'Spy', 'Late-Night Talk Show': 'Talk Show', 'Love Triangle Romance': 'Love Triangle', 'College Life': 'College',
  'Apocalyptic': 'Post-Apocalyptic', 'Live-Action/Animated': 'Live Action and Animation', 'Paranormal': 'Supernatural',
};
const TAG_DROP = new Set(['Speculative Fiction', 'Flashback', 'Drama Fiction', 'Psychological', 'White Savior', 'Horror Fiction',
  'Action Fiction', 'Crime Fiction', 'Westerns On Television', 'Political', 'Science Fantasy', 'Drama', 'Comedy']);
const SCREEN_ONLY = { movies: new Set(['Police Procedural', 'Sitcom', 'Animated Sitcom', 'Soap', 'Talk Show', 'Sketch Comedy']), shows: new Set() };
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');

function pruneTags(rows, minCount, kind) {
  for (const r of rows) {
    r.tags = [...new Set(r.tags.map((t) => TAG_ALIAS[t] || t))].filter((t) => !TAG_DROP.has(t) && !SCREEN_ONLY[kind].has(t));
  }
  // Genres held by only a handful of titles are noise in a filter list.
  const gn = {};
  for (const r of rows) for (const g of r.genres) gn[g] = (gn[g] || 0) + 1;
  for (const r of rows) r.genres = r.genres.filter((g) => gn[g] >= 8);
  const n = {};
  for (const r of rows) for (const t of r.tags) n[t] = (n[t] || 0) + 1;
  const genres = new Set(rows.flatMap((r) => r.genres).map(squash));
  for (const r of rows) {
    r.tags = r.tags.filter((t) => n[t] >= minCount && !genres.has(squash(t)))
      .sort((a, b) => n[a] - n[b]).slice(0, 8);
  }
}

/* --------------------------------------------------------------- games */

const RULES = [
  ['Visual Novel', ['Visual Novel', 'Dating Sim', 'Otome']],
  ['Rhythm', ['Rhythm', 'Music']],
  ['Card & Board', ['Card Game', 'Deckbuilding', 'Board Game', 'Card Battler', 'Roguelike Deckbuilder']],
  ['Racing', ['Racing', 'Driving', 'Automobile Sim', 'Motorbike']],
  ['Sports', ['Sports', 'Football', 'Soccer', 'Basketball', 'Golf', 'Fishing', 'Skateboarding']],
  ['Fighting', ['Fighting', '2D Fighter', '3D Fighter', 'Martial Arts']],
  ['MMO', ['MMORPG', 'Massively Multiplayer', 'MMO']],
  ['Horror', ['Horror', 'Psychological Horror', 'Survival Horror', 'Lovecraftian', 'Zombies']],
  ['Survival', ['Survival', 'Open World Survival Craft', 'Survival Craft', 'Base Building', 'Crafting']],
  ['Metroidvania', ['Metroidvania']],
  ['Roguelike', ['Roguelike', 'Roguelite', 'Action Roguelike', 'Roguevania', 'Dungeon Crawler', 'Traditional Roguelike']],
  ['Platformer', ['Platformer', 'Precision Platformer', 'Puzzle Platformer', '2D Platformer', '3D Platformer']],
  ['Stealth', ['Stealth', 'Immersive Sim']],
  ['Shooter', ['Shooter', 'FPS', 'Third-Person Shooter', 'Twin Stick Shooter', 'Bullet Hell', "Shoot 'Em Up", 'Looter Shooter', 'Tactical Shooter', 'Battle Royale', 'Hero Shooter', 'Arena Shooter']],
  ['JRPG', ['JRPG']],
  ['RPG', ['RPG', 'Action RPG', 'CRPG', 'Tactical RPG', 'Party-Based RPG', 'Souls-like', 'Turn-Based RPG']],
  ['Strategy', ['Strategy', 'Turn-Based Strategy', 'RTS', 'Grand Strategy', '4X', 'Tower Defense', 'Wargame', 'Auto Battler', 'Turn-Based Tactics', 'MOBA']],
  ['Simulation', ['Simulation', 'Management', 'City Builder', 'Colony Sim', 'Farming Sim', 'Life Sim', 'Economy', 'Building', 'Flight', 'Space Sim', 'Sandbox']],
  ['Puzzle', ['Puzzle', 'Sokoban', 'Hidden Object', 'Word Game', 'Trivia', 'Logic', 'Match 3']],
  ['Mystery', ['Detective', 'Mystery', 'Point & Click', 'Investigation']],
  ['Adventure', ['Adventure', 'Interactive Fiction', 'Walking Simulator', 'Choose Your Own Adventure', 'Open World']],
  ['Action', ['Action', 'Hack and Slash', 'Arcade', 'Character Action Game', "Beat 'em up"]],
];
/* A searched Wikipedia article only counts if its title is the game's title
   (ignoring a trailing "(video game)"); otherwise the art is someone else's. */
const EDITION_WORDS = new Set(('hd remaster remastered definitive edition reborn remake remade complete goty game of the year ' +
  'enhanced deluxe director directors cut redux special anniversary ultimate gold final collection trilogy classic reloaded vr').split(' '));
export function articleMatches(article, title) {
  const a = fold(String(article).replace(/\s*\([^)]*\)\s*$/, ''));
  const t = fold(title);
  if (!a || !t) return false;
  if (a === t) return true;
  // A longer name may only add edition words ("Sniper Elite V2 Remastered"), never a number or subtitle.
  const extra = t.startsWith(a + ' ') ? t.slice(a.length + 1) : a.startsWith(t + ' ') ? a.slice(t.length + 1) : null;
  return extra != null && extra.split(' ').every((w) => EDITION_WORDS.has(w));
}

export function classifyGame(tags) {
  for (const t of (tags || []).slice(0, 6)) {
    for (const [name, keys] of RULES) if (keys.includes(t)) return name;
  }
  return null;
}
/* Steam tags worth filtering by: sub-genres, settings and modes. Generic
   ones (Singleplayer, Great Soundtrack, Indie...) are left out. */
const TAG_KEEP = new Set(['Souls-like', 'Metroidvania', 'Roguelike', 'Roguelite', 'Deckbuilding', 'Open World', 'Survival Horror',
  'Psychological Horror', 'Horror', 'City Builder', 'Colony Sim', 'Farming Sim', 'Life Sim', 'Visual Novel', 'CRPG', 'JRPG',
  'Party-Based RPG', 'Action RPG', 'Tactical RPG', 'Turn-Based Tactics', 'Turn-Based Strategy', 'RTS', 'Grand Strategy', '4X',
  'Tower Defense', 'MOBA', 'Battle Royale', 'MMORPG', 'Open World Survival Craft', 'Survival', 'Immersive Sim', 'Stealth',
  'Point & Click', 'Walking Simulator', 'Puzzle', 'Puzzle Platformer', 'Precision Platformer', 'Platformer', 'Twin Stick Shooter',
  'Bullet Hell', 'Looter Shooter', 'Hero Shooter', 'FPS', 'Third-Person Shooter', 'Space Sim', 'Dating Sim', 'Interactive Fiction',
  'Dungeon Crawler', 'Hack and Slash', 'Character Action Game', 'Base Building', 'Wargame', 'Auto Battler', 'Card Battler',
  'Roguelike Deckbuilder', 'Lovecraftian', 'Cyberpunk', 'Steampunk', 'Post-apocalyptic', 'Western', 'Pirates', 'Superhero',
  'Mythology', 'Time Travel', 'Heist', 'Zombies', 'Space', 'Medieval', 'Dark Fantasy', 'Sci-fi', 'Fantasy', 'Anime',
  'Pixel Graphics', 'Online Co-Op', 'Local Co-Op', 'PvP', 'Sandbox', 'Crafting', 'Story Rich', 'Choices Matter', 'Detective',
  'Mystery', 'Comedy', 'Cozy', 'Racing', 'Driving', 'Sports', 'Fighting', 'Rhythm', 'Flight', 'Naval', 'Mechs', 'Military',
  'Strategy', 'Simulation', 'Indie', 'Free to Play', 'VR']);
const TAG_LABEL = { 'Online Co-Op': 'Co-op', 'Local Co-Op': 'Couch Co-op', 'Sci-fi': 'Sci-Fi', 'Post-apocalyptic': 'Post-Apocalyptic',
  "Shoot 'Em Up": 'Shmup', 'Free to Play': 'Free to Play' };
function gameTags(tags) {
  const out = [];
  for (const t of (tags || []).slice(0, 14)) {
    if (!TAG_KEEP.has(t)) continue;
    const l = TAG_LABEL[t] || t;
    if (!out.includes(l)) out.push(l);
    if (out.length >= 8) break;
  }
  return out;
}

export function mergeGames(prevGames, { newApps = [] } = {}) {
  const reviews = loadCache('steam-reviews');
  const tags = loadCache('steam-tags');
  const details = loadCache('steam-details');
  const wds = loadCache('wikidata-steam');
  const mcg = loadCache('mc-games');
  const gimg = loadCache('images-games');
  const assets = loadCache('steam-assets');
  const rows = [];
  const seenSteam = new Set();
  const freshMc = (row) => {
    const keys = [row.id, slugify(row.title) + '|' + (row.steamId || ''), row.steamId ? 'steam:' + row.steamId : null].filter(Boolean);
    for (const k of keys) if (mcg[k] && !mcg[k].none) return mcg[k];
    return null;
  };

  const finish = (row) => {
    const appId = row.steamId;
    const sr = appId && reviews[appId];
    if (sr && sr.score != null && sr.n >= 50) { row.steam = sr.score; row.steamN = sr.n; }
    const tg = appId && tags[appId];
    if (tg && tg.tags && tg.tags.length) row.tags = gameTags(tg.tags);
    const w = appId && wds[appId];
    if (w && w.wiki) row.wiki = w.wiki;
    if (!appId && gimg[row.id]?.img && articleMatches(gimg[row.id].wiki, row.title)) row.img = gimg[row.id].img.split('?')[0];
    // Steam art in a hashed folder needs its exact address; the plain one is derived from the id.
    const art = appId && assets[appId];
    if (art) {
      const pick = art.lib || art.header;
      row.img = pick && /\/[0-9a-f]{40}\//.test(pick) ? pick : null;
    }
    const f = freshMc(row);
    if (f && f.score != null) { row.mc = f.score; row.mcN = f.n || null; row.mcSlug = f.slug || null; }
    return row;
  };

  for (const g of prevGames) {
    if (g.steamId) seenSteam.add(g.steamId);
    rows.push(finish({
      id: g.id, title: g.title, year: g.year, genres: g.genres,
      steamId: g.steamId || null,
      mc: g.mc ?? null, mcN: g.mcN ?? null, mcSlug: g.mcSlug ?? null,
      steam: g.steam ?? null, steamN: g.steamN ?? null,
      ign: g.ign ?? null, ignUrl: g.ignUrl ?? null,
      tags: g.tags || [], wiki: g.wiki || null, img: g.img || null, free: g.free || null,
      blurb: g.blurb || null,
    }));
  }

  const byTitle = new Map(rows.map((r) => [fold(r.title), r]));
  for (const a of newApps) {
    if (seenSteam.has(a.appId)) continue;
    const d = details[a.appId];
    if (!d || d.missing || d.type !== 'game' || d.comingSoon) continue;
    const tg = tags[a.appId];
    seenSteam.add(a.appId);
    // Already listed without a Steam id: give that entry the id rather than adding a twin.
    const same = byTitle.get(fold(decode(d.name)));
    if (same && (!same.steamId || !same.year || !d.year || Math.abs(same.year - d.year) <= 1)) {
      if (!same.steamId) { same.steamId = a.appId; finish(same); }
      continue;
    }
    rows.push(finish({
      id: null, title: decode(d.name), year: d.year,
      genres: [classifyGame(tg?.tags) || 'Action'], steamId: a.appId,
      free: d.isFree || null,
    }));
  }

  // A game with no score that traces to a source is not shown, and one game
  // listed twice (same title, same year) keeps its better-attested entry.
  const best = new Map();
  for (const r of rows.filter((x) => x.mc != null || x.steam != null)) {
    const k = fold(r.title) + '|' + (r.year || '');
    const o = best.get(k);
    if (!o || (r.steamN || 0) + (r.mc != null ? 1e9 : 0) > (o.steamN || 0) + (o.mc != null ? 1e9 : 0)) best.set(k, r);
  }
  const kept = [...best.values()];
  const taken = new Set(kept.filter((r) => r.id).map((r) => r.id));
  for (const r of kept) {
    if (r.id) continue;
    // Titles in non-Latin scripts slugify to nothing; the Steam id is always there.
    let id = slugify(r.title) || 'steam-' + r.steamId;
    if (taken.has(id)) id += '-' + (r.year || r.steamId);
    taken.add(id);
    r.id = id;
  }
  log(`games ${kept.length} (dropped ${rows.length - kept.length} with no verifiable score): mc ${kept.filter((r) => r.mc != null).length}, steam ${kept.filter((r) => r.steam != null).length}`);
  return kept;
}

/* --------------------------------------------------------------- books */

/* Open Library subjects, as evidence for a book's genre. Listopia lists are
   fan-voted, so a list's genre is only a prior: Harry Potter turns up on
   travel lists. The genre with the most supporting subjects wins. */
const SUBJECT_GENRES = [
  ['Graphic Novels', /graphic novel|comic book|comics \(graphic/i],
  ['Manga & Comics', /manga/i],
  ['Children & Middle Grade', /juvenile fiction|juvenile literature|children's (stories|fiction|literature)|picture books/i],
  ['Young Adult', /young adult|teen fiction/i],
  ['Horror', /horror|ghost stories|supernatural/i],
  ['Science Fiction', /science fiction|dystopia|space opera|time travel/i],
  ['Fantasy', /fantasy|magic|wizards|dragons|witches|elves/i],
  ['Romance', /romance|love stories/i],
  ['Crime & Detective', /detective|crime|murder|police/i],
  ['Mystery & Thriller', /thriller|suspense|mystery|espionage/i],
  ['Historical Fiction', /historical fiction/i],
  ['Poetry & Essays', /poetry|poems|essays/i],
  ['Memoir & Biography', /biography|autobiograph|memoir/i],
  ['History & Politics', /^history|\bhistory\b|politic|world war/i],
  ['Science & Nature', /popular science|natural history|biology|physics|evolution|ecology|astronomy|neuroscience/i],
  ['Philosophy & Psychology', /philosophy|psychology/i],
  ['Business & Self-Help', /self-help|success|business|management|personal development|leadership/i],
  ['Health & Wellbeing', /health|diet|nutrition|wellness|meditation/i],
  ['Travel & Food', /travel|cooking|cookery|food/i],
  ['Art, Music & Film', /\bart\b|music|motion pictures|film/i],
];
export function bookGenre(listGenre, subjects) {
  if (!subjects || !subjects.length) return listGenre;
  const hits = SUBJECT_GENRES.map(([g, re]) => [g, subjects.filter((x) => re.test(x)).length]);
  const own = hits.find(([g]) => g === listGenre);
  const best = hits.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
  if (!best[1]) return listGenre;
  return own && own[1] >= best[1] ? listGenre : best[0];
}
const mainTitle = (t) => fold(String(t).split(/[:(]|,\s*vol\b/i)[0]);


export function mergeBooks(prevBooks) {
  const gr = loadCache('goodreads');
  const ol = { ...loadCache('ol-covers'), ...loadCache('openlibrary') };
  const editions = loadCache('ol-editions');
  const key = (b) => fold(b.title) + '|' + fold(b.author || '');
  const rows = [];
  let fresh = 0, kept = 0, dropped = 0;
  for (const b of prevBooks) {
    const k = key(b);
    const g = gr[k];
    const row = {
      id: b.id, title: b.title, author: b.author, year: b.year, genres: b.genres,
      rating: b.rating ?? null, ratings: b.ratings ?? null, isbn: b.isbn || null, gr: b.gr || null,
      cover: ol[k]?.cover || b.cover || null,
      blurb: b.blurb || null,
    };
    if (g && g.rating) { row.rating = g.rating; row.ratings = g.count; row.gr = g.id || row.gr; row.isbn = g.isbn || row.isbn; fresh++; }
    else if (row.rating != null) kept++;
    else { dropped++; continue; }
    // The verified edition's own cover beats the work's default, which may be a translation.
    if (row.isbn && editions[row.isbn]?.cover) row.cover = editions[row.isbn].cover;
    rows.push(row);
  }
  // New books from Goodreads' genre lists: 10,000+ ratings, rating read off Goodreads.
  const lists = loadCache('goodreads-lists', { books: {} }).books;
  const haveGr = new Set(rows.map((r) => r.gr).filter(Boolean));
  const haveKey = new Set(rows.map(key));
  // "Just Mercy" and "Just Mercy: A Story of Justice and Redemption" are one book.
  const haveMain = new Set(rows.map((r) => mainTitle(r.title) + '|' + fold(r.author || '')));
  let added = 0;
  for (const b of Object.values(lists)) {
    if (b.count < 10000 || haveGr.has(b.gr)) continue;
    const title = b.title.replace(/\s*\([^()]*#[\d.]+\)\s*$/, '').trim();
    const row = { title, author: b.author, genres: [b.genre], rating: b.rating, ratings: b.count, gr: b.gr };
    const k = key(row);
    const main = mainTitle(title) + '|' + fold(b.author || '');
    if (haveKey.has(k) || haveMain.has(main) || /box set|boxed set|collection set|books? \d+-\d+/i.test(title)) continue;
    row.genres = [bookGenre(b.genre, ol[k]?.subjects)];
    const g = gr[k];
    if (g && g.rating && g.id === b.gr) { row.rating = g.rating; row.ratings = g.count; row.isbn = g.isbn || null; }
    row.year = ol[k]?.year || null;
    row.cover = ol[k]?.cover || null;
    if (row.isbn && editions[row.isbn]?.cover) row.cover = editions[row.isbn].cover;
    row.id = slugify(title) ? slugify(title + ' ' + (b.author || '').split(' ').pop()) : 'gr-' + b.gr;
    rows.push(row);
    haveGr.add(b.gr); haveKey.add(k); haveMain.add(main);
    added++;
  }

  // The same book listed twice keeps its better-attested entry, under a unique id.
  const byKey = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!byKey.has(k) || (r.ratings || 0) > (byKey.get(k).ratings || 0)) byKey.set(k, r);
  }
  const out = [...byKey.values()];
  const ids = new Set();
  for (const r of out) { while (ids.has(r.id)) r.id += '-' + (r.year || 'b'); ids.add(r.id); }
  log(`books ${out.length}: ${fresh} confirmed on Goodreads now, ${kept} confirmed earlier, ${added} added from Goodreads lists, ${dropped} dropped as unverifiable, ${rows.length - out.length} duplicates merged`);
  return out;
}
