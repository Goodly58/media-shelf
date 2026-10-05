/* Unit tests for the refresh pipeline's matching and cleaning rules. No
   network: these are the pure functions that decide what gets written. */
import { slugify, broadGenres, articleMatches, classifyGame, bookGenre } from '../scripts/refresh/merge.mjs';
import { screenTags, screenBroad, screenCountries, gameTags, bookGenres, bookTags, clientTaxonomy } from '../scripts/refresh/taxonomy.mjs';
import { fold } from '../scripts/refresh/lib.mjs';
import { assess } from '../scripts/refresh/health.mjs';
import { pickTrailer, kinoPick, tmdbPick } from '../scripts/refresh/trailers.mjs';
import { slugRT } from '../scripts/refresh/rottentomatoes.mjs';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass += 1; return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail !== undefined ? `  (${JSON.stringify(detail)})` : ''}`);
}

console.log('titles');
ok('fold drops accents, punctuation and a leading article', fold('The Café: Amélie & Co.') === 'cafe amelie and co');
ok('slugify makes stable ids', slugify("Assassin's Creed® II") === 'assassins-creed-ii', slugify("Assassin's Creed® II"));

console.log('screen themes');
const getOut = ['2017 horror films', '2010s satirical films', 'American body horror films', 'Films about racism in the United States',
  'Films about cults', 'Films directed by Jordan Peele', 'Blumhouse Productions films'];
const tags = screenTags(getOut, ['horror film']);
ok('subgenres and themes come from categories', ['Satire', 'Body Horror', 'Race & Racism', 'Cults'].every((x) => tags.includes(x)), tags);
ok('a studio is not a theme', !screenTags(['Ghost House Pictures films'], []).includes('Ghosts'));
ok('the Great Depression is not mental health', !screenTags(['Great Depression films'], []).includes('Mental Health'));
ok('Dragon Ball is not about dragons', !screenTags(['Dragon Ball films'], []).includes('Dragons'));
ok('a city name is not a religion', !screenTags(['Films set in Islamabad'], []).includes('Religion'));
const nations = screenCountries(['2017 films', 'American satirical films', 'British horror films', '2010s French-language films']);
ok('countries come from nationality prefixes', nations.includes('United States') && nations.includes('United Kingdom'), nations);
ok('a language is not a country', !nations.includes('France'), nations);
ok('broad genres fill a single-genre title', JSON.stringify(screenBroad(['2005 action films', 'American crime films', '2005 films'])) === '["Action","Crime"]');

console.log('game and book tags');
const gt = gameTags(['Souls-like', 'Action', 'Open World', 'Singleplayer', 'Great Soundtrack']);
ok('Steam tags worth filtering by are kept', gt.includes('Souls-like') && gt.includes('Open World'), gt);
ok('generic Steam tags are dropped', !gt.includes('Singleplayer') && !gt.includes('Great Soundtrack'), gt);
const shelves = ['Fantasy', 'Classics', 'Fiction', 'Adventure', 'Young Adult', 'Audiobook', 'High Fantasy'];
ok('Goodreads shelves give genres', JSON.stringify(bookGenres(shelves, ['Horror'])) === '["Fantasy","Classics","Young Adult"]', bookGenres(shelves, ['Horror']));
ok('no shelves keeps the fallback genre', JSON.stringify(bookGenres(null, ['Horror'])) === '["Horror"]');
ok('shelves give subgenre tags', bookTags(shelves, []).includes('Epic Fantasy'), bookTags(shelves, []));
const tax = clientTaxonomy();
ok('every shelf has a picker taxonomy', ['movies', 'shows', 'games', 'books'].every((k) => tax[k].length > 5));
const seen = new Set(), dupes = [];
for (const [, list] of tax.movies) for (const x of list) { if (seen.has(x)) dupes.push(x); seen.add(x); }
ok('no theme sits in two groups', !dupes.length, dupes);

console.log('genres');
const g = broadGenres(['superhero film', 'action film', 'crime film', 'drama television series', 'science fiction film']);
ok('broad genres map to IMDb names', ['Action', 'Crime', 'Drama', 'Sci-Fi'].every((x) => g.includes(x)), g);
ok('no duplicates', new Set(g).size === g.length, g);

console.log('game art');
ok('exact article title matches', articleMatches('Lone Echo', 'Lone Echo'));
ok('disambiguator is ignored', articleMatches('Overwatch (2016 video game)', 'Overwatch'));
ok('an edition suffix is allowed', articleMatches('Sniper Elite V2', 'Sniper Elite V2 Remastered'));
ok('a numbered sequel is not the original', !articleMatches('Mass Effect (video game)', 'Mass Effect 3'));
ok('a different game is rejected', !articleMatches('Monster Hunter', 'Card Hunter'));
ok('a list article is rejected', !articleMatches('List of Yu-Gi-Oh! video games', 'Yu-Gi-Oh! Legacy of the Duelist'));

console.log('game genres');
ok('first prominent tag decides', classifyGame(['Roguelike', 'Action', 'Indie']) === 'Roguelike');
ok('horror outranks survival when it comes first', classifyGame(['Survival Horror', 'Survival']) === 'Horror');
ok('unknown tags give nothing', classifyGame(['Singleplayer', 'Great Soundtrack']) === null);

console.log('book genres');
ok('subjects overrule an off-topic list', bookGenre('Travel & Food', ['Fantasy fiction', 'Magic', 'Wizards', 'Juvenile fiction']) === 'Fantasy');
ok('a supported list genre stands', bookGenre('Romance', ['Love stories', 'Fiction, romance, contemporary']) === 'Romance');
ok('no subjects keeps the list genre', bookGenre('Horror', []) === 'Horror');

console.log('trailers');
const wd = { tt1: { c: [['aaaaaaaaaaa', '', ''], ['bbbbbbbbbbb', 'trailer', 'English']], at: 1 }, tt2: { c: [['ccccccccccc', '', '']], at: 1 }, tt3: { c: [], at: 1 } };
const check = { aaaaaaaaaaa: { ok: true, title: 'The Godfather' }, bbbbbbbbbbb: { ok: true, title: 'Clip' }, ccccccccccc: { ok: true, title: 'Casablanca' }, ddddddddddd: { ok: false } };
ok('a marked Wikidata trailer is chosen', pickTrailer('tt1', { wd, check }) === 'bbbbbbbbbbb');
ok('an unmarked id (the paid film listing) is not a trailer', pickTrailer('tt2', { wd, check }) === null);
ok('a title no source has seen is undecided', pickTrailer('tt9', { wd, check }) === undefined);
ok('a title the sources know has none', pickTrailer('tt3', { wd, check }) === null);
ok('an official trailer wins over Wikidata', pickTrailer('tt1', { wd, check, kino: { tt1: { yt: 'eeeeeeeeeee' } } }) === 'eeeeeeeeeee');
ok('a video YouTube refused is skipped', pickTrailer('tt1', { wd, check, kino: { tt1: { yt: 'ddddddddddd' } } }) === 'bbbbbbbbbbb');
ok('KinoCheck: its own trailer pick', kinoPick({ trailer: { youtube_video_id: 'gaZ-S1aFB24', categories: ['Trailer'] }, videos: [] }) === 'gaZ-S1aFB24');
ok('KinoCheck: a teaser when there is no trailer', kinoPick({ trailer: null, videos: [{ youtube_video_id: 'aaaaaaaaaaa', categories: ['Clip'] }, { youtube_video_id: 'bbbbbbbbbbb', categories: ['Teaser'] }] }) === 'bbbbbbbbbbb');
ok('KinoCheck: nothing for a clip', kinoPick({ trailer: null, videos: [{ youtube_video_id: 'aaaaaaaaaaa', categories: ['Clip'] }] }) === null);
ok('KinoCheck: nothing for an error', kinoPick({ error: 'Error', message: 'movie not found' }) === null);
ok('TMDB: the official trailer', tmdbPick({ results: [{ site: 'YouTube', key: 'aaaaaaaaaaa', type: 'Teaser', official: true }, { site: 'YouTube', key: 'bbbbbbbbbbb', type: 'Trailer', official: true }, { site: 'Vimeo', key: 'x', type: 'Trailer' }] }) === 'bbbbbbbbbbb');
ok('TMDB: nothing but featurettes', tmdbPick({ results: [{ site: 'YouTube', key: 'aaaaaaaaaaa', type: 'Featurette', official: true }] }) === null);

console.log('rotten tomatoes addresses');
ok('a title becomes RT\'s address', slugRT('The Dark Knight') === 'the_dark_knight');
ok('apostrophes go, accents fold', slugRT("Schindler's List") === 'schindlers_list' && slugRT('Amélie') === 'amelie', [slugRT("Schindler's List"), slugRT('Amélie')]);
ok('punctuation becomes one underscore', slugRT('Spider-Man: No Way Home') === 'spider_man_no_way_home', slugRT('Spider-Man: No Way Home'));
ok('commas inside numbers go', slugRT('10,000 BC') === '10000_bc', slugRT('10,000 BC'));

console.log('source health');
const now = Date.now(), old = now - 9e9;
const fake = (caches) => (name, dflt) => caches[name] ?? dflt;
const entries = (n, hits, at = now) => Object.fromEntries([...Array(n)].map((_, i) => [i, i < hits ? { score: 80, at } : { none: true, at }]));
const run = (steps, caches, snap, notes, traffic) => assess({ since: now - 1000, steps: steps.map((name) => (typeof name === 'string' ? { name, seconds: 1 } : name)), snap, notes, traffic, load: fake(caches) });
ok('a source answering as usual is fine', run(['rt'], { rt: entries(100, 88) }).ok);
ok('a quiet week with nothing due is fine', run(['steam'], { 'steam-tags': entries(100, 90, old) }).ok);
ok('a site failing most requests is a problem', /rottentomatoes/.test(run(['rt'], { rt: {} }, {}, [], { 'www.rottentomatoes.com': { ok: 3, failed: 120 } }).problems.join()));
ok('a few failed requests are not', run(['rt'], { rt: entries(100, 88) }, {}, [], { 'www.rottentomatoes.com': { ok: 900, failed: 12 } }).ok);
ok('a sharp drop in answers is a problem', /Rotten Tomatoes/.test(run(['rt'], { rt: entries(100, 30) }).problems.join()));
ok('a small sample is not judged', run(['rt'], { rt: entries(10, 1) }).ok);
ok('Metacritic games answering a fifth of the time is normal', run(['gamesmc'], { 'mc-games': entries(60, 12) }).ok);
ok('a source whose step did not run is not judged', run(['rt'], { rt: entries(100, 88), 'steam-reviews': {} }).rows.length === 1);
ok('a failed step is a problem', /rt: failed/.test(run([{ name: 'rt', seconds: 1, error: 'timeout' }], { rt: entries(100, 88) }).problems.join()));
ok('a crawl that shrank is a problem', /shrank/.test(run(['metacritic'], { 'mc-movies': new Array(5000), 'mc-tv': new Array(3300) }, { 'mc-movies': 17000, 'mc-tv': 3300 }).problems.join()));
ok('notes from the run are problems', !run(['rt'], { rt: entries(100, 88) }, {}, ['books: would have shrunk']).ok);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
