/* Regenerates assets/stats.json from the real datasets embedded in the pages.
   Run after any data change:  node build-stats.js
   Keeps the landing page free of hard-coded counts. */
const fs = require('fs');

function extract(file, varName) {
  const h = fs.readFileSync(file, 'utf8');
  const start = h.indexOf('const ' + varName + ' = ');
  if (start < 0) throw new Error('data not found in ' + file);
  const from = start + ('const ' + varName + ' = ').length;
  const end = h.indexOf('\n\nconst $ = s => document.querySelector', from);
  if (end < 0) throw new Error('data end marker not found in ' + file);
  return JSON.parse(h.slice(from, end).replace(/;\s*$/, ''));
}

const games = extract('games.html', 'GAMES');
const books = extract('books.html', 'BOOKS');

const gYears = games.map(g => g.year).filter(Number.isFinite);
const bYears = books.map(b => b.year).filter(Number.isFinite);

const movies = JSON.parse(fs.readFileSync("data/movies.json","utf8"));
const shows  = JSON.parse(fs.readFileSync("data/shows.json","utf8"));
const mYears = movies.map(m => m.year).filter(Number.isFinite);
const sYears = shows.map(m => m.year).filter(Number.isFinite);

const stats = {
  movies: movies.length,
  moviesFrom: Math.min(...mYears),
  moviesTo: Math.max(...mYears),
  moviesGenres: new Set(movies.map(m => m.genre)).size,
  shows: shows.length,
  showsFrom: Math.min(...sYears),
  showsTo: Math.max(...sYears),
  showsGenres: new Set(shows.map(m => m.genre)).size,
  games: games.length,
  gamesFrom: Math.min(...gYears),
  gamesTo: Math.max(...gYears),
  gamesVerified: games.filter(g => g.verified).length,
  gamesGenres: new Set(games.map(g => g.genre)).size,
  books: books.length,
  booksFrom: Math.min(...bYears),
  booksTo: Math.max(...bYears),
  booksGenres: new Set(books.map(b => b.genre)).size,
  booksAuthors: new Set(books.map(b => b.author)).size,
  updated: new Date().toISOString().slice(0, 10)
};

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/stats.json', JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
