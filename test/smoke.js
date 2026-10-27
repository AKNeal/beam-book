// End-to-end API test against the local dev server with a throwaway data folder.
// Run: npm test

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");

const PORT = 3999 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "bw-test-"));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let cookie = "";
// Beam Book picks the shop from the web address; on the local server we say which shop with X-Forwarded-Host.
let SHOPHOST = "blackwolf.localhost";
const go = (u) => { const x = new URL(u, BASE); return fetch(BASE + x.pathname + x.search, { headers: { "X-Forwarded-Host": SHOPHOST } }); };
const page = (p, h = SHOPHOST) => fetch(BASE + p, { headers: { "X-Forwarded-Host": h } });
async function call(p, { method, body, headers = {} } = {}) {
  const r = await fetch(BASE + p, {
    method: method || (body ? "POST" : "GET"),
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), "X-Forwarded-Host": SHOPHOST, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const valid = (o = {}) => ({
  artist: "nathan-ealey", name: "Jamie Rivers", email: "jamie@example.com", phone: "907-555-0100",
  idea: "Wolf head in blackwork with pine branches around it", placement: "Forearm", size: "About the size of a hand to a forearm",
  color: "Black and grey", availability: "Weekends", age18: true, agreePolicy: true, images: [PNG], ...o,
});

(async () => {
  const srv = spawn(process.execPath, ["dev-server.js"], {
    cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, PLATFORM_PASSWORD: "control-pass", SESSION_SECRET: "s3cret", BEAMBOOK_DOMAIN: "localhost", TZ: "UTC", EXTCAL_TEST_LOCAL: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 50 && !log.includes("running"); i++) await new Promise((r) => setTimeout(r, 100));
  let passed = 0; const ok = (m) => { passed++; console.log("  ✓", m); };

  try {
    // ---------- Beam Book control page: make the shop the rest of these tests use ----------
    const control = async (body) => {
      const r = await fetch(BASE + "/api/platform", { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(control.c ? { Cookie: control.c } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get("set-cookie"); if (sc) control.c = sc.split(";")[0];
      let data = {}; try { data = await r.json(); } catch {} return { status: r.status, data };
    };
    assert.equal((await control({ action: "create", slug: "blackwolf", name: "x" })).status, 401, "control page locked");
    assert.equal((await control({ action: "login", password: "wrong" })).status, 401);
    assert.equal((await control({ action: "login", password: "control-pass" })).status, 200);
    let made = await control({ action: "create", kind: "tattoo", slug: "blackwolf", ownerName: "Shop Owner", ownerEmail: "owner@example.com", artistName: "Nathan Ealey",
      studio: { name: "Black Wolf Tattoo Club", city: "Fairbanks, Alaska", phone: "907-251-7841", address: "521 6th Avenue, Fairbanks, AK 99701", instagram: "@bwtcfairbanks",
        contactEmail: "nathanealey@me.com", timeZone: "America/Anchorage" }, theme: { mode: "dark", accent: "#e0913f", deco: true } });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    assert.equal((await control({ action: "create", slug: "blackwolf", ownerName: "X Y", ownerEmail: "x@example.com", studio: { name: "Dupe" } })).status, 400, "short name taken");
    {
      const tok = new URL(made.data.ownerLink).searchParams.get("reset");
      const r = await fetch(BASE + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-Host": SHOPHOST }, body: JSON.stringify({ action: "reset", token: tok, password: "owner password 123" }) });
      assert.equal(r.status, 200);
    }
    ok("control page: locked, makes a shop with an Owner and a one-time password link");

    // Pages
    for (const p of ["/", "/artists", "/booking", "/request", "/schedule", "/admin", "/platform", "/embed.js"]) {
      const r = await page(p); assert.equal(r.status, 200, p); const t = await r.text(); if (p !== "/embed.js") assert.match(t, /<html/); else assert.match(t, /data-beambook/); assert.ok(!/<!--#|\{\{/.test(t), `unfilled template markers in ${p}`);
    }
    assert.equal((await page("/nope")).status, 404);
    ok("pages serve, unknown pages 404");

    // Every inline <script> in the inbox and built pages, plus the browser scripts, must at least parse.
    {
      const vm = require("vm");
      const pagesDir = path.join(__dirname, "..", "public");
      for (const f of fs.readdirSync(pagesDir).filter((x) => x.endsWith(".html"))) {
        const html = fs.readFileSync(path.join(pagesDir, f), "utf8");
        [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
          try { new vm.Script(m[1], { filename: `${f} script ${i + 1}` }); } catch (e) { throw new Error(`${f}: inline script ${i + 1} has a syntax error: ${e.message}`); }
        });
      }
      for (const f of fs.readdirSync(path.join(pagesDir, "assets")).filter((x) => x.endsWith(".js"))) {
        try { new vm.Script(fs.readFileSync(path.join(pagesDir, "assets", f), "utf8"), { filename: f }); } catch (e) { throw new Error(`assets/${f} has a syntax error: ${e.message}`); }
      }
    }
    ok("every page script and browser script parses");

    const a = await call("/api/artists");
    assert.equal(a.data.artists.length, 1); assert.equal(a.data.artists[0].slug, "nathan-ealey"); assert.equal(a.data.artists[0].booksOpen, true);
    ok("artist list with books state");

    // Validation
    let r = await call("/api/requests", { body: valid({ email: "nope", idea: "x", age18: false, placement: "Moon" }) });
    assert.equal(r.status, 400); for (const f of ["email", "idea", "age18", "placement"]) assert.ok(r.data.fields[f], f);
    ok("rejects bad fields with per-field errors");
    r = await call("/api/requests", { body: valid({ images: ["data:image/png;base64,aGVsbG8="] }) });
    assert.equal(r.status, 400); assert.ok(r.data.fields.images);
    ok("rejects non-image uploads (checks file bytes, not just the label)");

    // Happy path
    r = await call("/api/requests", { body: valid() });
    assert.equal(r.status, 201); const { id, token } = r.data;
    assert.ok(fs.readdirSync(path.join(DATA, "uploads/blackwolf/requests", id)).length === 1);
    ok("request saved with its photo");
    assert.match(log, /\[email:dev\] to=jamie@example.com subject="We got your request/);
    ok("client confirmation email generated");

    r = await call(`/api/status?id=${id}&t=${token}`); assert.equal(r.status, 200); assert.equal(r.data.status, "new");
    assert.equal(r.data.artist, "Nathan Ealey"); assert.equal(r.data.token, undefined); assert.equal(r.data.client, undefined);
    r = await call(`/api/status?id=${id}&t=wrong-token-xx`); assert.equal(r.status, 404);
    ok("status page needs the private token and hides client details");

    r = await call("/api/requests", { body: valid({ website: "spam.biz" }) }); assert.equal(r.status, 200); assert.equal(r.data.id, "x");
    ok("honeypot swallows bots");

    // Admin auth
    r = await call("/api/admin/inbox"); assert.equal(r.status, 401);
    r = await call("/api/admin/login", { body: { email: "owner@example.com", password: "wrong one here" } }); assert.equal(r.status, 401);
    r = await call("/api/admin/login", { body: { email: "owner@example.com", password: "owner password 123" } }); assert.equal(r.status, 200); assert.match(cookie, /^bw_admin=/);
    ok("inbox locked; wrong password rejected; right password logs in");
    const forged = cookie.replace(/\.[^.]+$/, ".forged"); const real = cookie; cookie = forged;
    r = await call("/api/admin/inbox"); assert.equal(r.status, 401); cookie = real;
    ok("forged session cookie rejected");

    r = await call("/api/admin/inbox"); assert.equal(r.status, 200);
    assert.equal(r.data.requests.length, 1); assert.equal(r.data.requests[0].token, undefined);
    ok("inbox lists the request without exposing the client's private link token");

    // Pipeline
    r = await call("/api/admin/update", { body: { id, action: "quote", quote: "350", message: "Clean linework." } }); assert.equal(r.status, 400, "quote needs a session length");
    r = await call("/api/admin/update", { body: { id, action: "quote", quote: "350", durationMin: 180, message: "Clean linework." } });
    assert.equal(r.data.request.status, "quoted"); assert.equal(r.data.request.clientView.quote, "$350", "adds the dollar sign");
    assert.match(log, /Review the offer/);
    {
      const shop = cookie; cookie = "";
      r = await call(`/api/status?id=${id}&t=${token}`); assert.equal(r.data.canAccept, true); assert.equal(r.data.canSchedule, false); assert.equal(r.data.session, "3 hours");
      r = await call(`/api/schedule?id=${id}&t=${token}`); assert.equal(r.data.open, false, "can't pick a time before accepting");
      r = await call("/api/status", { body: { id, t: "wrong-token-1234", action: "accept" } }); assert.equal(r.status, 404);
      r = await call("/api/status", { body: { id, t: token, action: "ask", message: "Can we make it a bit bigger?" } }); assert.equal(r.status, 200);
      assert.equal(r.data.messages.length, 1); assert.match(log, /Question from Jamie Rivers/);
      cookie = shop;
      r = await call("/api/admin/inbox"); assert.equal(r.data.requests[0].unread, true);
      r = await call("/api/admin/update", { body: { id, action: "reply", message: "Sure, same price." } }); assert.equal(r.status, 200);
      assert.equal(r.data.request.unread, false); assert.equal(r.data.request.status, "quoted");
      cookie = "";
      r = await call(`/api/status?id=${id}&t=${token}`); assert.deepEqual(r.data.messages.map((m) => m.from), ["you", "shop"]);
      r = await call("/api/status", { body: { id, t: token, action: "accept" } }); assert.equal(r.status, 200);
      assert.equal(r.data.status, "scheduling"); assert.equal(r.data.canSchedule, true); assert.match(r.data.scheduleUrl, /^\/schedule\?id=/);
      assert.match(log, /accepted your offer/);
      r = await call("/api/status", { body: { id, t: token, action: "accept" } }); assert.equal(r.status, 409, "can't accept twice");
      r = await call(`/api/schedule?id=${id}&t=${token}`); assert.equal(r.data.open, true);
      cookie = shop;
    }
    ok("client accepts the quote and goes straight to picking a time; questions and replies show on both sides");
    // ---- Calendar: shop sends a booking link, client picks a time ----
    const T = require("../lib/time");
    r = await call("/api/admin/update", { body: { id, action: "schedule", durationMin: 999 } }); assert.equal(r.status, 400);
    r = await call("/api/admin/update", { body: { id, action: "schedule", durationMin: 180, depositUrl: "javascript:alert(1)" } }); assert.equal(r.status, 400);
    ok("booking link rejects bad session lengths and non-https payment links");
    r = await call("/api/admin/update", { body: { id, action: "schedule", durationMin: 180, deposit: "$100 cash at the shop", message: "Can't wait." } });
    assert.equal(r.data.request.status, "scheduling"); assert.match(log, /subject="Pick your time/);
    r = await call(`/api/status?id=${id}&t=${token}`); assert.equal(r.data.canSchedule, true); assert.equal(r.data.quote, "$350");
    ok("booking link sent: status page offers 'Pick your time'");

    const shopCookie = cookie; cookie = "";
    r = await call(`/api/schedule?id=${id}&t=bad-token-123`); assert.equal(r.status, 404);
    r = await call(`/api/schedule?id=${id}&t=${token}`);
    assert.equal(r.data.open, true); assert.equal(r.data.durationMin, 180); assert.ok(r.data.days.length > 20);
    const allSlots = r.data.days.flatMap((d) => d.slots);
    for (const sl of allSlots) {
      const p = T.parts(sl.start), e = T.parts(sl.start + 180 * 60e3);
      assert.ok(p.wd !== 0, "no Sundays"); assert.ok(p.h >= 10 && (e.h < 18 || (e.h === 18 && e.mi === 0)), `inside 10-6: ${sl.label}`);
      assert.ok(sl.start >= Date.now() + 48 * 3600e3 - 5000, "48h notice");
    }
    ok(`slots respect hours, Sundays off and 48h notice (${allSlots.length} open start times)`);

    r = await call("/api/schedule", { body: { id, t: token, start: allSlots[0].start + 60e3 } }); assert.equal(r.status, 409);
    const first = allSlots[0].start;
    r = await call("/api/schedule", { body: { id, t: token, start: first } }); assert.equal(r.status, 200); assert.match(r.data.when, /to/);
    assert.equal(r.data.pending, true);
    r = await call(`/api/status?id=${id}&t=${token}`); assert.equal(r.data.status, "pending"); assert.equal(r.data.hasCalendarFile, false);
    assert.equal((await go(`${BASE}/api/schedule?id=${id}&t=${token}&ics=1`)).status, 404, "no calendar file until confirmed");
    r = await call("/api/schedule", { body: { id, t: token, start: allSlots[1].start } }); assert.equal(r.status, 409, "can't request two times");
    assert.match(log, /subject="Confirm: Jamie Rivers/); assert.match(log, /subject="Time requested:/);
    cookie = shopCookie;
    r = await call("/api/admin/update", { body: { id, action: "declineTime", message: "Can't do that day." } });
    assert.equal(r.data.request.status, "scheduling"); assert.match(log, /Please pick another time/);
    cookie = "";
    r = await call(`/api/schedule?id=${id}&t=${token}`); assert.ok(r.data.days.flatMap((d) => d.slots).some((sl) => sl.start === first), "asked-for time freed up again");
    r = await call("/api/schedule", { body: { id, t: token, start: first } }); assert.equal(r.status, 200);
    cookie = shopCookie;
    r = await call("/api/admin/update", { body: { id, action: "confirmTime", message: "See you then." } }); assert.equal(r.data.request.status, "booked");
    assert.match(log, /subject="You're booked:/);
    cookie = "";
    r = await call(`/api/status?id=${id}&t=${token}`); assert.equal(r.data.status, "booked"); assert.equal(r.data.hasCalendarFile, true);
    let raw = await go(`${BASE}/api/schedule?id=${id}&t=${token}&ics=1`);
    assert.match(raw.headers.get("content-type"), /text\/calendar/); const ics1 = await raw.text();
    assert.match(ics1, /BEGIN:VEVENT[\s\S]*DTSTART:\d{8}T\d{6}Z[\s\S]*END:VCALENDAR/);
    r = await call("/api/schedule", { body: { id, t: token, start: allSlots[1].start } }); assert.equal(r.status, 409);
    ok("client's pick is held as a request; artist can ask for another time or confirm it, then it's booked with a calendar file");

    // Two more requests from other connections
    const mk = async (name, ipAddr) => { const x = await call("/api/requests", { body: valid({ name, email: `${name.toLowerCase()}@example.com` }), headers: { "x-forwarded-for": ipAddr } }); return x.data; };
    const B = await mk("Bea", "10.0.0.2"), Cc = await mk("Cal", "10.0.0.3");
    cookie = shopCookie;
    for (const x of [B, Cc]) { r = await call("/api/admin/update", { body: { id: x.id, action: "schedule", durationMin: 180 } }); assert.equal(r.data.request.status, "scheduling"); }
    cookie = "";
    r = await call(`/api/schedule?id=${B.id}&t=${B.token}`);
    const bSlots = r.data.days.flatMap((d) => d.slots).map((x) => x.start);
    assert.ok(!bSlots.includes(first), "booked time gone");
    assert.ok(!bSlots.some((x) => x > first - 3.5 * 3600e3 && x < first + 3.5 * 3600e3), "30 min gap kept around the booking");
    ok("booked time and the 30-minute gap disappear for everyone else");

    const target = bSlots[0];
    const [rb, rc] = await Promise.all([
      call("/api/schedule", { body: { id: B.id, t: B.token, start: target } }),
      call("/api/schedule", { body: { id: Cc.id, t: Cc.token, start: target } }),
    ]);
    assert.deepEqual([rb.status, rc.status].sort(), [200, 409]);
    ok("two clients grabbing the same time at once: exactly one gets it");

    // Shop side: manual booking with conflict warning, cancel, decline
    cookie = shopCookie;
    const loser = rb.status === 409 ? B : Cc;
    const localFirst = T.localInputValue(first);
    r = await call("/api/admin/update", { body: { id: loser.id, action: "book", start: localFirst, durationMin: 120 } });
    assert.equal(r.status, 409); assert.equal(r.data.conflict, true);
    r = await call("/api/admin/update", { body: { id: loser.id, action: "book", start: localFirst, durationMin: 120, force: true } });
    assert.equal(r.data.request.status, "booked");
    ok("manual booking warns about overlaps, and 'Book anyway' works");
    r = await call("/api/admin/update", { body: { id: loser.id, action: "cancelAppt", message: "Sorry, conflict." } });
    assert.equal(r.data.request.status, "scheduling"); assert.equal(r.data.request.apptId, null);
    ok("cancelling an appointment frees the time and sends the client back to picking");

    // iPhone feed
    r = await call("/api/admin/inbox"); const feedUrl = r.data.feed.https; assert.match(r.data.feed.webcal, /^webcal:/);
    assert.equal(r.data.calendar["nathan-ealey"].appts.length, 2);
    cookie = "";
    raw = await go(feedUrl.replace(/k=[^&]+/, "k=wrong")); assert.equal(raw.status, 404);
    raw = await go(feedUrl); const feed = await raw.text();
    assert.equal((feed.match(/BEGIN:VEVENT/g) || []).length, 2); assert.match(feed, /SUMMARY:Tattoo: Jamie Rivers/); assert.match(feed, /REFRESH-INTERVAL/);
    ok("private iPhone calendar feed lists bookings; wrong key gets nothing");
    cookie = shopCookie;
    await call("/api/admin/books", { body: { action: "resetFeed" } });
    raw = await go(feedUrl); assert.equal(raw.status, 404);
    ok("'Make a new link' cuts off the old feed");

    // Hours + time off change what clients see
    const winner = rb.status === 200 ? B : Cc;
    r = await call("/api/admin/inbox"); const settings = r.data.calendar["nathan-ealey"].settings;
    const hours = { ...settings.hours, 6: null };
    await call("/api/admin/books", { body: { action: "settings", slug: "nathan-ealey", settings: { ...settings, hours } } });
    const satKey = (() => { let d = T.parseDate(T.dateKey(Date.now() + 3 * 864e5)); while (T.weekdayOf(d) !== 2) d = T.addDays(d, 1); return T.keyOf(d); })(); // a Tuesday
    r = await call("/api/admin/books", { body: { action: "block", slug: "nathan-ealey", startDate: satKey, note: "Convention" } }); assert.equal(r.data.blocks.length, 1);
    cookie = "";
    r = await call(`/api/schedule?id=${loser.id}&t=${loser.token}`);
    assert.ok(r.data.days.every((d) => T.weekdayOf(T.parseDate(d.date)) !== 6), "Saturdays closed");
    assert.ok(!r.data.days.some((d) => d.date === satKey), "blocked day gone");
    ok("closing Saturdays and adding time off removes those days for clients");
    cookie = shopCookie;
    r = await call("/api/admin/books", { body: { action: "block", slug: "nathan-ealey", startDate: "2026-02-30" } }); assert.equal(r.status, 400);
    r = await call("/api/admin/update", { body: { id: winner.id, action: "decline", message: "Sorry" } });
    r = await call("/api/admin/inbox"); assert.equal(r.data.calendar["nathan-ealey"].appts.length, 1);
    ok("declining a booked request frees its time");

    r = await call("/api/admin/update", { body: { id, action: "note", text: "Prefers left arm" } }); assert.equal(r.data.request.notes.length, 1);
    r = await call("/api/admin/update", { body: { id, action: "done" } }); assert.equal(r.data.request.status, "done");
    ok("notes and mark done still work");

    // Finished-tattoo photos
    {
      const shop = cookie; cookie = "";
      r = await call("/api/status", { body: { id, t: token, action: "addPhotos", images: [PNG] } }); assert.equal(r.status, 200);
      assert.equal(r.data.donePhotos.length, 1); assert.equal(r.data.donePhotos[0].byYou, true); assert.equal(r.data.canAddPhotos, true);
      assert.match(log, /added photos/);
      r = await call("/api/status", { body: { id, t: token, action: "addPhotos", images: ["data:image/png;base64,aGVsbG8="] } }); assert.equal(r.status, 400, "not an image");
      r = await call("/api/status", { body: { id, t: "wrong-token-1234", action: "addPhotos", images: [PNG] } }); assert.equal(r.status, 404);
      r = await call(`/api/status?id=${id}&t=${token}&photo=${encodeURIComponent("blackwolf/requests/other/done-1-0123456789abcdef.jpg")}`); assert.equal(r.status, 404, "only this request's photos");
      cookie = shop;
      r = await call("/api/admin/update", { body: { id, action: "addPhotos", images: [PNG, PNG] } }); assert.equal(r.status, 200);
      assert.equal(r.data.request.donePhotos.length, 3); assert.ok(r.data.request.donePhotos[2].url);
      r = await call("/api/admin/update", { body: { id, action: "removePhoto", photo: r.data.request.donePhotos[0].name } }); assert.equal(r.data.request.donePhotos.length, 2);
      cookie = "";
      r = await call(`/api/status?id=${id}&t=${token}`); assert.equal(r.data.donePhotos.length, 2); assert.equal(r.data.donePhotos[0].byYou, false);
      cookie = shop;
    }
    ok("client and shop can add photos of the finished tattoo; both see them; shop can remove");

    // Deleting old requests
    {
      const nr = await call("/api/requests", { body: valid({ name: "Old Test", email: "old@example.com" }), headers: { "X-Forwarded-For": "10.7.7.7" } });
      cookie = real;
      const delId = nr.data.id;
      const before = (await call("/api/admin/inbox")).data.calendar["nathan-ealey"].appts.length;
      const sl = (await call(`/api/schedule?id=${id}&t=${token}`)).data; // any open time
      const T2 = require("../lib/time");
      const startLocal = T2.localInputValue(Date.now() + 9 * 86400e3).replace(/T\d\d:\d\d$/, "T12:00");
      r = await call("/api/admin/update", { body: { id: delId, action: "book", start: startLocal, durationMin: 60, force: true } }); assert.equal(r.data.request.status, "booked");
      assert.equal((await call("/api/admin/inbox")).data.calendar["nathan-ealey"].appts.length, before + 1);
      const imgs = r.data.request.images; assert.ok(imgs.length);
      r = await call("/api/admin/update", { body: { id: delId, action: "delete" } }); assert.equal(r.data.deleted, delId);
      r = await call("/api/admin/inbox");
      assert.equal(r.data.requests.some((x) => x.id === delId), false); assert.equal(r.data.calendar["nathan-ealey"].appts.length, before, "appointment freed");
      assert.equal((await page(imgs[0])).status, 404, "photos deleted");
      assert.equal((await call("/api/admin/update", { body: { id: delId, action: "note", text: "x" } })).status, 404);
      cookie = "";
      assert.equal((await call(`/api/status?id=${delId}&t=${nr.data.token}`)).status, 404, "client link stops working");
      cookie = real;
    }
    ok("Owner can delete a request: gone from the inbox, its time freed, its photos removed");

    // Books toggle + waitlist
    r = await call("/api/admin/books", { body: { slug: "nathan-ealey", open: false } }); assert.equal(r.data.artists[0].booksOpen, false);
    cookie = "";
    r = await call("/api/requests", { body: valid() }); assert.equal(r.status, 409); assert.equal(r.data.booksClosed, true);
    r = await call("/api/waitlist", { body: { artist: "nathan-ealey", name: "Sam", email: "sam@example.com" } }); assert.equal(r.status, 200);
    await call("/api/waitlist", { body: { artist: "nathan-ealey", name: "Sam", email: "sam@example.com" } });
    cookie = real; r = await call("/api/admin/inbox"); assert.equal(r.data.waitlists["nathan-ealey"].length, 1);
    await call("/api/admin/books", { body: { slug: "nathan-ealey", open: true } });
    ok("closing books blocks requests; waitlist signup works without duplicates");

    // Client turns down a quote
    {
      const shop = cookie; cookie = "";
      const nr = await call("/api/requests", { body: valid({ name: "Dana Cole", email: "dana@example.com" }), headers: { "X-Forwarded-For": "10.9.9.9" } });
      assert.equal(nr.status, 201, JSON.stringify(nr.data));
      const did = nr.data.id, dt = nr.data.token;
      cookie = real;
      await call("/api/admin/update", { body: { id: did, action: "quote", quote: "$900", durationMin: 240 } });
      cookie = "";
      r = await call("/api/status", { body: { id: did, t: dt, action: "decline", message: "A bit over budget." } });
      assert.equal(r.data.status, "declined"); assert.equal(r.data.canMessage, false);
      cookie = real; r = await call("/api/admin/inbox");
      const dreq = r.data.requests.find((x) => x.id === did); assert.equal(dreq.declinedBy, "client"); assert.equal(dreq.unread, true);
      cookie = shop;
    }
    ok("client can turn down a quote with a note");


    // ---------- Team logins, roles and password resets ----------
    const jar = (xff) => { let c = ""; return async (p, { method, body } = {}) => {
      const r = await fetch(BASE + p, { method: method || (body ? "POST" : "GET"), redirect: "manual",
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(c ? { Cookie: c } : {}), "X-Forwarded-For": xff, "X-Forwarded-Host": SHOPHOST },
        body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get("set-cookie"); if (sc) c = sc.split(";")[0];
      let data = {}; try { data = await r.json(); } catch {}
      return { status: r.status, data, cookie: () => c, setCookie: (v) => { c = v; } };
    }; };
    const tokenOf = (link) => new URL(link).searchParams.get("reset");
    const shop = jar("10.0.0.1"), nathan = jar("10.0.0.2"), guest = jar("10.0.0.3"), desk = jar("10.0.0.4"), anon = jar("10.0.0.5");
    const L = "/api/admin/login";
    r = await anon(L); assert.equal(r.data.user, null); assert.equal(r.data.needsSetup, false);
    assert.equal((await shop(L, { body: { action: "login", email: "", password: "anything" } })).status, 400, "no shared shop password in Beam Book");
    assert.equal((await shop(L, { body: { action: "login", email: "owner@example.com", password: "owner password 123" } })).status, 200);
    r = await shop(L, { body: { action: "add", name: "Nathan Ealey", email: "Nathan@Example.com", role: "owner" } }); assert.equal(r.status, 200);
    assert.equal(r.data.invite.emailed, false); const nInvite = r.data.invite.link;
    r = await shop(L, { body: { action: "add", name: "Nate Two", email: "nathan@example.com", role: "desk" } }); assert.equal(r.status, 400, "duplicate email");
    r = await anon(`${L}?reset=${tokenOf(nInvite)}`); assert.equal(r.data.valid, true); assert.equal(r.data.email, "nathan@example.com");
    r = await nathan(L, { body: { action: "reset", token: tokenOf(nInvite), password: "short" } }); assert.equal(r.status, 400);
    r = await nathan(L, { body: { action: "reset", token: tokenOf(nInvite), password: "spruce moose aurora" } }); assert.equal(r.status, 200);
    r = await anon(L, { body: { action: "reset", token: tokenOf(nInvite), password: "another long one" } }); assert.equal(r.status, 400, "link is one-use");
    r = await anon(L, { body: { action: "login", email: "nathan@example.com", password: "wrong password" } }); assert.equal(r.status, 401);
    r = await nathan(L, { body: { action: "login", email: "NATHAN@example.com", password: "spruce moose aurora" } }); assert.equal(r.status, 200);
    r = await nathan(L); assert.equal(r.data.user.role, "owner"); assert.equal(r.data.needsSetup, false);
    ok("invite link sets a password once; email login works; duplicate emails refused");

    r = await nathan(L, { body: { action: "add", name: "Kai Guest", email: "kai@example.com", role: "artist", newArtist: "Kai Guest" } }); assert.equal(r.status, 200);
    const kaiSlug = r.data.users.find((u) => u.email === "kai@example.com").artist; assert.equal(kaiSlug, "kai-guest");
    const kaiInvite = r.data.invite.link;
    r = await anon("/api/artists"); assert.equal(r.data.artists.length, 1, "new artist hidden from booking form");
    r = await nathan("/api/admin/books", { body: { action: "listed", slug: kaiSlug, listed: true } }); assert.equal(r.status, 200);
    r = await anon("/api/artists"); assert.equal(r.data.artists.length, 2);
    await nathan("/api/admin/books", { body: { action: "listed", slug: kaiSlug, listed: false } });
    r = await nathan(L, { body: { action: "add", name: "Front Desk", email: "desk@example.com", role: "desk" } }); const deskInvite = r.data.invite.link;
    await desk(L, { body: { action: "reset", token: tokenOf(deskInvite), password: "front desk password" } });
    await guest(L, { body: { action: "reset", token: tokenOf(kaiInvite), password: "kai guest password" } });
    ok("adding an artist login creates the artist, hidden from the booking form until switched on");

    r = await nathan("/api/admin/books", { body: { action: "profile", slug: "nathan-ealey", styles: "Black and grey realism, Color", bio: "Wildlife and landscapes.", instagram: "https://instagram.com/bwtcfairbanks/", photo: PNG } });
    assert.equal(r.status, 200);
    r = await anon("/api/artists"); const nate = r.data.artists.find((a) => a.slug === "nathan-ealey");
    assert.equal(nate.instagram, "@bwtcfairbanks"); assert.deepEqual(nate.styles, ["Black and grey realism", "Color"]); assert.match(nate.photo, /^\/api\/artists\?photo=nathan-ealey/);
    assert.equal(nate.email, undefined, "no private fields on the public list");
    assert.equal((await page(nate.photo)).status, 200, "portrait is public");
    assert.equal((await anon(`/api/artists?photo=${kaiSlug}`)).status, 404, "hidden artist has no public photo");
    assert.equal((await guest("/api/admin/books", { body: { action: "profile", slug: "nathan-ealey", bio: "hacked" } })).status, 400, "artists can't edit someone else's profile");
    assert.equal((await guest("/api/admin/books", { body: { action: "profile", slug: kaiSlug, bio: "Fine line and lettering.", styles: "Fine line", instagram: "@kai.ink" } })).status, 200);
    assert.equal((await nathan("/api/admin/books", { body: { action: "profile", slug: kaiSlug, instagram: "not a handle!!" } })).status, 400);
    ok("artist profiles: photo, styles, bio and Instagram show on the public Artists page; artists edit only their own");

    r = await nathan("/api/admin/inbox"); const allCount = r.data.requests.length; assert.ok(allCount > 0);
    const someReq = r.data.requests[0];
    r = await desk("/api/admin/inbox"); assert.equal(r.data.requests.length, allCount); assert.equal(r.data.me.full, false);
    r = await guest("/api/admin/inbox"); assert.equal(r.data.requests.length, 0); assert.deepEqual(r.data.artists.map((a) => a.slug), [kaiSlug]);
    assert.equal((await guest("/api/admin/update", { body: { id: someReq.id, action: "note", text: "peek" } })).status, 404);
    assert.equal((await guest("/api/admin/books", { body: { slug: "nathan-ealey", open: false } })).status, 400);
    assert.equal((await guest(L, { body: { action: "team" } })).status, 403);
    assert.equal((await desk(L, { body: { action: "team" } })).status, 403);
    assert.equal((await desk("/api/admin/update", { body: { id: someReq.id, action: "delete" } })).status, 403, "front desk can't delete");
    // (Live photos go through /api/admin/photo, which applies the same rule; locally they're plain files.)
    r = await guest(`/api/admin/photo?p=${encodeURIComponent(`blackwolf/requests/${someReq.id}/1-0123456789abcdef.jpg`)}`); assert.equal(r.status, 404, "artist can't load another artist's client photos");
    r = await desk("/api/admin/update", { body: { id: someReq.id, action: "assign", artist: kaiSlug } }); assert.equal(r.status, 200);
    r = await guest("/api/admin/inbox"); assert.equal(r.data.requests.length, 1);
    assert.equal((await guest("/api/admin/update", { body: { id: someReq.id, action: "assign", artist: "nathan-ealey" } })).status, 403);
    r = await guest("/api/admin/update", { body: { id: someReq.id, action: "note", text: "Looks great" } }); assert.equal(r.status, 200);
    assert.equal(r.data.request.notes.at(-1).by, "Kai Guest");
    const kaiFeed = new URL((await guest("/api/admin/inbox")).data.feed.https);
    const shopFeed = new URL((await nathan("/api/admin/inbox")).data.feed.https);
    assert.notEqual(kaiFeed.search, shopFeed.search);
    assert.equal((await page(kaiFeed.pathname + kaiFeed.search)).status, 200);
    assert.match(await (await page(kaiFeed.pathname + kaiFeed.search)).text(), /Kai's tattoos/);
    await desk("/api/admin/update", { body: { id: someReq.id, action: "assign", artist: "nathan-ealey" } });
    ok("artists only see and change their own clients, calendar and feed; front desk sees all but not Team");

    r = await nathan(L, { body: { action: "remove", id: (await nathan(L)).data.user.id } }); assert.equal(r.status, 400, "can't remove yourself");
    const kaiId = (await nathan(L, { body: { action: "team" } })).data.users.find((u) => u.email === "kai@example.com").id;
    r = await nathan(L, { body: { action: "update", id: kaiId, active: false } }); assert.equal(r.status, 200);
    assert.equal((await guest("/api/admin/inbox")).status, 401, "turned-off login is logged out");
    assert.equal((await guest(L, { body: { action: "login", email: "kai@example.com", password: "kai guest password" } })).status, 401);
    await nathan(L, { body: { action: "update", id: kaiId, active: true } });
    r = await nathan(L, { body: { action: "resetLink", id: kaiId } }); assert.equal(r.status, 200);
    assert.equal((await guest(L, { body: { action: "login", email: "kai@example.com", password: "kai guest password" } })).status, 200, "old password still works until link is used");
    await anon(L, { body: { action: "reset", token: tokenOf(r.data.invite.link), password: "brand new kai pass" } });
    assert.equal((await guest("/api/admin/inbox")).status, 401, "reset logs out other sessions");
    assert.equal((await guest(L, { body: { action: "login", email: "kai@example.com", password: "brand new kai pass" } })).status, 200);
    ok("turning off, reset links and logging out old sessions");

    const deskOther = jar("10.0.0.6"); await deskOther(L, { body: { action: "login", email: "desk@example.com", password: "front desk password" } });
    assert.equal((await desk(L, { body: { action: "password", current: "nope nope nope", password: "new desk password 1" } })).status, 400);
    assert.equal((await desk(L, { body: { action: "password", current: "front desk password", password: "new desk password 1" } })).status, 200);
    assert.equal((await desk("/api/admin/inbox")).status, 200, "stays logged in on this device");
    assert.equal((await deskOther("/api/admin/inbox")).status, 401, "other devices logged out");
    r = await anon(L, { body: { action: "forgot", email: "desk@example.com" } }); assert.equal(r.data.emailed, false); assert.match(r.data.message, /Team screen/);
    assert.equal((await shop("/api/admin/inbox")).status, 200, "shop key still works for recovery");
    ok("change own password; forgot-password explains when email isn't connected");



    // "No preference" requests: open to every artist, first to take it gets it
    {
      const lee = jar("10.0.0.8");
      r = await nathan(L, { body: { action: "add", name: "Lee Ink", email: "lee@example.com", role: "artist", newArtist: "Lee Ink", password: "lee-ink-password-1", mustChange: false } });
      assert.equal(r.status, 200); await lee(L, { body: { action: "login", email: "lee@example.com", password: "lee-ink-password-1" } });
      const open = await anon("/api/requests", { body: valid({ artist: "any", name: "Robin Open", email: "robin@example.com" }) });
      assert.equal(open.status, 201, JSON.stringify(open.data)); const oid = open.data.id;
      assert.match(log, /Open request: /); assert.match(log, /to=[^\n]*kai@example\.com[^\n]*lee@example\.com|to=[^\n]*lee@example\.com[^\n]*kai@example\.com/);
      let k = (await guest("/api/admin/inbox")).data.requests.find((x) => x.id === oid);
      assert.ok(k && k.openToAll); assert.equal(k.client.email, undefined, "no contact details before taking it"); assert.equal(k.links, undefined);
      assert.equal((await guest("/api/admin/update", { body: { id: oid, action: "quote", quote: "$100", durationMin: 60 } })).status, 403);
      const [a1, a2] = await Promise.all([guest("/api/admin/update", { body: { id: oid, action: "claim" } }), lee("/api/admin/update", { body: { id: oid, action: "claim" } })]);
      assert.deepEqual([a1.status, a2.status].sort(), [200, 409], "exactly one artist gets it");
      const [winner, loser] = a1.status === 200 ? [guest, lee] : [lee, guest];
      k = (await winner("/api/admin/inbox")).data.requests.find((x) => x.id === oid); assert.equal(k.client.email, "robin@example.com"); assert.ok(!k.openToAll);
      assert.equal((await loser("/api/admin/inbox")).data.requests.some((x) => x.id === oid), false, "gone for everyone else");
      r = await nathan("/api/admin/inbox"); assert.ok(r.data.requests.find((x) => x.id === oid).history.some((h) => /Taken by/.test(h.note || "")));
    }
    ok("No preference requests are open to every artist; first to take it gets it, then it's gone for the rest");


    // Texts: client opt-in, staff alerts, booking confirmed to both sides
    {
      const cli = jar("10.0.0.9");
      r = await nathan(L, { body: { action: "alerts", phone: "12", smsAlerts: true } }); assert.equal(r.status, 400, "bad alert number refused");
      r = await nathan(L, { body: { action: "alerts", phone: "(907) 555-0142", smsAlerts: true } }); assert.equal(r.status, 200); assert.equal(r.data.user.smsAlerts, true);
      r = await cli("/api/requests", { body: valid({ name: "Tex Client", email: "tex@example.com", phone: "nope", smsOk: true }) });
      assert.equal(r.status, 400); assert.ok(r.data.fields.phone, "texts need a real mobile number");
      r = await cli("/api/requests", { body: valid({ name: "Tex Client", email: "tex@example.com", phone: "907-555-0177", smsOk: true }) });
      assert.equal(r.status, 201); const tid = r.data.id, ttok = r.data.token;
      assert.match(log, /\[sms:dev\] to=\+19075550177\nBlack Wolf Tattoo Club: Got your request/);
      assert.match(log, /\[sms:dev\] to=\+19075550142\nBlack Wolf Tattoo Club: New request from Tex Client/);
      r = await nathan("/api/admin/update", { body: { id: tid, action: "quote", quote: "250", durationMin: 60 } }); assert.match(log, /to=\+19075550177\n[^\n]*New offer from Black Wolf Tattoo Club: \$250/);
      await cli("/api/status", { body: { id: tid, t: ttok, action: "accept" } });
      const day = (await cli(`/api/schedule?id=${tid}&t=${ttok}`)).data.days[2];
      await cli("/api/schedule", { body: { id: tid, t: ttok, start: day.slots[0].start } });
      assert.match(log, /to=\+19075550142\n[^\n]*Tex Client asked for/);
      r = await nathan("/api/admin/update", { body: { id: tid, action: "confirmTime" } }); assert.equal(r.data.request.status, "booked");
      assert.equal(r.data.texted, "off", "texting not connected in tests: logged, reported as off");
      assert.match(log, /to=\+19075550177\n[^\n]*You're booked:/); assert.match(log, /to=\+19075550142\n[^\n]*Booked: Tex Client/);
      assert.match(log, /subject="Booked: Tex Client/);
      const noText = await jar("10.0.0.10")("/api/requests", { body: valid({ name: "Quiet Client", email: "quiet@example.com", phone: "907-555-0188" }) });
      assert.equal(noText.status, 201); assert.ok(!/to=\+19075550188/.test(log), "no texts without the opt-in box");
      await nathan("/api/admin/update", { body: { id: tid, action: "delete" } }); await nathan("/api/admin/update", { body: { id: noText.data.id, action: "delete" } });
    }
    ok("texts: client opt-in required, staff text alerts, booked confirmation texted and emailed to client and artist");

    // Owner creates a login with a password they choose
    const tess = jar("10.0.0.7");
    r = await nathan(L, { body: { action: "add", name: "Tess Front", email: "tess@example.com", role: "desk", password: "short" } }); assert.equal(r.status, 400);
    r = await nathan(L, { body: { action: "add", name: "Tess Front", email: "tess@example.com", role: "desk", password: "raven-spruce-ember-42" } });
    assert.equal(r.status, 200); assert.equal(r.data.invite, null); const tessId = r.data.created.id;
    assert.equal(r.data.users.find((u) => u.id === tessId).mustChange, true);
    assert.equal((await tess(L, { body: { action: "login", email: "tess@example.com", password: "raven-spruce-ember-42" } })).status, 200);
    assert.equal((await tess("/api/admin/inbox")).status, 401, "must pick own password before using the inbox");
    assert.equal((await tess(L)).data.user.mustChange, true);
    assert.equal((await tess(L, { body: { action: "password", password: "raven-spruce-ember-42" } })).status, 400, "can't keep the starting password");
    assert.equal((await tess(L, { body: { action: "password", password: "tess own password" } })).status, 200);
    assert.equal((await tess("/api/admin/inbox")).status, 200);
    r = await nathan(L, { body: { action: "setPassword", id: tessId, password: "copper-willow-ridge-17", mustChange: false } }); assert.equal(r.status, 200);
    assert.equal((await tess("/api/admin/inbox")).status, 401, "setting a password logs them out");
    assert.equal((await tess(L, { body: { action: "login", email: "tess@example.com", password: "copper-willow-ridge-17" } })).status, 200);
    assert.equal((await tess("/api/admin/inbox")).status, 200, "no forced change when unticked");
    assert.equal((await nathan(L, { body: { action: "setPassword", id: (await nathan(L)).data.user.id, password: "whatever long one" } })).status, 400);
    ok("owner can create a login with a chosen password; first-login change is enforced");


    // Outside calendars: existing appointments elsewhere block those times
    {
      const http = require("http");
      let ics = "";
      const icsSrv = http.createServer((q, s2) => { if (q.url === "/missing.ics") { s2.statusCode = 404; return s2.end(); } s2.setHeader("Content-Type", "text/calendar"); s2.end(ics); });
      await new Promise((ok) => icsSrv.listen(0, "127.0.0.1", ok));
      const icsUrl = `http://127.0.0.1:${icsSrv.address().port}/cal.ics`;
      try {
        const T3 = require("../lib/time");
        cookie = real;
        const nr = await call("/api/requests", { body: valid({ name: "Cal Test", email: "cal@example.com" }), headers: { "X-Forwarded-For": "10.8.8.8" } });
        const cid = nr.data.id, ctok = nr.data.token;
        await call("/api/admin/update", { body: { id: cid, action: "schedule", durationMin: 120 } });
        cookie = "";
        let open = (await call(`/api/schedule?id=${cid}&t=${ctok}`)).data.days;
        const day = open[3]; const target = day.slots[0].start;
        const ymd = (ms) => T3.dateKey(ms).replace(/-/g, "");
        const local = (ms) => { const p = T3.parts(ms); return `${p.y}${String(p.m).padStart(2, "0")}${String(p.d).padStart(2, "0")}T${String(p.h).padStart(2, "0")}${String(p.mi).padStart(2, "0")}00`; };
        const allDayDay = open[6].date; // a whole open day to block with an all-day event
        const freeT = open[4].slots[0].start, ownT = open[5].slots[0].start;
        const nextDay = T3.keyOf(T3.addDays(T3.parseDate(allDayDay), 1)).replace(/-/g, "");
        ics = ["BEGIN:VCALENDAR", "VERSION:2.0",
          "BEGIN:VEVENT", "UID:x1@icloud.com", "SUMMARY:Sleeve - Mike", `DTSTART;TZID=America/Anchorage:${local(target + 60 * 60e3)}`, `DTEND;TZID=America/Anchorage:${local(target + 2 * 60 * 60e3)}`, "END:VEVENT",
          "BEGIN:VEVENT", "UID:x2@icloud.com", "SUMMARY:Convention", `DTSTART;VALUE=DATE:${allDayDay.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${nextDay}`, "END:VEVENT",
          "BEGIN:VEVENT", "UID:x3@icloud.com", "SUMMARY:Just a reminder", "TRANSP:TRANSPARENT", `DTSTART;TZID=America/Anchorage:${local(freeT)}`, `DTEND;TZID=America/Anchorage:${local(freeT + 3600e3)}`, "END:VEVENT",
          "BEGIN:VEVENT", "UID:appt-abc@blackwolftattooclub.com", "SUMMARY:Tattoo: our own feed", `DTSTART;TZID=America/Anchorage:${local(ownT)}`, `DTEND;TZID=America/Anchorage:${local(ownT + 3600e3)}`, "END:VEVENT",
          "END:VCALENDAR"].join("\r\n");
        cookie = real;
        r = await call("/api/admin/books", { body: { slug: "nathan-ealey", action: "addCalendar", name: "iPhone", url: `${icsUrl.replace("cal.ics", "missing.ics")}` } }); assert.equal(r.status, 400, "bad link refused");
        r = await call("/api/admin/books", { body: { slug: "nathan-ealey", action: "addCalendar", name: "iPhone", url: "https://localhost/cal.ics" } }); assert.equal(r.status, 400, "private address refused");
        r = await call("/api/admin/books", { body: { slug: "nathan-ealey", action: "addCalendar", name: "iPhone", url: icsUrl } }); assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(r.data.calendars[0].count, 2, "busy event + all-day; free and own-feed events ignored");
        cookie = "";
        open = (await call(`/api/schedule?id=${cid}&t=${ctok}`)).data.days;
        const starts = new Set(open.flatMap((d) => d.slots.map((x) => x.start)));
        assert.ok(!starts.has(target), "2-hour session overlapping the outside appointment is gone");
        assert.ok(!open.some((d) => d.date === allDayDay), "all-day event blocks the whole Alaska day");
        assert.ok(starts.has(freeT), "events marked free don't block"); assert.ok(starts.has(ownT), "the site's own feed isn't counted twice");
        r = await call("/api/schedule", { body: { id: cid, t: ctok, start: target } }); assert.equal(r.status, 409, "can't request a busy time");
        cookie = real;
        r = await call("/api/admin/update", { body: { id: cid, action: "book", start: T3.localInputValue(target + 60 * 60e3), durationMin: 60 } });
        assert.equal(r.status, 409); assert.match(r.data.error, /Sleeve - Mike.*iPhone calendar/);
        r = await call("/api/admin/inbox"); const C = r.data.calendar["nathan-ealey"];
        assert.ok(C.busy.some((b) => b.title === "Sleeve - Mike")); assert.equal(C.external[0].host, "127.0.0.1");
        cookie = "";
        assert.equal((await call("/api/artists")).data.artists[0].busy, undefined);
        const pub = await call(`/api/schedule?id=${cid}&t=${ctok}`); assert.ok(!JSON.stringify(pub.data).includes("Sleeve"), "event names never reach clients");
        cookie = real;
        await call("/api/admin/books", { body: { slug: "nathan-ealey", action: "removeCalendar", id: C.external[0].id } });
        cookie = "";
        open = (await call(`/api/schedule?id=${cid}&t=${ctok}`)).data.days;
        assert.ok(open.flatMap((d) => d.slots).some((x) => x.start === target), "removing the calendar frees the time");
        cookie = real;
        await call("/api/admin/update", { body: { id: cid, action: "delete" } });
      } finally { icsSrv.close(); }
    }
    ok("outside calendars: their appointments and all-day events block times (with the gap), names stay private, removing frees them");

    // Rate limit (5/hour/IP; 2 real + 1 bot-free already used this hour from this IP)
    // Instagram: nothing connected means an empty feed (the strip stays hidden), and nothing else can be fetched.
    { cookie = "";
      const f = await call("/api/artists?ig=feed");
      assert.equal(f.status, 200); assert.deepEqual(f.data.items, []);
      assert.equal((await call("/api/artists?ig=img&id=123")).status, 404);
      assert.equal((await call("/api/artists?ig=img&id=../../etc")).status, 404);
      const cb = await go(BASE + "/instagram/callback?code=x&state=not-a-real-state-value-123");
      const html = await cb.text();
      assert.ok(html.includes("wasn't connected") && html.includes("/admin?ig=error"));
      const conn = await call("/api/admin/books", { body: { action: "igConnect" } });
      assert.equal(conn.status, 401); // must be logged in
      ok("instagram: empty until connected, pictures and callback locked down"); }

    const bwOwner = {};
    // ---------- Two shops never see each other's data ----------
    {
      cookie = ""; SHOPHOST = "blackwolf.localhost";
      await call("/api/admin/login", { body: { email: "owner@example.com", password: "owner password 123" } });
      bwOwner.c = cookie;
      const bwCookie = cookie, bwInbox = (await call("/api/admin/inbox")).data;
      assert.ok(bwInbox.requests.length >= 1);
      const bwReq = bwInbox.requests[0];

      const made2 = await control({ action: "create", kind: "trades", slug: "inkwell", ownerName: "Rae Mendez", ownerEmail: "rae@example.com", artistName: "Rae Mendez",
        studio: { name: "Inkwell Studio", city: "Anchorage, Alaska", timeZone: "America/Anchorage" }, theme: { mode: "light", accent: "#1670c2" } });
      assert.equal(made2.status, 201);
      SHOPHOST = "inkwell.localhost"; cookie = "";
      let x = await call("/api/artists");
      assert.equal(x.data.shop.name, "Inkwell Studio"); assert.equal(x.data.shop.theme.mode, "light");
      assert.deepEqual(x.data.artists.map((a) => a.name), ["Rae Mendez"]);
      // Black Wolf's login cookie means nothing here
      cookie = bwCookie; assert.equal((await call("/api/admin/inbox")).status, 401, "other shop's login rejected");
      // Black Wolf's owner email can't log in here
      cookie = ""; assert.equal((await call("/api/admin/login", { body: { email: "owner@example.com", password: "owner password 123" } })).status, 401);
      const tok = new URL(made2.data.ownerLink).searchParams.get("reset");
      assert.equal((await call("/api/admin/login", { body: { action: "reset", token: tok, password: "rae long password" } })).status, 200);
      x = await call("/api/admin/inbox"); assert.equal(x.status, 200); assert.equal(x.data.requests.length, 0, "no Black Wolf requests in Inkwell's inbox");
      assert.equal(x.data.shopName, "Inkwell Studio");
      // Black Wolf's request link and photos don't work at Inkwell's address
      assert.equal((await call(`/api/status?id=${id}&t=${token}`)).status, 404);
      assert.equal((await call("/api/admin/update", { body: { id: bwReq.id, action: "note", note: "hi" } })).status, 404);
      const bwPhoto = fs.readdirSync(path.join(DATA, "uploads/blackwolf/requests", id))[0];
      assert.notEqual((await call(`/api/admin/photo?p=${encodeURIComponent(`blackwolf/requests/${id}/${bwPhoto}`)}`)).status, 200, "other shop's photo blocked");
      // A request to Inkwell lands in Inkwell's folder and inbox only
      cookie = ""; x = await call("/api/requests", { body: valid({ artist: "rae-mendez", email: "pat@example.com", address: "12 Elm St, Anchorage" }) }); assert.equal(x.status, 201, JSON.stringify(x.data));
      assert.ok(fs.existsSync(path.join(DATA, "uploads/inkwell/requests", x.data.id)));
      await call("/api/admin/login", { body: { email: "rae@example.com", password: "rae long password" } });
      assert.equal((await call("/api/admin/inbox")).data.requests.length, 1);
      SHOPHOST = "blackwolf.localhost"; cookie = bwCookie;
      assert.ok(!(await call("/api/admin/inbox")).data.requests.some((q) => q.id === x.data.id), "Inkwell request not in Black Wolf's inbox");
      // Unknown address, and a shop that's turned off
      SHOPHOST = "nobody.localhost"; x = await call("/api/artists"); assert.equal(x.status, 404); assert.equal(x.data.noShop, true);
      assert.equal((await control({ action: "active", slug: "inkwell", active: false })).status, 200);
      SHOPHOST = "inkwell.localhost"; assert.equal((await call("/api/artists")).status, 404, "turned-off shop is hidden");
      await control({ action: "active", slug: "inkwell", active: true });
      await new Promise((res) => setTimeout(res, 15100)); // settings are cached for 15 s
      assert.equal((await call("/api/artists")).status, 200);
      // Control page: list, settings, own web address, new owner link
      x = await control(); assert.deepEqual(x.data.shops.map((q) => q.slug).sort(), ["blackwolf", "inkwell"]);
      x = await control({ action: "update", slug: "inkwell", hosts: ["book.inkwellstudio.com"], studio: { phone: "907-555-0199" }, placements: "Arm\nLeg" });
      assert.equal(x.status, 200, JSON.stringify(x.data));
      assert.equal((await control({ action: "update", slug: "blackwolf", hosts: ["book.inkwellstudio.com"] })).status, 400, "one address, one shop");
      SHOPHOST = "book.inkwellstudio.com"; x = await call("/api/artists"); assert.equal(x.data.shop.name, "Inkwell Studio"); assert.deepEqual(x.data.options.placements, ["Arm", "Leg"]);
      x = await control({ action: "ownerLink", slug: "inkwell" }); assert.equal(x.data.email, "rae@example.com"); assert.match(x.data.link, /^https:\/\/book\.inkwellstudio\.com\/admin\?reset=/);
      SHOPHOST = "blackwolf.localhost"; cookie = "";
      ok("two shops: separate settings, logins, inboxes, files and links; unknown or turned-off addresses show no shop");
    }

    const bwOwnerCookie = () => bwOwner.c;
    // ---------- Negotiation: a performer business where clients make the first offer ----------
    {
      const mk = await control({ action: "create", kind: "performer", slug: "djsolo", ownerName: "Sam Spin", ownerEmail: "sam@example.com", artistName: "Sam Spin",
        studio: { name: "DJ Sam", timeZone: "America/Anchorage" } });
      assert.equal(mk.status, 201);
      SHOPHOST = "djsolo.localhost"; cookie = "";
      let x = await call("/api/artists");
      assert.equal(x.data.words.job, "gig"); assert.equal(x.data.negotiate.clientOffersFirst, true); assert.ok(x.data.form.some((q) => q.key === "venue"));
      // required custom question
      x = await call("/api/requests", { body: { name: "Ana Lopez", email: "ana@example.com", idea: "Wedding reception, 120 guests, mostly 80s and Motown" } });
      assert.equal(x.status, 400); assert.ok(x.data.fields.eventType && x.data.fields.venue);
      const day = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
      x = await call("/api/requests", { body: { name: "Ana Lopez", email: "ana@example.com", idea: "Wedding reception, 120 guests, mostly 80s and Motown",
        eventType: "Wedding", venue: "Pike's Landing, Fairbanks", guests: "120", offer: { price: "600", date: day, time: "18:00", durationMin: 240 } } });
      assert.equal(x.status, 201, JSON.stringify(x.data)); const gid = x.data.id, gtok = x.data.token;
      x = await call(`/api/status?id=${gid}&t=${gtok}`);
      assert.equal(x.data.offers.length, 1); assert.equal(x.data.offers[0].price, "$600"); assert.equal(x.data.offers[0].from, "you"); assert.equal(x.data.canAccept, false, "can't accept your own offer");
      assert.ok(x.data.answers.some((a) => a.label === "Type of event" && a.value === "Wedding"));
      // the business counters on price
      const tok = new URL(mk.data.ownerLink).searchParams.get("reset");
      await call("/api/admin/login", { body: { action: "reset", token: tok, password: "sam long password" } });
      x = await call("/api/admin/update", { body: { id: gid, action: "offer", price: "850", date: day, time: "18:00", durationMin: 240, scope: "4-hour set, sound and lights", message: "That's my wedding rate." } });
      assert.equal(x.status, 200, JSON.stringify(x.data)); assert.equal(x.data.request.status, "quoted");
      assert.equal(x.data.request.offers[0].status, "countered"); assert.match(log, /Review the offer/);
      // the client counters at 750 and a later start
      const shopCookie = cookie; cookie = "";
      x = await call("/api/status", { body: { id: gid, t: gtok, action: "counter", price: "750", date: day, time: "19:00", durationMin: 240, scope: "4-hour set, sound and lights", message: "Can we meet in the middle?" } });
      assert.equal(x.status, 200, JSON.stringify(x.data)); assert.equal(x.data.offers.at(-1).price, "$750"); assert.equal(x.data.offers.at(-1).time, "19:00");
      x = await call("/api/status", { body: { id: gid, t: gtok, action: "counter", price: "750", date: day, time: "19:00", durationMin: 240, scope: "4-hour set, sound and lights" } });
      assert.equal(x.status, 409, "can't counter your own offer");
      assert.match(log, /sent a counter-offer/);
      // the business accepts: straight onto the calendar
      cookie = shopCookie;
      x = await call("/api/admin/update", { body: { id: gid, action: "acceptOffer", message: "Deal. See you there!" } });
      assert.equal(x.status, 200, JSON.stringify(x.data)); assert.equal(x.data.request.status, "booked"); assert.ok(x.data.request.apptId);
      assert.equal(x.data.request.agreed.price, "$750"); assert.match(log, /Your offer was accepted. You're booked./);
      cookie = "";
      x = await call(`/api/status?id=${gid}&t=${gtok}`); assert.equal(x.data.status, "booked"); assert.equal(x.data.hasCalendarFile, true);
      // a business that doesn't let clients counter (the tattoo template)
      SHOPHOST = "blackwolf.localhost";
      x = await call("/api/requests", { body: valid({ email: "nocounter@example.com", phone: "" }) }); const nid = x.data.id, ntok = x.data.token;
      cookie = bwOwnerCookie();
      await call("/api/admin/update", { body: { id: nid, action: "offer", price: "300", durationMin: 120 } });
      cookie = "";
      x = await call(`/api/status?id=${nid}&t=${ntok}`); assert.equal(x.data.canCounter, false); assert.equal(x.data.canAccept, true);
      x = await call("/api/status", { body: { id: nid, t: ntok, action: "counter", price: "200" } }); assert.equal(x.status, 400, "no counter-offers at this business");
      x = await call("/api/status", { body: { id: nid, t: ntok, action: "accept" } }); assert.equal(x.data.status, "scheduling", "accepted offer with a length → pick a time");
      // the business edits its own form from the inbox
      cookie = bwOwnerCookie();
      x = await call("/api/admin/books", { body: { action: "bookingSettings", form: [{ label: "Favorite color", type: "choice", options: ["Red", "Blue"], required: true }], negotiate: { price: true } } });
      assert.equal(x.status, 200, JSON.stringify(x.data)); assert.equal(x.data.form[0].key, "favorite_color"); assert.equal(x.data.negotiate.price, true);
      await new Promise((res) => setTimeout(res, 50));
      cookie = ""; x = await call("/api/artists"); assert.deepEqual(x.data.form.map((q) => q.key), ["favorite_color"]);
      x = await call("/api/requests", { body: valid({ email: "c2@example.com" }) }); assert.equal(x.status, 400); assert.ok(x.data.fields.favorite_color);
      ok("negotiation: client offers first, both sides counter, accepting books it; businesses choose what clients can counter and edit their own questions");
      assert.equal((await control({ action: "update", slug: "blackwolf", applyKind: "tattoo" })).status, 200, "start over from a template");
      x = await call("/api/artists"); assert.ok(x.data.form.some((q) => q.key === "placement"));
      SHOPHOST = "blackwolf.localhost"; cookie = "";
    }

    cookie = ""; const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await call("/api/requests", { body: valid() })).status);
    assert.ok(statuses.includes(429));
    ok("rate limit kicks in");

    console.log(`\n${passed} checks passed.`);
  } catch (e) {
    console.error("\nFAILED:", e.message, "\n--- server log ---\n", log.slice(-3000)); process.exitCode = 1;
  } finally { srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }
})();
