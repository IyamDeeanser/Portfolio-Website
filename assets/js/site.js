(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var IO = "IntersectionObserver" in window;

  /* nav hairline once the page leaves the very top */
  var nav = document.querySelector(".nav"), top = document.getElementById("top-sentinel");
  if (nav && top && IO) new IntersectionObserver(function (e) { nav.classList.toggle("edge", !e[0].isIntersecting); }).observe(top);

  /* reveal on entry */
  var rv = document.querySelectorAll(".reveal");
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

  /* experience rail: arrow buttons, disabled at the ends */
  var rail = document.querySelector(".rail");
  if (rail) {
    var prev = document.querySelector("[data-rail=prev]"), next = document.querySelector("[data-rail=next]");
    var cards = rail.children;
    function step(dir) { var w = cards[0].getBoundingClientRect().width + 16; rail.scrollBy({ left: dir * w, behavior: reduce ? "auto" : "smooth" }); }
    prev && prev.addEventListener("click", function () { step(-1); });
    next && next.addEventListener("click", function () { step(1); });
    if (IO && cards.length) {
      var ends = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.target === cards[0] && prev) prev.disabled = e.intersectionRatio > 0.9;
          if (e.target === cards[cards.length - 1] && next) next.disabled = e.intersectionRatio > 0.9;
        });
      }, { root: rail, threshold: [0, 0.9, 1] });
      ends.observe(cards[0]); ends.observe(cards[cards.length - 1]);
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

  /* lightbox */
  var links = Array.prototype.slice.call(document.querySelectorAll("a[data-lb]"));
  if (!links.length || typeof HTMLDialogElement === "undefined") return;
  var ICON = window.__ICONS || {};
  var dlg = document.createElement("dialog");
  dlg.className = "lb"; dlg.setAttribute("aria-label", "Image viewer");
  dlg.innerHTML = '<div class="lb-in"><div class="lb-bar"><span class="lb-count"></span><span class="lb-btns">' +
    '<button class="icon-btn" type="button" data-a="prev" aria-label="Previous">' + (ICON.prev || "&lsaquo;") + '</button>' +
    '<button class="icon-btn" type="button" data-a="next" aria-label="Next">' + (ICON.next || "&rsaquo;") + '</button>' +
    '<button class="icon-btn" type="button" data-a="close" aria-label="Close">' + (ICON.close || "&times;") + '</button></span></div>' +
    '<div class="lb-stage"></div></div>';
  document.body.appendChild(dlg);
  var stage = dlg.querySelector(".lb-stage"), count = dlg.querySelector(".lb-count"), idx = 0;
  function show() {
    var a = links[idx], el;
    stage.innerHTML = "";
    if (a.hasAttribute("data-video")) {
      el = document.createElement("video"); el.src = a.getAttribute("href"); el.muted = true; el.loop = true; el.playsInline = true; el.controls = true;
      if (!reduce) el.autoplay = true;
    } else { el = document.createElement("img"); el.src = a.getAttribute("href"); el.alt = a.getAttribute("data-alt") || ""; }
    stage.appendChild(el);
    count.textContent = (idx + 1) + " / " + links.length;
  }
  links.forEach(function (a, k) {
    a.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault(); idx = k; show(); if (!dlg.open) dlg.showModal();
    });
  });
  dlg.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b) {
      var act = b.getAttribute("data-a");
      if (act === "prev") { idx = (idx - 1 + links.length) % links.length; show(); }
      else if (act === "next") { idx = (idx + 1) % links.length; show(); }
      else if (act === "close") dlg.close();
    } else if (e.target === dlg || e.target === stage) dlg.close();
  });
  dlg.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { idx = (idx - 1 + links.length) % links.length; show(); }
    if (e.key === "ArrowRight") { idx = (idx + 1) % links.length; show(); }
  });
  dlg.addEventListener("close", function () { stage.innerHTML = ""; });
})();
