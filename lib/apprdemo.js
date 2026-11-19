// Demo apprentices: made-up people at different stages so a shop can see how the apprenticeship screens work.
// They live only in the apprenticeship records (appr:demo), never on the team, the booking page or the calendar.
// Everything they add is removed by clear().
const store = require("./store");
const A = require("./apprentice");
const P = require("./paperwork");
const T = require("./time");

const PEOPLE = [
  { slug: "demo-maya-chen", name: "Maya Chen (demo)", first: "Maya", last: "Chen", weeksIn: 1, hours: 22, permit: "", qualify: 0, modules: 0, ssn: false },
  { slug: "demo-devon-tate", name: "Devon Tate (demo)", first: "Devon", middle: "James", last: "Tate", weeksIn: 17, hours: 540, permit: "BAHA-90412", qualify: 2, modules: 3, ssn: true },
  { slug: "demo-ava-brooks", name: "Ava Brooks (demo)", first: "Ava", middle: "Rose", last: "Brooks", weeksIn: 40, hours: 1265, permit: "BAHA-90377", qualify: 8, modules: 6, ssn: true },
  { slug: "demo-eli-santos", name: "Eli Santos (demo)", first: "Eli", last: "Santos", weeksIn: 54, hours: 1650, permit: "BAHA-90215", qualify: 12, modules: 8, ssn: true },
];
const isDemo = (slug) => /^demo-/.test(String(slug || ""));
async function people() { return (await store.getJSON("appr:demo")) || []; }

async function seed(by = "Owner") {
  await clear();
  const now = Date.now(), today = T.dateKey(now), tasks = (await A.checklist());
  const qual = tasks.filter((c) => c.target), mods = tasks.filter((c) => !c.target);
  let n = 0; const id = () => `d${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  for (const p of PEOPLE) {
    const start = T.dateKey(now - p.weeksIn * 7 * 864e5);
    // hours: weekdays from the start, practical most days and a theory block on Fridays, until the total is reached;
    // the last few days are still waiting for sign-off (except the finished one)
    const days = []; for (let t = now - p.weeksIn * 7 * 864e5; t <= now - 864e5; t += 864e5) { const k = T.dateKey(t), wd = new Date(`${k}T12:00:00Z`).getUTCDay(); if (wd >= 1 && wd <= 5) days.push([k, wd]); }
    const hours = []; let total = 0; const perDay = Math.max(2, Math.min(8, p.hours / Math.max(1, days.length)));
    for (let i = 0; i < days.length && total < p.hours; i++) {
      const [k, wd] = days[i]; const h = Math.min(Math.ceil(perDay * 4) / 4, p.hours - total), theory = wd === 5;
      total += h; const pending = p.hours < 1650 && i >= days.length - 2;
      hours.push({ id: id(), date: k, hours: h, kind: theory ? "theory" : "practical", note: theory ? "Course reading and quiz" : "", status: pending ? "pending" : "approved", by: pending ? "" : by, at: now - (days.length - i) * 864e5 });
    }
    // qualified tasks: the first `qualify` done; the next couple part-way, with a few reps waiting
    const reps = {}, checks = {};
    qual.forEach((c, i) => {
      const doneReps = i < p.qualify ? c.target : i < p.qualify + 2 ? Math.round(c.target * (i === p.qualify ? 0.6 : 0.25)) : 0;
      const l = []; for (let r = 0; r < doneReps; r++) l.push({ id: id(), date: days[Math.min(days.length - 1, Math.floor(r * days.length / Math.max(1, doneReps)))]?.[0] || today, note: "", status: "approved", by, at: now - r });
      if (i === p.qualify && p.qualify < qual.length) for (let r = 0; r < 2; r++) l.push({ id: id(), date: today, note: "", status: "pending", by: "", at: now + r });
      if (l.length) reps[c.id] = l;
      if (i < p.qualify) checks[c.id] = { at: now - (qual.length - i) * 5 * 864e5, by };
    });
    mods.slice(0, p.modules).forEach((c, i) => { checks[c.id] = { at: now - (mods.length - i) * 20 * 864e5, by }; });
    await store.setJSON(`appr:${p.slug}`, { startDate: start, hours, checks, reps, permit: p.permit, demo: true });
    await P.saveProfile(p.slug, {
      first: p.first, middle: p.middle || "", last: p.last, street: "123 Demo Ave", city: "North Pole", state: "AK", zip: "99705",
      phone: "907-555-0142", email: `${p.first.toLowerCase()}@example.com`, correspondence: "email", enrollType: "initial",
      dob: "2003-04-15", ...(p.ssn ? { ssn: "000-00-0000".replace(/0000$/, String(1000 + PEOPLE.indexOf(p))) } : {}),
      i9Status: p.ssn ? "citizen" : "", w4Filing: p.ssn ? "single" : "", education: "hs", veteran: "non", employment: "new", preAppr: "no",
      emergencyName: "Demo Contact", emergencyPhone: "907-555-0100", emergencyRel: "Parent",
    });
  }
  await store.setJSON("appr:demo", PEOPLE.map(({ slug, name }) => ({ slug, name })));
  await store.setJSON("appr:list", [...new Set([...(await A.list()), ...PEOPLE.map((p) => p.slug)])]);
  const apps = await A.applications();
  apps.unshift({ id: "demoapp1", at: now - 2 * 3600e3, demo: true, first: "Jordan", middle: "", last: "Pike (demo)", email: "jordan@example.com", phone: "907-555-0177",
    street: "45 Sample Rd", city: "Fairbanks", state: "AK", zip: "99701", correspondence: "email", trained: "no", prior: [], startDate: "", availability: "Weekdays after 3, Saturdays",
    about: "Demo application. I've been cutting friends' hair for two years and want to do it for real.", status: "new" });
  await store.setJSON("appr:apps", apps);
  return PEOPLE.length;
}

async function clear() {
  const demo = await people(); const slugs = new Set([...demo.map((d) => d.slug), ...PEOPLE.map((p) => p.slug)]);
  for (const s of slugs) { await store.del(`appr:${s}`); await store.del(`appr:pw:${s}`); await store.del(`appr:docs:${s}`); }
  await store.setJSON("appr:list", (await A.list()).filter((s) => !isDemo(s)));
  await store.setJSON("appr:apps", (await A.applications()).filter((a) => !a.demo));
  await store.del("appr:demo");
}

module.exports = { seed, clear, people, isDemo };
