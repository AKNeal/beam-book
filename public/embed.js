/* Beam Book on any website.
 *
 * Paste ONE line where the page should load it (the address is the business's Beam Book address):
 *   <script src="https://blackwolf.book.nealmedia.app/embed.js" async></script>
 *
 * Then either or both of:
 *   <div data-beambook></div>                         the request form, right on the page (resizes itself)
 *   <div data-beambook="team"></div>                  the team / artists page instead
 *   <a href="#" data-beambook-button>Book now</a>     any link or button: opens the form in a pop-up
 *   data-artist="nathan-ealey" on either one          start with that person picked
 *
 * Or a floating button in the corner on every page, with no other markup:
 *   <script src="https://.../embed.js" data-floating="Book now" async></script>
 */
(function () {
  if (window.__beambook) return; window.__beambook = true;
  var me = document.currentScript || [].slice.call(document.querySelectorAll('script[src*="embed.js"]')).pop();
  if (!me) return;
  var BASE = new URL(me.src).origin;
  var frames = [];

  function pageUrl(page, artist) {
    var u = BASE + (page === "team" ? "/artists" : "/booking") + "?embed=1";
    if (artist) u += "&artist=" + encodeURIComponent(artist);
    return u;
  }
  function makeFrame(src, title) {
    var f = document.createElement("iframe");
    f.src = src; f.title = title || "Booking";
    f.setAttribute("allow", "clipboard-write");
    f.style.cssText = "display:block;width:100%;border:0;min-height:600px;height:900px;background:transparent;color-scheme:normal";
    frames.push(f);
    return f;
  }

  // The form tells us its height (and when to scroll back to its top, e.g. after sending).
  window.addEventListener("message", function (e) {
    if (e.origin !== BASE || !e.data || typeof e.data !== "object") return;
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (f.contentWindow !== e.source) continue;
      if (e.data.type === "beambook:height" && !f.__popup) f.style.height = Math.max(400, Math.ceil(e.data.height)) + "px";
      if (e.data.type === "beambook:top" && !f.__popup) { var top = f.getBoundingClientRect().top + window.pageYOffset - 20; window.scrollTo({ top: top, behavior: "smooth" }); }
    }
  });

  // Inline
  function mountInline() {
    var spots = document.querySelectorAll("[data-beambook]:not([data-beambook-ready])");
    for (var i = 0; i < spots.length; i++) {
      var el = spots[i]; el.setAttribute("data-beambook-ready", "1");
      el.appendChild(makeFrame(pageUrl(el.getAttribute("data-beambook"), el.getAttribute("data-artist")), "Request form"));
    }
  }

  // Pop-up
  var overlay = null, lastFocus = null;
  function openPopup(artist) {
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "Booking");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px";
    var box = document.createElement("div");
    box.style.cssText = "position:relative;width:min(980px,100%);height:min(92vh,1100px);border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.45);background:#111";
    var close = document.createElement("button");
    close.type = "button"; close.setAttribute("aria-label", "Close"); close.textContent = "×";
    close.style.cssText = "position:absolute;top:10px;right:10px;z-index:2;width:40px;height:40px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;font:600 24px/1 system-ui,sans-serif;cursor:pointer";
    var f = makeFrame(pageUrl("booking", artist), "Request form");
    f.__popup = true; f.style.height = "100%"; f.style.minHeight = "0";
    box.appendChild(f); box.appendChild(close); overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = "hidden";
    close.addEventListener("click", closePopup);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closePopup(); });
    document.addEventListener("keydown", onKey);
    close.focus();
  }
  function onKey(e) { if (e.key === "Escape") closePopup(); }
  function closePopup() {
    if (!overlay) return;
    var f = overlay.querySelector("iframe"); frames = frames.filter(function (x) { return x !== f; });
    overlay.remove(); overlay = null;
    document.documentElement.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-beambook-button]");
    if (!b) return;
    e.preventDefault(); openPopup(b.getAttribute("data-artist"));
  });

  // Floating corner button
  function floating() {
    var label = me.getAttribute("data-floating");
    if (!label || document.querySelector("[data-beambook-floating]")) return;
    var b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.setAttribute("data-beambook-button", ""); b.setAttribute("data-beambook-floating", "");
    b.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147482000;padding:14px 22px;border:0;border-radius:999px;font:600 16px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.3);background:" + (me.getAttribute("data-color") || "#1670C2") + ";color:#fff";
    document.body.appendChild(b);
  }

  function ready(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn); else fn(); }
  ready(function () {
    mountInline(); floating();
    // Pages that add [data-beambook] later (single-page sites) get the form too.
    if ("MutationObserver" in window) new MutationObserver(mountInline).observe(document.body, { childList: true, subtree: true });
  });
})();
