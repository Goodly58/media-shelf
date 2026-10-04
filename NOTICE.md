# Third-party notices

The [MIT licence](LICENSE) covers the source code of this project. It does not,
and cannot, cover the following, which remain the property of their respective
owners.

## Bundled

**Lucide**: icons, used under the ISC Licence.
Copyright (c) 2022 Lucide Contributors. <https://lucide.dev>
The SVG paths are inlined in `assets/app.js`.

## Loaded at runtime

**Inter**: typeface served by Google Fonts under the SIL Open Font Licence 1.1.

**Cover art and posters**: loaded on demand from Wikimedia (Wikipedia), TVmaze,
Steam, Open Library and TMDB. None of it is stored in this repository, and all
of it remains copyright of the respective publishers and studios. TVmaze data is
used under CC BY-SA 4.0 (<https://www.tvmaze.com>).

**Summaries**: fetched from Wikipedia when a title is opened, under CC BY-SA 4.0,
and linked back to the article.

## Data

Scores come from **IMDb** (the official IMDb datasets, used for personal and
non-commercial purposes), **Metacritic**, **Rotten Tomatoes**, **Steam**,
**Goodreads** and **IGN**. Links between titles and their pages come from
**Wikidata** (CC0). Subgenres, themes and countries of films and series are
derived from the categories of their **Wikipedia** articles. The refresh pipeline in `scripts/refresh/` reads each score
from its source and records nothing it could not read there.

This project is not affiliated with, endorsed by, or connected to any of the
services named above.
