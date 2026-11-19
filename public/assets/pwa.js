/* Beam as an app: registers the service worker (so phones can install Beam to the home screen) and,
   on phones that haven't installed it yet, shows a small "Get the Beam app" bar under the header.
   Android: the bar's Install button opens the phone's own install prompt.
   iPhone/iPad: the bar explains Share → Add to Home Screen (Apple doesn't allow a button for it).
   "Not now" hides the bar on that phone for 30 days. */
(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }

  var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone) { document.documentElement.classList.add("in-app"); return; }

  var KEY = "beam.installHidden";
  function hiddenUntil() { try { return +localStorage.getItem(KEY) || 0; } catch (e) { return 0; } }
  if (hiddenUntil() > Date.now()) return;

  var ua = navigator.userAgent || "";
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var phone = ios || /Android/.test(ua) || window.matchMedia("(pointer: coarse) and (max-width: 900px)").matches;
  if (!phone) return;

  var deferred = null, bar = null;

  var css = ".beam-install{margin:12px auto 0;max-width:1240px;padding:0 20px}" +
    ".beam-install .bi{display:flex;align-items:center;gap:12px;background:var(--white,#fff);border:1px solid var(--line,#ddd);border-left:5px solid #259ced;border-radius:8px;padding:10px 12px}" +
    ".beam-install img{width:40px;height:40px;border-radius:9px;flex:none}" +
    ".beam-install .bt{flex:1;min-width:0;font-size:14px;line-height:1.35}.beam-install .bt b{display:block;font-size:15px}" +
    ".beam-install .ba{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none}" +
    ".beam-install button{font:inherit;cursor:pointer}" +
    ".beam-install .go{background:#259ced;color:#fff;border:0;border-radius:999px;padding:7px 14px;font-weight:600;font-size:14px}" +
    ".beam-install .no{background:none;border:0;color:var(--graphite,#666);font-size:13px;padding:2px 0;text-decoration:underline}" +
    ".beam-install svg{width:15px;height:15px;vertical-align:-2px}";

  var SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

  function hide(days) {
    try { localStorage.setItem(KEY, String(Date.now() + days * 864e5)); } catch (e) {}
    if (bar) bar.remove();
    bar = null;
  }

  function show() {
    if (bar || !document.body) return;
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    bar = document.createElement("div");
    bar.className = "beam-install";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Install the Beam app");
    var text = ios
      ? "<b>Get the Beam app</b>Tap " + SHARE + " <span>Share</span>, then <strong>Add to Home Screen</strong>."
      : "<b>Get the Beam app</b>Your schedule and bookings, one tap from your home screen.";
    bar.innerHTML = '<div class="bi"><img src="/assets/brand/beam-icon-192.png" alt=""><div class="bt">' + text + '</div><div class="ba">' +
      (ios ? "" : '<button type="button" class="go">Install</button>') +
      '<button type="button" class="no">Not now</button></div></div>';
    var go = bar.querySelector(".go");
    if (go) go.addEventListener("click", function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function (c) { if (c && c.outcome === "accepted") hide(3650); });
      deferred = null;
    });
    bar.querySelector(".no").addEventListener("click", function () { hide(30); });
    var header = document.querySelector("header.top");
    if (header && header.parentNode) header.parentNode.insertBefore(bar, header.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
  }

  if (ios) {
    // Safari is the browser that reliably offers Add to Home Screen on iPhone.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show); else show();
  } else {
    window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; show(); });
  }
  window.addEventListener("appinstalled", function () { hide(3650); });
})();
