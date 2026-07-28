# Shelf

A fast, filterable catalogue of games, books, films and TV series — plus a
personal vocabulary vault. Static site, no backend, no accounts, no tracking.

**Live:** <https://goodly58.github.io/shelf/>

| Page | What it is |
| --- | --- |
| `games.html` | PC games, ranked by Metacritic and IGN |
| `books.html` | Books, ranked by Goodreads rating |
| `movies.html` | Films, with Metacritic / IMDb / Rotten Tomatoes |
| `shows.html` | TV series, same three score sources |
| `vocab.html` | Vocabulary vault — definitions fetched on demand, stored in your browser |

Shared across every page: a command palette (<kbd>⌘K</kbd>), light/dark themes,
keyboard shortcuts, shareable filter links, offline support and installability.

## Deploying

```bash
git push
```

That is the whole deploy. GitHub Actions rebuilds the generated files, runs
`validate.js`, and publishes. **If validation fails nothing is published** and
the previous site stays live.

## Working locally

```bash
node build-pages.js     # regenerates movies.html + shows.html from data/
node build-stats.js     # regenerates assets/stats.json
node build-version.js   # stamps the cache-busting build version
node validate.js        # the same gate CI runs
```

Run them in that order — each depends on the one before.

## Adding content

**Films and series** — edit `data/movies.json` or `data/shows.json`. Never edit
`movies.html` or `shows.html`; they are generated and your changes will be lost.
Each entry needs `title`, `year`, `genre`, and at least one of `metacritic`,
`imdb` or `rt`. Leave `posterPath` as `null` unless you know the real TMDB path —
missing artwork is resolved from Wikipedia at runtime.

**Games and books** — the arrays live inline in the page as `const GAMES = [...]`
and `const BOOKS = [...]`. Edit them with a script rather than by hand.

A scheduled routine refreshes all five catalogues on the 2nd of each month.

### What qualifies for inclusion

A popularity bar, not a quality one — poorly reviewed titles are welcome once
they clear it:

- **Games** — a Metacritic score, or 1,000+ Steam reviews, or a major release
- **Films** — a Metacritic score, or 25+ RT critics, or 5,000+ IMDb votes
- **Series** — one season aired, plus a Metacritic score or 5,000+ IMDb votes
- **Books** — 1,000+ Goodreads ratings, a major prize listing, or a bestseller placing

## Structure

```
index.html                  landing page
games.html   books.html     catalogues with inline data
movies.html  shows.html     generated from data/ — do not edit directly
vocab.html                  vocabulary vault
data/                       source data for the generated pages
assets/
  site.*                    shared chrome: nav, icons, sign-in, share, shortcuts
  theme.*  motion.*         theming and the animation system
  palette.*  features.*     command palette, compare, export, deep links
  polish.css  a11y.*        visual refinement, accessibility
  sw.js  pwa.js             offline support and install prompt
```

Stylesheets load in a fixed order, last one winning ties:

```
site → theme → palette → features → motion → polish → a11y → theme-patch
```

Adding a stylesheet or script means adding it to every page **and** to `SHELL`
in `assets/sw.js`, or offline loads render unstyled. `validate.js` enforces this.

## A note on the data

Scores are compiled from public sources with AI assistance. Entries marked with
a ✓ were checked directly against Metacritic; the rest are close approximations
and may be wrong in the details. Treat Shelf as a discovery tool rather than a
citation source. Cover art is served from Steam, Open Library, TMDB and
Wikipedia and belongs to its respective owners.

Some film and TV posters are non-free images that Wikipedia's API will not
serve, so a few entries show a typographic title card instead. That is expected,
not a loading failure.

## Licence

Source code is [MIT licensed](LICENSE).

That covers the code only. Icons are Lucide (ISC), typefaces are served by
Google Fonts (SIL OFL 1.1), and all cover art, posters and critic scores remain
the property of their respective owners — see [LICENSE](LICENSE) for the full
third-party notices.
