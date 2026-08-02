/* ─────────────────────────────────────────────────────────────
   Nova — shared behaviour

   Entrance motion for every page, plus the hero field (#field),
   which only runs where that canvas exists.
   ───────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ── entrance ─────────────────────────────────────────────── */

  /* all of them — a single-page build carries one hero per view */
  var lits = Array.prototype.slice.call(document.querySelectorAll("[data-lit]"));
  if (lits.length) {
    requestAnimationFrame(function () {
      lits.forEach(function (el) { el.classList.add("lit"); });
    });
  }

  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (reduced.matches || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("seen"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("seen");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.06 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* placeholder links stay put instead of jumping to the top */
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest ? ev.target.closest('a[href="#"]') : null;
    if (a) ev.preventDefault();
  });

  var fine = window.matchMedia("(hover: hover) and (pointer: fine)");

  /* one rAF-batched read of the scroll position, shared by everything
     that cares — the bar, and the section the nav points at */
  var scrollJobs = [];
  var scrollQueued = false;

  function onScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () {
      scrollQueued = false;
      for (var i = 0; i < scrollJobs.length; i++) scrollJobs[i]();
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });

  /* ── the bar firms up once the page moves under it ────────── */

  var masthead = document.querySelector(".masthead");

  if (masthead) {
    var wasScrolled = null;
    scrollJobs.push(function () {
      var is = window.scrollY > 6;
      if (is === wasScrolled) return;
      wasScrolled = is;
      masthead.classList.toggle("is-scrolled", is);
    });
  }

  /* ── the nav pill ─────────────────────────────────────────── */
  /* One indicator for the whole nav: it follows the pointer, and
     settles back on whatever section you are actually in. */

  var nav = document.querySelector(".masthead-nav");

  if (nav && nav.querySelector("a")) (function () {
    var links = Array.prototype.slice.call(nav.querySelectorAll("a"));
    var ink = document.createElement("span");
    ink.className = "nav-ink";
    nav.appendChild(ink);

    function anchor() {
      for (var i = 0; i < links.length; i++) {
        if (links[i].classList.contains("is-active") ||
            links[i].getAttribute("aria-current") === "page") return links[i];
      }
      return null;
    }

    function move(el, anchored) {
      if (!el) { ink.classList.remove("is-on", "is-anchored"); return; }

      /* coming back from nothing, it should fade in where it belongs
         rather than fly in from the left edge of the nav */
      var cold = !ink.classList.contains("is-on");
      if (cold) ink.style.transition = "opacity .28s var(--ease)";

      ink.style.width = el.offsetWidth + "px";
      ink.style.transform = "translate3d(" + el.offsetLeft + "px,0,0)";
      ink.classList.add("is-on");
      ink.classList.toggle("is-anchored", !!anchored);

      if (cold) requestAnimationFrame(function () { ink.style.transition = ""; });
    }

    function rest() { move(anchor(), true); }

    links.forEach(function (a) {
      a.addEventListener("pointerenter", function () { move(a, false); });
      a.addEventListener("focus", function () { move(a, false); });
      a.addEventListener("blur", rest);
    });

    nav.addEventListener("pointerleave", rest);

    /* first placement is silent — the pill belongs there already */
    ink.style.transition = "none";
    var start = anchor();
    if (start) {
      ink.style.width = start.offsetWidth + "px";
      ink.style.transform = "translate3d(" + start.offsetLeft + "px,0,0)";
    }
    requestAnimationFrame(function () {
      ink.style.transition = "";
      if (start) ink.classList.add("is-on", "is-anchored");
    });

    /* which in-page section the nav is pointing at */
    var spies = links.filter(function (a) { return a.getAttribute("data-spy"); });

    if (spies.length) {
      var targets = spies.map(function (a) {
        return { link: a, el: document.getElementById(a.getAttribute("data-spy")) };
      }).filter(function (t) { return t.el; });

      var lastActive = null;

      scrollJobs.push(function () {
        var line = window.innerHeight * 0.32;
        var found = null;
        for (var i = 0; i < targets.length; i++) {
          var r = targets[i].el.getBoundingClientRect();
          if (r.top <= line && r.bottom > line) found = targets[i].link;
        }
        if (found === lastActive) return;
        lastActive = found;
        links.forEach(function (a) { a.classList.toggle("is-active", a === found); });
        if (!nav.matches(":hover")) rest();
      });
    }

    var navTimer = null;
    window.addEventListener("resize", function () {
      window.clearTimeout(navTimer);
      navTimer = window.setTimeout(rest, 120);
    });
  })();

  /* ── magnetic buttons ─────────────────────────────────────── */
  /* A few pixels of pull, no more. The offset is handed to CSS as a
     variable so the hover rise composes with it instead of fighting
     it, and a pointer that never arrives leaves the button alone. */

  if (!reduced.matches && fine.matches) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-magnetic]"), function (el) {
      var pull = parseFloat(el.getAttribute("data-magnetic")) || 7;

      el.addEventListener("pointerenter", function (ev) {
        if (ev.pointerType === "touch") return;
        el.classList.add("is-magnetic");
      });

      el.addEventListener("pointermove", function (ev) {
        if (ev.pointerType === "touch") return;
        var r = el.getBoundingClientRect();
        var dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
        var dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
        el.style.setProperty("--mx", (dx * pull).toFixed(2) + "px");
        el.style.setProperty("--my", (dy * pull * 0.55).toFixed(2) + "px");
      });

      function release() {
        el.classList.remove("is-magnetic");
        el.style.removeProperty("--mx");
        el.style.removeProperty("--my");
      }

      el.addEventListener("pointerleave", release);
      el.addEventListener("blur", release);
    });
  }

  /* ── pointer wash on cards ────────────────────────────────── */

  if (fine.matches) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-spot]"), function (el) {
      el.addEventListener("pointermove", function (ev) {
        if (ev.pointerType === "touch") return;
        var r = el.getBoundingClientRect();
        el.style.setProperty("--px", (ev.clientX - r.left) + "px");
        el.style.setProperty("--py", (ev.clientY - r.top) + "px");
      });
    });
  }

  /* ── colour access ────────────────────────────────────────── */

  function token(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function hexToRgb(hex) {
    var s = hex.replace("#", "");
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(hex, alpha) {
    var c = hexToRgb(hex);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alpha + ")";
  }

  function isPaper() { return token("--sky", "#090B12").toLowerCase() !== "#090b12"; }

  var seed = 20260801;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }
  function reseed(n) { seed = n; }

  /* ─────────────────────────────────────────────────────────────
     The Nova field — the signature. A light echo drifting outward
     from one star, with the ecosystem around it as a constellation.
     ───────────────────────────────────────────────────────────── */

  var field = document.getElementById("field");
  var fieldApi = null;

  if (field) fieldApi = (function () {
    var ctx = field.getContext("2d");
    var w = 0, h = 0, dpr = 1, R = 1;
    var origin = { x: 0, y: 0 };
    var motes = [];
    var palette = { star: "#C9D2E8", brand: "#7C5CFF", line: "#4EA8FF", paper: false, dim: 1 };
    var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    var running = true, born = null, last = null, spin = 0;

    /* seven nodes — one per product in the ecosystem, in fixed
       relative positions so the figure is the same every visit */
    var NODES = [
      { a: -1.02, r: 0.94 }, { a: -0.16, r: 0.66 }, { a: 0.58, r: 1.02 },
      { a: 1.44, r: 0.52 }, { a: 2.36, r: 0.88 }, { a: 3.28, r: 0.60 },
      { a: 4.42, r: 0.99 }
    ];
    var EDGES = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,0],[1,5],[3,6]];

    function buildMotes() {
      motes.length = 0;
      reseed(20260801);
      var count = Math.round(Math.min(260, Math.max(90, (w * h) / 6400)));
      for (var i = 0; i < count; i++) {
        motes.push({
          a: rnd() * Math.PI * 2, r: rnd(),
          speed: 0.006 + rnd() * 0.014,
          size: 0.3 + rnd() * 1.0,
          alpha: 0.14 + rnd() * 0.5,
          tw: 0.3 + rnd() * 1.6,
          ph: rnd() * Math.PI * 2
        });
      }
    }

    function readPalette() {
      palette.star = token("--star", "#C9D2E8");
      palette.brand = token("--brand-graphic", "#7C5CFF");
      /* the star is always Nova violet; the constellation joining the
         products is electric blue, darkened when it prints on paper */
      palette.paper = isPaper();
      palette.line = palette.paper ? token("--eco", "#2A6FBF") : token("--eco-graphic", "#4EA8FF");
      palette.dim = palette.paper ? 0.72 : 1;
    }

    function resize() {
      var rect = field.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width; h = rect.height;
      field.width = Math.round(w * dpr);
      field.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* the whole constellation has to sit inside the frame — nodes
         reach 1.02 × R, so R stays under the distance to the edge */
      if (w > 900) {
        origin.x = w * 0.75; origin.y = h * 0.44; R = Math.min(w * 0.205, h * 0.30);
      } else if (w > 700) {
        origin.x = w * 0.73; origin.y = h * 0.30; R = Math.min(w * 0.24, h * 0.22);
      } else {
        origin.x = w * 0.70; origin.y = h * 0.145; R = Math.min(w * 0.30, h * 0.135);
      }
      buildMotes();
    }

    function nodePos(node) {
      var a = node.a + spin;
      return {
        x: origin.x + Math.cos(a) * node.r * R + pointer.x,
        y: origin.y + Math.sin(a) * node.r * R * 0.78 + pointer.y
      };
    }

    function drawSpike(len, thickness, intensity) {
      var g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, rgba(palette.brand, 0.5 * intensity));
      g.addColorStop(0.18, rgba(palette.brand, 0.2 * intensity));
      g.addColorStop(1, rgba(palette.brand, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -thickness); ctx.lineTo(len, 0); ctx.lineTo(0, thickness);
      ctx.closePath();
      ctx.fill();
    }

    function draw(t, dt) {
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);

      var age = reduced.matches ? 1 : Math.min((t - born) / 2000, 1);
      var ramp = 1 - Math.pow(1 - age, 3);
      var breath = reduced.matches ? 1 : 0.9 + Math.sin(t / 2400) * 0.1;
      var intensity = ramp * breath;
      var dim = palette.dim;

      if (!reduced.matches) {
        spin += dt * 0.0000131;                     /* one turn ≈ 8 minutes */
        pointer.x += (pointer.tx - pointer.x) * 0.045;
        pointer.y += (pointer.ty - pointer.y) * 0.045;
      }

      for (var i = 0; i < motes.length; i++) {
        var m = motes[i];
        if (!reduced.matches) {
          m.r += m.speed * (dt / 1000) * (0.35 + (1 - m.r) * 0.9);
          if (m.r > 1.55) m.r = 0.02;
        }
        var rr = m.r * R * 1.45;
        var mx = origin.x + Math.cos(m.a + spin * 0.35) * rr + pointer.x * 0.55;
        var my = origin.y + Math.sin(m.a + spin * 0.35) * rr * 0.82 + pointer.y * 0.55;
        if (mx < -20 || mx > w + 20 || my < -20 || my > h + 20) continue;

        var life = Math.min(m.r / 0.16, 1) * (1 - Math.max(0, (m.r - 1.05) / 0.5));
        var tw = reduced.matches ? 1 : 0.76 + Math.sin(t / 1000 * m.tw + m.ph) * 0.24;
        ctx.fillStyle = rgba(palette.star, m.alpha * tw * life * 0.5 * dim * ramp);
        ctx.beginPath();
        ctx.arc(mx, my, m.size, 0, Math.PI * 2);
        ctx.fill();
      }

      var points = NODES.map(nodePos);
      ctx.lineWidth = 1;
      for (var e = 0; e < EDGES.length; e++) {
        var p1 = points[EDGES[e][0]], p2 = points[EDGES[e][1]];
        var sway = reduced.matches ? 1 : 0.72 + Math.sin(t / 3400 + e) * 0.28;
        ctx.strokeStyle = rgba(palette.line, (palette.paper ? 0.22 : 0.19) * sway * ramp);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      for (var n = 0; n < points.length; n++) {
        var pulse = reduced.matches ? 1 : 0.7 + Math.sin(t / 1800 + n * 1.1) * 0.3;
        ctx.fillStyle = rgba(palette.line, (palette.paper ? 0.8 : 0.7) * pulse * ramp);
        ctx.beginPath();
        ctx.arc(points[n].x, points[n].y, palette.paper ? 1.8 : 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      var ox = origin.x + pointer.x, oy = origin.y + pointer.y;
      var halo = R * (palette.paper ? 0.8 : 1.15) * intensity;

      if (halo > 1) {
        var hg = ctx.createRadialGradient(ox, oy, 0, ox, oy, halo);
        hg.addColorStop(0, rgba(palette.brand, (palette.paper ? 0.15 : 0.2) * dim));
        hg.addColorStop(0.2, rgba(palette.brand, 0.06 * dim));
        hg.addColorStop(1, rgba(palette.brand, 0));
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(ox, oy, halo, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.translate(ox, oy);
      var longSpike = R * 1.25 * intensity;
      for (var k = 0; k < 4; k++) {
        ctx.save();
        ctx.rotate((Math.PI / 2) * k);
        drawSpike(k % 2 === 0 ? longSpike : longSpike * 0.42, 1.5 + intensity, dim);
        ctx.restore();
      }
      ctx.fillStyle = rgba(palette.brand, Math.min(0.95, 0.85 * intensity));
      ctx.beginPath();
      ctx.arc(0, 0, 2.6 + intensity * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function frame(t) {
      if (born === null) { born = t; last = t; }
      var dt = Math.min(t - last, 50);
      last = t;
      draw(t, dt);
      if (running && !reduced.matches) requestAnimationFrame(frame);
    }

    var host = field.parentNode;

    /* Restart the loop from wherever it was told to stop. `born` is
       rewound so the entrance ramp does not replay from zero. */
    var onScreen = true;

    function wake() {
      if (running || reduced.matches || document.hidden || !onScreen) return;
      running = true;
      requestAnimationFrame(function (t) { born = t - 2400; last = t; frame(t); });
    }

    function sleep() { running = false; }

    /* Off-screen, the field is a rAF loop burning a core for nothing.
       Scrolling past the hero is the common case, so it matters more
       than the tab-hidden case the visibility handler already covers. */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        if (onScreen) wake(); else sleep();
      }, { threshold: 0 }).observe(host);
    }

    host.addEventListener("pointermove", function (ev) {
      if (reduced.matches || ev.pointerType === "touch") return;
      var rect = host.getBoundingClientRect();
      pointer.tx = ((ev.clientX - rect.left) / rect.width - 0.5) * -16;
      pointer.ty = ((ev.clientY - rect.top) / rect.height - 0.5) * -12;
    });

    host.addEventListener("pointerleave", function () { pointer.tx = 0; pointer.ty = 0; });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) sleep(); else wake();
    });

    readPalette();
    resize();
    if (reduced.matches) { born = 0; draw(2400, 16); }
    else requestAnimationFrame(frame);

    return {
      resize: function () { resize(); if (reduced.matches) draw(2400, 16); },
      theme: function () { readPalette(); if (reduced.matches) draw(2400, 16); }
    };
  })();

  /* ── lifecycle ────────────────────────────────────────────── */

  /* a reload part-way down the page starts in the right state */
  onScroll();

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      if (fieldApi) fieldApi.resize();
    }, 140);
  });

  function onThemeChange() {
    if (fieldApi) fieldApi.theme();
  }

  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", onThemeChange);

  new MutationObserver(onThemeChange).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"]
  });


  /* Anything that reveals previously hidden content — a single-page
     build switching views, a details panel — calls this so anything
     that had no size while hidden lays out and appears. */
  window.Nova = {
    refresh: function () {
      lits.forEach(function (el) { el.classList.add("lit"); });
      if (fieldApi) fieldApi.resize();
      reveals.forEach(function (el) { el.classList.add("seen"); });
    }
  };
})();
