/* Stamps assets/pwa.js's SW_VERSION with a hash of everything the service
   worker precaches.

   The service worker derives its cache name from SW_VERSION, so if that string
   does not change when an asset changes, returning visitors keep getting the
   old file out of the SW cache forever. Hand-editing a version number is the
   kind of step that gets forgotten exactly once and then silently breaks every
   future deploy — so it is derived from content instead.

   Run before every deploy:  node build-version.js
*/
const fs = require('fs');
const crypto = require('crypto');

const FILES = [
  'index.html', 'games.html', 'books.html', 'movies.html', 'shows.html',
  'manifest.webmanifest',
  'assets/site.css', 'assets/theme.css', 'assets/palette.css', 'assets/features.css',
  'assets/motion.css', 'assets/polish.css', 'assets/a11y.css', 'assets/theme-patch.css',
  'assets/site.js', 'assets/theme.js', 'assets/motion.js', 'assets/palette.js',
  'assets/features.js', 'assets/pwa.js', 'assets/a11y.js', 'assets/theme-fix.js', 'assets/sw.js',
  'assets/stats.json'
];

const h = crypto.createHash('sha256');
let counted = 0;
for (const f of FILES) {
  if (!fs.existsSync(f)) { console.warn('  (missing, skipped) ' + f); continue; }
  let body = fs.readFileSync(f, 'utf8');
  /* Both of these values are DERIVED from this hash and written back into the
     very files being hashed, so they must be blanked out first — otherwise each
     run sees the previous run's stamp and the version never converges. */
  body = body.replace(/<meta name="shelf-build" content="[^"]*">/g, '');
  body = body.replace(/(var SW_VERSION\s*=\s*')[^']*(';)/, '$1$2');
  h.update(f);
  h.update(body);
  counted++;
}
const hash = h.digest('hex').slice(0, 10);

const PWA = 'assets/pwa.js';
let src = fs.readFileSync(PWA, 'utf8');
const re = /(var SW_VERSION\s*=\s*')([^']*)(';)/;
const m = src.match(re);
if (!m) { console.error('SW_VERSION not found in ' + PWA); process.exit(1); }

if (m[2] === hash) {
  console.log('SW_VERSION already current: ' + hash + '  (' + counted + ' files)');
} else {
  src = src.replace(re, '$1' + hash + '$3');
  fs.writeFileSync(PWA, src);
  console.log('SW_VERSION ' + m[2] + ' -> ' + hash + '  (' + counted + ' files hashed)');
}

/* Stamp the root worker shim so its bytes change -> browsers re-install it. */
{
  const shim = "sw.js";
  let s = fs.readFileSync(shim, "utf8");
  const sre = /(BUILD_STAMP: )([\w.\-]+)/;
  if (sre.test(s)) {
    s = s.replace(sre, "$1" + hash);
    fs.writeFileSync(shim, s);
    console.log("sw.js BUILD_STAMP -> " + hash);
  }
}

/* Re-stamp the pages so the self-heal bootstrap knows the expected build. */
require("child_process").execSync("node _selfheal.js", { stdio: "inherit" });
