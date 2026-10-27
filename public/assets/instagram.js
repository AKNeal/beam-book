// Latest posts from the shop's Instagram, as a slowly rotating strip. Hidden until there are posts to show.
(function () {
  var boxes = document.querySelectorAll("[data-ig-feed]");
  if (!boxes.length) return;
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  fetch("/api/artists?ig=feed&n=12").then(function (r) { return r.ok ? r.json() : { items: [] }; }).then(function (feed) {
    if (!feed.items || feed.items.length < 3) return;
    boxes.forEach(function (box) { build(box, feed); });
  }).catch(function () {});

  function build(box, feed) {
    var track = box.querySelector(".ig-track");
    feed.items.forEach(function (m) {
      var a = document.createElement("a");
      a.className = "ig-tile"; a.href = m.permalink; a.target = "_blank"; a.rel = "noopener";
      var img = document.createElement("img");
      img.src = "/api/artists?ig=img&id=" + encodeURIComponent(m.id); img.loading = "lazy"; img.decoding = "async";
      img.alt = m.caption ? m.caption.slice(0, 120) : "Instagram post";
      img.width = 600; img.height = 600;
      img.onerror = function () { a.remove(); };
      a.appendChild(img);
      if (m.type === "VIDEO") { var v = document.createElement("span"); v.className = "ig-badge"; v.textContent = "Video"; a.appendChild(v); }
      track.appendChild(a);
    });
    var handle = box.querySelector("[data-ig-handle]");
    if (handle && feed.username) { handle.textContent = "@" + feed.username; handle.href = "https://instagram.com/" + encodeURIComponent(feed.username); }
    box.hidden = false;

    var step = function () { var t = track.querySelector(".ig-tile"); return t ? t.getBoundingClientRect().width + 12 : 300; };
    var go = function (dir) {
      var end = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      if (dir > 0 && end) track.scrollTo({ left: 0, behavior: still ? "auto" : "smooth" });
      else if (dir < 0 && track.scrollLeft <= 4) track.scrollTo({ left: track.scrollWidth, behavior: still ? "auto" : "smooth" });
      else track.scrollBy({ left: dir * step(), behavior: still ? "auto" : "smooth" });
    };
    box.querySelector(".ig-prev").addEventListener("click", function () { go(-1); });
    box.querySelector(".ig-next").addEventListener("click", function () { go(1); });

    if (still) return; // no automatic movement for people who've asked for less motion
    var paused = false, timer = null;
    var pause = function () { paused = true; }, resume = function () { paused = false; };
    box.addEventListener("mouseenter", pause); box.addEventListener("mouseleave", resume);
    box.addEventListener("focusin", pause); box.addEventListener("focusout", resume);
    track.addEventListener("touchstart", function () { paused = true; clearTimeout(timer); timer = setTimeout(resume, 8000); }, { passive: true });
    var visible = true;
    if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(box);
    setInterval(function () { if (!paused && visible && !document.hidden) go(1); }, 4500);
  }
})();
