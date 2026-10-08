# Shelf

Games, books, films and series in one place, ranked by the people who score
them: IMDb, Metacritic, Rotten Tomatoes, Steam and Goodreads. Static site, no
backend, no accounts, no tracking.

**Live:** <https://goodly58.github.io/media-shelf/>

| Page | What it is |
| --- | --- |
| Films | Every film with 10,000+ IMDb votes, with Metacritic and Rotten Tomatoes, and a trailer feed |
| Series | Every series with 10,000+ IMDb votes, same three scores, and a trailer feed |
| Games | PC games by Metacritic and Steam reviews, including every game with 10,000+ Steam reviews |
| Books | Books with 10,000+ Goodreads ratings from Goodreads' genre lists, by rating |
| What next | Drop in a Goodreads, Letterboxd or IMDb export and get your backlog ranked |

## Every score comes from its source

No score is typed in. `scripts/refresh/` reads each number from where it is
published, and leaves it empty if it cannot:

| Source | How |
| --- | --- |
| IMDb | Official datasets: rating, votes, genres, runtime, directors, episodes |
| Metacritic | Critics' Metascore and the users' score with its count, from the same backend metacritic.com uses, matched by IMDb id or Wikidata link |
| Rotten Tomatoes | Critics' Tomatometer and the audience's Popcornmeter, from the title's own page at the address Wikidata records (or RT's own address when Wikidata has none) |
| Steam | The store's review summary for each app |
| Goodreads | Genre lists for new books, then each book's own page by its Goodreads id or ISBN |
| Wikipedia | Each article's categories, for the subgenres, themes and countries of films and series |
| Wikidata awards | Oscars, Palme d'Or, Golden Lion, Golden Bear, BAFTA and Golden Globes for films; Emmys and Golden Globes for series; Pulitzer, Booker, International Booker, National Book Award, Hugo, Nebula, Women's Prize and Newbery for books; The Game Awards, BAFTA Games, D.I.C.E., GDC and Golden Joystick for games |
| Wikidata, TVmaze, Open Library | Links between sites, posters and covers. Book covers are fetched once, shrunk to WebP and kept in `covers/`, so they load from GitHub's CDN |
| Steam | Game trailers: Steam's own videos (HLS streams) for each game, played by the trailer feed |
| TMDB, KinoCheck, Wikidata, YouTube | Trailers: official ones from TMDB and KinoCheck, and YouTube ids recorded on Wikidata, with up to two backups per title (from another channel where possible). Every video in use is checked with YouTube's oEmbed, again each month, and the player switches to a backup when one will not play where the viewer is |

Genres and themes come from one curated list, `scripts/refresh/taxonomy.mjs`,
matched against Wikipedia categories for films and series ("2010s satirical
films"), Steam's tags for games and Goodreads' shelves for books.

A GitHub Action runs the pipeline every Monday, commits the changes as data, and
redeploys. Trailers are looked up every day, within KinoCheck's free allowance of
1,000 requests; with a `TMDB_API_KEY` repository secret, TMDB is asked first and
nearly every title gets one. The slow sources are re-checked a slice at a time, oldest first, so
the whole catalogue is re-verified every few weeks.

A source that breaks is skipped so the rest still update, and the run then fails
on purpose so GitHub emails the owner: `scripts/refresh/health.mjs` flags a site
failing most of its requests, a source answering far less often than usual, and
a crawl or catalogue that shrank sharply. Each run's table is in its summary.

## Working locally

Node 22.12 or newer, no dependencies to install.

```bash
npm run build      # generate the site into _site/
npm run serve      # preview it at http://localhost:8080
npm run validate   # the checks the deploy runs
npm test           # unit tests
npm run refresh    # re-fetch every source (slow; the weekly job does this)
```

`npm run refresh -- --merge` rebuilds `data/` from the fetch caches without
fetching anything.

## Deploying

```bash
git push
```

GitHub Actions builds the site, validates it, and publishes `_site/`. If
validation fails, nothing is published and the previous site stays live.

## Structure

```
src/              page templates (layout, home, catalogue, What next)
assets/           app.css, app.js (shared, also run by the build), catalog.js,
                  whatnext.js, backlog.js, the Inter font, icons, og.png
data/             games.json  books.json  movies.json  shows.json
scripts/
  build.js        templates + data -> _site/, each catalogue's first screen pre-drawn
  validate.js     pre-publish checks
  refresh/        the data pipeline, one module per source
tests/            unit tests
```

## Licence

Source code is [MIT licensed](LICENSE). Cover art, posters and scores belong to
their owners; see [NOTICE.md](NOTICE.md).
