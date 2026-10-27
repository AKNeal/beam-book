// Beam Book: editor for a business's request questions, words and negotiation rules.
// Used on the control page (Neal) and in the business's inbox (Owner / Site admin).
//   const fb = BW.formBuilder(container, settings); ... fb.value() → { words, form, negotiate, ageCheck, policyCheck, sessionLengths }
(function () {
  const TYPE_NAMES = { text: "Short answer", long: "Long answer", number: "Number", date: "Date", time: "Time", choice: "Pick one", multi: "Pick several",
    check: "Yes / no tick box", address: "Address", money: "Amount ($)", photos: "Photos" };
  const hrs = (m) => (m % 60 ? `${(m / 60).toFixed(1)} hours` : `${m / 60} hour${m === 60 ? "" : "s"}`);

  window.BW = window.BW || {};
  window.BW.formBuilder = function (box, S) {
    const { el } = window.BW;
    let form = JSON.parse(JSON.stringify(S.form || []));
    const words = { ...(S.words || {}) }, neg = { ...(S.negotiate || {}) };
    let lengths = [...(S.sessionLengths || [60, 120, 180])];
    const wrap = el("div");
    box.append(wrap);

    function field(label, input, hint) { return el("div", { class: "field" }, el("label", {}, label), input, hint ? el("p", { class: "hint" }, hint) : null); }
    function input(obj, key, attrs = {}) { const i = el("input", { type: "text", value: obj[key] || "", ...attrs }); i.addEventListener("input", () => { obj[key] = i.value; }); return i; }
    function check(obj, key, label) { const c = el("input", { type: "checkbox", checked: Boolean(obj[key]) }); c.addEventListener("change", () => { obj[key] = c.checked; }); return el("label", { class: "check" }, c, " ", label); }

    function render() {
      wrap.textContent = "";
      // Words
      wrap.append(el("fieldset", {}, el("legend", {}, "Words"),
        el("p", { class: "note" }, "How the booking pages and emails talk about this business."),
        el("div", { class: "grid2" },
          field("Button and page title", input(words, "cta", { placeholder: "Request a booking" })),
          field("What's being booked", input(words, "job", { placeholder: "booking, gig, job, shoot…" }))),
        el("div", { class: "grid2" },
          field("One person who does the work", input(words, "provider", { placeholder: "artist, performer, crew member…" })),
          field("The group", input(words, "providers", { placeholder: "artists, team, crew…" }))),
        el("div", { class: "grid2" },
          field("A booked block of time is a…", input(words, "session", { placeholder: "session, set, visit, shoot" })),
          field("Main question on the form", input(words, "summary", { placeholder: "What do you need?" }))),
        field("Line under the page title", input(words, "intro")),
        field("Before-the-appointment note (in confirmations)", input(words, "prep", { placeholder: "Optional, e.g. Bring photo ID" }))));

      // Questions
      const qs = el("div");
      form.forEach((q, i) => {
        const typeSel = el("select", {}, Object.entries(TYPE_NAMES).map(([v, n]) => el("option", { value: v, selected: v === q.type }, n)));
        typeSel.addEventListener("change", () => { q.type = typeSel.value; if (["choice", "multi"].includes(q.type) && !(q.options || []).length) q.options = ["Option 1", "Option 2"]; render(); });
        const req = el("input", { type: "checkbox", checked: Boolean(q.required), disabled: ["check", "photos"].includes(q.type) });
        req.addEventListener("change", () => { q.required = req.checked; });
        const opts = ["choice", "multi"].includes(q.type) ? el("textarea", { rows: 3 }, (q.options || []).join("\n")) : null;
        if (opts) opts.addEventListener("input", () => { q.options = opts.value.split("\n").map((x) => x.trim()).filter(Boolean); });
        const move = (d) => { const j = i + d; if (j < 0 || j >= form.length) return; [form[i], form[j]] = [form[j], form[i]]; render(); };
        qs.append(el("div", { class: "qrow" },
          el("div", { class: "grid2" }, field("Question", input(q, "label")), field("Type", typeSel)),
          field("Hint (optional)", input(q, "hint")),
          opts ? field("Choices (one per line)", opts) : null,
          el("div", { class: "qtools" }, el("label", { class: "check", style: "margin:0" }, req, " Required"),
            el("span", {}, el("button", { class: "linkbtn", type: "button", onclick: () => move(-1), disabled: i === 0 }, "Up"),
              el("button", { class: "linkbtn", type: "button", onclick: () => move(1), disabled: i === form.length - 1 }, "Down"),
              el("button", { class: "linkbtn", type: "button", onclick: () => { form.splice(i, 1); render(); } }, "Remove")))));
      });
      wrap.append(el("fieldset", {}, el("legend", {}, "Request questions"),
        el("p", { class: "note" }, "Every request also asks for a description, name, email and phone. Add whatever else this business needs to know."),
        qs, el("button", { class: "btn sm line", type: "button", onclick: () => { form.push({ label: "New question", type: "text" }); render(); } }, "Add a question"),
        el("div", { style: "margin-top:16px" }, check(S, "ageCheck", "Ask clients to confirm their age"), check(S, "policyCheck", "Ask clients to accept the deposit policy"))));

      // Negotiation
      const lenBox = el("div", { class: "chips" });
      for (const m of lengths) lenBox.append(el("span", { class: "chip" }, hrs(m), el("button", { class: "linkbtn", type: "button", "aria-label": `Remove ${hrs(m)}`, onclick: () => { lengths = lengths.filter((x) => x !== m); render(); } }, "×")));
      const addLen = el("select", {}, el("option", { value: "" }, "Add a length…"), [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720, 1440].filter((m) => !lengths.includes(m)).map((m) => el("option", { value: m }, hrs(m))));
      addLen.addEventListener("change", () => { if (addLen.value) { lengths = [...lengths, Number(addLen.value)].sort((a, b) => a - b); render(); } });
      wrap.append(el("fieldset", {}, el("legend", {}, "Offers and negotiation"),
        el("p", { class: "note" }, "The business can always change anything in its own offers. Choose what clients can counter."),
        check(neg, "price", "Clients can counter the price"),
        check(neg, "datetime", "Clients can counter the date, time and length"),
        check(neg, "scope", "Clients can counter what's included"),
        check(neg, "terms", "Clients can counter the terms (deposit, cancellation…)"),
        check(neg, "clientOffersFirst", "Clients can name their own offer on the request form"),
        field("Lengths offered", el("div", {}, lenBox, addLen))));
    }
    render();
    return {
      value: () => ({ words, form: form.map((q) => ({ ...q })), negotiate: neg, ageCheck: Boolean(S.ageCheck), policyCheck: Boolean(S.policyCheck), sessionLengths: lengths }),
    };
  };
})();
