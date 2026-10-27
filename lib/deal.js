// What happens when an offer is accepted (by either side).
//   - The offer has a date, start time and length → it goes straight on the calendar as a confirmed booking.
//   - It has a length but no date → the client picks an open time (the usual scheduling page).
//   - Neither → "agreed": the business sets the time from the inbox (Book a time).

const cal = require("./calendar");
const T = require("./time");
const offers = require("./offers");

async function settle(r, cfg, { slug, force = false } = {}) {
  const o = r.agreed;
  r.clientView = { ...r.clientView, quote: o.price || r.clientView?.quote || "", deposit: o.deposit || r.clientView?.deposit || "" };
  r.quoteAccepted = new Date().toISOString();
  const start = offers.startOf(o);
  if (start && o.durationMin) {
    const end = start + o.durationMin * 60e3;
    if (!force) {
      const conflict = cal.conflictFor({
        start, end, settings: await cal.getSettings(slug), blocks: await cal.getBlocks(slug),
        appts: [...await cal.apptsBetween(slug, start - cal.DAY, end + cal.DAY), ...await require("./extcal").busyAsAppts(slug)],
        ignoreApptId: r.apptId, strict: false,
      });
      if (conflict) return { conflict };
    }
    if (r.apptId) await cal.cancelAppt(slug, r.apptId);
    const appt = await cal.createAppt({ slug, start, durationMin: o.durationMin, requestId: r.id, clientName: r.client.name, title: r.details.idea.slice(0, 80), source: "offer" });
    r.apptId = appt.id;
    r.session = { durationMin: o.durationMin };
    r.status = "booked";
    r.clientView.when = T.rangeLabel(appt.start, appt.end);
    return { status: "booked", when: r.clientView.when };
  }
  if (o.durationMin) { r.session = { durationMin: o.durationMin }; r.status = "scheduling"; return { status: "scheduling" }; }
  r.status = "agreed";
  return { status: "agreed" };
}

// How an overlapping time is described to whoever accepted.
function conflictText(conflict) {
  const w = conflict.with;
  return conflict.reason === "appointment"
    ? (w.external ? `"${w.title || "an event"}" on your ${w.source || "other"} calendar` : `${w.clientName || "another booking"} at ${T.timeLabel(w.start)}`)
    : `blocked time${w.note ? ` (${w.note})` : ""}`;
}

module.exports = { settle, conflictText };
