(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var IO = "IntersectionObserver" in window;

  /* ---- motion helpers, after Apple's fluid-interface approach ----
     Spring: each value springs to its target on its own (x and y never share one spring), starting from
     wherever it is now and with the velocity it already has, so any motion can be grabbed and redirected
     mid-flight. Tuned with Apple's two numbers: damping ratio (1 = no overshoot) and response (seconds). */
  function Spring(apply) { this.x = {}; this.v = {}; this.t = {}; this.apply = apply; this.raf = 0; this.running = false; }
  Spring.prototype.set = function (vals) {
    this.stop();
    for (var k in vals) { this.x[k] = this.t[k] = vals[k]; this.v[k] = 0; }
    this.apply(this.x);
  };
  Spring.prototype.stop = function () { cancelAnimationFrame(this.raf); this.running = false; };
  Spring.prototype.to = function (targets, opt, done) {
    var self = this; opt = opt || {};
    var resp = opt.response || 0.4, damp = opt.damping == null ? 1 : opt.damping;
    var K = Math.pow(2 * Math.PI / resp, 2), C = 4 * Math.PI * damp / resp, last = 0;
    for (var k in targets) {
      if (this.x[k] == null) { this.x[k] = targets[k]; this.v[k] = 0; }
      this.t[k] = targets[k];
      if (opt.velocity && opt.velocity[k] != null) this.v[k] = opt.velocity[k];
    }
    cancelAnimationFrame(this.raf); this.running = true;
    var tick = function (now) {
      var dt = last ? Math.min(0.12, (now - last) / 1000) : 1 / 60; last = now;           // real time, even on a slow frame
      var n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n, still = true;
      for (var k in self.t) {
        var x = self.x[k], v = self.v[k] || 0, g = self.t[k];
        for (var i = 0; i < n; i++) { v += (-K * (x - g) - C * v) * h; x += v * h; }
        var tol = Math.max(1e-3, Math.abs(g) * 1e-4);
        if (Math.abs(x - g) < tol * 4 && Math.abs(v) < tol * 40) { x = g; v = 0; } else still = false;
        self.x[k] = x; self.v[k] = v;
      }
      self.apply(self.x);
      if (still) { self.running = false; if (done) done(); } else self.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };
  // soft edge: the further past a boundary you pull, the less it follows (Apple's rubber-band constant)
  function rubber(over, dim) { var c = 0.55; return (over * dim * c) / (dim + c * Math.abs(over)); }
  // where a flick would come to rest, like scroll deceleration (rate .998 per ms)
  function project(v, rate) { rate = rate || 0.998; return (v / 1000) * rate / (1 - rate); }
  // pointer velocity (px/s) from the last ~100 ms of movement
  function Track() { this.h = []; }
  Track.prototype.add = function (x, y) { var t = performance.now(); this.h.push([t, x, y]); while (this.h.length > 2 && t - this.h[0][0] > 100) this.h.shift(); };
  Track.prototype.vel = function () {
    var h = this.h; if (h.length < 2) return [0, 0];
    var a = h[0], b = h[h.length - 1], dt = (b[0] - a[0]) / 1000;
    if (dt <= 0 || performance.now() - b[0] > 80) return [0, 0];       // held still before letting go: no throw
    return [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt];
  };

  /* smooth, weighted wheel scrolling everywhere (Lenis). Touch and keyboard scrolling stay native, nested
     scrollers (the experience rail) keep their own gestures, and in-page links glide to their target. */
  var lenis = null;
  if (window.Lenis) {
    try {
      // tuned after hermeus.com: every wheel input glides for 0.9 s on an exponential ease-out. Like the hero flame, it stays on even when the system asks for reduced
      // motion (Lenis would otherwise quietly fall back to plain scrolling there).
      lenis = new window.Lenis({
        duration: 0.9, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
        wheelMultiplier: 1, touchMultiplier: 1.4, anchors: true, allowNestedScroll: true, autoRaf: true,
        respectReducedMotion: false
      });
      window.__lenis = lenis;
    } catch (e) { lenis = null; }
  }

  /* nav hairline once the page leaves the very top */
  var nav = document.querySelector(".nav"), top = document.getElementById("top-sentinel");
  if (nav && top && IO) new IntersectionObserver(function (e) { nav.classList.toggle("edge", !e[0].isIntersecting); }).observe(top);

  /* where am I: the nav link for the section you are reading lights up, and a bar slides under it.
     A section counts as current once its top passes 35% of the way down the screen. On project pages
     Portfolio is always current. On phones the link row scrolls itself to keep the current one in view. */
  var navSec = document.querySelector(".nav-sec"), navInd = navSec && navSec.querySelector(".nav-ind");
  if (navSec && navInd) {
    var navLinks = Array.prototype.slice.call(navSec.querySelectorAll("a[data-sec]"));
    var here = navSec.parentNode.getAttribute("data-here");
    var secs = here ? [] : navLinks.map(function (a) { return document.getElementById(a.getAttribute("data-sec")); });
    var curSec = null, navTick = 0;
    var placeInd = function (a, instant) {
      if (!a) { navInd.style.opacity = 0; return; }
      if (instant) navInd.style.transition = "none";
      navInd.style.transform = "translateX(" + a.offsetLeft + "px) scaleX(" + (a.offsetWidth / 100) + ")";
      navInd.style.opacity = 1;
      if (instant) { navInd.offsetWidth; navInd.style.transition = ""; }
    };
    var setSec = function (id, instant) {
      if (id === curSec) return;
      var first = curSec === null; curSec = id;
      var on = null;
      navLinks.forEach(function (a) {
        var m = a.getAttribute("data-sec") === id;
        a.classList.toggle("on", m);
        if (m) { a.setAttribute("aria-current", "location"); on = a; } else a.removeAttribute("aria-current");
      });
      placeInd(on, instant || first);
      if (on && navSec.scrollWidth > navSec.clientWidth + 1) {        // phones: keep it in view, without touching the page scroll
        var l = on.offsetLeft - 12, r = on.offsetLeft + on.offsetWidth + 30 - navSec.clientWidth;
        if (navSec.scrollLeft > l) navSec.scrollTo({ left: l, behavior: instant ? "auto" : "smooth" });
        else if (navSec.scrollLeft < r) navSec.scrollTo({ left: r, behavior: instant ? "auto" : "smooth" });
      }
    };
    var whereAmI = function () {
      navTick = 0;
      if (here) return setSec(here);
      var line = innerHeight * 0.35, id = "";
      secs.forEach(function (el) { if (el && el.getBoundingClientRect().top <= line) id = el.id; });
      setSec(id);
    };
    window.addEventListener("scroll", function () { if (!navTick) navTick = requestAnimationFrame(whereAmI); }, { passive: true });
    window.addEventListener("resize", function () { var a = navSec.querySelector("a.on"); placeInd(a, true); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { placeInd(navSec.querySelector("a.on"), true); });
    whereAmI();
  }

  /* reveal on entry */
  var rv = document.querySelectorAll(".reveal");
  // anything already on screen when the page loads (or lands on a #section) shows at once, unanimated
  rv.forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) el.classList.add("now", "in");
  });
  if (IO && !reduce) {
    var ro = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); ro.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    rv.forEach(function (el) { ro.observe(el); });
  } else rv.forEach(function (el) { el.classList.add("in"); });

  /* timeline: roles that haven't started yet get a dashed line; checked against today, not the build date */
  var nowKey = new Date().getFullYear() * 12 + new Date().getMonth();
  document.querySelectorAll(".tl time[datetime]").forEach(function (t) {
    var d = t.getAttribute("datetime").split("-");
    t.closest(".tl").classList.toggle("future", +d[0] * 12 + (+d[1] - 1) > nowKey);
  });

  /* experience rail. Native scrolling (trackpad, touch) is left alone; on top of it:
     - with a mouse, grab the cards and drag them: they follow the pointer exactly, and pull softly
       past the first and last role instead of stopping dead
     - letting go throws it: the flick's momentum is projected to where it would come to rest, it snaps
       to the role nearest that point, and the spring starts at the flick's own speed
     - the scrubber below and the arrow buttons move it with the same spring
     Any of these can be grabbed mid-motion; a wheel or touch takes over at once. */
  var rail = document.querySelector(".rail");
  if (rail) {
    var prev = document.querySelector("[data-rail=prev]"), next = document.querySelector("[data-rail=next]");
    var cards = rail.children;
    var maxX = function () { return Math.max(0, rail.scrollWidth - rail.clientWidth); };
    var snapPoints = function () {
      var pad = parseFloat(getComputedStyle(rail).scrollPaddingLeft) || 0, rl = rail.getBoundingClientRect().left + pad, m = maxX(), out = [];
      for (var i = 0; i < cards.length; i++) out.push(Math.min(m, Math.max(0, rail.scrollLeft + cards[i].getBoundingClientRect().left - rl)));
      return out;
    };
    var nearest = function (x) {
      var pts = snapPoints(), best = 0, bd = Infinity;
      pts.forEach(function (p) { if (Math.abs(p - x) < bd) { bd = Math.abs(p - x); best = p; } });
      return best;
    };
    // one spring drives the rail's position; beyond either end it shows as a soft overshoot
    var rs = new Spring(function (v) {
      var m = maxX(), x = v.x, over = x < 0 ? x : (x > m ? x - m : 0);
      rail.scrollLeft = Math.min(m, Math.max(0, x));
      rail.style.transform = over ? "translateX(" + (-over).toFixed(2) + "px)" : "";
    });
    var snapOff = function () { rail.style.scrollSnapType = "none"; };
    var snapOn = function () { rail.style.scrollSnapType = ""; rail.style.transform = ""; };
    var livePos = function () { return rs.running ? rs.x.x : rail.scrollLeft; };             // the live position
    var glideTo = function (target, v) {
      snapOff();
      if (!rs.running) rs.set({ x: livePos() });
      rs.to({ x: target }, { damping: 1, response: 0.45, velocity: { x: v || 0 } }, snapOn);
    };
    var throwFrom = function (x, v) {                                                // momentum: land where the flick would
      var m = maxX(), land = Math.min(m, Math.max(0, x + project(v)));
      if (!rs.running) rs.set({ x: x });
      snapOff();
      rs.to({ x: nearest(land) }, { damping: 1, response: 0.45, velocity: { x: v } }, snapOn);
    };
    var stepBy = function (dir) {
      var pts = snapPoints(), cur = rs.running ? rs.t.x : rail.scrollLeft, i = 0, bd = Infinity;
      pts.forEach(function (p, k) { if (Math.abs(p - cur) < bd) { bd = Math.abs(p - cur); i = k; } });
      var j = Math.min(pts.length - 1, Math.max(0, i + dir));
      while (j > 0 && j < pts.length - 1 && pts[j] === pts[i]) j += dir;                  // skip stops that clamp to the same place
      glideTo(pts[j], rs.running ? rs.v.x : 0);
    };
    prev && prev.addEventListener("click", function () { stepBy(-1); });
    next && next.addEventListener("click", function () { stepBy(1); });
    // a wheel or a finger takes over immediately
    ["wheel", "touchstart"].forEach(function (t) {
      rail.addEventListener(t, function () { if (rs.running) { rs.stop(); snapOn(); } }, { passive: true });
    });
    if (IO && cards.length) {
      var ends = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.target === cards[0] && prev) prev.disabled = e.intersectionRatio > 0.9;
          if (e.target === cards[cards.length - 1] && next) next.disabled = e.intersectionRatio > 0.9;
        });
      }, { root: rail, threshold: [0, 0.9, 1] });
      ends.observe(cards[0]); ends.observe(cards[cards.length - 1]);
    }

    // mouse drag on the cards themselves
    var dragging = false, pressed = false, sx = 0, sScroll = 0, tr = new Track(), moved = false;
    rail.addEventListener("dragstart", function (e) { e.preventDefault(); });
    rail.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0 || e.target.closest("a, button")) return;
      pressed = true; moved = false; sx = e.clientX; sScroll = livePos();
      if (rs.running) { rs.stop(); snapOff(); }                                       // caught mid-flight: hold it right there
      tr = new Track(); tr.add(e.clientX, 0);
      e.preventDefault();                                                            // no text selection while dragging
    });
    rail.addEventListener("pointermove", function (e) {
      if (!pressed) return;
      var dx = e.clientX - sx;
      if (!moved) {
        if (Math.abs(dx) < 6) return;                                                // a little give before it commits to a drag
        moved = dragging = true; try { rail.setPointerCapture(e.pointerId); } catch (_) {} rail.classList.add("dragging"); snapOff();
      }
      tr.add(e.clientX, 0);
      var m = maxX(), x = sScroll - dx;
      if (x < 0) x = rubber(x, rail.clientWidth); else if (x > m) x = m + rubber(x - m, rail.clientWidth);
      rs.set({ x: x });
    });
    var endDrag = function () {
      if (!pressed) return;
      pressed = false;
      if (!moved) return;
      dragging = false; rail.classList.remove("dragging");
      throwFrom(rs.x.x, -tr.vel()[0]);
    };
    rail.addEventListener("pointerup", endDrag);
    rail.addEventListener("pointercancel", endDrag);
    rail.addEventListener("click", function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);

    /* scrubber: the thumb shows how much of the timeline is in view and where. Drag it, click the track to
       jump there, or use the arrow / Home / End keys. Releasing a drag throws the timeline, as above. */
    var bar = document.querySelector(".rail-bar"), thumb = bar && bar.querySelector(".rail-thumb");
    if (bar && thumb) {
      bar.hidden = false;
      var scrubbing = false, grab = 0, ttr = new Track();
      var geo = function () {
        var max = maxX(), bw = bar.clientWidth;
        var tw = Math.max(48, bw * rail.clientWidth / Math.max(rail.scrollWidth, 1));
        return { max: max, bw: bw, tw: tw, room: Math.max(bw - tw, 1) };
      };
      var paint = function () {
        var g = geo(), f = g.max > 0 ? rail.scrollLeft / g.max : 0;
        bar.hidden = g.max <= 1;
        thumb.style.width = g.tw + "px";
        thumb.style.transform = "translateX(" + (f * g.room) + "px)";
        bar.setAttribute("aria-valuenow", Math.round(f * 100));
      };
      var thumbTo = function (x) {
        var g = geo(), f = Math.min(1, Math.max(0, (x - grab) / g.room));
        rs.set({ x: f * g.max });
      };
      var px = function (e) { return e.clientX - bar.getBoundingClientRect().left; };
      bar.addEventListener("pointerdown", function (e) {
        var g = geo(), x = px(e), t0 = livePos() / Math.max(g.max, 1) * g.room;
        var onThumb = x >= t0 && x <= t0 + g.tw;
        grab = onThumb ? x - t0 : g.tw / 2;                                          // keep hold of the thumb where it was grabbed
        scrubbing = true; bar.classList.add("drag"); try { bar.setPointerCapture(e.pointerId); } catch (_) {}
        rs.stop(); snapOff(); ttr = new Track(); ttr.add(x, 0);
        if (!onThumb) { var tgt = Math.min(1, Math.max(0, (x - grab) / g.room)) * g.max; glideTo(tgt, 0); }
        e.preventDefault();
      });
      bar.addEventListener("pointermove", function (e) {
        if (!scrubbing) return;
        var x = px(e); ttr.add(x, 0); thumbTo(x);
      });
      var release = function () {
        if (!scrubbing) return;
        scrubbing = false; bar.classList.remove("drag");
        var g = geo(), v = ttr.vel()[0] * g.max / g.room;                            // thumb speed, in timeline terms
        throwFrom(livePos(), v);
      };
      bar.addEventListener("pointerup", release);
      bar.addEventListener("pointercancel", release);
      bar.addEventListener("keydown", function (e) {
        var k = e.key;
        if (k === "ArrowRight" || k === "ArrowDown") stepBy(1);
        else if (k === "ArrowLeft" || k === "ArrowUp") stepBy(-1);
        else if (k === "Home") glideTo(0, 0);
        else if (k === "End") glideTo(maxX(), 0);
        else return;
        e.preventDefault();
      });
      rail.addEventListener("scroll", paint, { passive: true });
      window.addEventListener("resize", paint);
      paint();
    }
  }

  /* clips play only while on screen */
  var vids = document.querySelectorAll("video[data-autoplay]");
  if (IO) {
    var vo = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting && !reduce) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
      });
    }, { rootMargin: "100px" });
    vids.forEach(function (v) { vo.observe(v); });
  }

  /* embeds load on click */
  document.querySelectorAll(".embed[data-src]").forEach(function (box) {
    var b = box.querySelector(".play");
    b && b.addEventListener("click", function () {
      var f = document.createElement("iframe");
      f.src = box.getAttribute("data-src"); f.title = box.getAttribute("data-title") || "Embedded media";
      f.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"; f.allowFullscreen = true;
      box.appendChild(f); box.querySelector(".embed-ui").hidden = true;
    });
  });

  /* table of contents */
  var toc = document.querySelectorAll(".toc a");
  if (toc.length && IO) {
    var map = {}; toc.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var to = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { toc.forEach(function (a) { a.classList.remove("on"); }); var a = map[e.target.id]; if (a) a.classList.add("on"); }
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    document.querySelectorAll(".prose section[id]").forEach(function (s) { to.observe(s); });
  }

  /* photo viewer, after Apple's photo browsing:
     - it grows out of the photo you clicked and shrinks back into it when closed, over a darkening backdrop
     - swipe sideways (or the arrows / arrow keys) to page; the photo follows your finger exactly, pulls
       softly at the first and last, and a quick flick is enough to turn the page
     - swipe down to dismiss: the photo shrinks a little and the backdrop lightens as you drag; let go
       past the point (or with a flick) and it returns to its spot on the page, otherwise it settles back
     Every motion is a spring from where things are now, so a photo can be caught mid-animation. */
  var links = Array.prototype.slice.call(document.querySelectorAll("a[data-lb]"));
  if (!links.length || typeof HTMLDialogElement === "undefined") return;
  var ICON = window.__ICONS || {};
  var dlg = document.createElement("dialog");
  dlg.className = "lb"; dlg.setAttribute("aria-label", "Image viewer");
  dlg.innerHTML = '<div class="lb-scrim"></div><div class="lb-in"><div class="lb-bar"><span class="lb-count"></span><span class="lb-btns">' +
    '<button class="icon-btn" type="button" data-a="prev" aria-label="Previous">' + (ICON.prev || "&lsaquo;") + '</button>' +
    '<button class="icon-btn" type="button" data-a="next" aria-label="Next">' + (ICON.next || "&rsaquo;") + '</button>' +
    '<button class="icon-btn" type="button" data-a="close" aria-label="Close">' + (ICON.close || "&times;") + '</button></span></div>' +
    '<div class="lb-stage"></div></div>';
  document.body.appendChild(dlg);
  var stage = dlg.querySelector(".lb-stage"), count = dlg.querySelector(".lb-count"), scrim = dlg.querySelector(".lb-scrim");
  var barEl = dlg.querySelector(".lb-bar"), bPrev = dlg.querySelector("[data-a=prev]"), bNext = dlg.querySelector("[data-a=next]");
  var idx = 0, cur = null, closing = false, GAP = 32;

  var thumbOf = function (k) { return links[k].querySelector("img, video") || links[k]; };
  var aspectOf = function (k) {
    var t = thumbOf(k);
    var w = t.naturalWidth || t.videoWidth || +t.getAttribute("width") || 4, h = t.naturalHeight || t.videoHeight || +t.getAttribute("height") || 3;
    return w / h;
  };
  var fitRect = function (k) {                                     // where the photo sits when open: fitted into the stage
    var r = stage.getBoundingClientRect(), a = aspectOf(k), w = r.width, h = w / a;
    if (h > r.height) { h = r.height; w = h * a; }
    return { left: (r.width - w) / 2, top: (r.height - h) / 2, width: w, height: h, sl: r.left, st: r.top };
  };
  var onScreen = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  var fromThumb = function (k, F) {                                // the transform that puts the open photo exactly over its thumbnail
    var T = thumbOf(k).getBoundingClientRect();
    return { tx: T.left - (F.sl + F.left), ty: T.top - (F.st + F.top), s: T.width / F.width };
  };
  var makeItem = function (k) {
    var a = links[k], el, it = document.createElement("div");
    it.className = "lb-item";
    if (a.hasAttribute("data-video")) {
      el = document.createElement("video"); el.src = a.getAttribute("href"); el.muted = true; el.loop = true; el.playsInline = true; el.controls = true;
      var pv = thumbOf(k); if (pv.poster) el.poster = pv.poster;
      if (!reduce) el.autoplay = true;
    } else {
      el = document.createElement("img"); el.alt = a.getAttribute("data-alt") || ""; el.draggable = false;
      var th = thumbOf(k); el.src = th.currentSrc || a.getAttribute("href");      // the thumbnail is already loaded: no blank frame
      var full = new Image(); full.onload = function () { el.src = full.src; }; full.src = a.getAttribute("href");
    }
    it.appendChild(el);
    var F = fitRect(k);
    it.style.cssText = "left:" + F.left + "px;top:" + F.top + "px;width:" + F.width + "px;height:" + F.height + "px";
    stage.appendChild(it);
    var o = { k: k, el: it, F: F };
    o.sp = new Spring(function (v) {
      it.style.transform = "translate(" + v.tx.toFixed(2) + "px," + v.ty.toFixed(2) + "px) scale(" + v.s.toFixed(4) + ")";
      it.style.opacity = v.f == null ? 1 : v.f;
      if (o === cur) { scrim.style.opacity = v.o; barEl.style.opacity = Math.max(0, v.o * 1.4 - 0.4); }
    });
    return o;
  };
  var ui = function () {
    count.textContent = (idx + 1) + " / " + links.length;
    bPrev.disabled = idx === 0; bNext.disabled = idx === links.length - 1;
  };
  var hideThumb = function (k, on) { thumbOf(k).style.visibility = on ? "hidden" : ""; };

  function open(k) {
    closing = false; idx = k;
    if (!dlg.open) { dlg.showModal(); if (lenis) lenis.stop(); }
    stage.innerHTML = ""; ui();
    cur = makeItem(k);
    var st = onScreen(thumbOf(k)) ? fromThumb(k, cur.F) : { tx: 0, ty: 24, s: 0.92 };
    cur.sp.set({ tx: st.tx, ty: st.ty, s: st.s, o: 0, f: 1 });
    hideThumb(k, true);
    cur.sp.to({ tx: 0, ty: 0, s: 1, o: 1 }, { damping: 1, response: 0.38 });
  }
  function close(vy) {
    if (!cur || closing) return;
    closing = true;
    var c = cur, back = onScreen(thumbOf(c.k));
    var tg = back ? fromThumb(c.k, c.F) : { tx: c.sp.x.tx, ty: c.sp.x.ty + 60, s: 0.9 };
    tg.o = 0; if (!back) tg.f = 0;
    c.sp.to(tg, { damping: 1, response: 0.34, velocity: { ty: vy || 0 } }, function () {
      hideThumb(c.k, false); stage.innerHTML = ""; cur = null; closing = false;
      if (dlg.open) dlg.close();
    });
  }
  function page(dir, v) {                                           // dir +1 = next
    var j = idx + dir;
    if (!cur || j < 0 || j >= links.length) { if (cur) cur.sp.to({ tx: 0 }, { damping: 1, response: 0.4, velocity: { tx: v || 0 } }); return; }
    var old = cur, W = stage.getBoundingClientRect().width + GAP;
    hideThumb(old.k, false); idx = j; ui();
    cur = makeItem(j); hideThumb(j, true);
    cur.sp.set({ tx: dir * W + (old.sp.x.tx || 0), ty: 0, s: 1, o: old.sp.x.o == null ? 1 : old.sp.x.o, f: 1 });
    old.sp.to({ tx: -dir * W }, { damping: 1, response: 0.42, velocity: { tx: v || 0 } }, function () { old.el.remove(); });   // out the way it is going
    cur.sp.to({ tx: 0, o: 1 }, { damping: 1, response: 0.42, velocity: { tx: v || 0 } });
  }

  links.forEach(function (a, k) {
    a.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault(); open(k);
    });
  });
  dlg.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var act = b.getAttribute("data-a");
    if (act === "prev") page(-1); else if (act === "next") page(1); else if (act === "close") close();
  });
  dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); });            // Esc: animate out too
  dlg.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") page(-1);
    if (e.key === "ArrowRight") page(1);
  });
  dlg.addEventListener("close", function () {
    if (cur) hideThumb(cur.k, false);
    stage.innerHTML = ""; cur = null; closing = false; if (lenis) lenis.start();
  });
  window.addEventListener("resize", function () {
    if (!cur) return;
    var F = fitRect(cur.k); cur.F = F;
    cur.el.style.cssText += ";left:" + F.left + "px;top:" + F.top + "px;width:" + F.width + "px;height:" + F.height + "px";
  });

  // swipes on the stage
  var g = null;
  stage.addEventListener("pointerdown", function (e) {
    if (!cur || closing) return;
    if (e.pointerType === "mouse" && e.target.tagName === "VIDEO") return;                 // leave the video controls alone
    cur.sp.stop();                                                                      // caught mid-animation: hold it there
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: "", tr: new Track(), x0: cur.sp.x.tx || 0, y0: cur.sp.x.ty || 0, onMedia: !!e.target.closest(".lb-item") };
    g.tr.add(e.clientX, e.clientY);
  });
  stage.addEventListener("pointermove", function (e) {
    if (!g || e.pointerId !== g.id || !cur) return;
    var dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.tr.add(e.clientX, e.clientY);
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 10) return;                                                // hysteresis before choosing a direction
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    }
    var R = stage.getBoundingClientRect();
    if (g.axis === "x") {
      var edge = (dx > 0 && idx === 0) || (dx < 0 && idx === links.length - 1);
      cur.sp.set({ tx: g.x0 + (edge ? rubber(dx, R.width) : dx), ty: cur.sp.x.ty, s: cur.sp.x.s, o: cur.sp.x.o, f: 1 });
    } else {
      var d = g.y0 + dy, down = Math.max(0, d);
      cur.sp.set({ tx: cur.sp.x.tx, ty: d > 0 ? d : rubber(d, R.height), s: 1 - Math.min(0.25, down / R.height * 0.5), o: 1 - Math.min(0.85, down / (R.height * 0.6)), f: 1 });
    }
  });
  var endSwipe = function (e) {
    if (!g || e.pointerId !== g.id || !cur) { g = null; return; }
    var v = g.tr.vel(), R = stage.getBoundingClientRect(), axis = g.axis, wasMedia = g.onMedia; g = null;
    if (!axis) { if (!wasMedia) close(); else cur.sp.to({ tx: 0, ty: 0, s: 1, o: 1 }, { damping: 1, response: 0.35 }); return; }   // a tap
    if (axis === "x") {
      // a deliberate flick turns the page the way it was thrown; a slow drag turns it once past the middle
      var land = cur.sp.x.tx + project(v[0], 0.995);
      var dir = Math.abs(v[0]) > 300 ? (v[0] < 0 ? 1 : -1) : (land < -R.width * 0.5 ? 1 : land > R.width * 0.5 ? -1 : 0);
      if (dir && idx + dir >= 0 && idx + dir < links.length) page(dir, v[0]);
      else cur.sp.to({ tx: 0, ty: 0, s: 1, o: 1 }, { damping: 1, response: 0.4, velocity: { tx: v[0] } });
    } else {
      var landY = cur.sp.x.ty + project(v[1], 0.995);
      if (v[1] > 500 || (v[1] > -300 && landY > R.height * 0.22)) close(v[1]);
      else cur.sp.to({ tx: 0, ty: 0, s: 1, o: 1 }, { damping: 1, response: 0.4, velocity: { ty: v[1] } });
    }
  };
  stage.addEventListener("pointerup", endSwipe);
  stage.addEventListener("pointercancel", endSwipe);
})();
