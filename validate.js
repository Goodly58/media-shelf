/* Pre-publish checks for Shelf.  Run: node validate.js
 *
 * Every check here exists because that exact thing broke at least once:
 *   - a duplicated `const GAMES =` left a page blank
 *   - a stale service-worker cache hid new builds from returning visitors
 *   - new module files were referenced but never precached, breaking offline
 *   - a class-name collision made a hero line invisible
 *   - hard-coded counts went stale the moment the catalogues grew
 * The Action runs this before publishing, so these fail the build, not the site.
 */
const fs = require('fs');
const path = require('path');

const PAGES = ['index.html', 'games.html', 'books.html', 'movies.html', 'shows.html'];
const fail = [];
const warn = [];
const ok = [];

const read = f => fs.readFileSync(f, 'utf8');
const has = f => fs.existsSync(f);

/* ---------- 1. every page exists and its inline JS parses ---------- */
for (const p of PAGES) {
  if (!has(p)) { fail.push(`${p} is missing`); continue; }
  const h = read(p);
  let n = 0;
  for (const m of h.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] || '';
    if (/\bsrc=/.test(attrs)) continue;
    if (/type\s*=\s*"(?!text\/javascript)/i.test(attrs)) continue;  // ld+json etc
    n++;
    try { new Function(m[2]); }
    catch (e) { fail.push(`${p}: inline script #${n} — ${e.message}`); }
  }
}
ok.push(`${PAGES.length} pages parsed`);

/* ---------- 2. standalone JS parses ---------- */
const jsFiles = fs.readdirSync('assets').filter(f => f.endsWith('.js')).map(f => 'assets/' + f);
if (has('sw.js')) jsFiles.push('sw.js');
for (const f of jsFiles) {
  try { new Function(read(f)); }
  catch (e) { fail.push(`${f} — ${e.message}`); }
}
ok.push(`${jsFiles.length} scripts parsed`);

/* ---------- 3. a dataset must be declared exactly once ---------- */
for (const [p, v] of [['games.html','GAMES'], ['books.html','BOOKS'], ['movies.html','MOVIES'], ['shows.html','SHOWS']]) {
  if (!has(p)) continue;
  const c = (read(p).match(new RegExp('const ' + v + ' = ', 'g')) || []).length;
  if (c !== 1) fail.push(`${p}: found ${c} \`const ${v} =\` declarations, expected exactly 1`);
}

/* ---------- 4. referenced assets exist AND are precached ---------- */
const swSrc = has('assets/sw.js') ? read('assets/sw.js') : '';
const shell = (swSrc.match(/var SHELL = \[([\s\S]*?)\]\.map/) || [])[1] || '';
for (const p of PAGES) {
  if (!has(p)) continue;
  const h = read(p);
  const refs = new Set();
  for (const m of h.matchAll(/(?:href|src)="(assets\/[^"]+\.(?:css|js))"/g)) refs.add(m[1]);
  for (const r of refs) {
    if (!has(r)) fail.push(`${p} references ${r}, which does not exist`);
    else if (shell && !shell.includes(`'${r}'`)) {
      fail.push(`${r} is referenced by ${p} but not in the service-worker precache (offline would break)`);
    }
  }
  if (!has(p)) continue;
  if (!/<link rel="manifest"/.test(h)) warn.push(`${p} has no manifest link`);
  if (!/name="shelf-build"/.test(h)) fail.push(`${p} has no build stamp`);
}
ok.push('asset references + precache coverage');

/* ---------- 5. build stamps agree with SW_VERSION ---------- */
const version = (read('assets/pwa.js').match(/var SW_VERSION\s*=\s*'([^']*)'/) || [])[1];
if (!version || version === 'dev') fail.push('SW_VERSION is unset — run node build-version.js');
for (const p of PAGES) {
  if (!has(p)) continue;
  const stamp = (read(p).match(/name="shelf-build" content="([^"]+)"/) || [])[1];
  if (stamp !== version) fail.push(`${p} stamp ${stamp} != SW_VERSION ${version} — build is stale`);
}
if (has('sw.js')) {
  const shim = (read('sw.js').match(/BUILD_STAMP: ([\w.\-]+)/) || [])[1];
  if (shim !== version) fail.push(`sw.js BUILD_STAMP ${shim} != SW_VERSION ${version} — stale workers will not update`);
}
ok.push(`build stamp ${version} consistent`);

/* ---------- 6. stats.json matches the real data ---------- */
if (!has('assets/stats.json')) fail.push('assets/stats.json missing — run node build-stats.js');
else {
  const s = JSON.parse(read('assets/stats.json'));
  const count = (file, v) => {
    if (!has(file)) return null;
    const h = read(file);
    const m = h.match(new RegExp('const ' + v + ' = (\\[[\\s\\S]*?\\]);\\n'));
    try { return m ? JSON.parse(m[1]).length : null; } catch (e) { return null; }
  };
  for (const [file, v, key] of [['games.html','GAMES','games'], ['books.html','BOOKS','books'],
                                ['movies.html','MOVIES','movies'], ['shows.html','SHOWS','shows']]) {
    const n = count(file, v);
    if (n != null && s[key] !== n) fail.push(`stats.json ${key}=${s[key]} but ${file} holds ${n} — run node build-stats.js`);
  }
  ok.push('stats.json matches the datasets');
}

