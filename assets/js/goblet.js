/* Goblet tour: a pinned scene. Scrolling plays the rendered animation (or moves a camera over the
   still cutaway), resting on each stop; the part in focus gets a pointer and a leader line to its
   description. Config lives in the JSON inside the section (see README: "Goblet tour").
   Rendered frames arrive in packs: JSON files of base64 WebP frames, desktop and phone sets. */
(function () {
  "use strict";
  var root = document.querySelector(".gx");
  if (!root) return;
  var conf;
  try { conf = JSON.parse(root.querySelector(".gx-config").textContent); } catch (e) { return; }
  var canvas = root.querySelector(".gx-canvas");
  var ctx = canvas && canvas.getContext("2d");
  if (!ctx || !conf.stops || !conf.stops.length) return;
  root.classList.add("gx-on");

  var stops = conf.stops, n = stops.length;
  var pin = root.querySelector(".gx-pin"), stage = root.querySelector(".gx-stage");
  var svg = root.querySelector(".gx-lead");
  var steps = root.querySelectorAll(".gx-step"), btns = root.querySelectorAll(".gx-index button");
  var reduce = false;   // the tour always animates, by choice, like the hero flame
  var narrow = window.matchMedia("(max-width: 860px)");
  var BG = conf.bg || [10, 11, 13];
  var DIM = conf.dim != null ? conf.dim : 0.62;

  // a stop may point at more than one part
  stops.forEach(function (s) {
    var a = s.anchor;
    s.anchors = !a ? [] : (typeof a[0] === "number" ? [a] : a);
  });

  // leader lines: one polyline + dot per anchor, one shared end dot at the heading
  var NS = "http://www.w3.org/2000/svg", leads = [];
  svg.innerHTML = "";
  for (var li = 0; li < 3; li++) {
    var pl = document.createElementNS(NS, "polyline"), dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "a"); dot.setAttribute("r", 5);
    svg.appendChild(pl); svg.appendChild(dot); leads.push({ pl: pl, dot: dot });
  }
  var endDot = document.createElementNS(NS, "circle"); endDot.setAttribute("class", "b"); svg.appendChild(endDot);

  // ---- media: the still cutaway, or the rendered frames
  var F = conf.frames && conf.frames.count ? conf.frames : null;
  var still = new Image(), frames = [], loaded = false;
  still.decoding = "async";
  still.onload = function () { kick(); };
  function b64Image(b64) {
    var bin = atob(b64), len = bin.length, u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    var im = new Image(); im.decoding = "async";
    im.src = URL.createObjectURL(new Blob([u8], { type: "image/webp" }));
    return im;
  }
  function loadPacks(packs) {
    var i = 0;
    (function next() {
      if (i >= packs.length) return;
      var p = packs[i++];
      fetch(p.src).then(function (r) { return r.json(); }).then(function (j) {
        j.frames.forEach(function (b64, k) {
          var im = b64Image(b64), idx = j.first + k * j.step;
          im.onload = kick; frames[idx] = im;
        });
        kick(); next();
      }).catch(next);
    })();
  }
  function load() {
    if (loaded) return; loaded = true;
    still.src = conf.still.src;
    if (F) loadPacks(narrow.matches && F.m ? F.m : F.d);
  }
  function ready(im) { return im && im.complete && im.naturalWidth; }
  function nearest(k) {
    for (var d = 0; d < F.count; d++) {                 // nearest frame that has arrived
      if (ready(frames[k - d])) return frames[k - d];
      if (ready(frames[k + d])) return frames[k + d];
    }
    return null;
  }
  function framePos(c) {
    // each stop names the frame it rests on; between stops the frames play in order
    var i = Math.min(Math.floor(c), n - 1), f = c - i;
    var a = stops[i].frame, b = i < n - 1 ? stops[i + 1].frame : a;
    return a + (b - a) * f;
  }
  // the source frame at the scroll position. conf.frames.blend (off by default) crossfades the two
  // frames either side, which only pays off with a low-fps render (it softens edges in motion)
  function framesAt(c) {
    var x = framePos(c), blend = !!F.blend, k0 = blend ? Math.floor(x) : Math.round(x), t = blend ? x - k0 : 0;
    var A = nearest(k0), B = t > 0.02 ? nearest(k0 + 1) : null;
    if (!A) return { a: ready(still) ? still : null, b: null, t: 0, frame: false };
    return { a: A, b: B && B !== A ? B : null, t: t, frame: true };
  }
  // keep the frames just ahead and behind decoded, so drawing them never stalls a scroll
  var warmAt = -1;
  function warm(c) {
    var k = Math.round(framePos(c));
    if (k === warmAt) return; warmAt = k;
    for (var d = -4; d <= 6; d++) { var im = frames[k + d]; if (ready(im) && im.decode) im.decode().catch(function () {}); }
  }

  // ---- camera (only used to move over the still; the render brings its own)
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function camAt(c) {
    var i = Math.min(Math.floor(c), n - 1), f = c - i;
    var a = stops[i].cam || [0.5, 0.5, 1], b = stops[Math.min(i + 1, n - 1)].cam || [0.5, 0.5, 1], e = ease(f);
    return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, Math.exp(Math.log(a[2]) * (1 - e) + Math.log(b[2]) * e)];
  }

  // ---- scroll: each stop rests for the first part of its stretch, then the scene travels on
  var HOLD = conf.hold || 0.5;
  function target() {
    var r = root.getBoundingClientRect(), span = r.height - window.innerHeight;
    var p = Math.min(1, Math.max(0, -r.top / Math.max(span, 1)));
    var u = p * n, i = Math.min(Math.floor(u), n - 1), local = u - i;
    var f = i >= n - 1 ? 0 : Math.max(0, (local - HOLD) / (1 - HOLD));
    f = 0.5 * f + 0.5 * f * f * (3 - 2 * f);            // ease out of each stop and into the next
    return i + f;
  }

  var dpr = 1, W = 0, H = 0, sx = 0, sy = 0;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var sr = stage.getBoundingClientRect(), pr = pin.getBoundingClientRect();
    W = sr.width; H = sr.height; sx = sr.left - pr.left; sy = sr.top - pr.top;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    svg.setAttribute("viewBox", "0 0 " + pr.width + " " + pr.height);
  }

  var cur = 0, active = -1, raf = 0, last = 0, primed = false;
  function setActive(k) {
    if (k === active) return;
    active = k;
    steps.forEach(function (s, j) { s.classList.toggle("on", j === k); });
    btns.forEach(function (b, j) { if (j === k) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });
  }
  function rgba(a) { return "rgba(" + BG[0] + "," + BG[1] + "," + BG[2] + "," + a.toFixed(3) + ")"; }

  function draw() {
    var fr = F ? framesAt(cur) : { a: ready(still) ? still : null, b: null, t: 0, frame: false };
    var media = fr.a;
    var isFrame = fr.frame;                             // with a render, the still is its first frame
    var iw = isFrame ? F.w : conf.still.w, ih = isFrame ? F.h : conf.still.h;
    var cam = isFrame ? [0.5, 0.5, 1] : camAt(cur);
    var s = (isFrame ? Math.min(W / iw, H / ih) : Math.min(W * 0.94 / iw, H * 0.92 / ih)) * cam[2];
    var dx = W / 2 - cam[0] * iw * s, dy = H / 2 - cam[1] * ih * s, fw = iw * s, fh = ih * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (media) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(media, dx, dy, fw, fh);
      if (fr.b) { ctx.globalAlpha = fr.t; ctx.drawImage(fr.b, dx, dy, fw, fh); ctx.globalAlpha = 1; }
      if (isFrame) {
        // the render window ends at the top: let the engine sink into shadow there instead
        var ft = F.fadeTop || 0.3, fb = F.fadeBottom || 0.06;
        var g1 = ctx.createLinearGradient(0, dy, 0, dy + fh * ft);
        g1.addColorStop(0, rgba(1)); g1.addColorStop(0.45, rgba(0.6)); g1.addColorStop(1, rgba(0));
        ctx.fillStyle = g1; ctx.fillRect(dx - 1, dy - 1, fw + 2, fh * ft + 1);
        var g2 = ctx.createLinearGradient(0, dy + fh * (1 - fb), 0, dy + fh);
        g2.addColorStop(0, rgba(0)); g2.addColorStop(1, rgba(1));
        ctx.fillStyle = g2; ctx.fillRect(dx - 1, dy + fh * (1 - fb), fw + 2, fh * fb + 1);
        var fs = F.fadeSide || 0.05;                     // and never show a hard crop at the sides
        var g3 = ctx.createLinearGradient(dx, 0, dx + fw * fs, 0);
        g3.addColorStop(0, rgba(1)); g3.addColorStop(1, rgba(0));
        ctx.fillStyle = g3; ctx.fillRect(dx - 1, dy, fw * fs + 1, fh);
        var g4 = ctx.createLinearGradient(dx + fw * (1 - fs), 0, dx + fw, 0);
        g4.addColorStop(0, rgba(0)); g4.addColorStop(1, rgba(1));
        ctx.fillStyle = g4; ctx.fillRect(dx + fw * (1 - fs), dy, fw * fs + 1, fh);
      }
    }
    var k = Math.round(cur), near = Math.max(0, 1 - Math.abs(cur - k) * 4);   // 1 while resting on a stop
    near = near * near * (3 - 2 * near);
    var an = stops[k].anchors;
    setActive(k);
    // pointers only make sense on the media they were placed on
    if (!an.length || !media) { svg.style.opacity = 0; return; }
    var pts = an.map(function (a) { return [dx + a[0] * fw, dy + a[1] * fh]; });

    // spotlight: dim the scene away from the part(s) in focus
    if (DIM > 0) {
      var cx = 0, cy = 0;
      pts.forEach(function (p) { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
      var g = ctx.createRadialGradient(cx, cy, H * 0.09, cx, cy, H * 0.5);
      g.addColorStop(0, rgba(0)); g.addColorStop(1, rgba(DIM * near));
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }

    // leader lines: each part -> the description's label
    var hdr = steps[k] && (steps[k].querySelector(".gx-n") || steps[k].querySelector("h4"));
    var pr = pin.getBoundingClientRect(), ex = 0, ey = 0, showLine = !narrow.matches && hdr;
    if (showLine) { var hr = hdr.getBoundingClientRect(); ex = hr.left - pr.left - 18; ey = hr.top - pr.top + hr.height * 0.5; }
    leads.forEach(function (L, j) {
      var p = pts[j];
      if (!p) { L.pl.setAttribute("points", ""); L.dot.setAttribute("r", 0); return; }
      var X = sx + p[0], Y = sy + p[1];
      L.dot.setAttribute("cx", X); L.dot.setAttribute("cy", Y); L.dot.setAttribute("r", 5);
      if (!showLine) { L.pl.setAttribute("points", ""); return; }
      var bx = Math.max(X + 24, ex - 64);
      L.pl.setAttribute("points", X + "," + Y + " " + bx + "," + ey + " " + ex + "," + ey);
      var len = Math.hypot(bx - X, ey - Y) + Math.abs(ex - bx);
      L.pl.style.strokeDasharray = len; L.pl.style.strokeDashoffset = len * (1 - near);
    });
    endDot.setAttribute("cx", ex); endDot.setAttribute("cy", ey); endDot.setAttribute("r", showLine ? 2.5 : 0);
    svg.style.opacity = near;
  }

  // the scene follows the scroll through two soft stages: a wheel notch never lurches it,
  // it picks up speed, glides, and settles (a critically damped follow, ~0.3 s)
  var mid = 0, TAU = 0.11;
  function frame(now) {
    raf = 0;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60; last = now;
    var t = target();
    if (reduce) { mid = cur = t; }
    else {
      var a = 1 - Math.exp(-dt / TAU);
      mid += (t - mid) * a;
      cur += (mid - cur) * a;
    }
    if (Math.abs(t - mid) < 0.0004 && Math.abs(t - cur) < 0.0004) { mid = cur = t; }
    draw();
    if (F) warm(cur);
    if (cur !== t) raf = requestAnimationFrame(frame); else last = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  // jump buttons scroll to the middle of a stop's resting stretch
  btns.forEach(function (b) {
    b.addEventListener("click", function () {
      var k = +b.getAttribute("data-go");
      var top = root.getBoundingClientRect().top + window.scrollY;
      var span = root.offsetHeight - window.innerHeight;
      window.scrollTo({ top: top + (k + HOLD * 0.5) / n * span, behavior: reduce ? "auto" : "smooth" });
    });
  });

  var onScreen = false;
  new IntersectionObserver(function (es) {
    onScreen = es[0].isIntersecting;
    if (onScreen) { load(); layout(); if (!primed) { primed = true; mid = cur = target(); } kick(); }
  }, { rootMargin: "150% 0px" }).observe(root);
  window.addEventListener("scroll", function () { if (onScreen) kick(); }, { passive: true });
  new ResizeObserver(function () { layout(); kick(); }).observe(stage);
  narrow.addEventListener && narrow.addEventListener("change", function () { layout(); kick(); });
})();
