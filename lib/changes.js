// Client self-service for instant bookings (barbershop mode): cancel, or move to another open time, with no call to the shop.
// Used by the client's status page (api/status.js) and, later, by text replies. The shop's `changeCutoffHours` decides how
// close to the appointment a client can still do it themselves; inside that window they're told to call the shop.
// Every change frees the old time at once, and the barber (and the shop) hear about it by text and email.

const config = require("../config/studio");
const store = require("./store");
const cal = require("./calendar");
const T = require("./time");
const artists = require("./artists");
const reqs = require("./requests");
const sms = require("./sms");
const { sendEmail } = require("./email");

const cutoffMs = () => Math.max(0, Number(config.changeCutoffHours ?? 2)) * 3600e3;

// Can this client still change this booking themselves? Returns { ok, appt, reason }.
async function changeable(r, now = Date.now()) {
  if (!r.instant || r.status !== "booked" || !r.apptId) return { ok: false, reason: "not-instant" };
  const appt = await cal.getAppt(r.apptId);
  if (!appt) return { ok: false, reason: "no-appt" };
  if (appt.start <= now) return { ok: false, appt, reason: "past" };
  if (appt.start - now < cutoffMs()) return { ok: false, appt, reason: "cutoff" };
  return { ok: true, appt };
}

function tooLate(reason) {
  const h = Number(config.changeCutoffHours ?? 2);
  const call = config.studio.phone ? ` Call or text ${config.studio.phone}.` : " Please call the shop.";
  if (reason === "cutoff") return `It's less than ${h} hour${h === 1 ? "" : "s"} away, so changes go through the shop.${call}`;
  if (reason === "past") return `This appointment has already started.${call}`;
  return `This booking can't be changed online.${call}`;
}

async function tell(r, barber, { subject, title, line, clientSubject, clientTitle, clientLine, clientText, link }) {
  const first = (r.client.name || "").split(" ")[0];
  const test = r.test || await require("./testbook").isTest(r.client); // the team's own test bookings don't alert the shop
  const shopTo = test ? [] : [config.studio.contactEmail, barber?.email, ...await require("./auth").artistEmails(r.artist)].filter(Boolean);
  await Promise.all([
    shopTo.length ? sendEmail({ to: [...new Set(shopTo)], replyTo: r.client.email || undefined, subject, title, paragraphs: [line, `Phone: ${r.client.phone}`] }) : null,
    r.client.email ? sendEmail({ to: r.client.email, replyTo: config.studio.contactEmail || undefined, subject: clientSubject, title: clientTitle,
      paragraphs: [`Hi ${first},`, clientLine], button: link ? { label: "View your booking", url: link } : undefined }) : null,
  ]);
  await Promise.all([test ? null : sms.textArtists(r.artist, line), sms.textClient(r, clientText)]);
}

async function cancel(r, { site = "", by = "client", reason = "" } = {}) {
  const c = await changeable(r);
  if (!c.ok) return { error: tooLate(c.reason), status: 409 };
  const now = new Date().toISOString();
  const was = T.rangeLabel(c.appt.start, c.appt.end);
  await cal.cancelAppt(r.artist, r.apptId);
  r.apptId = null;
  r.status = "declined"; r.declinedBy = by; r.cancelledAt = now; r.unread = true;
  r.clientView = { ...r.clientView, when: "", message: `You cancelled ${r.service?.name || "this booking"} (${was}). Book again any time.` };
  r.history.push({ at: now, status: "declined", by, note: `Cancelled by the client${reason ? ` — ${reason}` : ""} (was ${was})` });
  await reqs.save(r);
  const barber = await artists.bySlug(r.artist);
  const what = r.service?.name || "appointment";
  await tell(r, barber, {
    subject: `Cancelled: ${r.client.name}, ${what}, ${was}`, title: "Client cancelled",
    line: `${r.client.name} cancelled ${what}, ${was}. The time is open again.`,
    clientSubject: `Cancelled: ${what}, ${was}`, clientTitle: "Your appointment is cancelled",
    clientLine: `${what} on ${was} is cancelled. Book again any time${site ? `: ${site}/appointment` : "."}`,
    clientText: `Cancelled: ${what}, ${was}.${site ? ` Book again: ${site}/appointment` : ""}`,
  });
  return { ok: true };
}

