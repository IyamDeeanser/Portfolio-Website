/* Goblet tour: a pinned scene. Scrolling plays the rendered animation (or moves a camera over the
   still cutaway), resting on each stop; the part in focus gets a pointer and a leader line to its
   description. Config lives in the JSON inside the section (see README: "Goblet tour").
   Rendered frames arrive in packs: JSON files of base64 AVIF/WebP frames, desktop and phone sets.

   The tour lives in a full-screen sheet that grows out of the Goblet tile: the tile shows the tour's first
   frame, so on open the sheet's clip expands from the tile's picture to the whole screen while the engine
   glides and scales from the tile into its place in the tour. Closing runs it back, crossfading whatever
   frame is showing to the first one on the way, so the engine lands back in the tile exactly. */
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
  var sheet = root.closest(".gx-sheet"), scroller = sheet && sheet.querySelector(".gx-scroll");
  var sLenis = null;                                    // the sheet's own smooth scrolling, while it's open
  var home = 0, uiO = 1, leadO = 1;                                // closing: crossfade to the first frame; side UI opacity
  function vh() { return scroller ? scroller.clientHeight : window.innerHeight; }
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
  // packs are unpacked (JSON, base64 -> image blobs) in a background worker so the work never lands
  // on the main thread mid-scroll; if a worker can't start (e.g. a strict CSP), it's done here instead
  function unpack(j) {
    var out = [];
    for (var k = 0; k < j.frames.length; k++) {
      var b = atob(j.frames[k]), u = new Uint8Array(b.length);
      for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      out.push(new Blob([u], { type: j.type || "image/webp" }));
    }
    return out;
  }
  var worker = null, pending = {}, reqId = 0;
  function mainUnpack(src, done) {
    fetch(src).then(function (r) { return r.json(); }).then(function (j) { done(j.first, j.step, unpack(j)); })
      .catch(function () { done(null); });
  }
  try {
    worker = new Worker(URL.createObjectURL(new Blob([unpack.toString() + ";onmessage=function(e){var d=e.data;fetch(d.src).then(function(r){return r.json()})" +
      ".then(function(j){postMessage({id:d.id,first:j.first,step:j.step,blobs:unpack(j)})}).catch(function(){postMessage({id:d.id,err:1})})}"],
      { type: "text/javascript" })));
    worker.onmessage = function (e) {
      var d = e.data, cb = pending[d.id]; delete pending[d.id];
      if (cb) cb(d.err ? null : d.first, d.step, d.blobs);
    };
    worker.onerror = function () {                      // blocked or broken: finish the queue here
      worker = null;
      Object.keys(pending).forEach(function (id) { var p = pending[id]; delete pending[id]; mainUnpack(p.src, p); });
    };
  } catch (e) { worker = null; }
  function getPack(src, done) {
    src = new URL(src, location.href).href;
    if (!worker) return mainUnpack(src, done);
    var id = ++reqId; done.src = src; pending[id] = done;
    worker.postMessage({ id: id, src: src });
  }
  function loadPacks(packs) {
    // coarse-to-fine order, two requests in flight
    var i = 0, busy = 0;
    function next() {
      while (busy < 2 && i < packs.length) {
        busy++;
        getPack(packs[i++].src, function (first, step, blobs) {
          busy--;
          if (blobs) blobs.forEach(function (b, k) {
            var im = new Image(); im.decoding = "async"; im.onload = kick;
            im.src = URL.createObjectURL(b); frames[first + k * step] = im;
          });
          kick(); next();
        });
      }
    }
    next();
  }
  // AVIF where the browser has it (well under half the size of WebP); otherwise the WebP fallback set
  var AVIF1 = "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAIQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAKW1kYXQSAAoIGAAGiAhoNCAyExlHh4Yhh5555oAAAJBAyRxhQoo=";
  function avifOK(cb) {
    var im = new Image(), t = setTimeout(function () { cb(false); cb = function () {}; }, 1500);
    im.onload = function () { clearTimeout(t); cb(im.width > 0); }; im.onerror = function () { clearTimeout(t); cb(false); };
    im.src = AVIF1;
  }
  function load() {
    if (loaded) return; loaded = true;
    still.src = conf.still.src;
    if (F) avifOK(function (ok) { loadPacks(!ok && F.fb ? F.fb : (narrow.matches && F.m ? F.m : F.d)); });
  }
  // fetch in the background soon after the page settles (the hero's ignition), so the frames are usually
  // all here before anyone scrolls this far; on data-saver or slow connections, wait until the tour is near
  var cn = navigator.connection || {};
  if (!(cn.saveData || /2g|3g/.test(cn.effectiveType || ""))) {
    var soon = function () { setTimeout(function () { (window.requestIdleCallback || function (f) { setTimeout(f, 1); })(load, { timeout: 2000 }); }, 2500); };
    if (document.readyState === "complete") soon(); else window.addEventListener("load", soon);
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
    var r = root.getBoundingClientRect(), span = r.height - vh();
    var top0 = scroller ? scroller.getBoundingClientRect().top : 0;
    var p = Math.min(1, Math.max(0, (top0 - r.top) / Math.max(span, 1)));
    var u = p * n, i = Math.min(Math.floor(u), n - 1), local = u - i;
    var f = i >= n - 1 ? 0 : Math.max(0, (local - HOLD) / (1 - HOLD));
    f = 0.5 * f + 0.5 * f * f * (3 - 2 * f);            // ease out of each stop and into the next
    return i + f;
  }

  var dpr = 1, W = 0, H = 0, sx = 0, sy = 0;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // offsets, not rects: the stage carries a transform while the sheet opens and closes
    var pr = pin.getBoundingClientRect();
    W = stage.offsetWidth; H = stage.offsetHeight; sx = stage.offsetLeft; sy = stage.offsetTop;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    svg.setAttribute("viewBox", "0 0 " + pr.width + " " + pr.height);
  }

  var cur = 0, active = -1, raf = 0, last = 0, primed = false;
  function setActive(k) {
    if (k === active) return;
    // direction of travel: moving down the tour, the old text rises away and the new one comes up from
    // below; moving back up, the reverse. The incoming step is parked on its entry side before it shows.
    var down = active < 0 || k > active;
    var inc = steps[k];
    if (inc && !inc.classList.contains("on")) {
      inc.style.transition = "none";
      inc.style.setProperty("--off", down ? "16px" : "-16px");
      inc.offsetWidth;                                    // commit the parked position before animating
      inc.style.transition = "";
    }
    steps.forEach(function (s, j) { if (j !== k) s.style.setProperty("--off", down ? "-16px" : "16px"); });
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
      if (home > 0 && isFrame) {                         // on the way back into the tile
        var h0 = nearest(0) || (ready(still) ? still : null);
        if (h0 && h0 !== media) { ctx.globalAlpha = home; ctx.drawImage(h0, dx, dy, fw, fh); ctx.globalAlpha = 1; }
      }
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
      g.addColorStop(0, rgba(0)); g.addColorStop(1, rgba(DIM * near * (1 - home)));
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
    svg.style.opacity = near * (1 - home) * leadO;
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
      // with smooth wheel scrolling the scroll itself already glides, so follow it more tightly
      var a = 1 - Math.exp(-dt / ((scroller ? sLenis : window.__lenis) ? TAU * 0.55 : TAU));
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
      if (scroller) {
        var ys = (k + HOLD * 0.5) / n * (root.offsetHeight - vh());
        if (sLenis) sLenis.scrollTo(ys, { duration: 1.4 }); else scroller.scrollTo({ top: ys, behavior: "smooth" });
        return;
      }
      var top = root.getBoundingClientRect().top + window.scrollY;
      var span = root.offsetHeight - window.innerHeight;
      var y = top + (k + HOLD * 0.5) / n * span;
      if (window.__lenis) window.__lenis.scrollTo(y, { duration: 1.4 });
      else window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
    });
  });

  var onScreen = false;
  if (!scroller) {
    new IntersectionObserver(function (es) {
      onScreen = es[0].isIntersecting;
      if (onScreen) { load(); layout(); if (!primed) { primed = true; mid = cur = target(); } kick(); }
    }, { rootMargin: "150% 0px" }).observe(root);
  }
  (scroller || window).addEventListener("scroll", function () { if (onScreen) kick(); }, { passive: true });
  new ResizeObserver(function () { layout(); kick(); }).observe(stage);
  narrow.addEventListener && narrow.addEventListener("change", function () { layout(); kick(); });

  // ---- the sheet: open from the tile, close back into it
  var tile = document.querySelector(".tile.tour"), Spring = window.__Spring;
  if (!scroller || !tile || !Spring) return;
  var tbox = tile.querySelector(".tile-img"), timg = tbox.querySelector("img");
  var side = root.querySelector(".gx-side"), bar = sheet.querySelector(".gx-bar"), closeBtn = sheet.querySelector(".gx-close");
  var track = scroller.querySelector(".gx-track") || root;
  var state = 0, geo = null, pushed = false;           // state: 0 closed, 1 open or opening, -1 closing
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function contain(r, w, h) {
    var s = Math.min(r.width / w, r.height / h), cw = w * s, ch = h * s;
    return { left: r.left + (r.width - cw) / 2, top: r.top + (r.height - ch) / 2, width: cw, height: ch };
  }
  // where the engine sits in the tile and in the tour; the stage transform maps one onto the other
  function measure() {
    var g = { vw: sheet.clientWidth, vh: sheet.clientHeight };
    var b = tbox.getBoundingClientRect();
    if (!(b.width > 0 && b.bottom > 0 && b.top < g.vh)) { g.fade = true; return g; }   // tile off screen: just fade
    var iw = F ? F.w : conf.still.w, ih = F ? F.h : conf.still.h, pr = pin.getBoundingClientRect();
    var sr = { left: pr.left + stage.offsetLeft, top: pr.top + stage.offsetTop, width: stage.offsetWidth, height: stage.offsetHeight };
    var sc = contain(sr, iw, ih), ir = contain(timg.getBoundingClientRect(), iw, ih);
    g.k = ir.width / sc.width;
    g.tx = ir.left - sr.left - g.k * (sc.left - sr.left); g.ty = ir.top - sr.top - g.k * (sc.top - sr.top);
    var br = parseFloat(getComputedStyle(tile).borderTopLeftRadius);   // square tiles: 0, not a fallback
    g.box = b; g.rad = Math.max(0, (isNaN(br) ? 18 : br) - 1);
    return g;
  }
  var sp = new Spring(function (v) {
    var p = v.p, q = 1 - p, g = geo;
    if (!g) return;
    if (g.fade) { sheet.style.opacity = clamp01(p); stage.style.transform = "scale(" + (1 - 0.04 * q) + ")"; }
    else {
      var b = g.box, r = g.rad * q, cq = Math.max(0, q);
      sheet.style.clipPath = "inset(" + b.top * cq + "px " + (g.vw - b.right) * cq + "px " + (g.vh - b.bottom) * cq + "px " + b.left * cq + "px round " + r + "px " + r + "px 0 0)";
      stage.style.transform = "translate(" + g.tx * q + "px," + g.ty * q + "px) scale(" + (1 + (g.k - 1) * q) + ")";
    }
    uiO = clamp01((p - 0.5) / 0.5);                      // the text and controls come in over the second half
    side.style.opacity = uiO; bar.style.opacity = uiO;
    leadO = state < 0 ? clamp01((p - 0.8) / 0.2) : uiO;   // leader lines aren't on the moving stage: let them go first
    if (state < 0) home = clamp01(q / 0.6);
    draw();
  });
  function setInert(on) {
    [].forEach.call(document.body.children, function (el) { if (el !== sheet && el.tagName !== "SCRIPT") el.inert = on; });
  }
  function settle() {
    sheet.style.clipPath = sheet.style.opacity = stage.style.transform = side.style.opacity = bar.style.opacity = "";
    uiO = leadO = 1;
  }
  function open() {
    if (state === 1) return;
    load();
    var resume = state === -1;
    state = 1; home = 0;
    if (!resume) {
      sheet.classList.add("open");
      scroller.scrollTop = 0; layout(); mid = cur = 0; primed = true;
      geo = measure(); sp.set({ p: 0 });
    }
    tile.classList.add("opened");
    document.documentElement.classList.add("gx-open");
    if (window.__lenis) window.__lenis.stop();
    setInert(true); onScreen = true;
    if (window.Lenis && !sLenis) {
      try {
        sLenis = new window.Lenis({ wrapper: scroller, content: track, duration: 0.9, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
          wheelMultiplier: 1, touchMultiplier: 1.4, anchors: false, autoRaf: true, respectReducedMotion: false });
      } catch (e) { sLenis = null; }
    }
    sp.to({ p: 1 }, { damping: 1, response: 0.55 }, settle);
    try { closeBtn.focus({ preventScroll: true }); } catch (e) {}
  }
  function close() {
    if (state !== 1) return;
    state = -1;
    geo = measure();
    setInert(false);
    try { tile.focus({ preventScroll: true }); } catch (e) {}
    sp.to({ p: 0 }, { damping: 1, response: 0.45 }, function () {
      state = 0; settle();
      sheet.classList.remove("open"); tile.classList.remove("opened");
      if (sLenis) { sLenis.destroy(); sLenis = null; }
      scroller.scrollTop = 0; mid = cur = 0; home = 0; onScreen = false; setActive(0); resetPull();
      document.documentElement.classList.remove("gx-open");
      if (window.__lenis) window.__lenis.start();
    });
  }
  // ---- the end: past the last part the tour runs straight into the Goblet page's opening screen (.gx-peek:
  // the page's own header and first lines, laid out exactly as that page and one screen tall), so the bottom
  // of the tour looks just like the top of the write-up, the site's nav included. A last scroll or two from
  // the very bottom meets resistance (it lifts a little, rubber-banded); keep going and the real page takes
  // over at the same spot, lift and all. Only a fresh scroll started at rest at the bottom counts, so the
  // scroll that arrives there (or a trackpad's momentum) never carries straight through.
  var endEl = scroller.querySelector(".gx-end"), peek = endEl && endEl.querySelector(".gx-peek");
  var more = sheet.querySelector(".gx-more"), nextHref = more ? more.href : null, navClone = null;
  var THRESH = 280, pull = 0, armed = false, lastWheel = 0, lastScroll = 0, leaving = false, relaxT = 0, ty0 = null, fetched = false, liftNow = 0;
  function atEnd() { return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2; }
  function rubber(over, dim) { var c = 0.55; return (over * dim * c) / (dim + c * Math.abs(over)); }
  // as the write-up's first screen comes up, the site nav settles in over it and the tour's own controls leave
  function endUI() {
    if (!endEl) return;
    var e = clamp01(1 - endEl.getBoundingClientRect().top / scroller.clientHeight);
    if (e > 0 && !navClone) {
      var live = document.querySelector("header.nav");
      if (live) {
        navClone = live.cloneNode(true); navClone.classList.add("gx-navclone"); navClone.classList.remove("edge");
        navClone.setAttribute("aria-hidden", "true"); navClone.inert = true; sheet.appendChild(navClone);
      }
    }
    var nv = clamp01((e - 0.7) / 0.3);
    if (navClone) navClone.style.opacity = nv.toFixed(3);
    if (!sp.running) { bar.style.opacity = (1 - nv).toFixed(3); bar.style.visibility = nv > 0.99 ? "hidden" : ""; }
  }
  var ps = new Spring(function (v) {
    var x = Math.max(0, v.x); liftNow = rubber(x, scroller.clientHeight * 0.5);
    if (peek) peek.style.transform = liftNow > 0.3 ? "translateY(" + (-liftNow).toFixed(1) + "px)" : "";
    if (navClone) navClone.classList.toggle("edge", liftNow > 1);           // as the real nav does once scrolled
  });
  function relax() { clearTimeout(relaxT); pull = 0; if (!leaving) ps.to({ x: 0 }, { damping: 1, response: 0.4 }); }
  function resetPull() {
    clearTimeout(relaxT); pull = 0; armed = false; ty0 = null; leaving = false;
    ps.set({ x: 0 }); bar.style.visibility = ""; endUI();
  }
  function go() {
    if (leaving || !nextHref) return;
    leaving = true; clearTimeout(relaxT); ps.stop();
    // the page opens scrolled by the same lift, so nothing moves at the switch (and it ignores this scroll's tail)
    try { sessionStorage.setItem("gx-handoff", String(Math.round(liftNow))); } catch (e) {}
    location.href = nextHref;
  }
  function addPull(d) {
    if (leaving) return;
    pull = Math.max(0, pull + d); ps.set({ x: pull });
    clearTimeout(relaxT);
    if (pull >= THRESH) go(); else relaxT = setTimeout(relax, 650);     // let go and it settles back
  }
  scroller.addEventListener("scroll", function () {
    lastScroll = performance.now();
    endUI();
    if (!atEnd()) { armed = false; if (pull > 0) relax(); }
    else if (!fetched && nextHref) {                     // warm the write-up so the hand-off is instant
      fetched = true;
      var l = document.createElement("link"); l.rel = "prefetch"; l.href = nextHref; document.head.appendChild(l);
    }
  }, { passive: true });
  scroller.addEventListener("wheel", function (e) {
    if (state !== 1) return;
    var now = performance.now(), gap = now - lastWheel; lastWheel = now;
    var d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1);
    if (!atEnd() || now - lastScroll < 120) { armed = false; return; }
    if (!armed) { if (gap < 150 || d <= 0) return; armed = true; }   // a fresh scroll, started at rest
    if (d > 0) addPull(Math.min(d, 160)); else if (pull > 0) addPull(Math.max(d, -160));
  }, { passive: true });
  var tTrack = { h: [], add: function (y) { var t = performance.now(); this.h.push([t, y]); while (this.h.length > 2 && t - this.h[0][0] > 100) this.h.shift(); },
    vel: function () { var h = this.h; if (h.length < 2) return 0; var a = h[0], b = h[h.length - 1], dt = (b[0] - a[0]) / 1000;
      return dt > 0 && performance.now() - b[0] < 80 ? (b[1] - a[1]) / dt : 0; } };
  scroller.addEventListener("touchstart", function (e) { ty0 = atEnd() ? e.touches[0].clientY : null; tTrack.h = []; }, { passive: true });
  scroller.addEventListener("touchmove", function (e) {
    if (state !== 1 || leaving) return;
    var y = e.touches[0].clientY;
    if (ty0 == null) { if (atEnd()) ty0 = y; return; }
    pull = Math.max(0, (ty0 - y) * 1.6); clearTimeout(relaxT); ps.set({ x: pull });
    tTrack.add(y);
  }, { passive: true });
  scroller.addEventListener("touchend", function () {
    if (ty0 == null) return; ty0 = null;
    var vy = tTrack.vel(); tTrack.h = [];
    if (pull >= THRESH || (pull > THRESH * 0.25 && vy < -500)) go(); else relax();   // a flick up goes early
  }, { passive: true });
  document.addEventListener("keydown", function (e) {
    if (state !== 1 || !atEnd() || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === " " && e.target.closest && e.target.closest("a, button")) return;
    if (/^(ArrowDown|PageDown|End| )$/.test(e.key)) { e.preventDefault(); addPull(e.key === "ArrowDown" ? 90 : 150); }
  });
  if (endEl) endEl.addEventListener("click", function () { if (state === 1) go(); });   // or just click it
  // coming back from the write-up (back button, page restored from cache): the tour is as it was
  window.addEventListener("pageshow", function (e) { if (e.persisted && leaving) resetPull(); });

  // the browser's back button closes the tour; #goblet opens it
  function openNav() { open(); if (!pushed) { history.pushState({ gxTour: 1 }, "", "#goblet"); pushed = true; } }
  function closeNav() {
    if (pushed && history.state && history.state.gxTour) history.back();
    else { close(); pushed = false; history.replaceState(null, "", location.pathname + location.search); }
  }
  window.addEventListener("popstate", function (e) {
    if (e.state && e.state.gxTour) { pushed = true; open(); }
    else if (state === 1) { pushed = false; close(); }
  });
  tile.addEventListener("click", function (e) {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // new tab: the Goblet page
    e.preventDefault(); openNav();
  });
  tile.addEventListener("pointerenter", load); tile.addEventListener("focus", load);
  closeBtn.addEventListener("click", closeNav);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state === 1) { e.preventDefault(); closeNav(); } });
  window.addEventListener("resize", function () { if (state === 1 && !sp.running) layout(); });
  // a link to #goblet (on load, or followed on this page) opens the tour from the tile
  function deepLink() {
    if (location.hash !== "#goblet" || state === 1) return;
    history.replaceState(null, "", location.pathname + location.search); pushed = false;
    if (window.__lenis) window.__lenis.scrollTo(tile, { offset: -(innerHeight - tile.offsetHeight) / 2, immediate: true });
    else tile.scrollIntoView({ block: "center" });
    requestAnimationFrame(function () { requestAnimationFrame(openNav); });
  }
  window.addEventListener("hashchange", deepLink);
  deepLink();
})();
