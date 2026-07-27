/* =====================================================================
   Shelf — shared site layer
   Injects: top nav, optional sign-in, share-this-view, keyboard help.

   Sign-in philosophy: it is ALWAYS optional. Guests get 100% of the
   features. Signing in only (a) puts a name on the app and (b) can grant
   curator rights for editing the shared starter collection.
   Nothing is ever gated behind a wall, and no modal opens on its own.

   Pages opt in with:
     <link rel="stylesheet" href="assets/site.css">
     <script src="assets/site.js" defer></script>
     <body data-page="games|books|vocab|home">
   ===================================================================== */
(function () {
  'use strict';

  var PAGES = [
    { id: 'games', href: 'games.html', label: 'Games', icon: 'gamepad-2' },
    { id: 'books', href: 'books.html', label: 'Books', icon: 'book-open' },
    { id: 'vocab', href: 'vocab.html', label: 'Words', icon: 'notebook-pen' }
  ];
  var page = document.body.getAttribute('data-page') || '';
  var isHome = page === 'home';

  /* ================= icons (Lucide, ISC licence, inlined) =================
     Inlined rather than pulled from a CDN so the site stays self-contained and
     icons never flash in late. Use data-icon="name" in markup, or
     Shelf.icon('name') for dynamically built content.                      */
  var ICONS = {
    "gamepad-2": "<line x1=\"6\" x2=\"10\" y1=\"11\" y2=\"11\"/><line x1=\"8\" x2=\"8\" y1=\"9\" y2=\"13\"/><line x1=\"15\" x2=\"15.01\" y1=\"12\" y2=\"12\"/><line x1=\"18\" x2=\"18.01\" y1=\"10\" y2=\"10\"/><path d=\"M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z\"/>",
    "book-open": "<path d=\"M12 7v14\"/><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>",
    "notebook-pen": "<path d=\"M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4\"/><path d=\"M2 6h4\"/><path d=\"M2 10h4\"/><path d=\"M2 14h4\"/><path d=\"M2 18h4\"/><path d=\"M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z\"/>",
    "library": "<path d=\"m16 6 4 14\"/><path d=\"M12 6v14\"/><path d=\"M8 8v12\"/><path d=\"M4 4v16\"/>",
    "arrow-left": "<path d=\"m12 19-7-7 7-7\"/><path d=\"M19 12H5\"/>",
    "arrow-right": "<path d=\"M5 12h14\"/><path d=\"m12 5 7 7-7 7\"/>",
    "link-2": "<path d=\"M9 17H7A5 5 0 0 1 7 7h2\"/><path d=\"M15 7h2a5 5 0 1 1 0 10h-2\"/><line x1=\"8\" x2=\"16\" y1=\"12\" y2=\"12\"/>",
    "keyboard": "<path d=\"M10 8h.01\"/><path d=\"M12 12h.01\"/><path d=\"M14 8h.01\"/><path d=\"M16 12h.01\"/><path d=\"M18 8h.01\"/><path d=\"M6 8h.01\"/><path d=\"M7 16h10\"/><path d=\"M8 12h.01\"/><rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/>",
    "user": "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>",
    "search": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><path d=\"m21 21-4.3-4.3\"/>",
    "dice-5": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M16 8h.01\"/><path d=\"M8 8h.01\"/><path d=\"M8 16h.01\"/><path d=\"M16 16h.01\"/><path d=\"M12 12h.01\"/>",
    "star": "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 20.99a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.774a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\"/>",
    "layout-grid": "<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\"/>",
    "list": "<path d=\"M3 12h.01\"/><path d=\"M3 18h.01\"/><path d=\"M3 6h.01\"/><path d=\"M8 12h13\"/><path d=\"M8 18h13\"/><path d=\"M8 6h13\"/>",
    "rotate-ccw": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/>",
    "download": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\"/>",
    "upload": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"17 8 12 3 7 8\"/><line x1=\"12\" x2=\"12\" y1=\"3\" y2=\"15\"/>",
    "graduation-cap": "<path d=\"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z\"/><path d=\"M22 10v6\"/><path d=\"M6 12.5V16a6 3 0 0 0 12 0v-3.5\"/>",
    "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/>",
    "unlock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 9.9-1\"/>",
    "sparkles": "<path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\"/>",
    "trophy": "<path d=\"M6 9H4.5a2.5 2.5 0 0 1 0-5H6\"/><path d=\"M18 9h1.5a2.5 2.5 0 0 0 0-5H18\"/><path d=\"M4 22h16\"/><path d=\"M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22\"/><path d=\"M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22\"/><path d=\"M18 2H6v7a6 6 0 0 0 12 0V2Z\"/>",
    "clock": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/>",
    "ghost": "<path d=\"M9 10h.01\"/><path d=\"M15 10h.01\"/><path d=\"M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z\"/>",
    "rocket": "<path d=\"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91 0z\"/><path d=\"m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z\"/><path d=\"M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0\"/><path d=\"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5\"/>",
    "flame": "<path d=\"M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z\"/>",
    "smartphone": "<rect width=\"14\" height=\"20\" x=\"5\" y=\"2\" rx=\"2\"/><path d=\"M12 18h.01\"/>",
    "shield-check": "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/><path d=\"m9 12 2 2 4-4\"/>",
    "globe": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\"/><path d=\"M2 12h20\"/>",
    "layers": "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\"/><path d=\"m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65\"/><path d=\"m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65\"/>",
    "check-check": "<path d=\"M18 6 7 17l-5-5\"/><path d=\"m22 10-7.5 7.5L13 16\"/>",
    "plus": "<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>",
    "volume-2": "<path d=\"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.384 3.383A.705.705 0 0 0 11 19.298z\"/><path d=\"M16 9a5 5 0 0 1 0 6\"/><path d=\"M19.364 18.364a9 9 0 0 0 0-12.728\"/>",
    "pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/><path d=\"m15 5 4 4\"/>",
    "trash-2": "<path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/><line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\"/><line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\"/>",
    "archive": "<rect width=\"20\" height=\"5\" x=\"2\" y=\"3\" rx=\"1\"/><path d=\"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8\"/><path d=\"M10 12h4\"/>"
  };
  function svgIcon(name, cls){
    var p = ICONS[name];
    if (!p) return '';
    return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + p + '</svg>';
  }
  function hydrateIcons(root){
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      if (el.getAttribute('data-icon-done')) return;
      var s = svgIcon(el.getAttribute('data-icon'));
      if (s) { el.innerHTML = s; el.setAttribute('data-icon-done', '1'); }
    });
  }

  /* ================= auth (entirely local, no server) ================= */
  var AKEY = 'shelf_profile';
  var CURATOR_MS = 60 * 60 * 1000;
  // Passcode is never stored here — only a salted PBKDF2-SHA256 digest.
  var PW = {
    salt: '7acfa04ee0ba8f1a8cb07cbc20d2b4da',
    iter: 310000,
    hash: '3b0b48d13c2ab4fb4aa7e8f25fdb11b6d85beea189af8b96ea6d59a4e1bcdb0c'
  };
  var STEPS = [0, 0, 5 * 60e3, 15 * 60e3, 60 * 60e3, 24 * 3600e3];
  var clientIP = 'local';
  var listeners = [];

  function profile() {
    try { var p = JSON.parse(localStorage.getItem(AKEY) || 'null'); return p && p.name ? p : null; }
    catch (e) { return null; }
  }
  function setProfile(p) {
    if (p) localStorage.setItem(AKEY, JSON.stringify(p)); else localStorage.removeItem(AKEY);
    paintAccount(); listeners.forEach(function (f) { try { f(); } catch (e) {} });
  }
  function isCurator() { return Date.now() < +(sessionStorage.getItem('shelf_curator_until') || 0); }
  function setCurator(on) {
    if (on) sessionStorage.setItem('shelf_curator_until', Date.now() + CURATOR_MS);
    else sessionStorage.removeItem('shelf_curator_until');
    paintAccount(); listeners.forEach(function (f) { try { f(); } catch (e) {} });
  }
  function displayName() { var p = profile(); return p ? p.name : 'Guest'; }

  /* lockout guard, keyed by best-effort IP */
  function gk() { return 'shelf_guard_' + clientIP; }
  function guard() { try { return JSON.parse(localStorage.getItem(gk()) || '{"fails":0,"until":0}'); } catch (e) { return { fails: 0, until: 0 }; } }
  function setGuard(g) { localStorage.setItem(gk(), JSON.stringify(g)); }
  function lockLeft() { return Math.max(0, guard().until - Date.now()); }
  function fmtLeft(ms) {
    var s = Math.ceil(ms / 1000);
    if (s >= 3600) return Math.ceil(s / 3600) + ' hour' + (s >= 7200 ? 's' : '');
    if (s >= 60) return Math.ceil(s / 60) + ' min';
    return s + 's';
  }
  function hexBytes(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function ctEq(a, b) { if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
  function verifyPW(pw) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve(false);
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexBytes(PW.salt), iterations: PW.iter, hash: 'SHA-256' }, key, 256);
      })
      .then(function (bits) {
        var hex = [].map.call(new Uint8Array(bits), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        return ctEq(hex, PW.hash);
      })
      .catch(function () { return false; });
  }
  fetch('https://api.ipify.org?format=json')
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.ip) clientIP = j.ip; })
    .catch(function () {});

  /* ================= nav ================= */
  function buildNav() {
    var nav = document.createElement('div');
    nav.className = 'sitenav';
    var links = PAGES.map(function (p) {
      return '<a href="' + p.href + '"' + (p.id === page ? ' class="cur"' : '') + '>' + svgIcon(p.icon) + '<span>' + p.label + '</span></a>';
    }).join('');
    nav.innerHTML =
      '<div class="sn-in">' +
        (isHome
          ? '<span class="sn-home" style="cursor:default">' + svgIcon('library') + '<span>Shelf</span></span>'
          : '<a class="sn-home" href="index.html" title="Back to Shelf home">' + svgIcon('arrow-left','ar') + '<span>Shelf</span></a>') +
        '<nav class="sn-links">' + links + '</nav>' +
        '<div class="sn-right">' +
          (isHome ? '' : '<button class="sn-btn" id="shShare" title="Copy a link to exactly this view">' + svgIcon('link-2') + '<span class="lbl">Share view</span></button>') +
          '<button class="sn-btn" id="shHelp" title="Keyboard shortcuts (?)">' + svgIcon('keyboard') + '<span class="lbl">Shortcuts</span></button>' +
          '<button class="sn-acct" id="shAcct" title="Profile"></button>' +
        '</div>' +
      '</div>';
    document.body.insertBefore(nav, document.body.firstChild);
    document.getElementById('shAcct').addEventListener('click', function () { openAuth(); });
    paintAccount();
  }
  function paintAccount() {
    var b = document.getElementById('shAcct');
    if (!b) return;
    var p = profile(), cur = isCurator();
    var initial = p ? p.name.trim().charAt(0).toUpperCase() : '·';
    b.className = 'sn-acct' + (p ? ' in' : '') + (cur ? ' cur' : '');
    b.innerHTML = p
      ? '<span class="av">' + initial + '</span><span class="nm">' + escapeHtml(p.name) + (cur ? '<span class="crown">' + svgIcon('star') + '</span>' : '') + '</span>'
      : '<span class="av guest">' + svgIcon('user') + '</span><span class="nm">Sign in</span>';
    b.title = p ? (p.name + (cur ? ' — curator mode' : '') + ' · click for profile options') : 'Optional — browsing works fine as a guest';
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ================= toast ================= */
  var toastEl;
  function toast(msg, ok) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'sh-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.className = 'sh-toast show' + (ok ? ' ok' : '');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.className = 'sh-toast'; }, 2600);
  }

  /* ================= auth dialog ================= */
  var authOv, lockTimer;
  function ensureAuthOverlay() {
    if (authOv) return authOv;
    authOv = document.createElement('div');
    authOv.className = 'sh-ov'; authOv.id = 'shAuthOv';
    authOv.innerHTML = '<div class="sh-md" id="shAuthMd"></div>';
    document.body.appendChild(authOv);
    authOv.addEventListener('click', function (e) { if (e.target === authOv) closeAuth(); });
    return authOv;
  }
  function closeAuth() { if (authOv) authOv.classList.remove('show'); clearInterval(lockTimer); }

  function openAuth(mode) {
    ensureAuthOverlay();
    var p = profile();
    if (p && mode !== 'curator' && mode !== 'switch') return renderProfile();
    if (mode === 'curator') return renderCurator();
    renderSignIn();
  }

  function renderSignIn() {
    document.getElementById('shAuthMd').innerHTML =
      '<h3>Welcome to Shelf</h3>' +
      '<div class="sub">Signing in is <b>completely optional</b> — every feature works as a guest. A profile just puts your name on things and lets you keep separate favourites.</div>' +
      '<div class="sh-field"><label>Display name</label>' +
        '<input id="shName" type="text" maxlength="24" placeholder="What should we call you?" autocomplete="nickname"></div>' +
      '<button class="sh-primary" id="shSignIn">Create my profile</button>' +
      '<button class="sh-ghost" id="shGuest">Continue as guest →</button>' +
      '<div class="sh-alt"><span>or</span></div>' +
      '<button class="sh-ghost sm" id="shCuratorLink">🔑 Curator sign-in</button>' +
      '<div class="sh-note">This is a <b>local profile</b>, not an account: there is no server, no password and no email. It lives in this browser only, and nothing you do here is uploaded or tracked.</div>';
    show();
    var inp = document.getElementById('shName');
    setTimeout(function () { inp.focus(); }, 60);
    var go = function () {
      var n = inp.value.trim();
      if (!n) { inp.focus(); return; }
      setProfile({ name: n, since: Date.now() });
      closeAuth(); toast('Welcome, ' + n + '!', true);
    };
    document.getElementById('shSignIn').onclick = go;
    inp.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    document.getElementById('shGuest').onclick = function () { closeAuth(); toast('Browsing as guest — everything still works'); };
    document.getElementById('shCuratorLink').onclick = function () { renderCurator(); };
  }

  function renderProfile() {
    var p = profile(), cur = isCurator();
    document.getElementById('shAuthMd').innerHTML =
      '<h3>' + escapeHtml(p.name) + '</h3>' +
      '<div class="sub">' + (cur ? '★ Curator mode is active — it expires an hour after sign-in.' : 'Local profile on this browser.') + '</div>' +
      (cur ? '' : '<button class="sh-ghost sm" id="shCuratorLink">🔑 Curator sign-in</button>') +
      (cur ? '<button class="sh-ghost sm" id="shCuratorOff">Leave curator mode</button>' : '') +
      '<button class="sh-ghost sm" id="shRename">✎ Change display name</button>' +
      '<button class="sh-ghost sm danger" id="shOut">Sign out (back to guest)</button>' +
      '<button class="sh-primary" id="shDone">Done</button>' +
      '<div class="sh-note">Signing out only forgets your name — your favourites and saved words stay in this browser.</div>';
    show();
    var el;
    if ((el = document.getElementById('shCuratorLink'))) el.onclick = function () { renderCurator(); };
    if ((el = document.getElementById('shCuratorOff'))) el.onclick = function () { setCurator(false); toast('Left curator mode'); renderProfile(); };
    document.getElementById('shRename').onclick = function () { renderSignIn(); };
    document.getElementById('shOut').onclick = function () { setCurator(false); setProfile(null); closeAuth(); toast('Signed out — you are browsing as a guest'); };
    document.getElementById('shDone').onclick = closeAuth;
  }

  function renderCurator() {
    var locked = lockLeft() > 0;
    document.getElementById('shAuthMd').innerHTML =
      '<h3>Curator sign-in</h3>' +
      '<div class="sub">Only needed to edit the shared <b>Curator\'s Picks</b> word list. Everything else on Shelf is open to everyone.</div>' +
      '<div class="sh-field"><label>Passcode</label>' +
        '<input id="shPw" class="sh-pw" type="password" inputmode="numeric" maxlength="12" placeholder="••••" autocomplete="off"' + (locked ? ' disabled' : '') + '></div>' +
      '<div class="sh-lockmsg" id="shLock"></div>' +
      '<button class="sh-primary" id="shPwGo"' + (locked ? ' disabled' : '') + '>Unlock curator mode</button>' +
      '<button class="sh-ghost" id="shPwBack">← Back</button>' +
      '<div class="sh-note">The passcode is not in this page — only a salted PBKDF2 hash (310,000 rounds), so it can\'t be read from the source. Wrong guesses lock this browser out for progressively longer. It is a client-side gate: enough to stop casual edits, not a determined developer. Nothing private is stored here, so that trade-off is deliberate.</div>';
    show();
    var inp = document.getElementById('shPw');
    if (!locked) setTimeout(function () { inp.focus(); }, 60);
    document.getElementById('shPwBack').onclick = function () { profile() ? renderProfile() : renderSignIn(); };
    document.getElementById('shPwGo').onclick = attempt;
    inp.onkeydown = function (e) { if (e.key === 'Enter') attempt(); };
    paintLock();
    clearInterval(lockTimer);
    lockTimer = setInterval(function () { if (!document.getElementById('shLock')) { clearInterval(lockTimer); return; } paintLock(); }, 1000);

    function attempt() {
      if (lockLeft() > 0) { paintLock(); return; }
      var pw = inp.value; if (!pw) return;
      var btn = document.getElementById('shPwGo');
      btn.disabled = true; btn.textContent = 'Checking…';
      verifyPW(pw).then(function (ok) {
        btn.disabled = false; btn.textContent = 'Unlock curator mode';
        if (ok) {
          setGuard({ fails: 0, until: 0 });
          if (!profile()) setProfile({ name: 'Curator', since: Date.now() });
          setCurator(true); clearInterval(lockTimer); closeAuth();
          toast('Curator mode on — expires in 1 hour', true);
        } else {
          var g = guard(); g.fails = (g.fails || 0) + 1;
          var step = STEPS[Math.min(g.fails, STEPS.length - 1)];
          if (step > 0) g.until = Date.now() + step;
          setGuard(g); inp.value = ''; paintLock();
          var md = document.getElementById('shAuthMd');
          md.classList.add('shake'); setTimeout(function () { md.classList.remove('shake'); }, 420);
          toast(lockLeft() > 0 ? 'Locked for ' + fmtLeft(lockLeft()) : 'Incorrect passcode');
        }
      });
    }
  }
  function paintLock() {
    var m = document.getElementById('shLock'); if (!m) return;
    var left = lockLeft(), g = guard(), i = document.getElementById('shPw'), b = document.getElementById('shPwGo');
    if (left > 0) {
      m.className = 'sh-lockmsg bad'; m.textContent = '🚫 Too many attempts — try again in ' + fmtLeft(left) + '.';
      if (i) i.disabled = true; if (b) b.disabled = true;
    } else if (g.fails > 0) {
      var nextAt = -1;
      for (var k = g.fails + 1; k < STEPS.length; k++) { if (STEPS[k] > 0) { nextAt = k; break; } }
      var remain = (nextAt > 0 ? nextAt : g.fails + 1) - g.fails;
      m.className = 'sh-lockmsg warn';
      m.textContent = 'Incorrect — ' + remain + ' attempt' + (remain === 1 ? '' : 's') + ' before a timed lockout.';
      if (i) i.disabled = false; if (b) b.disabled = false;
    } else { m.className = 'sh-lockmsg'; m.textContent = ''; }
  }
  function show() { ensureAuthOverlay().classList.add('show'); }

  /* ================= shareable view state ================= */
  var FIELDS = ['#search', '#sort', '#minmc', '#minrate', '#yrmin', '#yrmax', '#posFilter'];
  function q(sel) { return document.querySelector(sel); }
  function readState() {
    var s = {};
    FIELDS.forEach(function (f) { var el = q(f); if (el && el.value !== '' && el.value != null) s[f.slice(1)] = el.value; });
    var chips = [].slice.call(document.querySelectorAll('.chip.on[data-g]')).map(function (c) { return c.getAttribute('data-g'); });
    if (chips.length) s.g = chips.join('~');
    return s;
  }
  function buildShareUrl() {
    var s = readState();
    var parts = Object.keys(s).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(s[k]); });
    return location.origin + location.pathname + (parts.length ? '#' + parts.join('&') : '');
  }
  function applyStateFromHash() {
    var h = location.hash.replace(/^#/, ''); if (!h) return;
    var s = {};
    h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) s[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
    FIELDS.forEach(function (f) {
      var key = f.slice(1), el = q(f);
      if (el && s[key] != null) {
        el.value = s[key];
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    if (s.g) {
      var want = s.g.split('~');
      document.querySelectorAll('.chip[data-g]').forEach(function (c) {
        var on = c.classList.contains('on'), should = want.indexOf(c.getAttribute('data-g')) !== -1;
        if (on !== should) c.click();
      });
    }
  }
  function wireShare() {
    var btn = document.getElementById('shShare'); if (!btn) return;
    btn.addEventListener('click', function () {
      var url = buildShareUrl();
      var done = function () {
        btn.classList.add('ok');
        var lbl = btn.querySelector('.lbl'); if (lbl) lbl.textContent = 'Copied!';
        toast('Link copied — it reopens this exact view', true);
        setTimeout(function () { btn.classList.remove('ok'); if (lbl) lbl.textContent = 'Share view'; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt('Copy this link:', url); });
      else prompt('Copy this link:', url);
      history.replaceState(null, '', url);
    });
  }

  /* ================= help ================= */
  var SHORTCUTS = {
    games: [['/', 'Focus search'], ['G', 'Grid view'], ['L', 'List view'], ['R', 'Surprise me'], ['?', 'This help'], ['Esc', 'Close dialog']],
    books: [['/', 'Focus search'], ['G', 'Grid view'], ['L', 'List view'], ['R', 'Surprise me'], ['?', 'This help'], ['Esc', 'Close dialog']],
    vocab: [['/', 'Focus the add-word box'], ['F', 'Focus search'], ['S', 'Study session'], ['?', 'This help'], ['Esc', 'Close dialog']],
    home:  [['1 / 2 / 3', 'Games / Books / Words'], ['?', 'This help']]
  };
  function buildHelp() {
    var rows = (SHORTCUTS[page] || SHORTCUTS.home).map(function (r) {
      return '<div class="sh-row"><span>' + r[1] + '</span><kbd>' + r[0] + '</kbd></div>';
    }).join('');
    var ov = document.createElement('div');
    ov.className = 'sh-ov'; ov.id = 'shHelpOv';
    ov.innerHTML = '<div class="sh-md"><h3>Keyboard shortcuts</h3><div class="sub">Everything here works without a mouse.</div>' +
      rows + '<button class="sh-primary" id="shHelpClose">Got it</button></div>';
    document.body.appendChild(ov);
    var close = function () { ov.classList.remove('show'); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('shHelpClose').addEventListener('click', close);
    var btn = document.getElementById('shHelp');
    if (btn) btn.addEventListener('click', function () { ov.classList.add('show'); });
  }
  function typing(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable); }
  function wireKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { var h = document.getElementById('shHelpOv'); if (h) h.classList.remove('show'); closeAuth(); }
      if (typing(document.activeElement)) return;
      if (e.key === '?') { e.preventDefault(); var hv = document.getElementById('shHelpOv'); if (hv) hv.classList.add('show'); return; }
      var k = e.key.toLowerCase();
      if (isHome) {
        if (k === '1') location.href = 'games.html';
        if (k === '2') location.href = 'books.html';
        if (k === '3') location.href = 'vocab.html';
        return;
      }
      var click = function (sel) { var b = q(sel); if (b) { e.preventDefault(); b.click(); } };
      if (k === 'g') click('#gridBtn');
      if (k === 'l') click('#listBtn');
      if (k === 'r') click('#surpriseBtn');
      if (page === 'vocab') {
        if (k === 's') click('#studyBtn');
        if (k === 'f') { var s = q('#search'); if (s) { e.preventDefault(); s.focus(); } }
      }
    });
  }

  /* ================= public API ================= */
  window.Shelf = {
    icon: svgIcon,
    hydrateIcons: hydrateIcons,
    profile: profile,
    name: displayName,
    isCurator: isCurator,
    setCurator: setCurator,
    openAuth: openAuth,
    openCurator: function () { openAuth('curator'); },
    onChange: function (fn) { listeners.push(fn); },
    toast: toast
  };
  window.shelfToast = toast;

  /* ================= boot ================= */
  function init() {
    buildNav(); buildHelp(); wireShare(); wireKeys(); hydrateIcons();
    if (!isHome) setTimeout(applyStateFromHash, 60);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