/* ---------- 7. no hard-coded catalogue numbers in visible copy ---------- */
const stats = has('assets/stats.json') ? JSON.parse(read('assets/stats.json')) : {};
const live = [stats.games, stats.books, stats.movies, stats.shows].filter(Boolean);
for (const p of PAGES) {
  if (!has(p)) continue;
  let h = read(p);
  h = h.replace(/const (GAMES|BOOKS|MOVIES|SHOWS) = \[[\s\S]*?\];\n/, '');  // drop the data
  h = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  for (const n of live) {
    const grouped = n.toLocaleString('en-US');
    if (h.includes(grouped) || new RegExp('\\b' + n + '\\b').test(h)) {
      fail.push(`${p} hard-codes the count ${grouped} in visible copy — it must come from stats.json`);
    }
  }
}
ok.push('no hard-coded counts in copy');

/* ---------- 7b. modules must actually RUN, not merely parse ----------
   Parsing is not enough: `addEventListener(visibilitychange, …)` — a missing
   pair of quotes — parses perfectly and then throws a ReferenceError at load,
   which killed the whole motion module on every page while every check here
   still passed. Executing each module against a permissive DOM stub catches
   that class of error. The stub answers almost anything, so a failure here
   means a genuine top-level throw rather than a missing browser feature. */
{
  const stub = () => {
    const any = new Proxy(function () {}, {
      get: (t, k) => {
        if (k === Symbol.toPrimitive || k === 'toString') return () => '';
        if (k === 'length') return 0;
        if (k === Symbol.iterator) return function* () {};
        // Every module opens with `if (window.ShelfX) return;` to avoid double
        // installing. A blanket-truthy proxy would satisfy that guard and the
        // module would return before running a single line — so these must read
        // as undefined or this whole check silently tests nothing.
        if (typeof k === 'string' && /^Shelf/.test(k)) return undefined;
        return any;
      },
      set: () => true,
      apply: () => any,
      construct: () => any,
      has: () => true
    });
    return any;
  };
  // Browser globals the modules legitimately reference bare (not via window.*).
  const GLOBALS = ['window', 'document', 'self', 'globalThis', 'navigator', 'location',
    'localStorage', 'sessionStorage', 'MutationObserver', 'IntersectionObserver',
    'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'fetch', 'caches',
    'performance', 'Event', 'CustomEvent', 'KeyboardEvent', 'URL', 'URLSearchParams',
    'TextEncoder', 'crypto', 'Audio', 'Image', 'Blob', 'FileReader', 'DOMParser',
    'speechSynthesis', 'SpeechSynthesisUtterance', 'getComputedStyle', 'history', 'screen'];
  const modules = ['site.js', 'theme.js', 'motion.js', 'palette.js', 'features.js', 'a11y.js', 'theme-fix.js', 'pwa.js'];
  for (const m of modules) {
    const f = 'assets/' + m;
    if (!has(f)) continue;
    try {
      const args = GLOBALS.map(() => stub());
      new Function(...GLOBALS, '"use strict";' + read(f))(...args);
    } catch (e) {
      if (e instanceof ReferenceError || e instanceof SyntaxError) {
        fail.push(`${f} throws on load — ${e.constructor.name}: ${e.message}`);
      } else {
        warn.push(`${f} threw under the DOM stub (${e.constructor.name}: ${e.message}) — likely a stub gap, check manually`);
      }
    }
  }
  ok.push(`${modules.length} modules execute`);
}

/* ---------- 8. every data-icon used in markup actually exists ----------
   A missing icon renders nothing at all — silently. Both new page logos and
   their nav entries were invisible for a while because two icons were never
   added to the set. */
{
  const site = read('assets/site.js');
  const block = site.match(/var ICONS = \{[\s\S]*?\n  \};/);
  if (!block) fail.push('assets/site.js: ICONS block not found');
  else {
    const defined = new Set([...block[0].matchAll(/"([\w-]+)":/g)].map(m => m[1]));
    const used = new Map();
    for (const p of PAGES) {
      if (!has(p)) continue;
      for (const m of read(p).matchAll(/data-icon="([\w-]+)"/g)) {
        if (!used.has(m[1])) used.set(m[1], p);
      }
    }
    // icons referenced from JS (nav entries, dynamically built cards)
    for (const f of ['assets/site.js', 'assets/palette.js']) {
      if (!has(f)) continue;
      for (const m of read(f).matchAll(/icon: '([\w-]+)'/g)) {
        if (!used.has(m[1])) used.set(m[1], f);
      }
    }
    for (const [name, where] of used) {
      if (!defined.has(name)) fail.push(`icon "${name}" used in ${where} is not defined in site.js ICONS`);
    }
    ok.push(`${used.size} icons resolve`);
  }
}

/* ---------- 9. source data is intact ---------- */
for (const f of ['data/movies.json', 'data/shows.json']) {
  if (!has(f)) { warn.push(`${f} missing — movies/shows cannot be rebuilt from source`); continue; }
  try {
    const a = JSON.parse(read(f));
    if (!Array.isArray(a) || !a.length) fail.push(`${f} is empty`);
    else if (!a[0].title) fail.push(`${f} rows have no title field`);
  } catch (e) { fail.push(`${f} — ${e.message}`); }
}

/* ---------- report ---------- */
for (const o of ok)   console.log('  ok    ' + o);
for (const w of warn) console.log('  warn  ' + w);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(fail.length ? `\n${fail.length} check(s) failed` : `\nall checks passed`);
process.exit(fail.length ? 1 : 0);
