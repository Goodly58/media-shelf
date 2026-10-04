# tools

Scripts that check catalogue scores against their sources and repair what is
wrong. None of them run in CI, and none are needed to build the site.

Run them from the repo root:

```bash
node tools/metacritic/verify_games.mjs           # report only
node tools/metacritic/verify_games.mjs --apply   # write the corrections
npm run build && npm run validate                # then rebuild as usual
```

Most are report-only unless given `--apply`; the header comment of each script
says what it reads, what it writes and how to run it. Caches, queues and
reports are written to the repo root as `_*.json` and are gitignored, so a
rerun resumes where the last one stopped.

| Folder | Source | What is there |
| --- | --- | --- |
| `metacritic/` | metacritic.com | Metascore verification for games, films and series |
| `goodreads/` | goodreads.com | Book rating verification, including the ISBN-less remainder |
| `imdb/` | IMDb datasets + suggest API | IMDb rating checks and id repair |
| `steam/` | Steam store, SteamSpy | Steam id repair, missing ids, genre tags |
| `rotten-tomatoes/` | rottentomatoes.com | Critic scores for films and series |
| `ign/` | ign.com | Editorial review scores (run locally, see the script header) |

The three scripts at the top level (`scrape.mjs`, `apply_rest.mjs`,
`apply_verified.mjs`) span more than one source.
