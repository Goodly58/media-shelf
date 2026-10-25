# Contributing

Thanks for wanting to help. Shelf is a static site: templates and data go in, plain HTML comes out, and there is no server or database to set up.

## Run it locally

Node 22.12 or newer.

```bash
npm run build      # generate the site into _site/
npm run serve      # preview it at http://localhost:8080
npm run validate   # the checks the deploy runs
npm test           # unit tests
```

The service worker only registers over https, so a local preview always shows your latest build.

## Deploying

Pushing to `main` deploys: GitHub Actions builds the site, validates it and publishes `_site/`. If validation fails, nothing is published and the live site stays as it was.

## The data

Every score is read from its source by the pipeline in `scripts/refresh/`, one module per source. A GitHub Action runs it every Monday (trailers every day) and commits the new data.

```bash
npm run refresh                       # every source (slow; the weekly job does this)
npm run refresh -- --only=rt,books    # just some steps, then rebuild data/
npm run refresh -- --merge            # rebuild data/ from the fetch caches, fetching nothing
```

The fetch caches live in `.cache/` and are not committed, so a fresh clone has none. Don't run a merge without them: it would rebuild `data/` with most scores missing. Data work belongs in the workflow, which keeps its caches between runs.

Never type a score in by hand. If a source can't give a number, the title goes without it.

## Project layout

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

## Before you open a pull request

Run `npm run build`, `npm run validate` and `npm test`, and keep the copy on the site short.
