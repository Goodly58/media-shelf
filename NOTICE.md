# Third-party notices

The [MIT licence](LICENSE) covers the source code of this project. It does not,
and cannot, cover the following, which remain the property of their respective
owners.

## Bundled

**Lucide**: icons, used under the ISC Licence.
Copyright (c) 2022 Lucide Contributors. <https://lucide.dev>
The SVG paths are inlined in `assets/app.js`.

**Inter**: typeface, used under the SIL Open Font Licence 1.1.
Copyright (c) 2016 The Inter Project Authors. <https://github.com/rsms/inter>
The font files and the full licence are in `assets/` (`inter-LICENSE.txt`).

**hls.js** (<https://github.com/video-dev/hls.js>), which plays Steam's game trailers in
browsers without built-in HLS: Copyright (c) 2017 Dailymotion, Apache License 2.0. The
file is `assets/hls.min.js`, its licence `assets/hls-LICENSE.txt`.

## Loaded at runtime

**Cover art and posters**: loaded on demand from Wikimedia (Wikipedia), TVmaze
and Steam. Book covers are small copies of Open Library's (Goodreads' where Open
Library has none), kept in `covers/` so they load quickly. All of it remains
copyright of the respective publishers and studios. TVmaze data is
used under CC BY-SA 4.0 (<https://www.tvmaze.com>).

**Trailers**: YouTube videos, played in YouTube's own embedded player in its
privacy-enhanced mode (youtube-nocookie.com) and only when the trailer feed is
opened. Which video belongs to which title comes from the KinoCheck API
(<https://api.kinocheck.com>) and Wikidata, and from TMDB when the refresh has a key
for it. This website uses TMDB and the TMDB APIs but is not endorsed, certified, or
otherwise approved by TMDB. The videos remain the property of their owners.

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
