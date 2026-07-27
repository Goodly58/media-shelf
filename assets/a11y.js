/* =====================================================================
   Shelf — accessibility layer (JS)

   Loaded AFTER assets/site.js as a deferred script, i.e. after the page's
   inline script has already rendered its first batch of cards and after
   site.js has injected the shared nav. Nothing here is required by any
   other module, and nothing here requires any other module: every step is
   feature-detected and every lookup is allowed to miss silently.

   What it does
     1. Skip links + landmark roles + a labelled document outline
     2. Accessible names for every control that only had a placeholder,
        a title, or a visually-adjacent <label> that was never associated
     3. Keyboard-operable cards / chips / icon "buttons" that are really
        <div>s, kept working for lazily appended batches via MutationObserver
     4. Real dialog semantics for #overlay and the shared .sh-ov overlays:
        role, aria-modal, focus move, focus trap, Esc, focus restore
     5. Polite live announcements for result counts and toasts
     6. Proper ARIA for the dual range slider
     7. Toggle state (aria-pressed) mirrored from the pages' `.on` class
     8. prefers-reduced-motion: smooth programmatic scrolling downgraded

   Design rules followed throughout:
     · Never replace, remove or re-order an existing node.
     · Never attach a listener that can swallow an existing one (all key
       handling checks for the page's own controls first, and Enter/Space
       activation is delegated, so page handlers keep firing).
     · Every public entry point is wrapped so an exception can never break
       the page it is enhancing.
   ===================================================================== */
