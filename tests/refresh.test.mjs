/* Unit tests for the refresh pipeline's matching and cleaning rules. No
   network: these are the pure functions that decide what gets written. */
import { slugify, cleanTag, broadGenres, articleMatches, classifyGame, bookGenre } from '../scripts/refresh/merge.mjs';
import { fold } from '../scripts/refresh/lib.mjs';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass += 1; return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail !== undefined ? `  (${JSON.stringify(detail)})` : ''}`);
}

console.log('titles');
ok('fold drops accents, punctuation and a leading article', fold('The Café: Amélie & Co.') === 'cafe amelie and co');
ok('slugify makes stable ids', slugify("Assassin's Creed® II") === 'assassins-creed-ii', slugify("Assassin's Creed® II"));

console.log('tags');
ok('subgenre film suffix is dropped', cleanTag('slasher film') === 'Slasher');
ok('television series suffix is dropped', cleanTag('police procedural') === 'Police Procedural');
ok('LGBT label is normalised', cleanTag('LGBT-related film') === 'LGBTQ');
ok('a plain genre is not a theme', cleanTag('drama film') === null);
ok('literature adaptation is not a theme', cleanTag('film based on literature') === null);

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
