/* Generates movies.html and shows.html from one template.

   Both pages deliberately mirror games.html's structure and element IDs, because
   every enhancement layer (motion, palette, features, a11y, theme, polish) binds
   to those hooks. Keeping the contract identical means the new pages inherit all
   of it for free instead of needing their own versions.

   Usage: node build-pages.js
   Reads data/movies.json and data/shows.json.
*/
const fs = require('fs');

const CONFIG = {
  movies: {
    file: 'movies.html', page: 'movies', dataVar: 'MOVIES', json: 'data/movies.json',
    title: 'Film Index — browse movies by Metacritic, IMDb & Rotten Tomatoes',
    desc: 'Browse notable films ranked by Metacritic, IMDb and Rotten Tomatoes. Filter by genre, year and score. Free, no sign-up.',
    icon: '🎬', iconName: 'clapperboard',
    h1: 'FILM <b>INDEX</b>',
    tagline: 'Ranked by Metacritic, IMDb &amp; Rotten Tomatoes — find something worth watching.',
    accent: '--acc:#f05a5a; --acc2:#f0a13c; --accSoft:rgba(240,90,90,.14);',
    bgA: '#2a1620', bgB: '#31210f',
    searchPh: 'Search films, directors…',
    unit: 'films'
  },
  shows: {
    file: 'shows.html', page: 'shows', dataVar: 'SHOWS', json: 'data/shows.json',
    title: 'Series Index — browse TV shows by Metacritic, IMDb & Rotten Tomatoes',
    desc: 'Browse notable TV series ranked by Metacritic, IMDb and Rotten Tomatoes. Filter by genre, year and score. Free, no sign-up.',
    icon: '📺', iconName: 'tv',
    h1: 'SERIES <b>INDEX</b>',
    tagline: 'Ranked by Metacritic, IMDb &amp; Rotten Tomatoes — find your next binge.',
    accent: '--acc:#6f7bff; --acc2:#22c1a6; --accSoft:rgba(111,123,255,.14);',
    bgA: '#161c33', bgB: '#0f2a28',
    searchPh: 'Search series, creators…',
    unit: 'series'
  }
};

const THEME_SNIPPET = `<script>(function(){try{var m=localStorage.getItem('shelf_theme')||'auto';if(m!=='light'&&m!=='dark'&&m!=='auto')m='auto';var r=m==='auto'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):m;var e=document.documentElement;e.setAttribute('data-theme',r);e.setAttribute('data-theme-mode',m);e.style.colorScheme=r;}catch(_){document.documentElement.setAttribute('data-theme','dark');}})();</script>`;

const HEAL = `<script>/* SW self-heal: the page is always fresh, so let it repair a stale worker. */
(function(){if(!('serviceWorker'in navigator))return;var el=document.querySelector('meta[name="shelf-build"]');var want=el&&el.content;if(!want)return;
navigator.serviceWorker.getRegistrations().then(function(rs){if(!rs.length)return;var sw=rs[0].active||rs[0].waiting||rs[0].installing;if(!sw)return;
var got=(sw.scriptURL.match(/[?&]v=([^&]+)/)||[])[1];if(got===want)return;
var k='shelf_heal_'+want;if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1');
Promise.all(rs.map(function(r){return r.unregister();})).then(function(){
return (window.caches?caches.keys():Promise.resolve([])).then(function(ns){
return Promise.all(ns.filter(function(n){return n.indexOf('shelf-shell-')===0;}).map(function(n){return caches.delete(n);}));});
}).then(function(){location.reload();}).catch(function(){});});})();
</script>`;

const CSS_LINKS = ['site','theme','palette','features','motion','polish','a11y','theme-patch']
  .map(n => `<link rel="stylesheet" href="assets/${n}.css">`).join('\n');
const JS_TAGS = ['site','theme','motion','palette','features','pwa','a11y','theme-fix']
  .map(n => `<script src="assets/${n}.js" defer></script>`).join('\n');

const PWA_HEAD = `<link rel="manifest" href="manifest.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Shelf">
<link rel="apple-touch-icon" href="assets/icon.svg">`;

