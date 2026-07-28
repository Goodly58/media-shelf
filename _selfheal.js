const fs = require('fs');

/* A service worker that precaches its own registrar can deadlock: the worker
   serves the old pwa.js, which re-registers the old worker, forever. HTML
   navigations are stale-while-revalidate, so the markup DOES refresh — which
   makes an inline <head> snippet the one piece of code guaranteed to be fresh.
   It compares the build stamped into the page against the worker that is
   actually running and, on a mismatch, tears the worker down and reloads once. */

const BOOT = `<script>/* SW self-heal: the page is always fresh, so let it repair a stale worker. */
(function(){if(!('serviceWorker'in navigator))return;var el=document.querySelector('meta[name="shelf-build"]');var want=el&&el.content;if(!want)return;
navigator.serviceWorker.getRegistrations().then(function(rs){if(!rs.length)return;var sw=rs[0].active||rs[0].waiting||rs[0].installing;if(!sw)return;
var got=(sw.scriptURL.match(/[?&]v=([^&]+)/)||[])[1];if(got===want)return;
var k='shelf_heal_'+want;if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1');
Promise.all(rs.map(function(r){return r.unregister();})).then(function(){
return (window.caches?caches.keys():Promise.resolve([])).then(function(ns){
return Promise.all(ns.filter(function(n){return n.indexOf('shelf-shell-')===0;}).map(function(n){return caches.delete(n);}));});
}).then(function(){location.reload();}).catch(function(){});});})();
</script>`;

const PAGES = ['index.html', 'games.html', 'books.html', 'movies.html', 'shows.html'];
const version = (fs.readFileSync('assets/pwa.js', 'utf8').match(/var SW_VERSION\s*=\s*'([^']*)'/) || [])[1];
if (!version) { console.error('could not read SW_VERSION'); process.exit(1); }

for (const p of PAGES) {
  let h = fs.readFileSync(p, 'utf8');
  const before = h;

  // build stamp
  const metaRe = /<meta name="shelf-build" content="[^"]*">/;
  const meta = `<meta name="shelf-build" content="${version}">`;
  if (metaRe.test(h)) h = h.replace(metaRe, meta);
  else h = h.replace(/(<meta name="viewport"[^>]*>)/, '$1\n' + meta);

  // bootstrap (idempotent)
  if (!h.includes('SW self-heal')) {
    h = h.replace('</head>', BOOT + '\n</head>');
  }

  fs.writeFileSync(p, h);
  console.log(p.padEnd(12), 'changed:', before !== h, '| stamp:', version, '| heal:', h.includes('SW self-heal'));
}
