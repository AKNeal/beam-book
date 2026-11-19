// Unit checks for the rebook rule and the gross-to-net math (lib/analytics.js).
const assert = require("assert/strict");
const an = require("../lib/analytics");
const H = 3600e3, D = 24 * H, now = Date.parse("2026-11-17T20:00:00Z");
const v = (id, client, start, createdAt, price = 55, barber = "snow") => ({ id, client, barber, start, end: start + H / 2, mins: 30, createdAt, price, service: "Standard Haircut" });

// A: rebooked in the chair. B: booked 3 days later (not a rebook). C: no next visit. D: future visit (not judged yet).
const all = [
  v("a1", "A", now - 10 * D, now - 12 * D), v("a2", "A", now - 2 * D, now - 10 * D + 20 * 6e4),
  v("b1", "B", now - 9 * D, now - 9 * D), v("b2", "B", now + D, now - 6 * D),
  v("c1", "C", now - 5 * D, now - 6 * D),
  v("d1", "D", now + 2 * D, now - D),
];
an.markRebooks(all, 24, now);
const by = Object.fromEntries(all.map((x) => [x.id, x]));
assert.equal(by.a1.rebooked, true, "booked during the cut");
assert.equal(by.b1.rebooked, false, "booked days later doesn't count");
assert.equal(by.c1.rebooked, false, "no next visit");
assert.equal(by.d1.rebooked, null, "future visits aren't judged");
assert.equal(by.a1.firstSeen, true); assert.equal(by.a2.firstSeen, false);
an.markRebooks(all, 24 * 4, now); assert.equal(by.b1.rebooked, true, "a wider window counts it");
console.log("ok - rebook rule: in the chair or within the window; later bookings and future visits don't count");

// Needs a rebook: A's last visit was 2 days ago with nothing ahead (listed); B and D have something booked; C was 5 days ago.
for (const x of all) x.name = "Client " + x.client;
const nr = an.needsRebook(all, now, 21, null, 24);
assert.deepEqual(nr.map((x) => x.name), ["Client C", "Client A"], "oldest first, only clients with nothing booked");
assert.equal(an.needsRebook(all, now, 3, null, 24).length, 1, "only the last few days");
assert.equal(an.needsRebook([v("e1", "E", now - 3 * H, now - D)], now, 21, null, 24).length, 0, "still inside the rebook window");
console.log("ok - needs a rebook: last visit within 3 weeks, past the rebook window, nothing on the books");
