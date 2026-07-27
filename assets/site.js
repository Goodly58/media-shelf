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
    { id: 'games', href: 'games.html', label: 'Games', icon: '🎮' },
    { id: 'books', href: 'books.html', label: 'Books', icon: '📚' },
    { id: 'vocab', href: 'vocab.html', label: 'Words', icon: '📖' }
  ];
  var page = document.body.getAttribute('data-page') || '';
  var isHome = page === 'home';

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
      return '<a href="' + p.href + '"' + (p.id === page ? ' class="cur"' : '') + '>' + p.icon + ' ' + p.label + '</a>';
    }).join('');
    nav.innerHTML =
      '<div class="sn-in">' +
        (isHome
          ? '<span class="sn-home" style="cursor:default"><span>📚</span> Shelf</span>'
          : '<a class="sn-home" href="index.html" title="Back to Shelf home"><span class="ar">←</span> Shelf</a>') +
        '<nav class="sn-links">' + links + '</nav>' +
        '<div class="sn-right">' +
          (isHome ? '' : '<button class="sn-btn" id="shShare" title="Copy a link to exactly this view">🔗 <span class="lbl">Share view</span></button>') +
          '<button class="sn-btn" id="shHelp" title="Keyboard shortcuts (?)">⌨ <span class="lbl">Shortcuts</span></button>' +
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
      ? '<span class="av">' + initial + '</span><span class="nm">' + escapeHtml(p.name) + (cur ? ' <span class="crown">★</span>' : '') + '</span>'
      : '<span class="av guest">👤</span><span class="nm">Sign in</span>';
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
    buildNav(); buildHelp(); wireShare(); wireKeys();
    if (!isHome) setTimeout(applyStateFromHash, 60);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
