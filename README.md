<div align="center">

<img src="assets/icon.svg" width="72" height="72" alt="">

# Shelf

**Games, books, films and series in one place, ranked by the people who score them.**

IMDb · Metacritic · Rotten Tomatoes · Steam · Goodreads

<a href="https://goodly58.github.io/media-shelf/"><img src="https://img.shields.io/badge/Open%20Shelf-8b95ff?style=for-the-badge" alt="Open Shelf"></a>
&nbsp;
<a href="https://github.com/Goodly58/media-shelf/actions/workflows/deploy.yml"><img src="https://github.com/Goodly58/media-shelf/actions/workflows/deploy.yml/badge.svg" alt="Deploy status"></a>

<br>

<a href="https://goodly58.github.io/media-shelf/"><img src=".github/readme/home.webp" width="100%" alt="Shelf's home page: a wall of posters and covers behind the search box"></a>

</div>

## A look around

<table>
  <tr>
    <td width="50%" valign="top">
      <img src=".github/readme/films.webp" width="100%" alt="The Films shelf, sorted by top rated">
      <br><b>Ranked shelves</b>
      <br>Every film and series with 10,000+ IMDb votes, books with 10,000+ Goodreads ratings, and PC games by Metacritic and Steam.
    </td>
    <td width="50%" valign="top">
      <img src=".github/readme/details.webp" width="100%" alt="The Dark Knight's details: IMDb, Metacritic and Rotten Tomatoes scores, and its awards">
      <br><b>Every score, with its count</b>
      <br>IMDb, Metacritic critics and users, Rotten Tomatoes critics and audience, and the awards a title won.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src=".github/readme/episodes.webp" width="100%" alt="Game of Thrones: the cast with photos, and every episode's IMDb rating by season">
      <br><b>Cast and episodes</b>
      <br>Who plays whom, with photos, and every episode's rating, season by season.
    </td>
    <td width="50%" valign="top">
      <img src=".github/readme/trailers.webp" width="100%" alt="The trailer feed playing Disco Elysium: The Final Cut">
      <br><b>Trailer feed</b>
      <br>Full-screen trailers for films, series and games, filtered like the shelves.
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="34%" valign="top">
      <img src=".github/readme/phone.webp" width="100%" alt="Breaking Bad's episode ratings on a phone">
    </td>
    <td valign="top">

### Also on board

- **Filters that count.** Genres, themes, countries, years, length, awards, a minimum rating and a minimum number of votes, each showing how many titles it leaves.
- **Follow a person.** Tap anyone in the cast, or a director, for everything else they are in.
- **Your shelf, no account.** Save, hide or mark titles watched, or bring in your Letterboxd, IMDb or Goodreads history. It all stays in your browser.
- **What next.** Drop in a watchlist or a to-read export and get it ranked by score and the time you have.
- **Quick everywhere.** Pages arrive already drawn, book covers come from the site itself, and pages you have visited open offline.

</td>
  </tr>
</table>

## Where the scores come from

Every number is read from its source by `scripts/refresh/`. Nothing is typed in, and a score the pipeline cannot read stays empty.

| Source | Gives |
| --- | --- |
| **IMDb** | Ratings and votes, genres, runtimes, directors, the cast and their parts, every episode's rating |
| **Metacritic** | The critics' Metascore and the users' score, each with its count |
| **Rotten Tomatoes** | The Tomatometer and the Popcornmeter |
| **Steam** | Review scores and counts, tags, game trailers |
| **Goodreads** | Book ratings, shelves, new books from its genre lists |
| **Wikidata · Wikipedia** | Links between sites, awards, subgenres and themes, posters and summaries |
| **TMDB · KinoCheck · YouTube** | Trailers, cast photos, posters Wikipedia lacks |
| **TVmaze · Open Library** | Series posters, book covers |

## How it stays fresh

```mermaid
flowchart LR
  S["IMDb · Metacritic · Rotten Tomatoes<br>Steam · Goodreads · TMDB"] -->|every Monday| R["Refresh, build and checks<br>GitHub Actions"]
  R --> P["The site<br>GitHub Pages"]
  R -. a source breaks .-> E["Email to the owner"]
```

Every Monday a GitHub Action re-reads the sources, commits the new data and redeploys; trailers are checked every day. When a source breaks, the rest still update and the run fails on purpose, so GitHub emails the owner.

## Run it locally

Node 22.12 or newer.

```bash
npm run build      # generate the site into _site/
npm run serve      # preview it at http://localhost:8080
npm run validate   # the checks the deploy runs
npm test           # unit tests
```

Pushing to `main` deploys: GitHub Actions builds the site, validates it and publishes `_site/`. If validation fails, nothing is published and the live site stays as it was.

<details>
<summary><b>How each source is read</b></summary>

<br>

| Source | How |
| --- | --- |
| IMDb | The official datasets: titles, ratings, crew, principals (the billed cast, with parts) and episodes |
| Metacritic | The backend metacritic.com itself uses, matched by IMDb id or Wikidata link; users' scores with their counts from each title's stats |
| Rotten Tomatoes | Each title's own page, at the address Wikidata records (or RT's own address where Wikidata has none) |
| Steam | The store's review summary and each game's videos (HLS streams, played by the trailer feed) |
| Goodreads | Genre lists for new books, then each book's own page by its Goodreads id or ISBN |
| Wikipedia | Each article's categories, for the subgenres, themes and countries of films and series |
| Wikidata | Links between sites, and award winners: Oscars, Palme d'Or, Golden Lion, Golden Bear, BAFTA, Golden Globes, Emmys, Pulitzer, Booker, International Booker, National Book Award, Hugo, Nebula, Women's Prize, Newbery, The Game Awards, BAFTA Games, D.I.C.E., GDC and Golden Joystick |
| TMDB | Trailers (with `TMDB_API_KEY` set as a repository secret), cast photos matched by name to IMDb's cast, and posters where Wikipedia has none |
| KinoCheck, YouTube | More trailers, up to two backups per title; every video in use is checked with YouTube's oEmbed each month |
| Open Library | Book covers, fetched once, shrunk to WebP and kept in `covers/`, so they load from GitHub's CDN |

Genres and themes come from one curated list, `scripts/refresh/taxonomy.mjs`, matched against Wikipedia categories for films and series ("2010s satirical films"), Steam's tags for games and Goodreads' shelves for books.

The slow sources are re-checked a slice at a time, oldest first, so the whole catalogue is re-verified every few weeks. `scripts/refresh/health.mjs` flags a site failing most of its requests, a source answering far less often than usual, and a crawl or catalogue that shrank sharply; each run's table is in its summary. `npm run refresh` runs the pipeline locally (slow), and `npm run refresh -- --merge` rebuilds `data/` from the fetch caches without fetching.

</details>

<details>
<summary><b>Project layout</b></summary>

<br>

```
src/              page templates (layout, home, catalogue, What next)
assets/           app.css, app.js (shared, also run by the build), catalog.js,
                  reels.js, whatnext.js, backlog.js, the Inter font, icons
data/             the catalogues, their trailers, cast and episode ratings
covers/           book covers, served with the site
scripts/
  build.js        templates + data -> _site/, each shelf's first screen pre-drawn
  validate.js     pre-publish checks
  refresh/        the data pipeline, one module per source
tests/            unit tests
```

</details>

## Licence

Source code is [MIT licensed](LICENSE). Cover art, posters, photos and scores belong to their owners; see [NOTICE.md](NOTICE.md).