// Move to a new start time, with the same barber or any barber who does this service (barber "any").
async function reschedule(r, { start, barber: wanted, site = "", by = "client" } = {}) {
  const c = await changeable(r);
  if (!c.ok) return { error: tooLate(c.reason), status: 409 };
  start = Number(start);
  if (!Number.isFinite(start) || start <= Date.now()) return { error: "Pick a new time.", status: 400 };
  const service = (config.services || []).find((s) => s.id === r.service?.id);
  const durationMin = service?.durationMin || r.service?.durationMin || c.appt.durationMin;
  const pool = (await artists.list({ publicOnly: true })).filter((a) => a.booksOpen !== false &&
    (!service?.barbers?.length || service.barbers.includes(a.slug)));
  const target = !wanted || wanted === "same" ? r.artist : wanted;
  const candidates = target === "any" ? [pool.find((a) => a.slug === r.artist), ...pool.filter((a) => a.slug !== r.artist)].filter(Boolean)
    : pool.filter((a) => a.slug === target);
  if (!candidates.length) return { error: "That barber isn't taking bookings. Pick someone else.", status: 400 };

  let appt = null, moved = null;
  for (const a of candidates) {
    if (!(await store.lock(`book:${a.slug}`))) continue;
    try {
      const end = start + durationMin * 60e3;
      const settings = await cal.getSettings(a.slug);
      const busy = [...await cal.apptsBetween(a.slug, start - cal.DAY, end + cal.DAY),
        ...await require("./extcal").busyAsAppts(a.slug).catch(() => [])];
      const clash = cal.conflictFor({ start, end, settings, blocks: await cal.getBlocks(a.slug), appts: busy, ignoreApptId: r.apptId });
      if (clash) continue;
      // The slot must also be one the booking page offers (on the shop's time grid, inside the booking window).
      const { days } = await cal.openSlots(a.slug, durationMin);
      const offered = days.some((d) => d.slots.some((sl) => sl.start === start));
      const ownSlot = a.slug === r.artist && start < c.appt.end && start + durationMin * 60e3 > c.appt.start; // overlaps their own old time
      if (!offered && !ownSlot) continue;
      appt = await cal.createAppt({ slug: a.slug, start, durationMin, requestId: r.id, clientName: r.client.name, title: r.service?.name || "", source: "online" });
      moved = a;
    } finally { await store.unlock(`book:${a.slug}`); }
    if (appt) break;
  }
  if (!appt) return { error: "That time was just taken. Pick another one.", status: 409, taken: true };

  const oldSlug = r.artist, was = T.rangeLabel(c.appt.start, c.appt.end), when = T.rangeLabel(appt.start, appt.end);
  await cal.cancelAppt(oldSlug, c.appt.id);
  const now = new Date().toISOString();
  r.apptId = appt.id; r.artist = moved.slug; r.unread = true;
  r.clientView = { ...r.clientView, when };
  r.history.push({ at: now, status: "booked", by, note: `Moved by the client from ${was} to ${when}${oldSlug !== moved.slug ? ` (now with ${moved.name})` : ""}` });
  await reqs.save(r);
  const link = site ? reqs.statusUrl(site, r) : "";
  const what = r.service?.name || "appointment";
  const oldBarber = await artists.bySlug(oldSlug);
  if (oldSlug !== moved.slug && oldBarber) await sms.textArtists(oldSlug, `${r.client.name} moved ${what} (${was}) to ${moved.name}. That time is open again.`);
  await tell(r, moved, {
    subject: `Moved: ${r.client.name}, ${what}, now ${when}`, title: "Client moved their appointment",
    line: `${r.client.name} moved ${what} from ${was} to ${when}${oldSlug !== moved.slug ? ` (from ${oldBarber?.name || "another barber"})` : ""}.`,
    clientSubject: `New time: ${what}, ${when}`, clientTitle: "Your appointment moved",
    clientLine: `${what} with ${moved.name} is now ${when}.`, clientText: `New time: ${what} with ${moved.name.split(" ")[0]}, ${when}.${link ? ` Details: ${link}` : ""}`, link,
  });
  return { ok: true, when, barber: moved.name };
}

module.exports = { changeable, cancel, reschedule, tooLate };
