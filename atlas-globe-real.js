/*
 * Cluster Atlas — real-world globe
 * Orthographic Earth (Natural Earth 110m land + country borders) with
 * connected city nodes, raised great-circle arcs and travelling pulses.
 * Needs d3 v7 and topojson-client v3 loaded first.
 */
(function () {
  'use strict';

  var WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';

  // [lon, lat]
  var CITIES = {
    nyc: [-74.0, 40.7], sf: [-122.4, 37.8], tor: [-79.4, 43.7], mex: [-99.1, 19.4],
    sao: [-46.6, -23.5], bog: [-74.1, 4.7], lon: [-0.1, 51.5], par: [2.35, 48.85],
    ber: [13.4, 52.5], mad: [-3.7, 40.4], lag: [3.4, 6.5], cai: [31.2, 30.0],
    nbo: [36.8, -1.3], jnb: [28.0, -26.2], dxb: [55.3, 25.2], ruh: [46.7, 24.7],
    bom: [72.9, 19.1], sin: [103.8, 1.35], hkg: [114.2, 22.3], tyo: [139.7, 35.7],
    sel: [127.0, 37.6], syd: [151.2, -33.9], mos: [37.6, 55.75], ist: [29.0, 41.0]
  };
  var LINKS = [
    ['nyc', 'lon'], ['nyc', 'sf'], ['nyc', 'tor'], ['sf', 'tyo'], ['sf', 'mex'],
    ['mex', 'bog'], ['bog', 'sao'], ['sao', 'lag'], ['lon', 'par'], ['par', 'ber'],
    ['lon', 'mad'], ['mad', 'lag'], ['lag', 'nbo'], ['nbo', 'jnb'], ['cai', 'dxb'],
    ['ist', 'cai'], ['ber', 'mos'], ['ist', 'dxb'], ['dxb', 'ruh'], ['dxb', 'bom'],
    ['bom', 'sin'], ['sin', 'hkg'], ['hkg', 'tyo'], ['tyo', 'sel'], ['sin', 'syd'],
    ['lon', 'dxb'], ['nyc', 'sao'], ['jnb', 'bom'], ['syd', 'sf'], ['mos', 'sel']
  ];

  var host = document.querySelector('.atlas-globe');
  var legacy = host && host.querySelector('canvas[data-atlas-globe]');
  if (!host || !legacy || !window.d3 || !window.topojson) return;

  // Keep the theme's canvas in place (so its script keeps working and the
  // layout keeps its size) but hide it; draw on our own canvas above it.
  legacy.style.visibility = 'hidden';
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  var canvas = document.createElement('canvas');
  canvas.className = 'atlas-globe-real';
  canvas.setAttribute('aria-hidden', 'true');
  host.insertBefore(canvas, legacy.nextSibling);
  var ctx = canvas.getContext('2d');

  // ---- palette ----
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // AdVault AI brand palette (from the theme's style.css):
  // navy #091b2c / #061023 / #083359, teal #0DBFC1, deep teal #0B757A,
  // slate teal #356B85, mist #BCDBE5, amber #FFC35A.
  var dark = true;
  var P = {
    oceanIn: [16, 52, 72],          // between #173448 and #093c4a
    oceanOut: [6, 16, 35],          // #061023
    land: [11, 117, 122],           // #0B757A
    landHi: [13, 191, 193],         // #0DBFC1
    landAlpha: 0.9,
    border: 'rgba(188,219,229,0.28)', // #BCDBE5
    grid: 'rgba(53,107,133,0.28)',    // #356B85
    glow: [13, 191, 193],           // #0DBFC1
    arc: [13, 191, 193],            // #0DBFC1
    pulse: [255, 195, 90],          // #FFC35A
    node: [255, 195, 90]            // #FFC35A
  };

  // ---- geometry ----
  var projection = d3.geoOrthographic().clipAngle(90).precision(0.4);
  var path = d3.geoPath(projection, ctx);
  var graticule = d3.geoGraticule10();
  var land = null, borders = null, landT0 = 0;

  var rot = [-20, -18, 0];           // start over Europe / Africa / Atlantic
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, R = 0, CX = 0, CY = 0, dpr = 1;

  var arcs = LINKS.map(function (l, i) {
    var a = CITIES[l[0]], b = CITIES[l[1]];
    var dist = d3.geoDistance(a, b);  // radians
    return {
      interp: d3.geoInterpolate(a, b),
      lift: Math.min(0.28, 0.06 + dist * 0.09),
      steps: Math.max(24, Math.round(dist * 40)),
      speed: 0.00012 + (i % 5) * 0.00002,
      offset: (i * 0.137) % 1
    };
  });

  function resize() {
    var r = host.getBoundingClientRect();
    var lr = legacy.getBoundingClientRect();
    // Match the theme canvas box when it has one, else the host.
    var box = lr.width > 10 && lr.height > 10 ? lr : r;
    W = box.width; H = box.height;
    canvas.style.position = 'absolute';
    canvas.style.left = (box.left - r.left) + 'px';
    canvas.style.top = (box.top - r.top) + 'px';
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.style.pointerEvents = 'auto';
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'pan-y';
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    R = Math.min(W, H) / 2 * 0.86;
    CX = W / 2; CY = H / 2;
    projection.translate([CX, CY]).scale(R);
  }

  // Project a lon/lat raised by `h` (fraction of radius) above the surface.
  var rotator = d3.geoRotation(rot);
  function project3(lonlat, h) {
    var p = rotator(lonlat);
    var lam = p[0] * Math.PI / 180, phi = p[1] * Math.PI / 180;
    var x = Math.cos(phi) * Math.sin(lam);
    var y = Math.sin(phi);
    var z = Math.cos(phi) * Math.cos(lam);
    var k = 1 + h;
    var visible = z > 0 || (x * x + y * y) * k * k > 1;
    return [CX + R * k * x, CY - R * k * y, visible, z];
  }

  function draw(t) {
    projection.rotate(rot);
    rotator = d3.geoRotation(rot);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // atmosphere glow
    var g =ctx.createRadialGradient(CX, CY, R * 0.9, CX, CY, R * 1.22);
    // gentle lighting pulse (~7s cycle, ±12%)
    var breathe = reduce ? 1 : 1 + 0.12 * Math.sin(t * 0.0009);
    g.addColorStop(0, rgba(P.glow, (dark ? 0.35 : 0.22) * breathe));
    g.addColorStop(1, rgba(P.glow, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, CY, R * 1.22, 0, Math.PI * 2); ctx.fill();

    // ocean
    var o = ctx.createRadialGradient(CX - R * 0.35, CY - R * 0.4, R * 0.1, CX, CY, R);
    o.addColorStop(0, rgba(P.oceanIn, 1));
    o.addColorStop(1, rgba(P.oceanOut, 1));
    ctx.fillStyle = o;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.fill();

    // graticule
    ctx.beginPath(); path(graticule);
    ctx.strokeStyle = P.grid; ctx.lineWidth = 0.7; ctx.stroke();

    // land + borders
    if (land) {
      var lg = ctx.createLinearGradient(CX - R, CY - R, CX + R, CY + R);
      lg.addColorStop(0, rgba(P.landHi, 1));
      lg.addColorStop(1, rgba(P.land, 1));
      ctx.beginPath(); path(land);
      // continents fade in once the map data arrives (no pop-in)
      var landFade = reduce || !landT0 ? 1 : Math.min(1, (performance.now() - landT0) / 700);
      ctx.globalAlpha = P.landAlpha * landFade;
      ctx.fillStyle = lg; ctx.fill();
      ctx.globalAlpha = landFade;
      ctx.beginPath(); path(borders);
      ctx.strokeStyle = P.border; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // terminator-style shading for depth
    var s = ctx.createRadialGradient(CX - R * 0.4, CY - R * 0.45, R * 0.2, CX, CY, R * 1.02);
    s.addColorStop(0, 'rgba(255,255,255,' + (dark ? 0.06 : 0.18) + ')');
    s.addColorStop(0.65, 'rgba(0,0,0,0)');
    s.addColorStop(1, 'rgba(0,0,0,' + (dark ? 0.45 : 0.18) + ')');
    ctx.fillStyle = s;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.fill();

    // rim
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(P.glow, dark ? 0.55 : 0.35); ctx.lineWidth = 1.2; ctx.stroke();

    // arcs + pulses
    ctx.lineCap = 'round';
    arcs.forEach(function (a) {
      var pts = [];
      for (var i = 0; i <= a.steps; i++) {
        var f = i / a.steps;
        pts.push(project3(a.interp(f), Math.sin(Math.PI * f) * a.lift));
      }
      ctx.strokeStyle = rgba(P.arc, dark ? 0.55 : 0.6);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      var pen = false;
      for (var j = 0; j < pts.length; j++) {
        if (pts[j][2]) { pen ? ctx.lineTo(pts[j][0], pts[j][1]) : ctx.moveTo(pts[j][0], pts[j][1]); pen = true; }
        else pen = false;
      }
      ctx.stroke();

      if (reduce) return;
      var head = (t * a.speed + a.offset) % 1;
      var tail = 0.12;
      for (var k = 0; k < 8; k++) {
        var ff = head - (k / 8) * tail;
        if (ff < 0) continue;
        var q = project3(a.interp(ff), Math.sin(Math.PI * ff) * a.lift);
        if (!q[2]) continue;
        ctx.fillStyle = k === 0 ? rgba(P.pulse, 1) : rgba(P.pulse, 0.85 * (1 - k / 8));
        ctx.beginPath(); ctx.arc(q[0], q[1], k === 0 ? 2.4 : 1.8 * (1 - k / 10), 0, Math.PI * 2); ctx.fill();
      }
    });

    // city nodes
    Object.keys(CITIES).forEach(function (key, i) {
      var p = project3(CITIES[key], 0);
      if (p[3] <= 0) return;
      var fade = Math.min(1, p[3] * 3);
      var pulse = reduce ? 0.5 : ((t * 0.0006 + i * 0.21) % 1);
      ctx.strokeStyle = rgba(P.arc, (1 - pulse) * 0.7 * fade);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p[0], p[1], 3 + pulse * 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgba(P.node, fade);
      ctx.beginPath(); ctx.arc(p[0], p[1], 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba([255, 255, 255], fade);
      ctx.beginPath(); ctx.arc(p[0], p[1], 1.4, 0, Math.PI * 2); ctx.fill();
    });
  }

  // ---- interaction: drag to spin, auto-rotate otherwise ----
  var dragging = false, last = null, vel = 0, lastTs = 0, running = true;
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; last = [e.clientX, e.clientY]; vel = 0;
    canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - last[0], dy = e.clientY - last[1];
    last = [e.clientX, e.clientY];
    var k = 90 / R;
    rot[0] += dx * k; vel = dx * k;
    rot[1] = Math.max(-60, Math.min(60, rot[1] - dy * k));
    if (reduce) draw(0);
  });
  function endDrag() { dragging = false; canvas.style.cursor = 'grab'; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function frame(ts) {
    if (!running) { lastTs = 0; return; }
    var dt = lastTs ? Math.min(64, ts - lastTs) : 16;
    lastTs = ts;
    if (!dragging) {
      vel *= 0.95;
      rot[0] += 0.006 * dt + vel;
    }
    draw(ts);
    requestAnimationFrame(frame);
  }

  function start() {
    resize();
    if (reduce) { draw(0); return; }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        var vis = es[0].isIntersecting;
        if (vis && !running) { running = true; requestAnimationFrame(frame); }
        running = vis;
      }).observe(host);
    }
    requestAnimationFrame(frame);
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(function () { resize(); if (reduce) draw(0); }).observe(host);
  } else {
    window.addEventListener('resize', function () { resize(); if (reduce) draw(0); });
  }

  // Remove the old theme's thin decorative guide lines (pseudo-elements on the
  // globe area / signal callout) that no longer line up with the new globe.
  (function hideGuideLines() {
    var scope = host.closest('.atlas-hero') || host.parentElement;
    var els = [host].concat([].slice.call(host.querySelectorAll('*')));
    var p = host.parentElement;
    // Walk up to (not including) the hero section, so section dividers stay.
    while (p && p !== scope && !p.classList.contains('atlas-hero__grid')) { els.push(p); p = p.parentElement; }
    var css = [], n = 0;
    els.forEach(function (el) {
      ['::before', '::after'].forEach(function (pseudo) {
        var cs = getComputedStyle(el, pseudo);
        if (!cs || cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') return;
        var w = parseFloat(cs.width) || 0, h = parseFloat(cs.height) || 0;
        var bt = parseFloat(cs.borderTopWidth) || 0, bl = parseFloat(cs.borderLeftWidth) || 0;
        var thin = (w > 20 && h <= 3) || (h > 20 && w <= 3) ||
                   (h === 0 && bt > 0 && w > 20) || (w === 0 && bl > 0 && h > 20);
        if (!thin) return;
        var id = 'agl' + (n++);
        el.setAttribute('data-' + id, '');
        css.push('[data-' + id + ']' + pseudo + '{display:none!important}');
        if (window.console) console.info('[atlas-globe] hid guide line:', el.className || el.tagName, pseudo, w + 'x' + h);
      });
    });
    if (css.length) {
      var st = document.createElement('style');
      st.id = 'atlas-globe-hide-lines';
      st.textContent = css.join('\n');
      document.head.appendChild(st);
    }
  })();

  start();
  fetch(WORLD_URL).then(function (r) { return r.json(); }).then(function (world) {
    land = topojson.feature(world, world.objects.land);
    landT0 = performance.now();
    borders = topojson.mesh(world, world.objects.countries, function (a, b) { return a !== b; });
    if (reduce) draw(0);
  }).catch(function () { /* globe still renders ocean, grid, arcs and nodes */ });
})();
