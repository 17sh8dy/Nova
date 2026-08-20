/* ─────────────────────────────────────────────────────────────
   Nova — generated product plates  (PARKED, not loaded)

   Drawn portraits of what each product does, in the same line-work
   as the hero constellation. Replaced on the ecosystem page by
   real screenshots; kept here so they can come back.

   To re-enable: load this file after nova.js and give a product a
   <figure class="plate"><canvas data-art="globe"></canvas></figure>
   in place of the placeholder. Keys: globe, engine, cut, assistant,
   replay, horizon.
   ───────────────────────────────────────────────────────────── */

(function () {
  "use strict";

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
     Product plates — a drawn portrait of what each product does, in
     the same line-work as the constellation. Rendered when it comes
     into view, repainted on resize or theme change. Blue is
     structure, violet is the live element.
     ───────────────────────────────────────────────────────────── */

  var art = {};

  art.globe = function (c, W, H, ink, blue, violet) {
    var cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.36;

    c.strokeStyle = rgba(blue, 0.4);
    c.lineWidth = 1;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();

    c.strokeStyle = rgba(ink, 0.34);
    for (var i = -4; i <= 4; i++) {
      var phi = (i / 5) * (Math.PI / 2);
      var y = cy + Math.sin(phi) * r, rx = Math.cos(phi) * r;
      c.beginPath();
      c.ellipse(cx, y, rx, rx * 0.2, 0, 0, Math.PI * 2);
      c.stroke();
    }
    for (var j = 0; j < 6; j++) {
      var th = (j / 6) * Math.PI;
      c.beginPath();
      c.ellipse(cx, cy, Math.abs(Math.cos(th)) * r, r, 0, 0, Math.PI * 2);
      c.stroke();
    }

    reseed(41);
    for (var k = 0; k < 9; k++) {
      var lat = (rnd() - 0.5) * 1.5, lon = rnd() * Math.PI * 2;
      if (Math.cos(lon) < 0) continue;                       /* far side */
      c.fillStyle = rgba(blue, 0.85);
      c.beginPath();
      c.arc(cx + Math.sin(lon) * Math.cos(lat) * r, cy + Math.sin(lat) * r, 2.2, 0, Math.PI * 2);
      c.fill();
    }

    /* the one place you are looking at */
    var tx = cx + r * 0.26, ty = cy - r * 0.3;
    c.strokeStyle = rgba(violet, 0.85);
    c.lineWidth = 1.4;
    c.beginPath();
    c.arc(tx, ty, 12, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = rgba(violet, 1);
    c.beginPath();
    c.arc(tx, ty, 3.2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = rgba(violet, 0.3);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(tx, ty - 12); c.lineTo(tx, 0);
    c.stroke();
  };

  art.engine = function (c, W, H, ink, blue, violet) {
    var hz = H * 0.33, vx = W / 2;

    c.strokeStyle = rgba(violet, 0.55);
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(W * 0.06, hz); c.lineTo(W * 0.94, hz);
    c.stroke();

    c.strokeStyle = rgba(ink, 0.3);
    c.lineWidth = 1;
    for (var i = -14; i <= 14; i++) {
      c.beginPath();
      c.moveTo(vx + i * (W / 9), H); c.lineTo(vx + i * W * 0.055, hz);
      c.stroke();
    }
    for (var s = 1; s <= 11; s++) {
      var t = s / 11, y = hz + Math.pow(t, 2.3) * (H - hz);
      c.strokeStyle = rgba(ink, 0.3 * (0.35 + t));
      c.beginPath();
      c.moveTo(0, y); c.lineTo(W, y);
      c.stroke();
    }

    function box(bx, by, bw, bh, bd, alpha) {
      c.strokeStyle = rgba(blue, alpha);
      c.lineWidth = 1;
      c.beginPath();
      c.rect(bx, by - bh, bw, bh);
      c.stroke();
      c.beginPath();
      c.moveTo(bx, by - bh); c.lineTo(bx + bd, by - bh - bd * 0.5);
      c.lineTo(bx + bw + bd, by - bh - bd * 0.5); c.lineTo(bx + bw, by - bh);
      c.stroke();
      c.beginPath();
      c.moveTo(bx + bw + bd, by - bh - bd * 0.5); c.lineTo(bx + bw + bd, by - bd * 0.5);
      c.lineTo(bx + bw, by);
      c.stroke();
    }
    box(W * 0.16, hz + (H - hz) * 0.46, W * 0.13, H * 0.2, W * 0.05, 0.55);
    box(W * 0.66, hz + (H - hz) * 0.3, W * 0.1, H * 0.13, W * 0.04, 0.42);
  };

  art.cut = function (c, W, H, ink, blue, violet) {
    var left = W * 0.08, right = W * 0.92, top = H * 0.2;
    var rowH = H * 0.12, gap = H * 0.045;

    reseed(7);

    for (var r = 0; r < 4; r++) {
      var y = top + r * (rowH + gap);
      c.strokeStyle = rgba(ink, 0.22);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(left, y + rowH); c.lineTo(right, y + rowH);
      c.stroke();

      var x = left;
      while (x < right - 20) {
        var cw = (right - left) * (0.08 + rnd() * 0.22);
        if (x + cw > right) cw = right - x;
        c.fillStyle = rgba(blue, 0.1 + r * 0.02);
        c.strokeStyle = rgba(blue, 0.5);
        c.beginPath();
        c.rect(x, y, cw - 6, rowH);
        c.fill();
        c.stroke();

        if (r === 3) {                                    /* the audio track */
          c.strokeStyle = rgba(blue, 0.75);
          c.beginPath();
          for (var px = x + 4; px < x + cw - 10; px += 3) {
            var amp = (rnd() * 0.8 + 0.15) * rowH * 0.42;
            c.moveTo(px, y + rowH / 2 - amp);
            c.lineTo(px, y + rowH / 2 + amp);
          }
          c.stroke();
        }
        x += cw;
      }
    }

    var ph = left + (right - left) * 0.38;
    c.strokeStyle = rgba(violet, 0.95);
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(ph, top - H * 0.09); c.lineTo(ph, top + 4 * (rowH + gap));
    c.stroke();
    c.fillStyle = rgba(violet, 1);
    c.beginPath();
    c.moveTo(ph - 6, top - H * 0.09);
    c.lineTo(ph + 6, top - H * 0.09);
    c.lineTo(ph, top - H * 0.09 + 9);
    c.closePath();
    c.fill();
  };

  /* everything the assistant holds, arranged by how close to hand it
     is: rings of context around one resident process */
  art.assistant = function (c, W, H, ink, blue, violet) {
    var cx = W * 0.5, cy = H * 0.5;
    var stepX = (W * 0.40) / 5, stepY = (H * 0.38) / 5;

    for (var i = 1; i <= 5; i++) {
      c.strokeStyle = rgba(ink, 0.34 - i * 0.035);
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(cx, cy, stepX * i, stepY * i, 0, 0, Math.PI * 2);
      c.stroke();
    }

    reseed(913);
    for (var ring = 1; ring <= 5; ring++) {
      var count = ring + 1, offset = rnd() * Math.PI * 2;
      for (var n = 0; n < count; n++) {
        var a = offset + (n / count) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
        var px = cx + Math.cos(a) * stepX * ring;
        var py = cy + Math.sin(a) * stepY * ring;
        var near = 1 - (ring - 1) / 5;

        c.strokeStyle = rgba(blue, 0.1 + near * 0.16);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(cx, cy); c.lineTo(px, py);
        c.stroke();

        c.fillStyle = rgba(blue, 0.35 + near * 0.5);
        c.beginPath();
        c.arc(px, py, 1.8 + near * 1.8, 0, Math.PI * 2);
        c.fill();
      }
    }

    c.strokeStyle = rgba(violet, 0.55);
    c.lineWidth = 1.2;
    c.beginPath();
    c.arc(cx, cy, 13, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = rgba(violet, 1);
    c.beginPath();
    c.arc(cx, cy, 5, 0, Math.PI * 2);
    c.fill();
  };

  art.replay = function (c, W, H, ink, blue, violet) {
    var cx = W * 0.5, cy = H * 0.44, r = Math.min(W, H) * 0.3;

    c.strokeStyle = rgba(ink, 0.26);
    c.lineWidth = 1;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();

    for (var i = 0; i < 72; i++) {
      var a = (i / 72) * Math.PI * 2 - Math.PI / 2;
      var inner = r - (i % 6 === 0 ? 12 : 6);
      c.strokeStyle = rgba(ink, i % 6 === 0 ? 0.6 : 0.34);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      c.stroke();
    }

    c.strokeStyle = rgba(violet, 0.9);            /* the part still held */
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cy, r, -Math.PI / 2 - 1.15, -Math.PI / 2);
    c.stroke();

    var fw = W * 0.1, fh = fw * 0.56, fy = cy + r + Math.min(H * 0.12, 44);
    var total = 5, span = total * (fw + 10) - 10;
    for (var f = 0; f < total; f++) {
      var live = f === total - 1;
      c.strokeStyle = live ? rgba(violet, 0.9) : rgba(blue, 0.45);
      c.fillStyle = live ? rgba(violet, 0.12) : rgba(blue, 0.07);
      c.lineWidth = 1;
      c.beginPath();
      c.rect(cx - span / 2 + f * (fw + 10), fy, fw, fh);
      c.fill();
      c.stroke();
    }
  };

  art.horizon = function (c, W, H, ink, blue, violet) {
    var hz = H * 0.46, vx = W * 0.52, sy = hz - H * 0.07;
    var sunR = Math.min(W, H) * 0.085;

    /* a sun already touching the horizon — the glow is clipped by the
       land, which is what stops it reading as a floating orb */
    c.save();
    c.beginPath();
    c.rect(0, 0, W, hz);
    c.clip();
    var glow = c.createRadialGradient(vx, sy, sunR * 0.4, vx, sy, sunR * 3.4);
    glow.addColorStop(0, rgba(violet, 0.26));
    glow.addColorStop(0.45, rgba(violet, 0.07));
    glow.addColorStop(1, rgba(violet, 0));
    c.fillStyle = glow;
    c.fillRect(0, 0, W, hz);
    c.strokeStyle = rgba(violet, 0.85);
    c.lineWidth = 1.3;
    c.beginPath();
    c.arc(vx, sy, sunR, 0, Math.PI * 2);
    c.stroke();
    for (var b = 1; b <= 4; b++) {
      var by = sy - sunR + (b / 5) * sunR * 2;
      var half = Math.sqrt(Math.max(0, sunR * sunR - Math.pow(by - sy, 2)));
      c.strokeStyle = rgba(violet, 0.3);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(vx - half, by); c.lineTo(vx + half, by);
      c.stroke();
    }
    c.restore();

    c.strokeStyle = rgba(ink, 0.42);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, hz); c.lineTo(W, hz);
    c.stroke();

    c.strokeStyle = rgba(ink, 0.28);
    c.beginPath();
    c.moveTo(0, hz);
    for (var x = 0; x <= W; x += 8) {
      c.lineTo(x, hz - Math.sin(x / W * 3.1) * H * 0.05 - Math.sin(x / W * 8.3) * H * 0.02);
    }
    c.stroke();

    for (var g = -7; g <= 7; g++) {
      if (g === 0) continue;
      c.strokeStyle = rgba(ink, 0.16);
      c.beginPath();
      c.moveTo(vx + g * (W / 4.2), H); c.lineTo(vx + g * W * 0.012, hz);
      c.stroke();
    }
    for (var d = 1; d <= 9; d++) {
      var td = Math.pow(d / 9, 2.4);
      c.strokeStyle = rgba(ink, 0.1 + td * 0.14);
      c.beginPath();
      c.moveTo(0, hz + td * (H - hz)); c.lineTo(W, hz + td * (H - hz));
      c.stroke();
    }

    c.strokeStyle = rgba(blue, 0.6);
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(W * 0.02, H); c.lineTo(vx - 2.5, hz);
    c.moveTo(W * 0.98, H); c.lineTo(vx + 2.5, hz);
    c.stroke();

    for (var s = 0; s < 10; s++) {
      var t0 = Math.pow(s / 10, 2.2), t1 = Math.pow((s + 0.5) / 10, 2.2);
      c.strokeStyle = rgba(blue, 0.35 + (1 - s / 10) * 0.5);
      c.lineWidth = 0.6 + (1 - s / 10) * 2.4;
      c.beginPath();
      c.moveTo(vx, hz + (H - hz) * (1 - t0));
      c.lineTo(vx, hz + (H - hz) * (1 - t1));
      c.stroke();
    }
  };


  var plates = Array.prototype.slice.call(document.querySelectorAll("canvas[data-art]"));

  function paint(cv) {
    var kind = cv.getAttribute("data-art");
    if (!art[kind]) return;
    var rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var d = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(rect.width * d);
    cv.height = Math.round(rect.height * d);
    var c = cv.getContext("2d");
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, rect.width, rect.height);
    c.lineJoin = "round";
    art[kind](c, rect.width, rect.height,
      token("--ink-3", "#6E7794"),
      isPaper() ? token("--eco", "#2A6FBF") : token("--eco-graphic", "#4EA8FF"),
      token("--brand-graphic", "#7C5CFF"));
    cv.dataset.painted = "1";
  }

  function repaint() {
    plates.forEach(function (cv) { if (cv.dataset.painted) paint(cv); });
  }

  if (!plates.length) return;

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { paint(entry.target); io.unobserve(entry.target); }
      });
    }, { rootMargin: "300px 0px" });
    plates.forEach(function (cv) { io.observe(cv); });
  } else {
    plates.forEach(paint);
  }

  var timer = null;
  window.addEventListener("resize", function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(repaint, 140);
  });

  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", repaint);
  new MutationObserver(repaint).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"]
  });
})();
