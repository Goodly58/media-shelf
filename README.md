# Shelf

Games, books, films and series in one place, ranked by the people who score
them: IMDb, Metacritic, Rotten Tomatoes, Steam and Goodreads. Static site, no
backend, no accounts, no tracking.

**Live:** <https://goodly58.github.io/media-shelf/>

| Page | What it is |
| --- | --- |
| Films | Every film with 10,000+ IMDb votes, with Metacritic and Rotten Tomatoes |
| Series | Every series with 10,000+ IMDb votes, same three scores |
| Games | PC games by Metacritic and Steam reviews, including every game with 10,000+ Steam reviews |
| Books | Books with 10,000+ Goodreads ratings from Goodreads' genre lists, by rating |
| What next | Drop in a Goodreads, Letterboxd or IMDb export and get your backlog ranked |

## Every score comes from its source

No score is typed in. `scripts/refresh/` reads each number from where it is
published, and leaves it empty if it cannot:

| Source | How |
| --- | --- |
| IMDb | Official datasets: rating, votes, genres, runtime, directors, episodes |
| Metacritic | The same backend metacritic.com uses, matched by IMDb id or Wikidata link |
| Rotten Tomatoes | The title's own page, at the address Wikidata records |
| Steam | The store's review summary for each app |
| Goodreads | Genre lists for new books, then each book's own page by its Goodreads id or ISBN |
| Wikidata, Wikipedia, TVmaze, Open Library | Links between sites, subgenres, posters and covers |

A GitHub Action runs the pipeline every Monday, commits the changes as data, and
redeploys. The slow sources are re-checked a slice at a time, oldest first, so
the whole catalogue is re-verified every few weeks.

## Working locally

Node 20 or newer, no dependencies to install.

```bash
npm run build      # generate the site into _site/
npm run serve      # preview it at http://localhost:8080
npm run validate   # the checks the deploy runs
npm test           # backlog matcher tests
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
assets/           app.css, app.js (shared), catalog.js, whatnext.js, backlog.js
data/             games.json  books.json  movies.json  shows.json
scripts/
  build.js        templates + data -> _site/
  validate.js     pre-publish checks
  refresh/        the data pipeline, one module per source
tests/            backlog matcher tests
```

## Licence

Source code is [MIT licensed](LICENSE). Cover art, posters and scores belong to
their owners; see [NOTICE.md](NOTICE.md).
