// Beam Book: make the page look and read like the shop at this web address.
// Loaded in <head> on every page. Applies the shop's colors right away (from the last visit, if any), then
// loads the shop's details and fills in [data-shop] elements. BW.shopReady resolves with the details.
(function () {
  var KEY = "bb-theme";
  function hexToRgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgbToHex(r) { return "#" + r.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); }).join(""); }
  function mix(h, to, t) { var a = hexToRgb(h), b = hexToRgb(to); return rgbToHex(a.map(function (v, i) { return v + (b[i] - v) * t; })); }
  function lum(h) { return hexToRgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
    .reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0); }
  function apply(t) {
    if (!t || !/^#[0-9a-f]{6}$/i.test(t.accent || "")) return;
    var root = document.documentElement, light = t.mode === "light", a = t.accent;
    root.classList.toggle("light", light);
    root.classList.toggle("deco", Boolean(t.deco));
    var s = root.style;
    s.setProperty("--sign", a);
    s.setProperty("--sign-hover", light ? mix(a, "#000000", 0.15) : mix(a, "#ffffff", 0.15));
    s.setProperty("--on-sign", lum(a) > 0.32 ? "#14110c" : "#ffffff");
    s.setProperty("--gold", light ? mix(a, "#000000", 0.25) : a);
    s.setProperty("--gold-bright", light ? mix(a, "#000000", 0.45) : mix(a, "#ffffff", 0.3));
    s.setProperty("--sign-dark", light ? mix(a, "#000000", 0.45) : mix(a, "#ffffff", 0.3));
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = light ? "#f6f5f2" : "#0d1014";
  }
  try { apply(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) {}

  // Inside a business's own website (through /embed.js): no header or footer, links open in a new tab,
  // and the page tells the website how tall it is so there's no inner scroll bar.
  var embedded = /[?&]embed=1\b/.test(location.search) || (function () { try { return window.top !== window; } catch (e) { return true; } })();
  if (embedded) {
    document.documentElement.classList.add("embed");
    var baseEl = document.createElement("base"); baseEl.target = "_blank"; document.head.appendChild(baseEl);
    var send = function (msg) { try { window.parent.postMessage(msg, "*"); } catch (e) {} };
    var lastH = 0;
    var report = function () { var h = document.documentElement.scrollHeight; if (Math.abs(h - lastH) > 2) { lastH = h; send({ type: "beambook:height", height: h }); } };
    document.addEventListener("DOMContentLoaded", function () {
      if ("ResizeObserver" in window) new ResizeObserver(report).observe(document.body);
      report(); setTimeout(report, 600);
    });
    window.addEventListener("load", report);
  }
  window.BW = window.BW || {};
  window.BW.embedded = embedded;
  window.BW.toTop = function () { if (embedded) { try { window.parent.postMessage({ type: "beambook:top" }, "*"); } catch (e) {} } window.scrollTo({ top: 0 }); };

  var ready = fetch("/api/artists", { credentials: "same-origin" }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, d: d }; });
  }).then(function (x) {
    if (!x.ok) return { noShop: Boolean(x.d && x.d.noShop) };
    var shop = x.d.shop || {};
    shop.words = x.d.words || {};
    try { localStorage.setItem(KEY, JSON.stringify(shop.theme || null)); } catch (e) {}
    apply(shop.theme);
    return shop;
  }).catch(function () { return {}; });

  window.BW.shopReady = ready.then(function (shop) { window.BW.shop = shop; return shop; });

  function fill(shop) {
    if (shop.noShop) {
      var main = document.getElementById("main") || document.body;
      main.innerHTML = '<div class="page noshop"><h1>No booking page here</h1><p class="intro" style="margin:0 auto">There isn’t a shop at this address. Check the link you were sent.</p>' +
        '<p class="poweredby"><a href="https://beam.nealmedia.app" rel="noopener">Powered by: <img class="pb-on-dark" src="/assets/brand/beam-book-logo-white.svg" alt="Beam Book" width="123" height="22"><img class="pb-on-light" src="/assets/brand/beam-book-logo.svg" alt="Beam Book" width="123" height="22"></a></p></div>';
      document.querySelectorAll(".site-header, .site-footer").forEach(function (n) { n.hidden = true; });
      return;
    }
    var name = shop.name || "";
    if (name) document.title = document.title.indexOf("%SHOP%") >= 0 ? document.title.replace("%SHOP%", name) : document.title + " | " + name;
    else document.title = document.title.replace(" | %SHOP%", "").replace("%SHOP%", "Booking");
    var tel = (shop.phone || "").replace(/[^\d+]/g, "");
    var ig = (shop.instagram || "").replace(/^@/, "");
    var vals = { name: name, tagline: shop.tagline || "", city: shop.city || "", phone: shop.phone || "", address: shop.address || "",
      instagram: ig ? "@" + ig : "", website: (shop.website || "").replace(/^https?:\/\//, "").replace(/\/$/, ""), year: String(new Date().getFullYear()) };
    var hrefs = { phone: tel ? "tel:" + tel : "", instagram: ig ? "https://instagram.com/" + encodeURIComponent(ig) : "",
      website: shop.website || "", address: shop.address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(shop.address) : "" };
    document.querySelectorAll("[data-shop]").forEach(function (n) {
      var k = n.getAttribute("data-shop");
      if (k === "logo") {
        if (shop.theme && shop.theme.logo) { n.src = shop.theme.logo; n.hidden = false; var m = n.parentNode.querySelector(".brand-mono"); if (m) m.hidden = true; }
        else { n.hidden = true; var mono = n.parentNode.querySelector(".brand-mono"); if (mono) { mono.textContent = (name.match(/\b\w/g) || ["?"]).slice(0, 2).join("").toUpperCase(); mono.hidden = false; } }
        return;
      }
      if (vals[k] !== undefined) n.textContent = vals[k];
      if (n.tagName === "A" && hrefs[k]) n.href = hrefs[k];
    });
    // The business's own words: data-word="cta" etc.; a capitalized name (data-word="Providers") capitalizes the word.
    var W = shop.words || {};
    document.querySelectorAll("[data-word]").forEach(function (n) {
      var k = n.getAttribute("data-word"), up = /^[A-Z]/.test(k), key = k.charAt(0).toLowerCase() + k.slice(1);
      if (W[key]) n.textContent = up ? W[key].charAt(0).toUpperCase() + W[key].slice(1) : W[key];
    });
    document.querySelectorAll("[data-shop-if]").forEach(function (n) { n.hidden = !n.getAttribute("data-shop-if").split("|").some(function (k) { return vals[k]; }); });
  }
  function onReady(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn); else fn(); }
  ready.then(function (shop) { onReady(function () { fill(shop); }); });
})();