(function () {
  'use strict';

  if (window.__shelfA11y) return;          // idempotent if double-included
  window.__shelfA11y = true;

  var doc = document, win = window, root = doc.documentElement;
  var page = (doc.body && doc.body.getAttribute('data-page')) || '';
  var NOUN = page === 'games' ? 'games' : page === 'books' ? 'books'
           : page === 'vocab' ? 'words' : 'items';
  var uid = 0;

  /* ================= tiny, total helpers ================= */
  function $(sel, r) { try { return (r || doc).querySelector(sel); } catch (e) { return null; } }
  function $$(sel, r) {
    try { return Array.prototype.slice.call((r || doc).querySelectorAll(sel)); }
    catch (e) { return []; }
  }
  function set(el, k, v) {
    if (!el || !el.setAttribute) return;
    try { if (el.getAttribute(k) !== v) el.setAttribute(k, v); } catch (e) {}
  }
  /* set only when the attribute is absent/empty — never overwrite authored ARIA */
  function fill(el, k, v) {
    if (!el || !el.getAttribute) return;
    try { if (!el.getAttribute(k)) el.setAttribute(k, v); } catch (e) {}
  }
  function txt(el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function on(el, ev, fn, opt) { if (el && el.addEventListener) el.addEventListener(ev, fn, opt || false); }
  function guard(fn) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (e) { if (win.console && win.console.debug) win.console.debug('[shelf-a11y]', e); }
    };
  }
  function idFor(el, prefix) {
    if (!el) return '';
    if (!el.id) el.id = (prefix || 'a11y') + '-' + (++uid);
    return el.id;
  }
  function isVisible(el) {
    if (!el || !el.getClientRects) return false;
    try { return el.getClientRects().length > 0; } catch (e) { return false; }
  }
  function observe(target, opts, cb) {
    if (!target || !win.MutationObserver) return null;
    var o = new MutationObserver(guard(cb));
    try { o.observe(target, opts); } catch (e) { return null; }
    return o;
  }
  function focusSafe(el) {
    if (!el || !el.focus) return false;
    try { el.focus({ preventScroll: false }); } catch (e) { try { el.focus(); } catch (e2) { return false; } }
    return doc.activeElement === el;
  }
  function isFormField(el) {
    if (!el || !el.tagName) return false;
    return /^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName) || el.isContentEditable === true;
  }

  /* ================= 1. live regions ================= */
  var liveStatus = null, liveAlert = null;

  function ensureLive() {
    if (!liveStatus) {
      liveStatus = doc.createElement('div');
      liveStatus.id = 'a11yLiveStatus';
      liveStatus.className = 'a11y-sr-only';
      liveStatus.setAttribute('role', 'status');
      liveStatus.setAttribute('aria-live', 'polite');
      liveStatus.setAttribute('aria-atomic', 'true');
      doc.body.appendChild(liveStatus);
    }
    if (!liveAlert) {
      liveAlert = doc.createElement('div');
      liveAlert.id = 'a11yLiveAlert';
      liveAlert.className = 'a11y-sr-only';
      liveAlert.setAttribute('role', 'status');
      liveAlert.setAttribute('aria-live', 'polite');
      liveAlert.setAttribute('aria-atomic', 'true');
      doc.body.appendChild(liveAlert);
    }
  }

  /* A live region only announces when its text CHANGES, so a repeated message
     ("Copied" twice in a row is two real events) needs to differ somehow.
     Alternating a trailing no-break space does that without ever emptying the
     region — clearing it first would leave a window in which a screen reader
     reading on demand finds nothing. */
  var NBSP = String.fromCharCode(160);   // invisible-but-different suffix
  var sayTick = 0;
  function say(region, msg) {
    if (!region || !msg) return;
    sayTick = (sayTick + 1) % 2;
    region.textContent = sayTick ? msg : msg + NBSP;
  }

  /* ================= 2. skip links, landmarks, outline ================= */
  var mainEl = null;

  function pickMain() {
    var anchor = $('#grid') || $('#list') || $('.hero');
    var w = anchor && anchor.closest ? anchor.closest('.wrap') : null;
    if (!w) w = anchor;
    if (!w) {
      /* Last resort: the first .wrap that is not inside header/footer/nav. */
      w = $$('.wrap').filter(function (el) {
        return !el.closest('header') && !el.closest('footer') && !el.closest('.sitenav');
      })[0] || null;
    }
    return w;
  }

  function landmarks() {
    /* Shared nav: site.js renders <nav class="sn-links"> inside a plain div,
       so the real <nav> only needs a name. Labelling the outer div too would
       create a pointless nested landmark. */
    var links = $('.sn-links');
    if (links) fill(links, 'aria-label', 'Shelf sections');
    var home = $('.sn-home');
    if (home && home.tagName === 'A') fill(home, 'aria-label', 'Shelf home');

    var right = $('.sn-right');
    if (right) { fill(right, 'role', 'group'); fill(right, 'aria-label', 'Site tools'); }

    /* Page header / footer are direct children of <body>, so they already
       expose banner / contentinfo implicitly. Only name them. */
    var hdr = $('body > header');

    /* The home page has no <header>, so nothing exposes a banner landmark —
       promote the shared chrome instead. Never do this when a real header
       exists: one banner per page. */
    var chrome = $('.sitenav');
    if (chrome && !hdr) fill(chrome, 'role', 'banner');

    if (hdr) fill(hdr, 'aria-label', doc.title ? doc.title.split('—')[0].trim() : 'Page header');
    var ftr = $('body > footer');
    if (ftr) fill(ftr, 'aria-label', 'About this catalogue');

    /* Main content */
    mainEl = pickMain();
    if (mainEl) {
      fill(mainEl, 'role', 'main');
      fill(mainEl, 'tabindex', '-1');
      idFor(mainEl, 'a11y-main');
      fill(mainEl, 'aria-label',
        page === 'games' ? 'Game results' :
        page === 'books' ? 'Book results' :
        page === 'vocab' ? 'Your words' : 'Main content');
    }

    /* The filter bar is the site's search region. */
    var tb = $('.toolbar');
    if (tb) {
      fill(tb, 'role', 'search');
      fill(tb, 'aria-label', 'Search and filter ' + NOUN);
      idFor(tb, 'a11y-toolbar');
      fill(tb, 'tabindex', '-1');
    }

    /* Chip rails are groups, not lists of links. */
    var chips = $('#chips');
    if (chips) {
      fill(chips, 'role', 'group');
      fill(chips, 'aria-label',
        page === 'vocab' ? 'Filter by status or tag' : 'Filter by genre');
    }

    /* Vocab vault tabs behave as a pair of toggles, not a tablist (the panel
       is the same list element), so label them as a group. */
    var vt = $('.vtabs');
    if (vt) { fill(vt, 'role', 'group'); fill(vt, 'aria-label', 'Which collection to show'); }

    var seg = $('.seg');
    if (seg) { fill(seg, 'role', 'group'); fill(seg, 'aria-label', 'Result layout'); }

    var statusrow = $('.statusrow');
    if (statusrow) fill(statusrow, 'aria-label', 'Result summary');

    /* Decorative-only nodes that would otherwise be read as stray text. */
    $$('.range .vals, .slider .track, .slider .fill, .search kbd, .card .grad, .card .sk')
      .forEach(function (el) { fill(el, 'aria-hidden', 'true'); });
  }

  function buildSkipLinks() {
    if ($('.a11y-skiplinks')) return;
    var box = doc.createElement('div');
    box.className = 'a11y-skiplinks';

    var toMain = doc.createElement('a');
    toMain.className = 'a11y-skip';
    toMain.href = '#' + (mainEl ? idFor(mainEl, 'a11y-main') : '');
    toMain.textContent = 'Skip to content';
    if (mainEl) box.appendChild(toMain);

    var tb = $('.toolbar');
    if (tb) {
      var toFilters = doc.createElement('a');
      toFilters.className = 'a11y-skip';
      toFilters.href = '#' + idFor(tb, 'a11y-toolbar');
      toFilters.textContent = 'Skip to filters';
      box.appendChild(toFilters);
    }
    if (!box.children.length) return;

    /* Clicking a skip link must move real focus, not just the scroll offset. */
    on(box, 'click', guard(function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      var id = (a.getAttribute('href') || '').slice(1);
      var target = id ? doc.getElementById(id) : null;
      if (!target) return;
      /* preventDefault keeps the page's shareable #hash state intact — the
         skip link moves real focus instead of navigating. */
      e.preventDefault();
      fill(target, 'tabindex', '-1');
      focusSafe(target);
      try { target.scrollIntoView({ block: 'start' }); } catch (err) {}
    }));

    doc.body.insertBefore(box, doc.body.firstChild);
  }

  function keepSkipFirst() {
    var box = $('.a11y-skiplinks');
    if (box && doc.body.firstChild !== box) doc.body.insertBefore(box, doc.body.firstChild);
  }

  /* ================= 3. accessible names ================= */

  /* Explicit names for controls the markup never named. Only applied when
     the control still has no accessible name, so page/module labels win. */
  var NAMES = {
    '#search':    page === 'vocab' ? 'Search your words' : 'Search ' + NOUN,
    '#sort':      'Sort order',
    '#minmc':     'Minimum Metacritic score',
    '#minrate':   'Minimum rating',
    '#posFilter': 'Filter by part of speech',
    '#yrmin':     'Earliest year',
    '#yrmax':     'Latest year',
    '#gridBtn':   'Grid view',
    '#listBtn':   'List view',
    '#favBtn':    page === 'books' ? 'Show only books on your shelf' : 'Show only favourites',
    '#surpriseBtn': 'Surprise me with a random pick',
    '#resetBtn':  'Reset all filters',
    '#studyBtn':  'Start a study session',
    '#exportBtn': 'Export your vault as a file',
    '#importBtn': 'Import a vault backup',
    '#importFile': 'Choose a backup file',
    '#wordIn':    'Word to add',
    '#srcIn':     'Where you found the word (optional)',
    '#addBtn':    'Add this word to your vault',
    '#ownerBtn':  'Curator sign-in',
    '#tabMine':   'Show my vault',
    '#tabCur':    "Show the curator's picks",
    '#mclose':    'Close'
  };

  /* "Enough characters to be a name": strips icons, bullets and glyphs such
     as the account chip's lone "·" or a close button's "✕". */
  function meaningful(s) { return String(s || '').replace(/[^0-9A-Za-z]+/g, '').length >= 2; }

  /* Only an explicitly authored name (aria-label / aria-labelledby / <label>).
     Used where this layer deliberately replaces a sprawling text-content name
     — a card's whole blurb — with a concise one that still leads with the
     visible title. */
  function hasAuthoredName(el) {
    if (!el) return true;
    return !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
              (el.labels && el.labels.length));
  }

  /* True when the element ALREADY has an accessible name — including one that
     comes from its own rendered text. Overriding those would break WCAG 2.5.3
     (Label in Name) for voice-control users and throw away the page's wording. */
  function hasName(el) {
    if (!el) return true;
    if (hasAuthoredName(el)) return true;

    /* Only these roles take their name from content. An <input>'s value or a
       <select>'s options are never a name. */
    var byContent = /^(BUTTON|A|SUMMARY)$/.test(el.tagName || '') ||
                    el.getAttribute('role') === 'button' ||
                    el.getAttribute('role') === 'link';
    if (!byContent) return false;
    if (!meaningful(txt(el))) return false;

    /* The text may be hidden at this breakpoint (.lbl and .nm are
       display:none on phones); innerText respects CSS, and we only pay for
       that layout read once the cheap textContent check has passed. */
    var shown = '';
    try { shown = String(el.innerText || '').trim(); } catch (e) { shown = txt(el); }
    return meaningful(shown);
  }

  function nameControls(scope) {
    scope = scope || doc;

    Object.keys(NAMES).forEach(function (sel) {
      var el = $(sel, scope);
      if (el && !hasName(el)) set(el, 'aria-label', NAMES[sel]);
    });

    /* Placeholders are not accessible names once text is typed. */
    $$('input[placeholder], textarea[placeholder]', scope).forEach(function (el) {
      if (!hasName(el)) set(el, 'aria-label', el.getAttribute('placeholder'));
    });

    /* Icon-only buttons/links that only carry a title attribute. hasName()
       already protects anything named by its own visible text, so voice
       control ("click Share view") keeps working. */
    $$('button[title], a[title], [role="button"][title]', scope).forEach(function (el) {
      if (hasName(el)) return;
      var t = (el.getAttribute('title') || '').trim();
      if (t) set(el, 'aria-label', t);
    });

    /* Links that open a new tab should say so. */
    $$('a[target="_blank"]', scope).forEach(function (a) {
      if (a.getAttribute('data-a11y-ext')) return;
      set(a, 'data-a11y-ext', '1');
      var base = a.getAttribute('aria-label') || txt(a);
      if (base) set(a, 'aria-label', base.replace(/\s*↗\s*$/, '').trim() + ' (opens in a new tab)');
    });

    /* Icons are decorative: every inline SVG here sits next to real text or
       inside a named control. */
    $$('svg:not([aria-hidden])', scope).forEach(function (s) {
      set(s, 'aria-hidden', 'true');
      set(s, 'focusable', 'false');
    });

    /* Cover images repeat the title that is already in the card's name. */
    $$('img:not([alt])', scope).forEach(function (img) { set(img, 'alt', ''); });
  }

  /* Associate the visually-adjacent labels the pages never wired up:
     .ctl > label (games/books toolbar), .fld > label (vocab edit dialog),
     .sh-field label (shared auth dialog). */
  function wireLabels(scope) {
    scope = scope || doc;
    $$('.ctl, .fld, .sh-field, .wordin, .srcin', scope).forEach(function (box) {
      var lab = $('label', box);
      if (!lab) return;
      var ctls = $$('input, select, textarea', box).filter(function (c) {
        return c.type !== 'hidden';
      });
      if (!ctls.length) return;

      if (ctls.length === 1) {
        var c = ctls[0];
        var lid = idFor(lab, 'a11y-lbl');
        if (c.id && !lab.getAttribute('for')) set(lab, 'for', c.id);
        if (!hasName(c)) set(c, 'aria-labelledby', lid);
      } else {
        /* Several controls under one label (the dual year slider): the label
           names the group, each control gets its own name elsewhere. */
        var gid = idFor(lab, 'a11y-lbl');
        fill(box, 'role', 'group');
        fill(box, 'aria-labelledby', gid);
      }
    });
  }

  /* ================= 4. dual range slider ================= */
  function syncRange() {
    var a = $('#yrmin'), b = $('#yrmax');
    if (!a || !b) return;
    /* The pages already render the values in a human form ("700 BC" rather
       than "-700"); reuse that text so the slider does not read out a
       negative number. Fall back to the raw values if the labels are gone. */
    var lo = txt($('#yrminLbl')) || a.value;
    var hi = txt($('#yrmaxLbl')) || b.value;
    [[a, 'Earliest year'], [b, 'Latest year']].forEach(function (pair) {
      var el = pair[0];
      set(el, 'aria-valuemin', String(el.min || ''));
      set(el, 'aria-valuemax', String(el.max || ''));
      set(el, 'aria-valuenow', String(el.value || ''));
      set(el, 'aria-valuetext', (el === a ? lo : hi) + ', showing ' + lo + ' to ' + hi);
      set(el, 'aria-orientation', 'horizontal');
      if (!hasName(el)) set(el, 'aria-label', pair[1]);
    });
    /* Describe the pair as a whole on the wrapper, so entering the group
       announces the current span before either thumb is touched. Ignored by
       engines without aria-description support, which costs nothing. */
    var group = a.closest ? a.closest('.ctl') : null;
    if (group) set(group, 'aria-description', 'Currently ' + lo + ' to ' + hi);
  }

  function wireRange() {
    var a = $('#yrmin'), b = $('#yrmax');
    if (!a || !b) return;
    [a, b].forEach(function (el) {
      on(el, 'input', guard(syncRange));
      on(el, 'change', guard(syncRange));
    });
    /* #resetBtn writes .value directly and only dispatches on one input. */
    var reset = $('#resetBtn');
    if (reset) on(reset, 'click', guard(function () { win.setTimeout(syncRange, 0); }));
    syncRange();
  }

  /* ================= 5. toggles (aria-pressed mirrors `.on`) ================= */
  var pressedWatched = (typeof WeakSet === 'function') ? new WeakSet() : null;

  function syncPressed(el) {
    if (!el) return;
    set(el, 'aria-pressed', el.classList.contains('on') ? 'true' : 'false');
  }

  function watchPressed(el) {
    if (!el) return;
    if (pressedWatched) { if (pressedWatched.has(el)) return; pressedWatched.add(el); }
    else { if (el.__a11yPressed) return; el.__a11yPressed = 1; }
    syncPressed(el);
    observe(el, { attributes: true, attributeFilter: ['class'] }, function () { syncPressed(el); });
  }

  function wireToggles() {
    ['#favBtn', '#gridBtn', '#listBtn', '#tabMine', '#tabCur'].forEach(function (sel) {
      watchPressed($(sel));
    });

    labelVaultTabs();
    /* The counts change as words are added, so keep the names in step. */
    ['#cntMine', '#cntCur'].forEach(function (sel) {
      observe($(sel), { childList: true, characterData: true, subtree: true }, labelVaultTabs);
    });
    /* Chips are re-created by buildChips(); the chips-container observer
       below re-applies to any replacement. */
    $$('#chips .chip').forEach(enhanceChip);
  }

  /* Vault tabs put an unspaced count badge after their label, so the
     text-content name comes out as "My Vault3". Same repair as the chips:
     keep the visible words, separate the number. */
  function labelVaultTabs() {
    $$('.vtab').forEach(function (b) {
      var cnt = $('.cnt', b);
      var label = txt(b);
      if (cnt) {
        var n = txt(cnt);
        if (n && label.slice(-n.length) === n) label = label.slice(0, -n.length).trim();
        if (n) label += ', ' + n + ' ' + NOUN;
      }
      if (label) set(b, 'aria-label', label);
    });
  }

  function enhanceChip(c) {
    if (!c) return;
    fill(c, 'role', 'button');
    fill(c, 'tabindex', '0');
    syncPressed(c);
    /* The count badge has no separating whitespace, so the text-content name
       comes out as "Strategy / 4X / RTS270". Rebuild it with the genre and
       the count as separate phrases (the genre text is still in the name). */
    if (!hasAuthoredName(c)) {
      var g = c.getAttribute('data-g');
      var n = $('.n', c) || $('.n2', c);
      if (g) {
        var count = n ? txt(n) : '';
        set(c, 'aria-label', count ? g + ', ' + count + ' ' + NOUN : g);
      }
    }
  }

  /* One observer for the whole chip rail: covers rebuilds and .on toggles. */
  function watchChips() {
    var box = $('#chips');
    if (!box) return;
    observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] },
      function () { $$('.chip', box).forEach(enhanceChip); });
  }

  /* Segmented control: left/right arrows move between the two buttons, the
     way a real toolbar behaves. Tab still enters and leaves normally. */
  function wireSegKeys() {
    var seg = $('.seg');
    if (!seg) return;
    on(seg, 'keydown', guard(function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var btns = $$('button', seg).filter(isVisible);
      if (btns.length < 2) return;
      var i = btns.indexOf(doc.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var next = e.key === 'ArrowRight' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      focusSafe(btns[next]);
    }));
  }

  /* ================= 6. cards & other div-buttons ================= */
  var enhanced = (typeof WeakSet === 'function') ? new WeakSet() : null;
  function once(el) {
    if (!el) return false;
    if (enhanced) { if (enhanced.has(el)) return false; enhanced.add(el); return true; }
    if (el.__a11yDone) return false;
    el.__a11yDone = 1;
    return true;
  }

  function cardLabel(el) {
    var title = txt($('.ttl', el)) || txt($('.bt', el));
    if (!title) return '';
    var bits = [title];

    /* .meta is built from <span>s separated by an empty .dot element, so read
       the spans rather than the run-together textContent. */
    var metaSpans = $$('.meta > span', el).map(txt).filter(Boolean);
    if (metaSpans.length) bits.push(metaSpans.join(', '));
    var author = txt($('.ba', el));
    if (!metaSpans.length && author) bits.push(author.replace(/\s*·\s*/g, ', '));

    if (page === 'games') {
      var mc = txt($('.mc', el));
      if (mc) bits.push('Metacritic ' + mc);
      var ign = txt($('.ign', el));
      if (ign) bits.push(ign);
      if ($('.verified', el)) bits.push('verified score');
    } else {
      var rate = txt($('.rate', el)).replace(/[^\d.]/g, '');
      if (rate) bits.push('rated ' + rate + ' out of 5');
    }
    return bits.join('. ');
  }

  function enhanceFav(fav, title) {
    if (!fav) return;
    fill(fav, 'role', 'button');
    fill(fav, 'tabindex', '0');
    syncPressed(fav);
    var verb = page === 'books' ? 'Add to your shelf' : 'Add to favourites';
    set(fav, 'aria-label', title ? verb + ': ' + title : verb);
    /* The class flips only when the card is rebuilt, but observe anyway so a
       future in-place toggle stays truthful. */
    watchPressed(fav);
  }

  function enhanceCard(el) {
    if (!el || !el.classList || !el.classList.contains('card')) return;
    if (!once(el)) return;
    var label = cardLabel(el);
    fill(el, 'role', 'button');
    fill(el, 'tabindex', '0');
    set(el, 'aria-haspopup', 'dialog');
    /* Without a label the name would be the card's entire text content —
       title, badges, blurb and all. The label keeps the visible title first
       and drops the blurb, which the dialog reads out anyway. */
    if (label && !hasAuthoredName(el)) set(el, 'aria-label', label + '. Opens details');
    enhanceFav($('.fav', el), txt($('.ttl', el)) || txt($('.bt', el)));
    $$('img:not([alt])', el).forEach(function (img) { set(img, 'alt', ''); });
    $$('svg:not([aria-hidden])', el).forEach(function (s) {
      set(s, 'aria-hidden', 'true'); set(s, 'focusable', 'false');
    });
    /* The placeholder repeats the title that is already in the card name. */
    fill($('.ph', el), 'aria-hidden', 'true');
  }

  /* Vocab rows: the row itself is not clickable, but the little icon spans
     inside it are, and they were built as <span>s. */
  function enhanceWord(el) {
    if (!el || !once(el)) return;
    var term = txt($('.term', el));
    if (term) fill(el, 'aria-label', term);
    fill(el, 'role', 'group');

    $$('.iconbtn, .spk', el).forEach(function (b) {
      fill(b, 'role', 'button');
      fill(b, 'tabindex', '0');
      if (!hasName(b)) {
        var t = (b.getAttribute('title') || '').trim();
        var vt = txt(b);
        var name = t || vt;
        if (name) set(b, 'aria-label', term ? name + ': ' + term : name);
      }
      if (b.classList.contains('fav')) syncPressed(b);
    });

    /* A synonym chip reads as just "alpha" otherwise, with no hint that
       activating it searches for the word. The visible text stays inside the
       name, so voice control still matches it. */
    $$('.syn .s', el).forEach(function (s) {
      fill(s, 'role', 'button');
      fill(s, 'tabindex', '0');
      if (!hasAuthoredName(s) && txt(s)) set(s, 'aria-label', 'Look up ' + txt(s));
    });

    var sel = $('.statusSel', el);
    if (sel && !hasName(sel)) set(sel, 'aria-label', term ? 'Status for ' + term : 'Status');
  }

  /* Anything inside a dialog that got a click handler assigned as a property
     (the pages use `el.onclick = ...`) but is not a real control. Scoped to
     dialogs so the sweep stays cheap. */
  function enhanceAdHocButtons(scope) {
    $$('div[class], span[class]', scope).forEach(function (el) {
      if (!el.onclick) return;
      if (el.getAttribute('role')) return;
      if (el.closest && el.closest('button, a')) return;
      set(el, 'role', 'button');
      fill(el, 'tabindex', '0');
      if (!hasName(el)) {
        var t = (el.getAttribute('title') || '').trim() || txt(el);
        if (t) set(el, 'aria-label', t);
      }
    });
  }

  /* Toggling a favourite (or editing a word) makes the page rebuild the whole
     list, which throws focus back to <body>. Remember enough to find the same
     control in the rebuilt list and put focus back where the user left it. */
  function rowKey(host) {
    if (!host) return '';
    return host.getAttribute('aria-label') || txt($('.term', host)) ||
           txt($('.ttl', host)) || txt($('.bt', host)) || '';
  }

  function rememberSpot(target) {
    if (!target || !target.closest) return null;
    var host = target.closest('.card, .word');
    if (!host) return null;
    var key = rowKey(host);
    if (!key) return null;
    var classes = String(target.className || '').trim().split(/\s+/).filter(Boolean);
    return { key: key, classes: classes };
  }

  function restoreSpot(spot) {
    if (!spot) return;
    var active = doc.activeElement;
    if (active && active !== doc.body && active !== root) return;   // focus survived
    var host = $$('.card, .word').filter(function (el) { return rowKey(el) === spot.key; })[0];
    if (!host) return;
    var target = null;
    if (spot.classes.length) {
      target = $('.' + spot.classes.join('.'), host) || $('.' + spot.classes[0], host);
    }
    focusSafe(target || host);
  }

  /* Single delegated activation handler: Enter and Space fire a click on any
     element we (or anyone else) marked as a button/switch. Real controls are
     skipped so native behaviour and page handlers are untouched. */
  function wireActivation() {
    /* Mouse users get the same courtesy — a click that rebuilds the list
       should not silently reset the keyboard position either. The vocab
       status <select> rebuilds on `change`, not on `click`. */
    var keepPlace = guard(function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var ctl = t.closest('.fav, .iconbtn, .statusSel');
      if (!ctl) return;
      var spot = rememberSpot(ctl);
      if (spot) win.setTimeout(guard(function () { restoreSpot(spot); }), 0);
    });
    on(doc, 'click', keepPlace, true);
    on(doc, 'change', keepPlace, true);

    on(doc, 'keydown', guard(function (e) {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var isEnter = e.key === 'Enter';
      var isSpace = e.key === ' ' || e.key === 'Spacebar' || e.key === 'Space';
      if (!isEnter && !isSpace) return;

      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (isFormField(t)) return;
      if (/^(A|BUTTON|SUMMARY)$/.test(t.tagName)) return;   // native activation

      var role = t.getAttribute('role');
      if (role !== 'button' && role !== 'switch') return;

      e.preventDefault();          // Space must not scroll the page
      var spot = rememberSpot(t);
      if (typeof t.click === 'function') t.click();
      if (spot) win.setTimeout(guard(function () { restoreSpot(spot); }), 0);
    }));
  }

  /* ================= 7. dialogs ================= */
  var OVERLAYS = [];
  var backgroundHidden = [];
  var lastFocus = null;    // last focused element outside any dialog
  var lastClick = null;    // last activated control, tracked independently of
                           // focus events (they do not fire in a background
                           // tab, and some browsers do not focus on click)
  var lastClickAt = 0;

  function panelOf(ov) { return $('.modal, .sh-md', ov) || ov; }
  function isOpen(ov) { return !!(ov && ov.classList && ov.classList.contains('show') && isVisible(ov)); }
  /* The topmost open dialog — the one latest in document order, which is what
     paints on top when several share a z-index (help vs. sign-in). */
  function anyOpen() {
    var best = null;
    for (var i = 0; i < OVERLAYS.length; i++) {
      var ov = OVERLAYS[i];
      if (!isOpen(ov)) continue;
      if (!best) { best = ov; continue; }
      var rel = best.compareDocumentPosition(ov);
      if (rel & 4 /* DOCUMENT_POSITION_FOLLOWING */) best = ov;
    }
    return best;
  }

  var FOCUSABLE = 'a[href],area[href],button,input,select,textarea,summary,iframe,' +
                  'object,embed,audio[controls],video[controls],' +
                  '[contenteditable]:not([contenteditable="false"]),[tabindex]';

  function focusables(scope) {
    return $$(FOCUSABLE, scope).filter(function (el) {
      if (el.disabled) return false;
      if (el.getAttribute('tabindex') === '-1') return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.type === 'hidden') return false;
      return isVisible(el);
    });
  }

  function labelDialog(ov) {
    var panel = panelOf(ov);
    if (!panel) return;
    var heading = $('.mtitle, .mh, h3, h2, .bt, .mtop .ttl', panel);
    if (heading && txt(heading)) {
      set(panel, 'aria-labelledby', idFor(heading, 'a11y-dlg'));
      panel.removeAttribute('aria-label');
    } else if (!hasName(panel)) {
      set(panel, 'aria-label', 'Details');
    }
  }

  function hideBackground(ov) {
    restoreBackground();
    $$('body > *').forEach(function (el) {
      if (el === ov) return;
      if (!el.tagName || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(el.tagName)) return;
      if (el.id === 'a11yLiveStatus' || el.id === 'a11yLiveAlert') return;
      if (el.classList && el.classList.contains('a11y-skiplinks')) return;
      /* Anyone's live region — ours or another module's — must keep
         announcing while a dialog is open. */
      if (el.hasAttribute('aria-live')) return;
      if (/^(status|alert|log)$/.test(el.getAttribute('role') || '')) return;
      if (isOpen(el)) return;                       // another dialog on top
      if (el.hasAttribute('aria-hidden')) return;   // respect authored state
      set(el, 'aria-hidden', 'true');
      backgroundHidden.push(el);
    });
  }

  function restoreBackground() {
    backgroundHidden.forEach(function (el) {
      try { el.removeAttribute('aria-hidden'); } catch (e) {}
    });
    backgroundHidden = [];
  }

  function openDialog(ov) {
    if (ov.__a11yOpen) return;
    ov.__a11yOpen = 1;

    var panel = panelOf(ov);
    ov.__a11yPanel = panel;
    set(panel, 'role', 'dialog');
    set(panel, 'aria-modal', 'true');
    fill(panel, 'tabindex', '-1');
    labelDialog(ov);

    enhanceScope(panel);
    hideBackground(ov);

    ov.__a11yTrigger = pickTrigger(ov);

    /* rAF alone is not enough: it is throttled to a standstill in background
       tabs, and the dialog can be opened by a script there. Race it against a
       short timer and take whichever arrives first. */
    var moved = false;
    var move = function () {
      if (moved) return;
      moved = true;
      if (!isOpen(ov)) return;
      if (panel.contains(doc.activeElement)) return;   // the page focused it first
      var f = focusables(panel)[0];
      focusSafe(f || panel);
    };
    if (win.requestAnimationFrame) win.requestAnimationFrame(guard(move));
    win.setTimeout(guard(move), 60);
  }

  /* What should get focus back when this dialog closes. activeElement at open
     time is the most trustworthy signal; the tracked fallbacks cover browsers
     that do not focus an element on click. */
  function pickTrigger(ov) {
    var usable = function (el) { return el && doc.contains(el) && !ov.contains(el) && el !== doc.body && el !== root; };
    /* A control the user just activated is the most accurate answer, and it
       covers browsers (Safari) that do not focus buttons on click. Enter on a
       focused control fires a click too, so the keyboard path lands here as
       well. Older activations are ignored — they are not why this opened. */
    if (usable(lastClick) && (Date.now() - lastClickAt) < 1500) return lastClick;
    if (usable(doc.activeElement)) return doc.activeElement;
    if (usable(lastFocus)) return lastFocus;
    return null;
  }

  function closeDialog(ov) {
    if (!ov.__a11yOpen) return;
    ov.__a11yOpen = 0;
    restoreBackground();
    var panel = ov.__a11yPanel;
    if (panel) { try { panel.removeAttribute('aria-modal'); } catch (e) {} }
    /* If this dialog sat on top of another one, the one underneath is modal
       again and needs its background hidden back. */
    var below = anyOpen();
    if (below) { hideBackground(below); return; }

    var trigger = ov.__a11yTrigger;
    ov.__a11yTrigger = null;
    if (trigger && doc.contains(trigger) && isVisible(trigger)) {
      focusSafe(trigger);
      return;
    }
    /* The grid re-renders when the modal's favourite button is used, so the
       card that opened the dialog can be gone. Land on the results region
       rather than dumping focus at the top of the document. */
    if (mainEl && doc.contains(mainEl)) {
      fill(mainEl, 'tabindex', '-1');
      focusSafe(mainEl);
    }
  }

  function syncDialog(ov) {
    if (isOpen(ov)) openDialog(ov); else closeDialog(ov);
  }

  function watchOverlay(ov) {
    if (!ov || ov.__a11yWatched) return;
    ov.__a11yWatched = 1;
    OVERLAYS.push(ov);
    observe(ov, { attributes: true, attributeFilter: ['class', 'style'] }, function () { syncDialog(ov); });
    observe(ov, { childList: true, subtree: true }, function () {
      if (!isOpen(ov)) return;
      enhanceScope(panelOf(ov));
      labelDialog(ov);
    });
    syncDialog(ov);
  }

  function wireOverlays() {
    var found = [$('#overlay')].concat($$('.sh-ov'));
    found.forEach(watchOverlay);
  }

  function wireDialogKeys() {
    /* Focus trap. Registered in the capture phase so it runs before any page
       handler, but it only ever acts on Tab while a dialog is open. */
    on(doc, 'keydown', guard(function (e) {
      if (e.key !== 'Tab') return;
      var ov = anyOpen();
      if (!ov) return;
      var panel = panelOf(ov);
      var list = focusables(panel);
      if (!list.length) { e.preventDefault(); focusSafe(panel); return; }
      var first = list[0], last = list[list.length - 1], a = doc.activeElement;
      if (!panel.contains(a)) {
        e.preventDefault();
        focusSafe(e.shiftKey ? last : first);
      } else if (e.shiftKey && (a === first || a === panel)) {
        e.preventDefault(); focusSafe(last);
      } else if (!e.shiftKey && a === last) {
        e.preventDefault(); focusSafe(first);
      }
    }), true);

    /* Escape. The pages and site.js already close on Escape; this only steps
       in (after a tick) if nothing did, so we never double-close. */
    on(doc, 'keydown', guard(function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      var ov = anyOpen();
      if (!ov) return;
      win.setTimeout(guard(function () {
        if (!isOpen(ov)) return;
        var btn = $('#mclose, .mclose, .sh-close, #shHelpClose, [data-close]', ov);
        if (btn) btn.click();
        if (isOpen(ov)) {
          ov.classList.remove('show');
          if (doc.body.style.overflow === 'hidden') doc.body.style.overflow = '';
        }
      }), 0);
    }));

    /* Track what should get focus back, and act as a safety net: if a dialog
       was closed by a path we did not observe, release the background. */
    on(doc, 'focusin', guard(function (e) {
      OVERLAYS.forEach(function (ov) { if (ov.__a11yOpen && !isOpen(ov)) closeDialog(ov); });
      if (anyOpen()) return;
      var t = e.target;
      if (t && t !== doc.body) lastFocus = t;
    }));

    var noteClick = guard(function (e) {
      if (anyOpen()) return;
      var t = e.target;
      if (!t || !t.closest) return;
      lastClick = t.closest('a,button,[tabindex],[role="button"],.card,.word') || t;
      lastClickAt = Date.now();
    });
    on(doc, 'mousedown', noteClick, true);
    on(doc, 'click', noteClick, true);
  }

  /* ================= 8. announcements ================= */
  var annTimer = 0, lastAnn = '', annArmed = false;

  function resultMessage() {
    if (page === 'vocab') {
      var count = txt($('#count'));
      var emptyV = $('#empty');
      if (emptyV && isVisible(emptyV)) {
        var eh = txt($('.eh', emptyV));
        return eh || 'No words match your filters.';
      }
      /* #count already reads "3 words" or "1 of 3 shown" — keep the page's
         own wording rather than inventing a second phrasing. */
      return count ? count + '.' : '';
    }

    var emptyEl = $('#empty');
    if (emptyEl && isVisible(emptyEl)) return 'No ' + NOUN + ' match your filters.';

    var n = null;
    var lm = txt($('#loadmore'));
    var m = lm.match(/of\s+([\d.,\s]+)/i) || lm.match(/All\s+([\d.,\s]+)\s+shown/i);
    if (m) n = m[1].replace(/[^\d]/g, '');
    if (!n) {
      var shown = $('#shown');
      if (shown && shown.parentElement && isVisible(shown.parentElement)) {
        n = txt(shown).replace(/[^\d]/g, '');
      }
    }
    if (!n) {
      var g = $('#grid');
      if (g) n = String(g.children.length);
    }
    if (!n) return '';

    var msg = Number(n).toLocaleString() + ' ' + NOUN + ' match your filters.';
    var af = txt($('#activeFilters'));
    if (af) msg += ' ' + af.replace(/^filters:\s*/i, 'Filters: ') + '.';
    return msg;
  }

  function announceResults() {
    if (!annArmed) return;
    win.clearTimeout(annTimer);
    annTimer = win.setTimeout(guard(function () {
      var msg = resultMessage();
      if (!msg || msg === lastAnn) return;
      lastAnn = msg;
      say(liveStatus, msg);
    }), 450);
  }

  function watchCounts() {
    var targets = ['#loadmore', '#shown', '#activeFilters', '#count', '#empty', '#avg']
      .map(function (s) { return $(s); })
      .filter(Boolean);
    if (!targets.length) return;

    targets.forEach(function (el) {
      observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] },
        function () { announceResults(); syncRangeSoon(); });
    });

    /* The first render happened before this script ran; arm afterwards so we
       do not announce the page's own initial state on load. */
    lastAnn = resultMessage();
    win.setTimeout(function () { annArmed = true; }, 800);
  }

  var rangeTimer = 0;
  function syncRangeSoon() {
    win.clearTimeout(rangeTimer);
    rangeTimer = win.setTimeout(guard(syncRange), 60);
  }

  /* Toasts: mirror into the alert region rather than making the toast element
     itself live — it is created before its text is set, and during a modal it
     sits in the aria-hidden background. */
  function watchToast(el, announceNow) {
    if (!el || el.__a11yToast) return;
    el.__a11yToast = 1;

    /* Both toasts are shown by putting a `show` class on them; treat a
       re-show of the same text as a new event, because it is one. */
    var shown = function () { return /(^|\s)show(\s|$)/.test(String(el.className || '')); };

    observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] },
      function () {
        var t = txt(el);
        var vis = shown();
        if (!t || !vis) { el.__a11yWasShown = vis; return; }
        if (t !== el.__a11yLastText || !el.__a11yWasShown) {
          el.__a11yLastText = t;
          say(liveAlert, t);
        }
        el.__a11yWasShown = vis;
      });

    /* site.js appends the toast element and fills it in the same task, so by
       the time the body observer hands it to us the text is already there and
       no further mutation is coming. Announce what is on screen right now. */
    if (announceNow) {
      var t0 = txt(el);
      if (t0) { el.__a11yLastText = t0; el.__a11yWasShown = shown(); say(liveAlert, t0); }
    } else {
      el.__a11yLastText = txt(el);
      el.__a11yWasShown = shown();
    }
  }

  function watchToasts() {
    watchToast($('#toast'));
    watchToast($('.sh-toast'));
  }

  /* ================= 9. sticky offset & reduced motion ================= */
  function stickyOffset() {
    var total = 0;
    ['.sitenav', '.toolbar'].forEach(function (sel) {
      var el = $(sel);
      if (!el || !isVisible(el)) return;
      var pos = '';
      try { pos = win.getComputedStyle(el).position; } catch (e) {}
      if (pos !== 'sticky' && pos !== 'fixed') return;
      total += el.offsetHeight || 0;
    });
    /* A mid-layout or zero-size measurement must never turn into an absurd
       scroll offset, so cap the reservation at a sane share of the viewport. */
    if (win.innerHeight > 0) total = Math.min(total, Math.round(win.innerHeight * 0.45));
    root.style.setProperty('--a11y-sticky', (total || 0) + 'px');
  }

  function watchStickyOffset() {
    stickyOffset();
    var t = 0;
    var run = function () { win.clearTimeout(t); t = win.setTimeout(guard(stickyOffset), 120); };
    on(win, 'resize', run);
    on(win, 'orientationchange', run);
    if (win.ResizeObserver) {
      var ro = new ResizeObserver(guard(stickyOffset));
      ['.sitenav', '.toolbar'].forEach(function (sel) {
        var el = $(sel);
        if (el) { try { ro.observe(el); } catch (e) {} }
      });
    }
  }

  /* The pages call scrollIntoView({behavior:'smooth'}) from "Surprise" and the
     synonym links. CSS cannot reach that, so downgrade it at the source. */
  function patchSmoothScroll() {
    var mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!mq) return;
    var patched = false;
    var apply = function () {
      if (patched || !mq.matches || !win.Element || !Element.prototype.scrollIntoView) return;
      patched = true;
      var native = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (opts) {
        try {
          if (opts && typeof opts === 'object' && opts.behavior === 'smooth') {
            var copy = {};
            for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) copy[k] = opts[k];
            copy.behavior = 'auto';
            return native.call(this, copy);
          }
        } catch (e) {}
        return native.apply(this, arguments);
      };
    };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', guard(apply));
    else if (mq.addListener) mq.addListener(guard(apply));
  }

  /* ================= 10. scope enhancement + observers ================= */
  function enhanceScope(scope) {
    scope = scope || doc;
    /* wireLabels first: a real, visible <label> is a better accessible name
       than anything this file can invent, and it keeps the visible text
       inside the accessible name (WCAG 2.5.3 "Label in Name"). */
    wireLabels(scope);
    nameControls(scope);
    $$('.card', scope).forEach(enhanceCard);
    if (scope.classList && scope.classList.contains('card')) enhanceCard(scope);
    $$('.word', scope).forEach(enhanceWord);
    $$('.chip', scope).forEach(enhanceChip);
    if (scope !== doc) enhanceAdHocButtons(scope);
  }

  function watchResults() {
    var container = $('#grid') || $('#list');
    if (!container) return;
    observe(container, { childList: true }, function (records) {
      var touched = false;
      records.forEach(function (r) {
        Array.prototype.forEach.call(r.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          touched = true;
          if (n.classList && n.classList.contains('card')) enhanceCard(n);
          else if (n.classList && n.classList.contains('word')) enhanceWord(n);
          $$('.card', n).forEach(enhanceCard);
          $$('.word', n).forEach(enhanceWord);
        });
      });
      if (touched) announceResults();
    });
    /* Anything already on screen when we booted. */
    $$('.card', container).forEach(enhanceCard);
    $$('.word', container).forEach(enhanceWord);
  }

  function watchBody() {
    observe(doc.body, { childList: true }, function (records) {
      var needNames = false;
      records.forEach(function (r) {
        Array.prototype.forEach.call(r.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          /* Our own nodes never need a re-sweep of the document. */
          if (n.id === 'a11yLiveStatus' || n.id === 'a11yLiveAlert') return;
          if (n.classList && n.classList.contains('a11y-skiplinks')) return;
          needNames = true;
          if (n.classList && n.classList.contains('sh-ov')) watchOverlay(n);
          if (n.classList && n.classList.contains('sh-toast')) watchToast(n, true);
          if (n.id === 'overlay') watchOverlay(n);
          $$('.sh-ov', n).forEach(watchOverlay);
        });
      });
      if (!needNames) return;
      keepSkipFirst();
      landmarks();
      nameControls(doc);
      stickyOffset();
    });
  }

  /* ================= boot ================= */
  function boot() {
    if (!doc.body) return;
    ensureLive();
    landmarks();
    buildSkipLinks();
    wireLabels(doc);       // must run before nameControls — see enhanceScope
    nameControls(doc);
    wireRange();
    wireToggles();
    watchChips();
    wireSegKeys();
    wireActivation();
    wireOverlays();
    wireDialogKeys();
    watchResults();
    watchCounts();
    watchToasts();
    watchBody();
    watchStickyOffset();
    patchSmoothScroll();
    enhanceScope(doc);

    /* site.js may still be pending (different load order in a future page):
       re-run the chrome-dependent bits once everything has settled. */
    win.setTimeout(guard(function () {
      keepSkipFirst();
      landmarks();
      nameControls(doc);
      wireOverlays();
      watchToasts();
      stickyOffset();
    }), 300);
  }

  if (doc.readyState === 'loading') on(doc, 'DOMContentLoaded', guard(boot));
  else guard(boot)();
})();
