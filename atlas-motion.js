/*
 * Cluster Atlas — motion & interaction layer
 *  1. Once-only scroll reveals (single IntersectionObserver, batched stagger)
 *  2. Cluster card selection → right-hand panel (uses each card's real content)
 *  3. Panel image load state (shimmer only while genuinely loading)
 *  4. Dropdown keyboard support (Escape closes, focus returns to trigger)
 */
(function () {
  'use strict';
  window.__amBoot = true;

  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var narrow = window.matchMedia && matchMedia('(max-width: 767px)').matches;
  var STAGGER = narrow ? 60 : 90;   // ms between items revealed together
  var MAX_STAGGER_STEPS = 8;

  /* ------------------------------------------------------------------
     1. Scroll reveals
     ------------------------------------------------------------------ */
  function mark(sel, extraClass) {
    [].forEach.call(document.querySelectorAll(sel), function (el) {
      el.classList.add('am-item');
      if (extraClass) el.classList.add(extraClass);
    });
  }

  if (root.classList.contains('am-ready') && 'IntersectionObserver' in window) {
    // Desktop (cards arranged around the hub): cards emerge from behind the
    // 43 hub and travel out to their places. Other layouts: normal fade-up.
    var amMap = document.querySelector('.atlas-lp .atlas-map');
    var amHub = amMap && amMap.querySelector('.atlas-hub');
    var emerge = !!(amMap && amHub && window.matchMedia('(min-width: 1024px)').matches);
    if (emerge) setupEmerge(amMap, amHub);
    else {
      mark('.atlas-lp .atlas-map .atlas-window');
      mark('.atlas-lp .atlas-hub', 'am-item--scale');
    }
    mark('.atlas-lp .atlas-explorer');
    mark('.atlas-lp .pf__intro');
    mark('.atlas-lp .pf__step');
    mark('.atlas-lp .pf__benefits');
    mark('footer > .container');

    var io = new IntersectionObserver(function (entries) {
      var batch = entries.filter(function (e) { return e.isIntersecting; })
        .map(function (e) { return e.target; })
        .sort(function (a, b) {
          return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });
      batch.forEach(function (el, i) {
        var d = Math.min(i, MAX_STAGGER_STEPS) * STAGGER;
        // the panel enters a beat after the cards around it
        // (on desktop it waits until the cards have started fanning out)
        if (el.classList.contains('atlas-explorer')) d += emerge ? 450 : 120;
        el.style.setProperty('--am-delay', d + 'ms');
        el.classList.add('am-in');
        io.unobserve(el);   // once only — never replays on scroll
        var done = function (ev) {
          if (ev && ev.target !== el) return;
          el.classList.add('am-done');
          el.removeEventListener('transitionend', done);
        };
        el.addEventListener('transitionend', done);
        setTimeout(done, d + 1300);  // safety net if transitionend never fires
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    [].forEach.call(document.querySelectorAll('.am-item'), function (el) { io.observe(el); });
  }

  function setupEmerge(mapEl, hubEl) {
    var cards = [].slice.call(mapEl.querySelectorAll('.atlas-window'));
    mapEl.classList.add('am-emerge');   // cards now sit hidden & shrunk at their own spot

    // Offset from each card's centre to the hub's centre (scale is centred,
    // so centres are unaffected by the initial shrink).
    function measure() {
      if (mapEl.classList.contains('am-emerge-in')) return;
      var h = hubEl.getBoundingClientRect();
      var hx = h.left + h.width / 2, hy = h.top + h.height / 2;
      cards.forEach(function (c) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--am-fx', (hx - (r.left + r.width / 2)).toFixed(1) + 'px');
        c.style.setProperty('--am-fy', (hy - (r.top + r.height / 2)).toFixed(1) + 'px');
      });
    }
    measure();
    window.addEventListener('resize', measure);

    var mio = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      mio.disconnect();
      measure();
      cards.forEach(function (c, i) {
        c.style.setProperty('--am-delay', (320 + i * 70) + 'ms');  // hub first, then cards
      });
      void mapEl.offsetWidth;
      mapEl.classList.add('am-emerge-in');
      // Once landed, drop the long reveal transition so hover feels instant.
      setTimeout(function () {
        mapEl.classList.add('am-emerge-done');
        window.removeEventListener('resize', measure);
      }, 320 + cards.length * 70 + 1100);
    }, { threshold: 0.2 });
    mio.observe(mapEl);
  }

  /* ------------------------------------------------------------------
     1b. Hub → card connector lines: endless data-transfer animation
     Lines are in the same order as the cards around the hub
     (TL, T, TR, L, R, BL, B, BR), so line i feeds card i.
     ------------------------------------------------------------------ */
  (function wires() {
    var svg = document.querySelector('.atlas-lp .atlas-wires');
    if (!svg) return;
    var lines = [].slice.call(svg.querySelectorAll('line'));
    var cards = [].slice.call(document.querySelectorAll('.atlas-lp .atlas-map .atlas-window'));
    var NS = 'http://www.w3.org/2000/svg';

    // Base dashes drift outward: shift by exactly one dash cycle → seamless loop.
    lines.forEach(function (ln) {
      var da = getComputedStyle(ln).strokeDasharray;
      if (!da || da === 'none') return;
      var parts = da.split(/[\s,]+/).map(parseFloat).filter(function (n) { return !isNaN(n); });
      if (parts.length % 2) parts = parts.concat(parts);
      var cycle = parts.reduce(function (a, b) { return a + b; }, 0);
      if (!cycle) return;
      ln.style.setProperty('--am-dash-cycle', cycle + 'px');
      ln.style.setProperty('--am-dash-speed', Math.max(1.5, cycle / 4) + 's');  // slow, calm drift
      ln.classList.add('am-dashed');
    });

    if (reduce) return;

    // One travelling packet per line, coloured like its destination card.
    var packets = lines.map(function (ln, i) {
      var p = document.createElementNS(NS, 'line');
      ['x1', 'y1', 'x2', 'y2'].forEach(function (a) { p.setAttribute(a, ln.getAttribute(a)); });
      p.setAttribute('class', 'am-packet');
      var card = cards[i];
      var col = card && getComputedStyle(card).getPropertyValue('--cat').trim();
      if (col) p.style.setProperty('--am-pk-color', col);
      svg.appendChild(p);
      return p;
    });

    // Packet dash lengths are in screen px (non-scaling stroke) → measure lines.
    function measure() {
      var r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      packets.forEach(function (p) {
        var dx = (p.x2.baseVal.value - p.x1.baseVal.value) * r.width / 100;
        var dy = (p.y2.baseVal.value - p.y1.baseVal.value) * r.height / 100;
        var len = Math.sqrt(dx * dx + dy * dy);
        p.style.setProperty('--am-len', len.toFixed(1) + 'px');
      });
    }
    measure();
    if ('ResizeObserver' in window) new ResizeObserver(measure).observe(svg);
    else window.addEventListener('resize', measure);
  })();

  /* ------------------------------------------------------------------
     2. Card selection → panel
     First click on a card selects it and shows its theme in the panel;
     clicking the selected card again (or Ctrl/⌘/middle-click) opens its
     page as before. The panel CTA links to the selected theme's page.
     ------------------------------------------------------------------ */
  var map = document.querySelector('.atlas-lp .atlas-map');
  var panel = document.querySelector('.atlas-lp .atlas-explorer');
  var cluster = panel && panel.querySelector('.atlas-explorer__cluster');
  if (map && cluster) {
    var cards = [].slice.call(map.querySelectorAll('.atlas-window'));
    var chip = cluster.querySelector('.atlas-chip');
    var title = cluster.querySelector('h2');
    var text = panel.querySelector('.atlas-explorer__text');
    var cta = panel.querySelector('.atlas-explorer__cta');

    cluster.setAttribute('aria-live', 'polite');
    cards.forEach(function (c) { c.setAttribute('aria-controls', 'atlas-explorer'); });

    function cardData(card, index) {
      var t = card.querySelector('.atlas-window__title');
      var d = card.querySelector('.atlas-window__text');
      var list = card.querySelectorAll('.atlas-window__list > span');
      var n = card.querySelector('.atlas-window__foot .marker-num');
      var desc = d ? d.textContent.trim()
        : [].map.call(list, function (s) { return s.textContent.trim(); }).join(', ') + '.';
      return {
        chip: 'Theme ' + (index + 1) + ' of ' + cards.length + (n ? ' · ' + n.textContent.trim() : ''),
        title: t ? t.textContent.trim() : '',
        text: desc,
        href: card.getAttribute('href')
      };
    }

    var swapTimer = null;
    function render(data) {
      if (chip) chip.textContent = data.chip;
      if (title) title.textContent = data.title;
      if (text) text.textContent = data.text;
      if (cta && data.href) cta.setAttribute('href', data.href);
    }

    function select(card) {
      var data = cardData(card, cards.indexOf(card));
      cards.forEach(function (c) {
        var on = c === card;
        c.classList.toggle('is-selected', on);
        if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
      });

      // Hold the current height so the swap never shifts the layout.
      cluster.style.minHeight = cluster.offsetHeight + 'px';

      if (reduce) { render(data); }
      else {
        clearTimeout(swapTimer);
        cluster.classList.remove('am-swap-in');
        cluster.classList.add('am-out');
        swapTimer = setTimeout(function () {
          render(data);
          cluster.classList.remove('am-out');
          void cluster.offsetWidth;            // restart the feature stagger
          cluster.classList.add('am-swap-in');
        }, 180);
      }

      // When the panel is off-screen (stacked layouts), bring it into view.
      var r = panel.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.75 || r.bottom < 0) {
        panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }
    }

    map.addEventListener('click', function (e) {
      var card = e.target.closest('.atlas-window');
      if (!card) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (card.classList.contains('is-selected')) return; // second click → navigate
      e.preventDefault();
      select(card);
    });
  }

  /* ------------------------------------------------------------------
     2b. Process timeline — plays ONCE when the section appears:
     steps "load" one after another (track fills, step fills, its benefit
     lights up) until the last step, then stops in the completed state.
     ------------------------------------------------------------------ */
  (function processFlow() {
    var flow = document.querySelector('.atlas-lp .pf');
    if (!flow) return;
    var steps = [].slice.call(flow.querySelectorAll('.pf__step'));
    var benefits = [].slice.call(flow.querySelectorAll('.pf__benefit'));
    var n = steps.length;
    if (!n) return;
    var STEP_MS = 900;          // time per step while loading
    var START_DELAY = 0;        // start the moment the section appears

    function setStep(k) {       // k = step currently loading (-1 = none)
      steps.forEach(function (s, i) {
        s.classList.toggle('is-done', i < k);
        s.classList.toggle('is-active', i === k);
      });
      benefits.forEach(function (b, i) { b.classList.toggle('is-active', i <= k); });
    }
    function complete() {
      steps.forEach(function (s) { s.classList.remove('is-active'); s.classList.add('is-done'); });
      benefits.forEach(function (b) { b.classList.add('is-active'); });
      flow.style.setProperty('--pf-progress', 1);
      flow.classList.add('pf--complete');
    }

    if (reduce) { flow.classList.add('am-flow-in'); complete(); return; }

    setStep(-1);
    function play() {
      flow.classList.add('am-flow-in');
      // The line starts moving immediately and fills continuously; each step
      // loads exactly when the fill reaches it.
      flow.style.setProperty('--pf-fill-dur', ((n - 1) * STEP_MS) + 'ms');
      var k = 0;
      setTimeout(function tick() {
        setStep(k);
        if (k === 0) flow.style.setProperty('--pf-progress', 1);   // run the whole line now
        if (k >= n - 1) { setTimeout(complete, STEP_MS); return; }
        k++;
        setTimeout(tick, STEP_MS);
      }, START_DELAY);
    }

    if ('IntersectionObserver' in window) {
      var pio = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return;
        pio.disconnect();       // once only
        play();
      }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });  // as soon as the steps enter view
      pio.observe(flow.querySelector('.pf__steps') || flow);
    } else { play(); }
  })();

  /* ------------------------------------------------------------------
     3. Panel image — shimmer only if it is actually still loading
     ------------------------------------------------------------------ */
  [].forEach.call(document.querySelectorAll('.atlas-explorer__media'), function (box) {
    var img = box.querySelector('img');
    if (!img || (img.complete && img.naturalWidth)) return;
    box.classList.add('am-loading');
    var clear = function () { box.classList.remove('am-loading'); };
    img.addEventListener('load', clear, { once: true });
    img.addEventListener('error', clear, { once: true });
  });

  /* ------------------------------------------------------------------
     4. Dropdowns — Escape closes the open menu via the theme's own toggle
     ------------------------------------------------------------------ */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector('[id^="clusterDropdown-"]:not(.hidden)');
    if (!open) return;
    var n = open.id.split('-').pop();
    var toggle = document.querySelector('[data-dropdown="' + n + '"]');
    if (toggle) { toggle.click(); toggle.focus(); }
  });
})();
