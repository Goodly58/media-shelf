/* IMDb's official bulk datasets (datasets.imdbws.com): the backbone of the
   film and series catalogues. They give every title's type, year, runtime,
   genres, rating and vote count, so inclusion and the IMDb score are both
   taken straight from the source. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { IMDB_DIR, UA, log } from './lib.mjs';

const BASE = 'https://datasets.imdbws.com/';
export const FILM_TYPES = new Set(['movie', 'tvMovie', 'video']);
export const SERIES_TYPES = new Set(['tvSeries', 'tvMiniSeries']);

/* Download a dataset unless today's copy is already on disk. */
export async function ensure(name, maxAgeHours = 20) {
  const file = path.join(IMDB_DIR, name + '.tsv.gz');
  fs.mkdirSync(IMDB_DIR, { recursive: true });
  try {
    const age = (Date.now() - fs.statSync(file).mtimeMs) / 3.6e6;
    if (age < maxAgeHours) return file;
  } catch {}
  log(`downloading ${name}`);
  const res = await fetch(BASE + name + '.tsv.gz', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file + '.part'));
  fs.renameSync(file + '.part', file);
  return file;
}

async function* rows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    yield line.split('\t');
  }
}

const val = (s) => (s === '\\N' || s === undefined ? null : s);

/** Season and episode counts for the given series ids. */
export async function loadEpisodes(ids) {
  const file = await ensure('title.episode');
  const out = new Map();
  for await (const [, parent, season] of rows(file)) {
    if (!ids.has(parent)) continue;
    const rec = out.get(parent) || { seasons: 0, eps: 0 };
    const s = Number(season);
    if (s > rec.seasons && s < 200) rec.seasons = s;
    rec.eps++;
    out.set(parent, rec);
  }
  return out;
}

/**
 * Every film and series with at least `minVotes` IMDb votes, plus any title
 * in `keep` (ids already in the catalogue), with directors resolved to names.
 */
export async function loadImdb({ minVotes = 10000, keep = new Set(), withCrew = true } = {}) {
  const ratingsFile = await ensure('title.ratings');
  const basicsFile = await ensure('title.basics');

  const ratings = new Map();
  for await (const [id, avg, votes] of rows(ratingsFile)) {
    ratings.set(id, [Number(avg), Number(votes)]);
  }
  log(`ratings: ${ratings.size} titles`);

  const titles = new Map();
  for await (const r of rows(basicsFile)) {
    const [id, type, primary, original, isAdult, start, end, runtime, genres] = r;
    const film = FILM_TYPES.has(type), series = SERIES_TYPES.has(type);
    if (!film && !series) continue;
    const rt = ratings.get(id);
    const wanted = keep.has(id) || (rt && rt[1] >= minVotes);
    if (!wanted) continue;
    if (isAdult === '1') continue;
    const g = val(genres) ? genres.split(',').filter((x) => x !== 'Adult') : [];
    titles.set(id, {
      id, type, kind: film ? 'movies' : 'shows',
      title: primary, original: original !== primary ? original : null,
      year: val(start) ? Number(start) : null,
      end: val(end) ? Number(end) : null,
      runtime: val(runtime) ? Number(runtime) : null,
      genres: g,
      imdb: rt ? rt[0] : null,
      votes: rt ? rt[1] : 0,
    });
  }
  log(`basics: ${titles.size} films and series selected`);

  if (withCrew) {
    const crewFile = await ensure('title.crew');
    const namesFile = await ensure('name.basics');
    const need = new Map();
    for await (const [id, directors] of rows(crewFile)) {
      const t = titles.get(id);
      if (!t || !val(directors)) continue;
      t.directorIds = directors.split(',').slice(0, 3);
      for (const n of t.directorIds) need.set(n, null);
    }
    for await (const [nid, name] of rows(namesFile)) {
      if (need.has(nid)) need.set(nid, name);
    }
    for (const t of titles.values()) {
      if (t.directorIds) t.directors = t.directorIds.map((n) => need.get(n)).filter(Boolean);
      delete t.directorIds;
    }
    log(`crew: ${need.size} directors named`);
  }
  return { titles, ratings };
}
