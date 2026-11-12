/* Beam inbox: the Website screen.
   - Checklist: facts and photos for the shop's own website. Saving one puts it on the site right away.
   - Change requests: anything else the owner wants changed. The Site manager reviews these before anything changes.
   - Google reviews: shows whether they're linked (the Site manager links them on the Beam control page). */
(function () {
  var BW = window.BW, el = BW.el;
  var S = null, ctx = null;

  function call(body) { return BW.api("/api/admin/books", { body: body }); }
  function when(t) { return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }

  // The setup checklist at the top of the inbox: closed by default, one line per item, red/green lights.
  var nudgeBox = null, nudgeOpen = null;
  async function nudge(where, open) {
    nudgeBox = where; nudgeOpen = open;
    try { S = await call({ action: "site" }); } catch (e) { return; }
    drawNudge();
  }
  function drawNudge() {
    var box = document.getElementById(nudgeBox);
    if (!box || !S) return;
    var parts = [];
    if (S.items.length && S.done < S.items.length) parts.push(setup(true));
    var waiting = S.changes.filter(function (c) { return c.status === "open"; }).length;
    if (S.canReview && waiting) parts.push(el("p", { class: "notice small", style: "margin:8px 0" }, el("b", {}, waiting + " website change request" + (waiting === 1 ? "" : "s")), " waiting for review. ",
      el("button", { class: "linkbtn", type: "button", onclick: nudgeOpen }, "Review")));
    box.replaceChildren.apply(box, parts);
    box.hidden = !parts.length;
  }

  // The compact list (used at the top of the inbox and on the Website screen).
  var editing = null;
  function setup(collapsible) {
    var total = S.items.length, done = S.done, left = total - done;
    var open = !collapsible; if (collapsible) { try { open = localStorage.getItem("beam.setupOpen") === "1"; } catch (e) {} }
    var d = el("details", { class: "panel setup", open: open, ontoggle: function (e) { if (collapsible) try { localStorage.setItem("beam.setupOpen", e.target.open ? "1" : "0"); } catch (x) {} } },
      el("summary", {},
        el("h2", {}, "Setup checklist"),
        el("span", { class: "count" }, done + " of " + total + " done" + (left ? " · " + left + " to go" : "")),
        el("span", { class: "bar", role: "img", "aria-label": done + " of " + total + " done" }, el("i", { style: "width:" + Math.round(100 * done / Math.max(total, 1)) + "%" })),
        collapsible ? el("span", { class: "btn sm line toggle" }, el("span", { class: "o" }, "Show list"), el("span", { class: "c" }, "Hide list"), el("span", { class: "chev", "aria-hidden": "true" })) : null));
    var list = el("div", { class: "ck-list" });
    var isDone = function (i) { return Boolean(i.value); };
    S.items.filter(isDone).concat(S.items.filter(function (i) { return !isDone(i) && !i.skipped; }), S.items.filter(function (i) { return !isDone(i) && i.skipped; }))
      .forEach(function (it) { list.append(row(it)); });
    d.append(el("div", { class: "setup-body" }, el("p", { class: "small muted" }, "Photos and short answers go on your website right away. Questionnaires stay private between you and Neal Media."), list));
    return d;
  }
  function redraw() { drawNudge(); var v = document.getElementById("siteView"); if (v && !v.hidden) render(); }

  function row(it) {
    var done = Boolean(it.value), wrap = el("div", { class: "ck" + (done ? " done" : it.skipped ? " skip" : "") });
    var btn = el("button", { class: "btn sm line", type: "button", onclick: function () { editing = editing === it.key ? null : it.key; redraw(); } },
      editing === it.key ? "Close" : done ? "Edit" : it.type === "photo" ? "Upload" : it.type === "form" ? "Answer" : "Add");
    wrap.append(el("div", { class: "ck-row" },
      el("span", { class: "led", role: "img", "aria-label": done ? "Done" : it.skipped ? "Skipped" : "Still needed" }),
      el("span", { class: "t", title: it.hint || "" }, it.label),
      el("div", { class: "a" }, btn)));
    if (editing === it.key) wrap.append(editor(it));
    return wrap;
  }

  function editor(it) {
    var box = el("div", { class: "ck-edit" });
    var err = el("p", { class: "form-error", role: "alert", hidden: true });
    async function save(payload, msg) {
      err.hidden = true;
      try { S = await call(Object.assign({ action: "siteSave", key: it.key }, payload)); editing = null; ctxToast(msg); redraw(); }
      catch (e) { err.textContent = e.message; err.hidden = false; }
    }
    if (it.hint) box.append(el("p", { class: "small muted hint" }, it.hint));
    var btns = el("div", { class: "row-btns" });
    if (it.type === "form") {
      var ans = it.value || {}, inputs = {};
      box.append(el("p", { class: "small muted hint" }, "Private: only you and Neal Media see these answers."));
      (it.questions || []).forEach(function (q) {
        var f;
        if (q.type === "choice") {
          f = el("select", {}, el("option", { value: "" }, "Pick one"), q.options.map(function (o) { return el("option", { value: o }, o); }));
          f.value = ans[q.key] || "";
        } else { f = q.type === "long" ? el("textarea", { rows: 3 }) : el("input", { type: "text" }); f.value = ans[q.key] || ""; }
        inputs[q.key] = f;
        box.append(el("div", { class: "field", style: "margin:10px 0" }, el("label", {}, q.label), q.hint ? el("p", { class: "small muted", style: "margin:0 0 4px" }, q.hint) : null, f));
      });
      btns.append(el("button", { class: "btn sm", type: "button", onclick: function () {
        var a = {}; Object.keys(inputs).forEach(function (k) { a[k] = inputs[k].value; });
        save({ answers: a }, "Answers saved. Thanks!");
      } }, "Save answers"));
    } else if (it.type === "photo") {
      if (it.value) box.append(el("img", { src: it.value, alt: it.label }));
      var file = el("input", { type: "file", accept: "image/*", hidden: true, onchange: async function () {
        var f = file.files[0]; if (!f) return;
        try { await save({ photo: await BW.shrink(f, 1800) }, "On your website now"); } catch (e) { err.textContent = e.message; err.hidden = false; }
      } });
      btns.append(file, el("button", { class: "btn sm", type: "button", onclick: function () { file.click(); } }, it.value ? "Replace photo" : "Choose photo"));
      if (it.value) btns.append(el("button", { class: "btn sm line", type: "button", onclick: function () { save({ remove: true }, "Photo taken off the site"); } }, "Remove"));
    } else {
      var input = it.type === "long" ? el("textarea", { rows: 3 }) : el("input", { type: "text" });
      input.value = it.value || "";
      box.append(input);
      btns.append(el("button", { class: "btn sm", type: "button", onclick: function () { save({ value: input.value }, input.value.trim() ? "On your website now" : "Taken off the site"); } }, "Save"));
    }
    if (!it.value) btns.append(el("button", { class: "linkbtn small", type: "button", onclick: function () { save({ skip: !it.skipped }, it.skipped ? "Back on the list" : "Skipped"); } },
      it.skipped ? "Put back on the list" : "Skip this"));
    box.append(btns, err);
    return box;
  }
  function ctxToast(m) { if (ctx) ctx.toast(m); else { var t = el("div", { class: "toast", role: "status" }, m); document.body.append(t); setTimeout(function () { t.remove(); }, 2600); } }

  async function show(c) {
    ctx = c; ctx.only("siteView");
    var v = document.getElementById("siteView");
    v.replaceChildren(el("p", { class: "muted", style: "margin-top:28px" }, "Loading…"));
    try { S = await call({ action: "site" }); } catch (e) { return ctx.toast(e.message); }
    render();
  }

  function render() {
    var v = document.getElementById("siteView");
    var nb = document.getElementById(nudgeBox || "siteNudge"); if (nb) nb.hidden = true;
    v.replaceChildren(
      el("h1", { style: "font-size:44px;margin:28px 0 6px" }, "Website"),
      el("p", { class: "muted", style: "margin-top:0" }, "Checklist answers go on your website right away. Want to change anything else? Send a change request and we'll take care of it."),
      S.items.length ? setup(false) : null, google(), changes());
  }

  // ---------- Google reviews ----------
  function google() {
    var g = S.google;
    return el("section", { class: "panel", style: "margin-top:20px" },
      el("h2", { style: "margin-top:0;font-size:30px" }, "Google reviews"),
      g.linked
        ? el("p", {}, "Linked. Your newest Google reviews show on your website automatically" + (g.rating ? " (" + g.rating.toFixed(1) + " stars from " + g.count + " reviews)." : "."))
        : el("p", { class: "muted" }, "Not linked yet. Your Site manager connects your Google Business listing, then new reviews show on your website on their own."));
  }

  // ---------- change requests ----------
  function changes() {
    var sec = el("section", { class: "panel", style: "margin-top:20px" },
      el("h2", { style: "margin-top:0;font-size:30px" }, "Request a change"),
      el("p", { class: "muted", style: "margin-top:0" }, "New wording, a different photo, a new service, anything at all. We review every request before it goes on your site."));
    var text = el("textarea", { rows: 4, style: "width:100%", placeholder: "e.g. Add 'heat cable install' to the services page" });
    var pics = [], picRow = el("div", { class: "pics" });
    var file = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: async function () {
      for (var i = 0; i < file.files.length && pics.length < 4; i++) { try { pics.push(await BW.shrink(file.files[i], 1800)); } catch (e) { ctx.toast(e.message); } }
      picRow.replaceChildren.apply(picRow, pics.map(function (d) { return el("img", { src: d, alt: "" }); }));
      file.value = "";
    } });
    var err = el("p", { class: "form-error", role: "alert", hidden: true });
    sec.append(el("div", { class: "field" }, text), picRow, file, el("div", { class: "actions" },
      el("button", { class: "btn sm line", type: "button", onclick: function () { file.click(); } }, "Add photos"),
      el("button", { class: "btn sm", type: "button", onclick: async function () {
        err.hidden = true;
        try { S = await call({ action: "siteChange", text: text.value, photos: pics }); ctx.toast("Sent. We'll review it."); render(); }
        catch (e) { err.textContent = e.message; err.hidden = false; }
      } }, "Send request")), err);

    if (S.changes.length) {
      sec.append(el("h3", { style: "margin:26px 0 6px" }, "Your requests"));
      S.changes.forEach(function (c) { sec.append(change(c)); });
    }
    return sec;
  }

  var STATUS = { open: "Waiting for review", done: "Done", declined: "Not changed" };
  function change(c) {
    var row = el("div", { style: "border-top:1px solid var(--line);padding:14px 0" },
      el("div", { class: "small muted" }, when(c.at) + " · " + c.by + " · ", el("b", {}, STATUS[c.status] || c.status)),
      el("p", { style: "margin:6px 0;white-space:pre-wrap" }, c.text));
    if (c.photos.length) row.append(el("div", { class: "pics" }, c.photos.map(function (u) { return el("a", { href: u, target: "_blank", rel: "noopener" }, el("img", { src: u, alt: "" })); })));
    if (c.note) row.append(el("p", { class: "small", style: "margin:6px 0" }, el("b", {}, "Reply: "), c.note));
    if (S.canReview) {
      var note = el("input", { type: "text", placeholder: "Reply (optional)", value: c.note || "", style: "flex:1;min-width:180px" });
      var act = function (status) { return async function () {
        try { S = await call({ action: "siteReview", id: c.id, status: status, note: note.value }); ctx.toast("Saved"); render(); } catch (e) { ctx.toast(e.message); }
      }; };
      row.append(el("div", { class: "actions", style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, note,
        c.status !== "done" ? el("button", { class: "btn sm", type: "button", onclick: act("done") }, "Mark done") : null,
        c.status === "open" ? el("button", { class: "btn sm line", type: "button", onclick: act("declined") }, "Won't change") : null,
        c.status !== "open" ? el("button", { class: "btn sm line", type: "button", onclick: act("open") }, "Reopen") : null));
    }
    return row;
  }

  window.BBSite = { show: show, nudge: nudge };
})();
