// Beam date picker: replaces <input type="date" data-picker> with a styled pop-up calendar.
// The original input keeps its name and stores the same yyyy-mm-dd value, so forms and the server don't change.
// The pop-up opens right under the field, lined up with its left edge (a bottom sheet on small screens).
// Options on the input: data-min="today" (no past days), data-placeholder="Pick a date".
(function () {
  if (window.BeamDatePicker) return;
  var RED = "#e5383b";
  var css = '' +
    '.bdp-field{position:relative}' +
    '.bdp-trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;cursor:pointer;font:inherit;color:inherit}' +
    '.bdp-trigger .ph{opacity:.6}' +
    '.bdp-trigger svg{flex:none;width:20px;height:20px;opacity:.8}' +
    '.bdp{position:absolute;z-index:60;width:min(360px,100%);min-width:300px;background:#18181d;color:#ececf1;border:1px solid #2c2c34;border-radius:28px;padding:18px 18px 16px;' +
      'box-shadow:0 24px 60px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.2;' +
      'opacity:0;transform:translateY(-6px);transition:opacity .14s ease,transform .14s ease}' +
    '.bdp.open{opacity:1;transform:none}' +
    '.bdp *{box-sizing:border-box}' +
    '.bdp button{font:inherit;color:inherit;border:0;cursor:pointer;background:none}' +
    '.bdp-top{display:flex;justify-content:flex-end;margin-bottom:6px}' +
    '.bdp .bdp-x,.bdp .bdp-nav{width:38px;height:38px;border-radius:50%;background:#2a2a32;display:grid;place-items:center}' +
    '.bdp .bdp-x:hover,.bdp .bdp-nav:hover{background:#34343d}' +
    '.bdp .bdp-x svg,.bdp .bdp-nav svg{width:16px;height:16px}' +
    '.bdp-chips{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:14px;border-bottom:1px solid #2c2c34}' +
    '.bdp .bdp-chip{padding:9px 15px;border-radius:999px;background:#2a2a32;font-weight:600;font-size:14px}' +
    '.bdp .bdp-chip:hover{background:#34343d}' +
    '.bdp .bdp-chip.on{background:' + RED + ';color:#fff;box-shadow:0 0 14px rgba(255,255,255,.35),0 0 0 2px rgba(255,255,255,.85)}' +
    '.bdp-head{display:flex;align-items:center;justify-content:space-between;margin:16px 0 12px}' +
    '.bdp-month{font-size:17px;font-weight:600;letter-spacing:.01em}' +
    '.bdp .bdp-nav[disabled]{opacity:.3;cursor:default}' +
    '.bdp-wk,.bdp-row{display:grid;grid-template-columns:repeat(7,1fr);gap:0}' +
    '.bdp-wk{gap:6px;margin-bottom:10px}' +
    '.bdp-wk span{text-align:center;font-size:12.5px;font-weight:600;color:#a3a3ad;background:#24242b;border-radius:999px;padding:7px 0}' +
    '.bdp-rows{display:grid;gap:8px}' +
    '.bdp-row{border-radius:16px}' +
    '.bdp-row.sel{background:rgba(229,56,59,.18)}' +
    '.bdp .bdp-d{height:42px;display:grid;place-items:center}' +
    '.bdp .bdp-d button{width:40px;height:40px;border-radius:50%;font-size:15px;font-weight:500;transition:background .1s ease}' +
    '.bdp .bdp-d button:hover{background:#2f2f38}' +
    '.bdp .bdp-d.today button{box-shadow:inset 0 0 0 1.5px #d7d7de}' +
    '.bdp .bdp-d.on button{background:' + RED + ';color:#fff;font-weight:700;box-shadow:0 0 0 2px rgba(255,255,255,.9),0 0 18px rgba(255,255,255,.45)}' +
    '.bdp .bdp-d.out{visibility:hidden}' +
    '.bdp .bdp-d.off button{color:#55555e;cursor:default;background:none}' +
    '.bdp .bdp-d button:focus-visible,.bdp button:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
    '.bdp-foot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #2c2c34;margin-top:16px;padding-top:14px}' +
    '.bdp .bdp-clear{color:#a3a3ad;font-weight:600;padding:8px 4px}' +
    '.bdp .bdp-clear:hover{color:#fff}' +
    '.bdp .bdp-done{background:' + RED + ';color:#fff !important;font-weight:700;padding:12px 28px;border-radius:999px;box-shadow:0 0 14px rgba(255,255,255,.3)}' +
    '.bdp .bdp-done:hover{filter:brightness(1.08)}' +
    '.bdp-scrim{position:fixed;inset:0;z-index:59;background:rgba(0,0,0,.5)}' +
    '@media (max-width:560px){.bdp{position:fixed;left:50% !important;top:auto !important;bottom:12px;transform:translate(-50%,10px);width:calc(100% - 24px);min-width:0}.bdp.open{transform:translate(-50%,0)}}' +
    '@media (prefers-reduced-motion:reduce){.bdp{transition:none}}';
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var WK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var key = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var parse = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  var today = function () { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  var add = function (d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
  var label = function (d) { return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }); };
  var icon = function (path) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>"; };
  var CAL = icon('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>');

  function presets() {
    var t = today();
    var mon = add(t, ((8 - t.getDay()) % 7) || 7);
    return [["Today", t], ["Next Monday", mon], ["In 2 weeks", add(t, 14)], ["Next month", new Date(t.getFullYear(), t.getMonth() + 1, 1)]];
  }

  function enhance(input) {
    if (input._bdp) return; input._bdp = true;
    var minD = input.dataset.min === "today" ? today() : parse(input.min);
    var ph = input.dataset.placeholder || "Pick a date";
    var wrap = input.parentNode; wrap.classList.add("bdp-field");
    var trig = document.createElement("button");
    trig.type = "button"; trig.className = "bdp-trigger " + (input.className || ""); trig.id = input.id; input.id = input.id ? input.id + "-value" : "";
    trig.setAttribute("aria-haspopup", "dialog");
    input.type = "hidden";
    input.parentNode.insertBefore(trig, input);
    var paint = function () { var d = parse(input.value); trig.innerHTML = (d ? "<span>" + label(d) + "</span>" : '<span class="ph">' + ph + "</span>") + CAL; };
    paint();

    var pop = null, scrim = null, view = null, pick = null;
    function close(save) {
      if (!pop) return;
      if (save) { input.value = pick ? key(pick) : ""; paint(); input.dispatchEvent(new Event("change", { bubbles: true })); }
      pop.remove(); if (scrim) scrim.remove(); pop = scrim = null;
      document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", onKey, true); removeEventListener("resize", place);
      trig.setAttribute("aria-expanded", "false"); trig.focus();
    }
    function outside(e) { if (pop && !pop.contains(e.target) && e.target !== trig && !trig.contains(e.target)) close(false); }
    function onKey(e) {
      if (!pop) return;
      if (e.key === "Escape") { e.preventDefault(); close(false); return; }
      var cur = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.day;
      if (!cur) return;
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (step) { e.preventDefault(); var n = add(parse(cur), step); if (minD && n < minD) return; view = new Date(n.getFullYear(), n.getMonth(), 1); render(key(n)); }
    }
    function place() {
      if (!pop || matchMedia("(max-width:560px)").matches) return;
      var r = trig.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      pop.style.left = (r.left - w.left) + "px";
      var below = innerHeight - r.bottom, h = pop.offsetHeight;
      pop.style.top = (below < h + 16 && r.top > h + 16 ? (r.top - w.top - h - 8) : (r.bottom - w.top + 8)) + "px";
    }
    function render(focusKey) {
      var t = today(), y = view.getFullYear(), m = view.getMonth();
      var first = new Date(y, m, 1), start = first.getDay(), days = new Date(y, m + 1, 0).getDate();
      var prevOff = minD && new Date(y, m, 0) < minD;
      var selKey = pick ? key(pick) : "";
      var h = '<div class="bdp-top"><button type="button" class="bdp-x" aria-label="Close">' + icon('<path d="M18 6L6 18M6 6l12 12"/>') + "</button></div>";
      h += '<div class="bdp-chips">' + presets().map(function (p, i) { return '<button type="button" class="bdp-chip' + (selKey === key(p[1]) ? " on" : "") + '" data-p="' + i + '">' + p[0] + "</button>"; }).join("") + "</div>";
      h += '<div class="bdp-head"><button type="button" class="bdp-nav" data-nav="-1" aria-label="Previous month"' + (prevOff ? " disabled" : "") + ">" + icon('<path d="M15 18l-6-6 6-6"/>') + '</button><div class="bdp-month" aria-live="polite">' + MONTHS[m] + " " + y + '</div><button type="button" class="bdp-nav" data-nav="1" aria-label="Next month">' + icon('<path d="M9 18l6-6-6-6"/>') + "</button></div>";
      h += '<div class="bdp-wk">' + WK.map(function (w) { return "<span>" + w + "</span>"; }).join("") + '</div><div class="bdp-rows">';
      var cells = Math.ceil((start + days) / 7) * 7;
      for (var i = 0; i < cells; i++) {
        if (i % 7 === 0) {
          var rowHasSel = false;
          for (var j = i; j < i + 7; j++) { var dd = j - start + 1; if (dd >= 1 && dd <= days && key(new Date(y, m, dd)) === selKey) rowHasSel = true; }
          h += '<div class="bdp-row' + (rowHasSel ? " sel" : "") + '">';
        }
        var dn = i - start + 1;
        if (dn < 1 || dn > days) h += '<div class="bdp-d out"></div>';
        else {
          var d = new Date(y, m, dn), k = key(d), off = minD && d < minD;
          h += '<div class="bdp-d' + (k === key(t) ? " today" : "") + (k === selKey ? " on" : "") + (off ? " off" : "") + '"><button type="button" data-day="' + k + '"' + (off ? ' disabled tabindex="-1"' : "") + ' aria-label="' + label(d) + '"' + (k === selKey ? ' aria-pressed="true"' : "") + ">" + dn + "</button></div>";
        }
        if (i % 7 === 6) h += "</div>";
      }
      h += '</div><div class="bdp-foot"><button type="button" class="bdp-clear">Clear</button><button type="button" class="bdp-done">Done</button></div>';
      pop.innerHTML = h;
      var f = (focusKey && pop.querySelector('[data-day="' + focusKey + '"]')) || pop.querySelector(".bdp-d.on button") || pop.querySelector(".bdp-d.today button:not([disabled])") || pop.querySelector(".bdp-d button:not([disabled])");
      if (f && focusKey !== false) f.focus({ preventScroll: true });
      place();
    }
    function open() {
      if (pop) { close(false); return; }
      pick = parse(input.value);
      var base = pick || (minD && minD > today() ? minD : today());
      view = new Date(base.getFullYear(), base.getMonth(), 1);
      pop = document.createElement("div"); pop.className = "bdp"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Choose a date");
      if (matchMedia("(max-width:560px)").matches) { scrim = document.createElement("div"); scrim.className = "bdp-scrim"; document.body.appendChild(scrim); scrim.addEventListener("click", function () { close(false); }); document.body.appendChild(pop); }
      else wrap.appendChild(pop);
      pop.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b || b.disabled) return;
        if (b.classList.contains("bdp-x")) return close(false);
        if (b.classList.contains("bdp-done")) return close(true);
        if (b.classList.contains("bdp-clear")) { pick = null; return close(true); }
        if (b.dataset.nav) { view = new Date(view.getFullYear(), view.getMonth() + +b.dataset.nav, 1); return render(false); }
        if (b.dataset.p) { pick = presets()[+b.dataset.p][1]; view = new Date(pick.getFullYear(), pick.getMonth(), 1); return render(); }
        if (b.dataset.day) { pick = parse(b.dataset.day); return render(b.dataset.day); }
      });
      // Double-click a day to pick it and close in one go.
      pop.addEventListener("dblclick", function (e) { var b = e.target.closest("[data-day]"); if (b && !b.disabled) { pick = parse(b.dataset.day); close(true); } });
      render();
      requestAnimationFrame(function () { if (!pop) return; pop.classList.add("open"); if (!scrim) pop.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
      document.addEventListener("mousedown", outside, true); document.addEventListener("keydown", onKey, true); addEventListener("resize", place);
      trig.setAttribute("aria-expanded", "true");
    }
    trig.addEventListener("click", open);
    var form = input.form; if (form) form.addEventListener("reset", function () { setTimeout(paint, 0); });
  }

  window.BeamDatePicker = { enhance: enhance };
  var run = function () { document.querySelectorAll('input[type="date"][data-picker]').forEach(enhance); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
