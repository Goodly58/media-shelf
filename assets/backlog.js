/* ============================================================================
   Shelf — backlog.js
   Reads an export from Goodreads / Letterboxd (or a pasted list), matches it
   against this site's catalogues, and answers the question none of those sites
   answer: **of the things I already own or mean to get to, what should I do
   next, in the time I actually have?**

   Goodreads knows your to-read pile but rates by popularity and will not tell
   you which of them are short. Metacritic knows quality but has never heard of
   your list. This joins the two.

   THE FILE NEVER LEAVES THE BROWSER. There is no backend to send it to — the
   whole site is static — so that is a property of the architecture rather than
   a promise. Everything below runs on the main thread against a File the user
   picked; nothing is fetched, stored on a server, or logged.

   Exposed as window.ShelfBacklog. Pure functions are exported for validate.js
   and for the tests in backlog.test.js.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     1. CSV
     Exports are real CSV: quoted fields, embedded commas, embedded newlines,
     doubled quotes. A split(',') would corrupt any title containing a comma —
     which is most of them once subtitles appear.
     ------------------------------------------------------------------ */

  /**
   * @param {string} text
   * @returns {string[][]} rows of raw cells
   */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    // Strip a BOM: Excel puts one there and it corrupts the first header.
    const src = String(text || '').replace(/^﻿/, '');

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];

      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i++; }
          else quoted = false;
        } else cell += ch;
        continue;
      }

      if (ch === '"') { quoted = true; continue; }
      if (ch === ',') { row.push(cell); cell = ''; continue; }
      if (ch === '\r') continue;
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r[0] || '').trim() !== ''; });
  }

  /**
   * Rows keyed by header name.
   * @param {string} text
   * @returns {Record<string,string>[]}
   */
  function parseCsvObjects(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const head = rows[0].map(function (h) { return String(h).trim(); });
    return rows.slice(1).map(function (r) {
      const o = {};
      for (let i = 0; i < head.length; i++) o[head[i]] = (r[i] !== undefined ? r[i] : '').trim();
      return o;
    });
  }

  /** Goodreads writes ISBNs as `="9780441013593"` so Excel keeps the zeros. */
  function unwrapExcel(v) {
    const s = String(v == null ? '' : v).trim();
    const m = s.match(/^="?(.*?)"?$/);
    return (m ? m[1] : s).trim();
  }

  function num(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
  }

  /* ---------------------------------------------------------------------
     2. Recognising an export
     Detection is by COLUMN SHAPE, not by filename: people rename downloads,
     and "export.csv" tells us nothing.
     ------------------------------------------------------------------ */

  const SOURCES = [
    {
      id: 'goodreads',
      label: 'Goodreads',
      kind: 'books',
      detect: function (h) { return h.indexOf('Exclusive Shelf') >= 0 || (h.indexOf('Book Id') >= 0 && h.indexOf('Title') >= 0); },
      parse: function (rows) {
        return rows.map(function (r) {
          // Goodreads ships the page count and its own average rating in the
          // file, so a book we have never heard of is still rankable. That is
          // what makes this work on a whole list rather than on the overlap.
          const shelf = (r['Exclusive Shelf'] || '').toLowerCase();
          return {
            title: r.Title || '',
            creator: r.Author || '',
            year: num(r['Original Publication Year']) || num(r['Year Published']),
            pages: num(r['Number of Pages']),
            isbn: unwrapExcel(r.ISBN13) || unwrapExcel(r.ISBN),
            myRating: num(r['My Rating']) || null,
            theirRating: num(r['Average Rating']),
            status: shelf === 'read' ? 'done' : shelf === 'currently-reading' ? 'doing' : 'todo',
            shelves: (r.Bookshelves || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
          };
        }).filter(function (b) { return b.title; });
      }
    },
    {
      id: 'letterboxd',
      label: 'Letterboxd',
      kind: 'movies',
      detect: function (h) { return h.indexOf('Letterboxd URI') >= 0; },
      parse: function (rows) {
        return rows.map(function (r) {
          const rating = num(r.Rating);
          return {
            title: r.Name || '',
            creator: '',
            year: num(r.Year),
            pages: null,
            isbn: '',
            myRating: rating,
            // A watchlist row has no rating; a diary or ratings row does, and a
            // rated film has by definition already been watched.
            theirRating: null,
            status: rating != null || r['Watched Date'] ? 'done' : 'todo',
            shelves: []
          };
        }).filter(function (m) { return m.title; });
      }
    },
    {
      id: 'imdb',
      label: 'IMDb',
      kind: 'movies',
      detect: function (h) { return h.indexOf('Const') >= 0 && h.indexOf('Title Type') >= 0; },
      parse: function (rows) {
        return rows.map(function (r) {
          return {
            title: r.Title || r['Original Title'] || '',
            creator: r.Directors || '',
            year: num(r.Year),
            pages: null,
            isbn: '',
            myRating: num(r['Your Rating']),
            theirRating: num(r['IMDb Rating']),
            status: r['Your Rating'] ? 'done' : 'todo',
            shelves: []
          };
        }).filter(function (m) { return m.title; });
      }
    }
  ];

  /**
   * @param {string} text raw file contents
   * @returns {{source: object|null, items: object[], rows: number}}
   */
  function readExport(text) {
    const rows = parseCsvObjects(text);
    if (!rows.length) return { source: null, items: [], rows: 0 };
    const head = Object.keys(rows[0]);
    for (let i = 0; i < SOURCES.length; i++) {
      if (SOURCES[i].detect(head)) {
        return { source: SOURCES[i], items: SOURCES[i].parse(rows), rows: rows.length };
      }
    }
    return { source: null, items: [], rows: rows.length };
  }

  /**
   * The universal fallback: one title per line, optional trailing year.
   * Works for Steam, for a Notes list, for anything — Steam has no CSV export
   * and its community endpoints send no CORS headers, so pasting is the only
   * honest route rather than a broken integration.
   * @param {string} text
   */
  function readPasted(text) {
    const items = String(text || '').split(/\r?\n/).map(function (line) {
      const s = line.trim();
      if (!s) return null;
      const m = s.match(/^(.*?)[\s(]*((?:19|20)\d{2})\)?$/);
      return {
        title: (m ? m[1] : s).replace(/[\s\-–—:,]+$/, '').trim(),
        creator: '', year: m ? Number(m[2]) : null,
        pages: null, isbn: '', myRating: null, theirRating: null,
        status: 'todo', shelves: []
      };
    }).filter(function (i) { return i && i.title; });
    return { source: { id: 'pasted', label: 'your list', kind: null }, items: items, rows: items.length };
  }

  /* ---------------------------------------------------------------------
     3. Matching against the catalogue
     Reuses the rule the score verifier settled on: fold the title, then
     require the year to agree. A title alone does not identify a work —
     Psycho (1960) and Psycho (1998) are different films with one name.
     ------------------------------------------------------------------ */

  function fold(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/\b(the|a|an)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, '');
  }

  /** Years may differ by this much and still be the same work. */
  const YEAR_SLACK = 3;

  function yearsAgree(a, b) {
    if (a == null || b == null) return true; // no year on one side is not a conflict
    const x = Number(a), y = Number(b);
    if (!isFinite(x) || !isFinite(y)) return true;
    return Math.abs(x - y) <= YEAR_SLACK;
  }

  /**
   * @param {object[]} catalogue
   * @returns {Map<string, object[]>} folded title -> entries
   */
  function indexCatalogue(catalogue) {
    const map = new Map();
    for (let i = 0; i < catalogue.length; i++) {
      const key = fold(catalogue[i].title);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(catalogue[i]);
    }
    return map;
  }

  /**
   * @param {object} item from an export
   * @param {Map<string, object[]>} index
   * @returns {object|null}
   */
  function matchOne(item, index) {
    const bucket = index.get(fold(item.title));
    if (!bucket || !bucket.length) return null;
    if (bucket.length === 1) return yearsAgree(item.year, bucket[0].year) ? bucket[0] : null;
    // Several works share the name: the year decides, and if it cannot, we
    // decline rather than guess.
    let best = null;
    for (let i = 0; i < bucket.length; i++) {
      if (!yearsAgree(item.year, bucket[i].year)) continue;
      if (best) return null;
      best = bucket[i];
    }
    return best;
  }

  /* ---------------------------------------------------------------------
     4. Time
     ------------------------------------------------------------------ */

  /**
   * Pages to minutes. 250 words per minute over ~275 words a page is the
   * figure reading-speed research keeps landing on; it is a rough guide and
   * the UI says so rather than pretending to know how fast you read.
   */
  const MINUTES_PER_PAGE = 1.1;

  /**
   * How long this will take, in minutes, or null when we genuinely cannot say.
   * @param {object} item
   * @param {object|null} entry catalogue match
   * @param {string} kind
   */
  function minutesFor(item, entry, kind) {
    if (kind === 'books') {
      const pages = item.pages || (entry && entry.pages) || null;
      return pages ? Math.round(pages * MINUTES_PER_PAGE) : null;
    }
    if (kind === 'movies') return (entry && entry.runtime) || null;
    if (kind === 'shows') {
      if (!entry || !entry.runtime) return null;
      // A series is its whole run: episodes are not listed, so seasons are the
      // only handle, and 10 episodes a season is the streaming-era norm.
      const seasons = entry.seasons || 1;
      return Math.round(entry.runtime * 10 * seasons);
    }
    return null;
  }

  /* ---------------------------------------------------------------------
     5. Scoring
     ------------------------------------------------------------------ */

  /**
   * One 0-100 quality figure per item, and where it came from.
   *
   * The catalogue's verified critic score wins when we have it. Failing that
   * the export's own community rating is used and labelled as such — the point
   * is to rank the WHOLE list, not just the slice we happen to hold, so an
   * unknown book still gets an honest position instead of vanishing.
   */
  function qualityOf(item, entry, kind) {
    if (entry) {
      if (kind === 'books' && entry.rating != null) {
        return { score: Math.round((entry.rating / 5) * 100), basis: 'shelf', verified: false };
      }
      if (entry.metacritic != null) {
        return { score: entry.metacritic, basis: 'critics', verified: !!entry.verified };
      }
    }
    if (item.theirRating != null) {
      const max = item.theirRating > 5 ? 10 : 5;
      return { score: Math.round((item.theirRating / max) * 100), basis: 'community', verified: false };
    }
    return { score: null, basis: 'none', verified: false };
  }

  /* ---------------------------------------------------------------------
     6. The answer
     ------------------------------------------------------------------ */

  /**
   * @param {object} params
   * @param {object[]} params.items      parsed export rows
   * @param {object[]} params.catalogue  this site's entries for that kind
   * @param {string}   params.kind       books | movies | shows
   * @param {number}   [params.minutes]  time available; 0 or null = no limit
   * @param {number}   [params.minScore] quality floor, 0-100
   * @param {string}   [params.status]   todo | done | any
   * @returns {{ rows: object[], stats: object }}
   */
  function build(params) {
    const items = params.items || [];
    const kind = params.kind;
    const index = indexCatalogue(params.catalogue || []);
    const budget = Number(params.minutes) || 0;
    const floor = Number(params.minScore) || 0;
    const want = params.status || 'todo';

    const rows = [];
    let matched = 0, timed = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (want !== 'any' && item.status !== want) continue;

      const entry = matchOne(item, index);
      if (entry) matched++;

      const q = qualityOf(item, entry, kind);
      const mins = minutesFor(item, entry, kind);
      if (mins) timed++;

      rows.push({
        title: (entry && entry.title) || item.title,
        creator: item.creator || (entry && (entry.author || entry.creator)) || '',
        year: item.year || (entry && entry.year) || null,
        genre: (entry && entry.genre) || '',
        blurb: (entry && entry.blurb) || '',
        minutes: mins,
        score: q.score,
        basis: q.basis,
        verified: q.verified,
        inCatalogue: !!entry,
        entry: entry || null,
        item: item
      });
    }

    const eligible = rows.filter(function (r) {
      if (r.score != null && r.score < floor) return false;
      // An unknown length is not disqualifying unless a budget was set — with a
      // budget, "we do not know how long this is" cannot be an answer to "what
      // fits in two hours".
      if (budget) return r.minutes != null && r.minutes <= budget;
      return true;
    });

    eligible.sort(function (a, b) {
      const as = a.score == null ? -1 : a.score;
      const bs = b.score == null ? -1 : b.score;
      if (bs !== as) return bs - as;
      // Same quality: the shorter one wins, because the whole point is to
      // finish something.
      const am = a.minutes == null ? Infinity : a.minutes;
      const bm = b.minutes == null ? Infinity : b.minutes;
      return am - bm;
    });

    return {
      rows: eligible,
      stats: {
        total: items.length,
        considered: rows.length,
        shown: eligible.length,
        matched: matched,
        timed: timed
      }
    };
  }

  /* ------------------------------------------------------------------ */

  const api = {
    parseCsv: parseCsv,
    parseCsvObjects: parseCsvObjects,
    readExport: readExport,
    readPasted: readPasted,
    fold: fold,
    yearsAgree: yearsAgree,
    indexCatalogue: indexCatalogue,
    matchOne: matchOne,
    minutesFor: minutesFor,
    qualityOf: qualityOf,
    build: build,
    SOURCES: SOURCES,
    MINUTES_PER_PAGE: MINUTES_PER_PAGE
  };

  if (typeof window !== 'undefined') window.ShelfBacklog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