function page(c, data) {
  const isShow = c.page === 'shows';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${THEME_SNIPPET}
<meta name="shelf-build" content="dev">
<title>${c.title}</title>
<meta name="description" content="${c.desc}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${c.icon}</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0a0c11; --bg2:#0d1017; --panel:#13161f; --panel2:#1a1e2a; --panel3:#222736;
    --line:#262c3b; --line2:#323a4d;
    --txt:#eef1f7; --txt2:#c2c9d8; --mut:#8b94a8; --mut2:#5f6878;
    ${c.accent}
    --good:#00ce7c; --mid:#ffc24b; --bad:#ff6874;
    --shadow:0 18px 40px -12px rgba(0,0,0,.65); --r:16px;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;min-height:100vh;color:var(--txt);
    font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    background:
      radial-gradient(1100px 520px at 12% -8%, ${c.bgA} 0%, transparent 58%),
      radial-gradient(900px 520px at 92% -4%, ${c.bgB} 0%, transparent 55%),
      var(--bg);}
  ::selection{background:var(--accSoft)}
  *::-webkit-scrollbar{height:10px;width:10px}
  *::-webkit-scrollbar-thumb{background:var(--line2);border-radius:20px}

  .wrap{max-width:1560px;margin:0 auto;padding:0 26px}
  header{padding:30px 0 18px}
  .brandrow{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:14px}
  .logo{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;font-size:24px;
    background:linear-gradient(135deg,var(--acc),var(--acc2));box-shadow:0 8px 22px -6px var(--accSoft)}
  .logo .ic{width:24px;height:24px}
  h1{margin:0;font-size:25px;font-weight:800;letter-spacing:-.4px;line-height:1}
  h1 b{background:linear-gradient(90deg,#fff,var(--acc));-webkit-background-clip:text;background-clip:text;color:transparent}
  .tagline{color:var(--mut);font-size:13.5px;margin-top:6px;font-weight:500}
  .stats{display:flex;gap:12px;flex-wrap:wrap}
  .stat{background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line);
    border-radius:14px;padding:11px 16px;min-width:92px}
  .stat .v{font-size:20px;font-weight:800;letter-spacing:-.5px}
  .stat .l{font-size:10.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.8px;margin-top:2px;font-weight:600}
  .stat.good .v{color:var(--good)} .stat.acc .v{color:var(--acc)}

  .toolbar{position:sticky;top:0;z-index:40;margin-top:14px;
    background:rgba(10,12,17,.78);backdrop-filter:blur(14px) saturate(1.2);
    border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .toolbar .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 0}
  .search{position:relative;flex:1;min-width:240px}
  .search svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);opacity:.5}
  .search input{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:11px;
    color:var(--txt);font-size:14px;padding:12px 12px 12px 40px;outline:none;font-family:inherit;transition:.15s}
  .search input:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--accSoft)}
  .search kbd{position:absolute;right:11px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--mut2);
    border:1px solid var(--line2);border-radius:6px;padding:1px 6px;font-family:inherit;background:var(--bg2)}
  .ctl{display:flex;flex-direction:column;gap:4px}
  .ctl label{font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:.7px;font-weight:600;padding-left:2px}
  select{appearance:none;background:var(--panel2)
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238b94a8' stroke-width='2.5'><path d='M6 9l6 6 6-6'/></svg>")
    no-repeat right 11px center;
    color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:10px 32px 10px 12px;
    font-size:13.5px;font-family:inherit;outline:none;cursor:pointer;transition:.15s}
  select:hover{border-color:var(--line2)} select:focus{border-color:var(--acc)}
  .btn{display:inline-flex;align-items:center;gap:7px;background:var(--panel2);color:var(--txt2);
    border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-size:13.5px;font-weight:600;
    font-family:inherit;cursor:pointer;transition:.15s;white-space:nowrap}
  .btn:hover{border-color:var(--line2);color:var(--txt);transform:translateY(-1px)}
  .btn.on{background:linear-gradient(90deg,var(--acc),var(--acc2));border-color:transparent;color:#fff}
  .seg{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .seg button{background:var(--panel2);border:0;color:var(--mut);padding:10px 12px;cursor:pointer;font-size:14px;
    display:inline-flex;align-items:center;justify-content:center;transition:.15s}
  .seg button.on{background:var(--panel3);color:var(--txt)}
  .seg button .ic{width:16px;height:16px}
  .range{width:190px;padding-top:3px}
  .range .vals{display:flex;justify-content:space-between;font-size:12px;color:var(--txt2);font-weight:600;margin-bottom:6px}
  .slider{position:relative;height:24px}
  .slider .track{position:absolute;top:10px;left:0;right:0;height:4px;background:var(--line2);border-radius:4px}
  .slider .fill{position:absolute;top:10px;height:4px;background:linear-gradient(90deg,var(--acc),var(--acc2));border-radius:4px}
  .slider input{-webkit-appearance:none;appearance:none;position:absolute;top:0;left:0;width:100%;height:24px;
    background:none;pointer-events:none;margin:0}
  .slider input::-webkit-slider-thumb{-webkit-appearance:none;pointer-events:all;width:16px;height:16px;border-radius:50%;
    background:#fff;border:3px solid var(--acc);cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,.5)}
  .slider input::-moz-range-thumb{pointer-events:all;width:16px;height:16px;border-radius:50%;
    background:#fff;border:3px solid var(--acc);cursor:grab}

  .chips{display:flex;gap:8px;overflow-x:auto;padding:0 0 14px;scrollbar-width:thin}
  .chip{cursor:pointer;user-select:none;white-space:nowrap;padding:8px 14px;border-radius:999px;font-size:13px;
    font-weight:600;border:1px solid var(--line);background:var(--panel);color:var(--mut);transition:.15s}
  .chip:hover{border-color:var(--line2);color:var(--txt2)}
  .chip .n{opacity:.55;font-weight:700;margin-left:3px}
  .chip.on{background:var(--accSoft);border-color:var(--acc);color:var(--txt)}

  .statusrow{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 0 4px;font-size:13px;color:var(--mut)}
  .statusrow b{color:var(--txt)}
  .pill{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-weight:600;color:var(--txt2)}

  /* poster grid — 2:3 portrait, like the book shelf */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:22px 18px;padding:14px 0 50px}
  .card{position:relative;cursor:pointer;display:flex;flex-direction:column;gap:10px;transition:transform .18s}
  .card:hover{transform:translateY(-5px)}
  .cover{position:relative;aspect-ratio:2/3;border-radius:12px;overflow:hidden;background:#0f1219;
    box-shadow:0 12px 26px -10px rgba(0,0,0,.7),inset 0 0 0 1px rgba(255,255,255,.04);transition:box-shadow .18s}
  .card:hover .cover{box-shadow:0 20px 38px -10px rgba(0,0,0,.85),0 0 0 1px var(--line2)}
  .cover .sk{position:absolute;inset:0;background:linear-gradient(110deg,#161b27 8%,#1e2433 18%,#161b27 33%);
    background-size:220% 100%;animation:sh 1.3s linear infinite}
  @keyframes sh{to{background-position:-220% 0}}
  .cover img{position:relative;width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .35s}
  .cover img.ok{opacity:1}
  .cover img.lazyart.ok{opacity:1}
  /* Title card, shown when no artwork exists. A fair number of film and TV
     posters are non-free images that Wikipedia's API will not serve, so this is
     a permanent state for some entries, not a loading failure — it is designed
     to look like a deliberate typographic poster rather than a broken image. */
  .ph{position:absolute;inset:0;display:none;flex-direction:column;justify-content:flex-end;
    gap:6px;text-align:left;padding:16px 15px;overflow:hidden;
    background:
      radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--acc) 26%, transparent), transparent 70%),
      linear-gradient(165deg,#1c2333 0%,#12151f 55%,#0d1017 100%)}
  .ph::before{content:'';position:absolute;inset:0;opacity:.55;
    background:
      repeating-linear-gradient(115deg, rgba(255,255,255,.045) 0 1px, transparent 1px 7px);
    -webkit-mask-image:radial-gradient(90% 70% at 50% 0%,#000,transparent 76%);
            mask-image:radial-gradient(90% 70% at 50% 0%,#000,transparent 76%)}
  .ph .pmark{position:absolute;top:12px;left:14px;width:22px;height:22px;border-radius:6px;
    display:grid;place-items:center;opacity:.5;
    background:linear-gradient(135deg,var(--acc),var(--acc2))}
  .ph .pmark .ic{width:13px;height:13px;color:#0a0d13}
  .ph .pt{position:relative;font-family:'Fraunces',serif;font-weight:900;font-size:16px;
    color:#e9eefb;line-height:1.18;letter-spacing:-.2px;
    display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
  .ph .pa{position:relative;font-size:11px;color:var(--mut);letter-spacing:.2px}
  .grad{position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(8,10,15,.55));pointer-events:none}
  .mc{position:absolute;top:9px;right:9px;width:38px;height:38px;border-radius:10px;display:grid;place-items:center;
    font-weight:800;font-size:15px;color:#08130d;box-shadow:0 5px 14px rgba(0,0,0,.55);border:2px solid rgba(255,255,255,.18)}
  .mc.bad{color:#2a0c10} .mc.mid{color:#231900}
  .fav{position:absolute;top:9px;left:9px;z-index:3;width:30px;height:30px;border-radius:9px;cursor:pointer;
    display:grid;place-items:center;font-size:15px;background:rgba(8,10,15,.62);backdrop-filter:blur(3px);
    border:1px solid var(--line2);color:#aab3c6;transition:.15s}
  .fav:hover{color:var(--mid);border-color:var(--mid);transform:scale(1.08)}
  .fav.on{color:var(--mid);border-color:var(--mid)}
  .yearbadge{position:absolute;bottom:8px;left:8px;z-index:3;font-size:11px;font-weight:700;color:var(--txt2);
    background:rgba(8,10,15,.72);backdrop-filter:blur(3px);border:1px solid var(--line2);border-radius:7px;padding:2px 7px}
  /* Shown only when the Metascore was read off metacritic.com directly. */
  .verified{position:absolute;bottom:8px;right:8px;z-index:3;display:inline-flex;align-items:center;gap:3px;
    font-size:10px;font-weight:800;letter-spacing:.3px;color:#8ff3c8;background:rgba(0,40,26,.78);
    backdrop-filter:blur(3px);border:1px solid rgba(0,206,124,.45);border-radius:7px;padding:2px 6px}
  .verified .ic{width:11px;height:11px}
  .mverified{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:#8ff3c8;
    background:rgba(0,40,26,.6);border:1px solid rgba(0,206,124,.4);border-radius:7px;padding:3px 9px}
  .mverified .ic{width:12px;height:12px}
  .body{display:flex;flex-direction:column;gap:5px;padding:0 2px}
  .ttl{font-size:14.5px;font-weight:700;line-height:1.25;letter-spacing:-.2px;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .meta{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--mut);font-weight:500;flex-wrap:wrap}
  .meta .dot{width:3px;height:3px;border-radius:50%;background:var(--mut2)}
  .scores{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:1px}
  .imdb{display:inline-flex;align-items:center;gap:4px;font-weight:800;font-size:11px;color:#1a1a1a;
    background:#f5c518;border-radius:5px;padding:2px 6px}
  .rt{display:inline-flex;align-items:center;gap:4px;font-weight:700;font-size:11px;color:#fff;
    background:#fa320a;border-radius:5px;padding:2px 6px}
  .rt.rotten{background:#0ac855;color:#04210f}
  .blurb{display:none}

  .grid.list{grid-template-columns:1fr;gap:10px}
  .grid.list .card{flex-direction:row;align-items:flex-start;gap:16px;padding:8px;border:1px solid var(--line);
    border-radius:12px;background:linear-gradient(180deg,var(--panel),var(--bg2))}
  .grid.list .card:hover{transform:translateY(-2px);border-color:var(--line2)}
  .grid.list .cover{width:78px;flex:0 0 78px;aspect-ratio:2/3}
  .grid.list .grad,.grid.list .yearbadge{display:none}
  .grid.list .ttl{-webkit-line-clamp:1;font-size:16px}
  .grid.list .blurb{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
    font-size:12.5px;color:var(--mut);line-height:1.45;max-width:720px;margin-top:2px}
  @media(max-width:600px){ .grid.list .cover{width:58px;flex:0 0 58px} }

  #sentinel{height:1px}
  .loadmore{text-align:center;color:var(--mut);font-size:12.5px;padding:0 0 50px}
  .empty{display:none;text-align:center;color:var(--mut);padding:70px 20px}
  .empty .big{font-size:40px;margin-bottom:10px}
  .empty .big .ic{width:40px;height:40px;opacity:.7}

  .overlay{position:fixed;inset:0;z-index:90;background:rgba(5,7,11,.74);backdrop-filter:blur(6px);
    display:none;align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity .2s}
  .overlay.show{display:flex;opacity:1}
  .modal{width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--panel);border:1px solid var(--line2);
    border-radius:20px;box-shadow:var(--shadow);transform:translateY(12px) scale(.98);transition:transform .25s;position:relative}
  .overlay.show .modal{transform:none}
  .mclose{position:absolute;top:14px;right:14px;z-index:5;width:38px;height:38px;border-radius:10px;border:1px solid var(--line2);
    background:rgba(8,10,15,.6);color:#fff;font-size:18px;cursor:pointer;display:grid;place-items:center;backdrop-filter:blur(4px)}
  .mclose:hover{background:rgba(8,10,15,.9)}
  .mtop{display:flex;gap:22px;padding:26px 26px 20px}
  .mposter{flex:0 0 160px;aspect-ratio:2/3;border-radius:12px;overflow:hidden;background:#0f1219;box-shadow:0 16px 30px -10px rgba(0,0,0,.8)}
  .mposter img{width:100%;height:100%;object-fit:cover}
  .minfo{flex:1;min-width:0}
  .mtitle{font-family:'Fraunces',serif;font-size:25px;font-weight:900;letter-spacing:-.4px;line-height:1.12}
  .mcreator{color:var(--acc);font-size:14.5px;font-weight:600;margin-top:6px}
  .mmeta{display:flex;gap:9px;align-items:center;color:var(--mut);font-size:13px;margin-top:10px;font-weight:500;flex-wrap:wrap}
  .mscores{display:flex;gap:12px;margin:18px 0 0;flex-wrap:wrap}
  .scorebox{flex:1;min-width:104px;background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
  .scorebox .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut);font-weight:700}
  .scorebox .val{font-size:26px;font-weight:800;margin-top:4px;letter-spacing:-1px}
  .mbody{padding:0 26px 24px}
  .mblurb{color:var(--txt2);font-size:15px;line-height:1.6;margin:16px 0 20px}
  .mactions{display:flex;gap:11px;flex-wrap:wrap}
  .mbtn{display:inline-flex;align-items:center;gap:8px;border-radius:11px;padding:12px 18px;font-size:14px;font-weight:700;
    cursor:pointer;border:1px solid var(--line2);background:var(--panel2);color:var(--txt);text-decoration:none;transition:.15s}
  .mbtn:hover{transform:translateY(-1px);border-color:var(--acc)}
  .mbtn.primary{background:linear-gradient(90deg,var(--acc),var(--acc2));border-color:transparent;color:#fff}
  .mbtn.imdb{background:#f5c518;color:#1a1a1a;border-color:#c9a313}

  footer{border-top:1px solid var(--line);color:var(--mut2);font-size:12px;padding:22px 0 46px;line-height:1.6}
  footer b{color:var(--mut)}
  .ic{width:1em;height:1em;display:inline-block;vertical-align:-.14em;flex:0 0 auto}
  [data-icon]{display:inline-flex;align-items:center;justify-content:center;line-height:1}
  @media(max-width:640px){
    h1{font-size:21px} .stat{min-width:78px;padding:9px 12px} .stat .v{font-size:17px}
    .grid{grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:18px 14px}
    .mtop{flex-direction:column} .mposter{width:130px;flex:none}
  }
</style>
${CSS_LINKS}
${PWA_HEAD}
${HEAL}
</head>
<body data-page="${c.page}">
<header>
  <div class="wrap">
    <div class="brandrow">
      <div class="brand">
        <div class="logo" data-icon="${c.iconName}"></div>
        <div>
          <h1>${c.h1}</h1>
          <div class="tagline">${c.tagline}</div>
        </div>
      </div>
      <div class="stats" id="stats"></div>
    </div>
  </div>
</header>

<div class="toolbar">
  <div class="wrap">
    <div class="row">
      <div class="search">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input id="search" type="text" placeholder="${c.searchPh}" autocomplete="off">
        <kbd>/</kbd>
      </div>
      <div class="ctl"><label>Sort</label>
        <select id="sort">
          <option value="best-desc">Best overall ↓</option>
          <option value="mc-desc">Metacritic ↓</option>
          <option value="imdb-desc">IMDb ↓</option>
          <option value="rt-desc">Rotten Tomatoes ↓</option>
          <option value="year-desc">Newest</option>
          <option value="year-asc">Oldest</option>
          <option value="title-asc">A → Z</option>
        </select>
      </div>
      <div class="ctl"><label>Min score</label>
        <select id="minmc">
          <option value="0">Any</option><option value="90">90+</option><option value="85">85+</option>
          <option value="80">80+</option><option value="75">75+</option><option value="70">70+</option><option value="60">60+</option>
        </select>
      </div>
      <div class="ctl"><label>Release years</label>
        <div class="range">
          <div class="vals"><span id="yrminLbl"></span><span id="yrmaxLbl"></span></div>
          <div class="slider"><div class="track"></div><div class="fill" id="rfill"></div>
            <input type="range" id="yrmin"><input type="range" id="yrmax"></div>
        </div>
      </div>
      <div class="seg" title="View mode">
        <button id="gridBtn" class="on" aria-label="Grid view" data-icon="layout-grid"></button>
        <button id="listBtn" aria-label="List view" data-icon="list"></button>
      </div>
      <button class="btn" id="surpriseBtn" title="Random highly-rated pick"><span data-icon="dice-5"></span> Surprise</button>
      <button class="btn" id="favBtn" title="Show favourites only"><span data-icon="star"></span> Favourites</button>
      <button class="btn" id="resetBtn" title="Clear filters"><span data-icon="rotate-ccw"></span> Reset</button>
    </div>
    <div class="chips" id="chips"></div>
  </div>
</div>

<div class="wrap">
  <div class="statusrow">
    <span class="pill"><b id="shown">0</b> shown</span>
    <span id="avg"></span>
    <span id="activeFilters" style="margin-left:auto"></span>
  </div>
  <div class="grid" id="grid"></div>
  <div id="sentinel"></div>
  <div class="loadmore" id="loadmore"></div>
  <div class="empty" id="empty"><div class="big" data-icon="search"></div>Nothing matches your filters.<br><span style="font-size:13px">Try widening the year range or lowering the minimum score.</span></div>
</div>

<footer>
  <div class="wrap">
    Entries marked <b>✓ Verified</b> had their Metascore read directly from metacritic.com. Remaining Metascores, along with all IMDb and Rotten Tomatoes figures, are compiled from public sources and are close approximations. Posters come from TMDB and Wikipedia; a number of them are non-free images that cannot be served, so those titles show a typographic card instead. Not affiliated with Metacritic, IMDb, Rotten Tomatoes or TMDB.
  </div>
</footer>

<div class="overlay" id="overlay"><div class="modal" id="modal"></div></div>

<script>
const ${c.dataVar} = ${JSON.stringify(data)};

const $ = s => document.querySelector(s);
const grid = $('#grid'), empty = $('#empty');
let activeGenres = new Set();
let favOnly = false;
const favKey = x => x.title+'|'+x.year;
let favs = new Set(JSON.parse(localStorage.getItem('${c.page}_favs')||'[]'));
const saveFavs = () => localStorage.setItem('${c.page}_favs', JSON.stringify([...favs]));
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

/* A single comparable number so titles with different score coverage can still
   be ranked together: Metacritic if present, else IMDb x10, else the RT score. */
const bestScore = x => x.metacritic!=null ? x.metacritic
                     : x.imdb!=null ? Math.round(x.imdb*10)
                     : x.rt!=null ? x.rt : 0;
const mcClass = v => v>=75?'good':v>=50?'mid':'bad';
const mcColor = v => v>=75?'var(--good)':v>=50?'var(--mid)':'var(--bad)';
const poster = x => x.posterPath ? 'https://image.tmdb.org/t/p/w342'+x.posterPath : '';

/* ---- artwork resolution -------------------------------------------------
   Only a minority of entries ship a TMDB poster path (a guessed path renders a
   broken image, so they were left null deliberately). For everything else the
   artwork is resolved at runtime from Wikipedia's REST summary endpoint, which
   is free, keyless and CORS-enabled. Results — including misses, stored as
   null — are cached in localStorage so each title is looked up at most once,
   and lookups only fire for cards that actually scroll into view.           */
const PKEY='${c.page}_art_v1';
let pcache={}; try{ pcache=JSON.parse(localStorage.getItem(PKEY)||'{}'); }catch(e){}
let psaveT=null;
function psave(){ clearTimeout(psaveT); psaveT=setTimeout(()=>{
  try{ localStorage.setItem(PKEY,JSON.stringify(pcache)); }catch(e){/* quota — harmless */} },800); }

let inflight=0; const pqueue=[];
function pnext(){
  if(inflight>=4 || !pqueue.length) return;
  const job=pqueue.shift(); inflight++;
  job().catch(()=>{}).then(()=>{ inflight--; pnext(); });
}
function penqueue(fn){ pqueue.push(fn); pnext(); }

/* Pull the image out of a Wikipedia summary payload, upscaled a little.
   Thumbnails come back around 200-320px wide, which looks soft on a 2:3 card. */
function artFrom(j){
  if(!j || j.type==='disambiguation') return null;
  const src=(j.thumbnail&&j.thumbnail.source)||(j.originalimage&&j.originalimage.source);
  if(!src) return null;
  return src.replace(/\\/\\d+px-/,'/420px-');
}
async function wikiSummary(title){
  try{
    const r=await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/'+
      encodeURIComponent(title.replace(/ /g,'_')));
    if(!r.ok) return null;
    return await r.json();
  }catch(e){ return null; }
}

async function wikiArt(x){
  const key=x.title+'|'+x.year;
  if(key in pcache) return pcache[key];
  const kind=${isShow} ? 'TV series' : 'film';
  /* Wikipedia disambiguates by kind and year, and the exact form varies a lot
     ("Dune (2021 film)", "Severance (TV series)", "Poor Things (film)"), so try
     the common shapes before falling back to a real search. */
  const cands=[
    x.title+' ('+x.year+' '+kind+')',
    x.title+' ('+kind+')',
    ${isShow}
      ? x.title+' ('+x.year+' American TV series)'
      : x.title+' ('+x.year+' American film)',
    x.title
  ];
  for(const t of cands){
    const art=artFrom(await wikiSummary(t));
    if(art){ pcache[key]=art; psave(); return art; }
  }
  /* Nothing matched by guessing the title. Ask the search index, which copes
     with renames, foreign titles and odd disambiguators. This endpoint returns
     the page image directly, so one request covers both search and artwork.
     origin=* is required for CORS from the browser. */
  try{
    const u='https://en.wikipedia.org/w/api.php?action=query&generator=search'+
      '&gsrsearch='+encodeURIComponent(x.title+' '+kind+' '+x.year)+'&gsrlimit=3'+
      '&prop=pageimages&piprop=thumbnail&pithumbsize=420&format=json&origin=*';
    const r=await fetch(u);
    if(r.ok){
      const j=await r.json();
      const pages=Object.values((j.query&&j.query.pages)||{});
      const stem=x.title.toLowerCase().slice(0,Math.min(12,x.title.length));
      for(const p of pages){
        if(!p||!p.thumbnail||!p.thumbnail.source) continue;
        /* guard against the search drifting onto a loosely related article */
        if(!(p.title||'').toLowerCase().includes(stem)) continue;
        pcache[key]=p.thumbnail.source; psave(); return pcache[key];
      }
    }
  }catch(e){}
  /* Cache the miss so we never ask again. Note that a fair few film and TV
     posters are non-free images, which Wikipedia's API deliberately does not
     expose — those titles can never resolve here and keep their title card. */
  pcache[key]=null; psave(); return null;
}

/* If the observer never delivers (hidden tab, prerender, no compositing), the
   grid would show title cards forever. Kick off the first screenful anyway. */
let artFallbackDone=false;
function artFallback(){
  if(artFallbackDone) return; artFallbackDone=true;
  [...grid.querySelectorAll('.card')].slice(0,24).forEach(el=>{
    if(el.__artStarted || !el.__item) return;
    el.__artStarted=1;
    penqueue(async ()=>{
      const src=await wikiArt(el.__item);
      if(!src||!el.isConnected) return;
      const img=el.querySelector('img.lazyart'); if(!img) return;
      img.src=src; img.onload=()=>img.classList.add('ok');
    });
  });
}
setTimeout(artFallback, 2500);

/* Resolve artwork for a card once it is close to the viewport. */
const artObserver=new IntersectionObserver(es=>{
  es.forEach(e=>{
    if(!e.isIntersecting) return;
    artObserver.unobserve(e.target);
    const el=e.target, x=el.__item;
    if(!x || el.__artStarted) return;
    el.__artStarted=1;
    penqueue(async ()=>{
      const src=await wikiArt(x);
      if(!src || !el.isConnected) return;
      const img=el.querySelector('img.lazyart');
      const ph=el.querySelector('.ph');
      if(!img) return;
      img.src=src;
      img.onload=()=>{ img.classList.add('ok'); if(ph) ph.style.display='none'; };
    });
  });
},{rootMargin:'400px'});

/* Perf: build the search haystack once instead of lowercasing every field on
   every keystroke, and read the query once per render rather than per item. */
${c.dataVar}.forEach(x=>{ x._hay=(x.title+' '+(x.creator||'')+' '+x.genre+' '+(x.blurb||'')).toLowerCase(); });
let _q='';

const YEARS = ${c.dataVar}.map(x=>x.year).filter(Number.isFinite);
const YMIN = Math.min(...YEARS), YMAX = Math.max(...YEARS);

function buildStats(){
  const scored = ${c.dataVar}.filter(x=>x.metacritic!=null);
  const avg = scored.length ? Math.round(scored.reduce((s,x)=>s+x.metacritic,0)/scored.length) : 0;
  const cards=[
    {v:${c.dataVar}.length.toLocaleString(), l:'${c.unit}'},
    {v:avg, l:'Avg Metacritic', c:'good'},
    {v:${c.dataVar}.filter(x=>x.verified).length.toLocaleString(), l:'Verified ✓', c:'acc'},
    {v:YMIN+'–'+String(YMAX).slice(2), l:'Years'}
  ];
  $('#stats').innerHTML = cards.map(x=>\`<div class="stat \${x.c||''}"><div class="v">\${x.v}</div><div class="l">\${x.l}</div></div>\`).join('');
}

function buildChips(){
  const counts={}; ${c.dataVar}.forEach(x=>counts[x.genre]=(counts[x.genre]||0)+1);
  const genres=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]);
  $('#chips').innerHTML=genres.map(g=>\`<div class="chip" data-g="\${g.replace(/"/g,'&quot;')}">\${g}<span class="n">\${counts[g]}</span></div>\`).join('');
  $('#chips').querySelectorAll('.chip').forEach(ch=>{
    ch.onclick=()=>{ const g=ch.dataset.g; ch.classList.toggle('on');
      activeGenres.has(g)?activeGenres.delete(g):activeGenres.add(g); render(); };
  });
}

function initSlider(){
  const a=$('#yrmin'), b=$('#yrmax');
  [a,b].forEach(el=>{el.min=YMIN;el.max=YMAX;el.step=1;});
  a.value=YMIN; b.value=YMAX;
  function upd(){
    let lo=+a.value, hi=+b.value;
    if(lo>hi){ if(this===a){hi=lo;b.value=hi;} else {lo=hi;a.value=lo;} }
    $('#yrminLbl').textContent=lo; $('#yrmaxLbl').textContent=hi;
    const span=YMAX-YMIN||1;
    $('#rfill').style.left=((lo-YMIN)/span*100)+'%';
    $('#rfill').style.right=((YMAX-hi)/span*100)+'%';
    render();
  }
  a.addEventListener('input',upd); b.addEventListener('input',upd);
  upd.call(a);
}

function passes(x){
  if(_q && !x._hay.includes(_q)) return false;
  if(bestScore(x) < +$('#minmc').value) return false;
  if(x.year < +$('#yrmin').value || x.year > +$('#yrmax').value) return false;
  if(activeGenres.size && !activeGenres.has(x.genre)) return false;
  if(favOnly && !favs.has(favKey(x))) return false;
  return true;
}
function sortItems(arr){
  const c={
    'best-desc':(a,b)=>bestScore(b)-bestScore(a),
    'mc-desc':(a,b)=>(b.metacritic??-1)-(a.metacritic??-1),
    'imdb-desc':(a,b)=>(b.imdb??-1)-(a.imdb??-1),
    'rt-desc':(a,b)=>(b.rt??-1)-(a.rt??-1),
    'year-desc':(a,b)=>b.year-a.year||bestScore(b)-bestScore(a),
    'year-asc':(a,b)=>a.year-b.year||bestScore(b)-bestScore(a),
    'title-asc':(a,b)=>a.title.localeCompare(b.title)
  }[$('#sort').value];
  return arr.slice().sort(c);
}

function card(x){
  const el=document.createElement('div'); el.className='card';
  const isFav=favs.has(favKey(x));
  const p=poster(x);
  const cov = p
    ? \`<div class="sk"></div><img loading="lazy" src="\${p}" alt=""
         onload="this.classList.add('ok');this.previousElementSibling.style.display='none'"
         onerror="this.style.display='none';this.previousElementSibling.style.display='none';this.nextElementSibling.style.display='flex'">
       <div class="ph"><div class="pmark"><span data-icon="${c.iconName}"></span></div><div class="pt">\${esc(x.title)}</div><div class="pa">\${esc(x.creator||'')}</div></div>\`
    : /* No TMDB path: show the title card immediately, then let the observer
         swap in Wikipedia artwork on top of it if any is found. */
      \`<div class="ph" style="display:flex"><div class="pmark"><span data-icon="${c.iconName}"></span></div><div class="pt">\${esc(x.title)}</div><div class="pa">\${esc(x.creator||'')}</div></div>
       <img class="lazyart" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .35s">\`;
  const sc=bestScore(x);
  const imdb = x.imdb!=null ? \`<span class="imdb">IMDb \${(+x.imdb).toFixed(1)}</span>\` : '';
  const rt = x.rt!=null ? \`<span class="rt \${x.rt<60?'':'rotten'}">\${x.rt}%</span>\` : '';
  const sub = ${isShow} ? (x.seasons? x.seasons+(x.seasons===1?' season':' seasons') : '') : (x.runtime? x.runtime+' min' : '');
  el.innerHTML=\`
    <div class="cover">
      <div class="fav \${isFav?'on':''}" title="Favourite">\${isFav?'★':'☆'}</div>
      \${cov}<div class="grad"></div>
      \${x.metacritic!=null?\`<div class="mc \${mcClass(sc)}" style="background:\${mcColor(sc)}">\${x.metacritic}</div>\`:''}
      <div class="yearbadge">\${x.year}</div>
      \${x.verified?'<div class="verified" title="Metascore checked against Metacritic"><span data-icon="check-check"></span>VERIFIED</div>':''}
    </div>
    <div class="body">
      <div class="ttl">\${esc(x.title)}</div>
      <div class="meta"><span>\${x.genre}</span>\${sub?'<span class="dot"></span><span>'+sub+'</span>':''}</div>
      <div class="scores">\${imdb}\${rt}</div>
      <div class="blurb">\${esc(x.blurb||'')}</div>
    </div>\`;
  el.querySelector('.fav').addEventListener('click',e=>{
    e.stopPropagation(); const k=favKey(x);
    favs.has(k)?favs.delete(k):favs.add(k); saveFavs(); buildStats(); render();
  });
  el.addEventListener('click',()=>openModal(x));
  if(!p){ el.__item=x; artObserver.observe(el); }   // resolve artwork when near view
  return el;
}

const BATCH=60; let currentList=[], rendered=0;
function renderBatch(){
  const frag=document.createDocumentFragment();
  currentList.slice(rendered,rendered+BATCH).forEach(x=>frag.appendChild(card(x)));
  grid.appendChild(frag); rendered=Math.min(rendered+BATCH,currentList.length);
  $('#loadmore').textContent = rendered<currentList.length ? \`Showing \${rendered} of \${currentList.length} — scroll for more\` : (currentList.length?\`All \${currentList.length} shown\`:'');
  if(window.Shelf&&window.Shelf.hydrateIcons) window.Shelf.hydrateIcons(grid);
}
function render(){
  _q=$('#search').value.trim().toLowerCase();
  currentList=sortItems(${c.dataVar}.filter(passes));
  grid.innerHTML=''; rendered=0; renderBatch();
  {const _p=$('#shown').parentElement;
    if(currentList.length===${c.dataVar}.length){ _p.style.display='none'; }
    else { _p.style.display=''; $('#shown').textContent=currentList.length.toLocaleString(); }}
  empty.style.display=currentList.length?'none':'block';
  const scored=currentList.filter(x=>x.metacritic!=null);
  const avg=scored.length?Math.round(scored.reduce((s,x)=>s+x.metacritic,0)/scored.length):0;
  $('#avg').innerHTML=scored.length?\`avg <b>\${avg}</b>\`:'';
  const af=[];
  if(activeGenres.size) af.push(activeGenres.size+' genre'+(activeGenres.size>1?'s':''));
  if(+$('#minmc').value>0) af.push($('#minmc').value+'+ score');
  if(favOnly) af.push('favourites');
  if(+$('#yrmin').value>YMIN||+$('#yrmax').value<YMAX) af.push($('#yrmin').value+'–'+$('#yrmax').value);
  $('#activeFilters').innerHTML=af.length?\`<span style="color:var(--mut2)">filters:</span> \${af.map(t=>\`<span class="pill" style="padding:3px 9px;font-size:12px">\${t}</span>\`).join(' ')}\`:'';
}
new IntersectionObserver(es=>{ if(es[0].isIntersecting && rendered<currentList.length) renderBatch(); },{rootMargin:'700px'}).observe($('#sentinel'));

function openModal(x){
  const p=poster(x);
  const cov=p?\`<img src="\${p}" alt="">\`:\`<div class="ph" style="display:flex"><div class="pt">\${esc(x.title)}</div></div>\`;
  const q=encodeURIComponent(x.title+' '+x.year);
  const imdbUrl = x.imdbId ? 'https://www.imdb.com/title/'+x.imdbId+'/' : 'https://www.imdb.com/find/?q='+q;
  const rtUrl='https://www.rottentomatoes.com/search?search='+q;
  const mcUrl='https://www.metacritic.com/search/'+q+'/';
  const isFav=favs.has(favKey(x));
  const sub = ${isShow} ? (x.seasons? x.seasons+(x.seasons===1?' season':' seasons') : '') : (x.runtime? x.runtime+' min' : '');
  const box=(k,v,sv,col)=> v==null?'':\`<div class="scorebox"><div class="k">\${k}</div><div class="val" style="color:\${col}">\${v}</div><div class="sub" style="font-size:11.5px;color:var(--mut);margin-top:2px">\${sv}</div></div>\`;
  $('#modal').innerHTML=\`
    <button class="mclose" id="mclose" aria-label="Close">✕</button>
    <div class="mtop">
      <div class="mposter">\${cov}</div>
      <div class="minfo">
        <div class="mtitle">\${esc(x.title)}</div>
        \${x.creator?\`<div class="mcreator">\${esc(x.creator)}</div>\`:''}
        <div class="mmeta"><span>\${x.year}</span><span class="dot" style="width:3px;height:3px;border-radius:50%;background:var(--mut2)"></span><span>\${x.genre}</span>\${sub?'<span class="dot" style="width:3px;height:3px;border-radius:50%;background:var(--mut2)"></span><span>'+sub+'</span>':''}</div>
        <div class="mscores">
          \${box('Metacritic', x.metacritic, x.verified?'verified ✓':'approximate', mcColor(x.metacritic||0))}
          \${box('IMDb', x.imdb!=null?(+x.imdb).toFixed(1):null, 'out of 10', '#f5c518')}
          \${box('Rotten Tomatoes', x.rt!=null?x.rt+'%':null, 'critics', x.rt>=60?'#0ac855':'#fa320a')}
        </div>
      </div>
    </div>
    <div class="mbody">
      <div class="mblurb">\${esc(x.blurb||'')}</div>
      <div class="mactions">
        <button class="mbtn primary" id="mfav">\${isFav?'★ Favourited':'☆ Add to favourites'}</button>
        <a class="mbtn imdb" href="\${imdbUrl}" target="_blank" rel="noopener">IMDb ↗</a>
        <a class="mbtn" href="\${rtUrl}" target="_blank" rel="noopener">Rotten Tomatoes ↗</a>
        <a class="mbtn" href="\${mcUrl}" target="_blank" rel="noopener">Metacritic ↗</a>
      </div>
    </div>\`;
  $('#overlay').classList.add('show'); document.body.style.overflow='hidden';
  if(window.Shelf&&window.Shelf.hydrateIcons) window.Shelf.hydrateIcons($('#modal'));
  $('#mclose').onclick=closeModal;
  $('#mfav').onclick=function(){ const k=favKey(x); favs.has(k)?favs.delete(k):favs.add(k); saveFavs();
    this.textContent=favs.has(k)?'★ Favourited':'☆ Add to favourites'; buildStats(); render(); };
}
function closeModal(){ $('#overlay').classList.remove('show'); document.body.style.overflow=''; }
$('#overlay').addEventListener('click',e=>{ if(e.target===$('#overlay')) closeModal(); });

let _t=null;
const debouncedRender=()=>{ clearTimeout(_t); _t=setTimeout(render,110); };
$('#search').addEventListener('input',debouncedRender);
['#sort','#minmc'].forEach(s=>{$(s).addEventListener('input',render);$(s).addEventListener('change',render);});
$('#gridBtn').onclick=()=>{grid.classList.remove('list');$('#gridBtn').classList.add('on');$('#listBtn').classList.remove('on');};
$('#listBtn').onclick=()=>{grid.classList.add('list');$('#listBtn').classList.add('on');$('#gridBtn').classList.remove('on');};
$('#favBtn').onclick=function(){favOnly=!favOnly;this.classList.toggle('on',favOnly);render();};
$('#surpriseBtn').onclick=()=>{
  if(!currentList.length) return;
  const pool=currentList.filter(x=>bestScore(x)>=80); const src=pool.length?pool:currentList;
  const pick=src[Math.floor(Math.random()*src.length)];
  const idx=currentList.indexOf(pick);
  while(rendered<=idx) renderBatch();
  const node=grid.children[idx];
  if(node){ node.scrollIntoView({behavior:'smooth',block:'center'});
    grid.querySelectorAll('.card.flash').forEach(n=>n.classList.remove('flash'));
    node.classList.add('flash'); setTimeout(()=>node.classList.remove('flash'),1700); }
};
$('#resetBtn').onclick=()=>{
  $('#search').value='';$('#sort').value='best-desc';$('#minmc').value='0';
  activeGenres.clear();favOnly=false;$('#favBtn').classList.remove('on');
  $('#chips').querySelectorAll('.chip.on').forEach(ch=>ch.classList.remove('on'));
  $('#yrmin').value=YMIN;$('#yrmax').value=YMAX;$('#yrmin').dispatchEvent(new Event('input'));
};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') closeModal();
  if(e.key==='/' && document.activeElement!==$('#search')){ e.preventDefault(); $('#search').focus(); }
});

buildStats(); buildChips(); initSlider(); render();
</script>
${JS_TAGS}
</body>
</html>
`;
}

let built = 0;
for (const key of Object.keys(CONFIG)) {
  const c = CONFIG[key];
  if (!fs.existsSync(c.json)) { console.warn('missing ' + c.json + ' — skipped'); continue; }
  const data = JSON.parse(fs.readFileSync(c.json, 'utf8'));
  fs.writeFileSync(c.file, page(c, data));
  console.log(c.file.padEnd(12), data.length + ' items', (fs.statSync(c.file).size/1024).toFixed(0) + 'KB');
  built++;
}
console.log('built ' + built + ' page(s)');
