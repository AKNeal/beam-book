/* Beam Book inbox: the Clients screen (search, profiles, add/edit, import from Squire or any CSV).
   The import file is read here in the browser. Only name, phone, email, barber, last visit, last service and notes
   are sent to Beam Book; payment method, tips and any other column never leave this computer. */
(function () {
  var BW = window.BW;

  // ---------- CSV ----------
  function parseCsv(text) {
    var rows = [], row = [], cell = "", q = false;
    text = String(text).replace(/^﻿/, "");
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }

  // Which column means what. Anything not listed here is never uploaded.
  var FIELDS = [
    { key: "name", label: "Name", match: /^(customer|client|name|full ?name|customer ?name|client ?name)$/ },
    { key: "first", label: "First name", match: /^first( ?name)?$/ },
    { key: "last", label: "Last name", match: /^last( ?name)?$/ },
    { key: "email", label: "Email", match: /e-?mail/ },
    { key: "phone", label: "Phone", match: /phone|mobile|cell/ },
    { key: "lastVisit", label: "Last visit", match: /last ?(visit|appointment|appt)|visit ?date/ },
    { key: "lastService", label: "Last service", match: /last ?service|^service$/ },
    { key: "barber", label: "Barber", match: /barber|stylist|staff|provider|artist/ },
    { key: "notes", label: "Notes", match: /note/ },
  ];
  function mapHeaders(headers) {
    var map = {}, dropped = [];
    headers.forEach(function (h, i) {
      var n = h.trim().toLowerCase();
      var f = FIELDS.find(function (x) { return !(x.key in map) && x.match.test(n); });
      if (f) map[f.key] = i; else if (h.trim()) dropped.push(h.trim());
    });
    return { map: map, dropped: dropped };
  }
  function toDate(v) {
    v = String(v || "").trim(); if (!v) return 0;
    var m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { var y = Number(m[3]); if (y < 100) y += 2000; return new Date(y, Number(m[1]) - 1, Number(m[2]), 12).getTime(); }
    var t = Date.parse(v); return isNaN(t) ? 0 : t;
  }

  // ---------- screen ----------
  var ctx, state = { q: "", rows: [], next: null, total: 0, open: null, editing: null };

  function show(c) { ctx = c; ctx.only("clientsView"); state.open = null; state.editing = null; load(); }

  async function load(more) {
    try {
      var r = await BW.api("/api/admin/books", { body: { action: "clients", q: state.q, before: more ? state.next : null } });
      state.rows = more ? state.rows.concat(r.clients) : r.clients;
      state.next = r.next || null; if (r.total != null) state.total = r.total;
      state.search = Boolean(r.search);
    } catch (e) { ctx.toast(e.message); }
    render();
  }

  function barberName(v) { var a = (ctx.D.artists || []).find(function (x) { return x.slug === v; }); return a ? a.name : (v || ""); }
  function when(ms) { return ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No visits yet"; }
  var el = function () { return BW.el.apply(null, arguments); };
  var canEdit = function () { return ctx.D.me.seesAll; };
  var isOwner = function () { return ctx.D.me.full; };

  function render() {
    var v = document.getElementById("clientsView"); v.textContent = "";
    v.append(el("h1", { style: "font-size:44px;margin:28px 0 6px" }, "Clients"),
      el("p", { class: "muted", style: "margin-top:0" }, state.total ? state.total.toLocaleString() + " clients. Search by name, phone (or its last 4 digits) or email." : "No clients yet. They're added automatically when someone books, or you can import your list."));

    var box = el("input", { type: "text", placeholder: "Search name, phone or email", value: state.q, "aria-label": "Search clients",
      style: "flex:1;min-width:200px;padding:10px 12px;border:1.5px solid var(--field, #999);border-radius:var(--radius, 6px);font:inherit;background:var(--white, #fff);color:inherit" });
    var timer;
    box.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { state.q = box.value.trim(); load(); }, 250); });
    var bar = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0" }, box);
    if (canEdit()) bar.append(el("button", { class: "btn sm", type: "button", onclick: function () { state.editing = {}; render(); } }, "Add a client"));
    if (isOwner()) bar.append(el("button", { class: "btn sm line", type: "button", onclick: importer }, "Import clients"));
    v.append(bar);

    if (state.editing) v.append(editor(state.editing));

    var list = el("section", { class: "panel" });
    if (!state.rows.length) list.append(el("p", { class: "muted" }, state.q ? "No one matches that." : "No clients yet."));
    state.rows.forEach(function (c) {
      var row = el("div", { class: "team-row", style: "cursor:pointer" },
        el("div", {}, el("strong", {}, c.name),
          el("div", { class: "small" }, [c.phone, c.email].filter(Boolean).join(" · ")),
          el("div", { class: "small muted" }, "Last visit: " + when(c.lastVisit) + (c.lastService ? " · " + c.lastService : "") + (c.barber ? " · " + barberName(c.barber) : ""))));
      row.addEventListener("click", function () { state.open = state.open === c.id ? null : c.id; render(); });
      list.append(row);
      if (state.open === c.id) list.append(profile(c));
    });
    if (state.next && !state.search) list.append(el("button", { class: "btn sm line", type: "button", style: "margin-top:12px", onclick: function () { load(true); } }, "Show more"));
    v.append(list);

    if (isOwner() && state.total) {
      v.append(el("p", { class: "small muted", style: "margin:28px 0 48px" }, "Need to start over? ",
        el("button", { class: "linkbtn", type: "button", onclick: removeAll }, "Remove every client"), " (bookings stay)."));
    }
  }

  function profile(c) {
    var p = el("div", { class: "panel", style: "margin:6px 0 16px;background:var(--panel-2, rgba(127,127,127,.06))" });
    p.append(el("p", { class: "small" }, el("strong", {}, "Preferred barber: "), barberName(c.barber) || "None"),
      el("p", { class: "small" }, el("strong", {}, "Text reminders: "), c.textOk ? "Yes (client agreed)" : "No, email only"),
      c.notes ? el("p", { class: "small", style: "white-space:pre-wrap" }, el("strong", {}, "Notes: "), c.notes) : null);
    var visits = c.visits || [];
    if (visits.length) {
      p.append(el("p", { class: "small", style: "margin-bottom:4px" }, el("strong", {}, "Booked through Beam Book")));
      p.append(el("ul", { class: "small", style: "margin-top:0" }, visits.slice(0, 12).map(function (x) {
        return el("li", {}, new Date(x.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) + (x.service ? " · " + x.service : "") + (x.barber ? " · " + barberName(x.barber) : ""));
      })));
    }
    if (canEdit()) {
      var acts = el("div", { class: "acts", style: "margin-top:10px" },
        el("button", { class: "btn sm line", type: "button", onclick: function () { state.editing = c; render(); window.scrollTo({ top: 0 }); } }, "Edit"),
        el("button", { class: "btn sm danger", type: "button", onclick: async function () {
          if (!confirm("Delete " + c.name + " from the client list for good? Their past bookings stay in the calendar.")) return;
          try { await BW.api("/api/admin/books", { body: { action: "clientDelete", id: c.id } }); ctx.toast(c.name + " deleted"); state.open = null; load(); } catch (e) { ctx.toast(e.message); }
        } }, "Delete client"));
      p.append(acts);
    }
    return p;
  }

  function editor(c) {
    var f = el("form", { class: "panel", style: "margin-bottom:18px" }, el("h2", { style: "font-size:1.5rem" }, c.id ? "Edit " + c.name : "Add a client"));
    var inp = function (name, label, type) { return el("div", { class: "field" }, el("label", {}, label), el("input", { type: type || "text", name: name, value: c[name] || "", maxlength: 120 })); };
    var barber = el("select", { name: "barber" }, el("option", { value: "" }, "No preference"), (ctx.D.artists || []).map(function (a) { return el("option", { value: a.slug }, a.name); }));
    barber.value = (ctx.D.artists || []).some(function (a) { return a.slug === c.barber; }) ? c.barber : "";
    var err = el("p", { class: "form-error", role: "alert", hidden: true });
    f.append(el("div", { class: "row" }, inp("name", "Name"), inp("phone", "Phone", "tel")), el("div", { class: "row" }, inp("email", "Email", "email"),
      el("div", { class: "field" }, el("label", {}, "Preferred barber"), barber)),
      el("div", { class: "field" }, el("label", {}, "Notes"), el("textarea", { name: "notes", rows: 3, maxlength: 1000 }, c.notes || ""),
        el("p", { class: "hint" }, "Cut details only (guard number, style). No health, payment or personal details.")),
      el("label", { class: "check" }, el("input", { type: "checkbox", name: "textOk", checked: Boolean(c.textOk) }), "This client agreed to get appointment reminders by text"),
      err,
      el("div", { class: "acts", style: "margin-top:12px" }, el("button", { class: "btn sm", type: "submit" }, "Save"),
        el("button", { class: "btn sm line", type: "button", onclick: function () { state.editing = null; render(); } }, "Cancel")));
    f.addEventListener("submit", async function (e) {
      e.preventDefault(); err.hidden = true;
      var d = new FormData(f);
      try {
        var r = await BW.api("/api/admin/books", { body: { action: "clientSave", id: c.id || null, client: {
          name: d.get("name"), phone: d.get("phone"), email: d.get("email"), barber: d.get("barber") || (barber.value ? barber.value : (c.barber || "")),
          notes: d.get("notes"), textOk: d.get("textOk") === "on" } } });
        ctx.toast("Saved " + r.client.name); state.editing = null; state.open = r.client.id; load();
      } catch (x) { err.textContent = x.message; err.hidden = false; }
    });
    return f;
  }

  // ---------- import ----------
  function importer() {
    var v = document.getElementById("clientsView"); v.textContent = "";
    var file = el("input", { type: "file", accept: ".csv,text/csv" });
    var out = el("div", {});
    v.append(el("h1", { style: "font-size:44px;margin:28px 0 6px" }, "Import clients"),
      el("section", { class: "panel" },
        el("p", {}, "Export your client list from Squire (or any system) as a CSV file, then choose it here."),
        el("p", { class: "small muted" }, "The file is read on this computer. Only name, phone, email, barber, last visit, last service and notes are sent to Beam Book. Payment method, tips and every other column stay on this computer and are never uploaded."),
        el("div", { class: "field" }, el("label", {}, "CSV file"), file), out,
        el("button", { class: "btn sm line", type: "button", style: "margin-top:12px", onclick: function () { show(ctx); } }, "Back to clients")));
    file.addEventListener("change", function () {
      var fl = file.files[0]; if (!fl) return;
      var rd = new FileReader();
      rd.onload = function () { preview(parseCsv(rd.result), out); };
      rd.readAsText(fl);
    });
  }

  function preview(rows, out) {
    out.textContent = "";
    if (rows.length < 2) { out.append(el("p", { class: "form-error" }, "That file has no client rows.")); return; }
    var m = mapHeaders(rows[0]);
    if (!("name" in m.map) && !("first" in m.map)) { out.append(el("p", { class: "form-error" }, "Couldn't find a name column. The first row should be the column names (e.g. Customer, Phone, Email).")); return; }
    var artists = ctx.D.artists || [];
    var pick = function (r, k) { return k in m.map ? String(r[m.map[k]] || "").trim() : ""; };
    var matchBarber = function (t) {
      var n = t.toLowerCase(); if (!n) return "";
      var a = artists.find(function (x) { return x.name.toLowerCase() === n; }) || artists.find(function (x) { return x.name.toLowerCase().split(" ")[0] === n.split(" ")[0]; });
      return a ? a.slug : t;
    };
    // Build the rows to send: only these fields exist on them.
    var clean = rows.slice(1).map(function (r) {
      var name = pick(r, "name") || [pick(r, "first"), pick(r, "last")].filter(Boolean).join(" ");
      return { name: name, phone: pick(r, "phone"), email: pick(r, "email"), barber: matchBarber(pick(r, "barber")),
        lastVisit: toDate(pick(r, "lastVisit")), lastService: pick(r, "lastService"), notes: pick(r, "notes") };
    }).filter(function (r) { return r.name; });

    var kept = FIELDS.filter(function (f) { return f.key in m.map; }).map(function (f) { return f.label + " (“" + rows[0][m.map[f.key]].trim() + "”)"; });
    out.append(el("p", {}, el("strong", {}, clean.length.toLocaleString() + " clients found.")),
      el("p", { class: "small" }, el("strong", {}, "Will be imported: "), kept.join(", ")),
      el("p", { class: "small" }, el("strong", {}, "Stays on this computer (not uploaded): "), m.dropped.length ? m.dropped.join(", ") : "nothing"));
    var sample = clean.slice(0, 3).map(function (r) { return el("li", {}, r.name + " · " + (r.phone || r.email || "no contact") + (r.lastVisit ? " · last visit " + when(r.lastVisit) : "") + (r.barber ? " · " + barberName(r.barber) : "")); });
    out.append(el("p", { class: "small muted", style: "margin-bottom:4px" }, "Check the first few look right:"), el("ul", { class: "small", style: "margin-top:0" }, sample));
    var unmatched = Array.from(new Set(clean.map(function (r) { return r.barber; }).filter(function (b) { return b && !artists.some(function (a) { return a.slug === b; }); })));
    if (unmatched.length) out.append(el("p", { class: "small muted" }, "Barbers not on your team yet (kept as names): " + unmatched.slice(0, 8).join(", ")));
    var textOk = el("input", { type: "checkbox" });
    var permission = el("input", { type: "checkbox" });
    var go = el("button", { class: "btn", type: "button", disabled: true }, "Import " + clean.length.toLocaleString() + " clients");
    var status = el("p", { class: "small", role: "status" });
    permission.addEventListener("change", function () { go.disabled = !permission.checked; });
    out.append(
      el("label", { class: "check" }, textOk, "These clients agreed to get appointment reminders by text (for example, they opted in through Squire). If unsure, leave this off: they'll get email reminders, and text once they tick the box when booking."),
      el("label", { class: "check" }, permission, "This is my shop's client list, and I'm importing it to run our bookings."),
      go, status);
    go.addEventListener("click", async function () {
      go.disabled = true; var tot = { added: 0, merged: 0, skipped: 0 };
      try {
        for (var i = 0; i < clean.length; i += 250) {
          status.textContent = "Importing " + Math.min(i + 250, clean.length).toLocaleString() + " of " + clean.length.toLocaleString() + "…";
          var r = await BW.api("/api/admin/books", { body: { action: "clientsImport", rows: clean.slice(i, i + 250), textOk: textOk.checked } });
          tot.added += r.added; tot.merged += r.merged; tot.skipped += r.skipped;
        }
        status.textContent = "Done: " + tot.added.toLocaleString() + " added, " + tot.merged.toLocaleString() + " merged with an existing client" + (tot.skipped ? ", " + tot.skipped + " skipped (no phone or email)" : "") + ". You can delete the CSV file from this computer now.";
        ctx.toast("Clients imported");
      } catch (e) { status.textContent = "Stopped: " + e.message + ". Running it again is safe; clients already imported are merged, not duplicated."; go.disabled = false; }
    });
  }

  async function removeAll() {
    var t = prompt("This removes every client from the list (bookings and the calendar stay). Type DELETE ALL to confirm.");
    if (t !== "DELETE ALL") return;
    try { var r = await BW.api("/api/admin/books", { body: { action: "clientsRemoveAll", confirm: t } }); ctx.toast(r.removed + " clients removed"); load(); } catch (e) { ctx.toast(e.message); }
  }

  window.BBClients = { show: show, _parseCsv: parseCsv, _mapHeaders: mapHeaders };
})();
