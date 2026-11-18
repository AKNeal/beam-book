// Squire import on the sandbox: creates the shop, team, hours, services and calendar; dashboard reads it; clear takes it out.
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert/strict");
const PORT = 4600 + Math.floor(Math.random() * 300), BASE = `http://localhost:${PORT}`, DATA = fs.mkdtempSync(path.join(os.tmpdir(), "bw-imp-"));
const TOKEN = "t".repeat(32);
(async () => {
  const srv = spawn(process.execPath, ["dev-server.js"], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, PLATFORM_PASSWORD: "control-pass", SESSION_SECRET: "s3cret", BEAMBOOK_DOMAIN: "localhost", TZ: "UTC", STORE_NAMESPACE: "sandbox", IMPORT_TOKEN: TOKEN, RANK_INGEST_TOKEN: "r".repeat(30) } });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 50 && !log.includes("running"); i++) await new Promise((r) => setTimeout(r, 100));
  const post = async (b, host = "localhost") => { const r = await fetch(BASE + "/api/platform", { method: "POST", headers: { "Content-Type": "text/plain", "X-Forwarded-Host": host }, body: JSON.stringify(b) }); return { status: r.status, data: await r.json() }; };
  try {
    const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const days = [d(-21), d(-14), d(-7), d(3)];
    const data = {
      teamOrder: ["Kiley K", "Snow D", "Seth Long"],
      team: [{ name: "Snow D", category: "snows services", hours: { 2: "12:00-18:00", 3: "09:00-18:00", 6: "09:00-18:00" } },
        { name: "Seth Long", category: "licensed barber services", hours: { 3: "09:00-18:00" } }],
      catalog: { "snows services": [["Standard Haircut", 55, 30, true], ["Beard Trim w/ Razor", 25, 15, true], ["Kids Cut", 45, 30, true]], "licensed barber services": [["Haircut", 50, 45, true], ["Beard trim, w/ razor", 25, 30, true], ["Hidden thing", 5, 15, false], ["Kids Cut", 40, 30, true]] },
      days, raw: ["Standard Haircut", "Beard Trim w/ Razor, Standard Haircut", "Haircut", "Beard trim, w/ razor"],
      rows: [[0, 600, 30, 1, "Jo Client", 0, 1], [1, 600, 45, 1, "Jo Client", 1, 0], [2, 660, 45, 2, "Al Other", 2, 0], [3, 720, 30, 2, "Al Other", 3, 0], [3, 600, 30, 0, "Nobody", 0, 0]],
      blocks: [[3, 780, 30, 1]],
    };
    let x = await post({ action: "importSquire", token: "wrong", slug: "levelup", data });
    assert.equal(x.status, 403);
    x = await post({ action: "importSquire", token: TOKEN, slug: "levelup", shop: { name: "Level Up Barbershop", ownerName: "Snow", ownerEmail: "snow@example.com", artistName: "Snow D" }, data });
    assert.equal(x.status, 200, JSON.stringify(x.data));
    assert.equal(x.data.appointments, 4, "rows for unknown team members are skipped"); assert.equal(x.data.bookedAhead, 1); assert.equal(x.data.services, 6, "hidden services left out; the same name priced by two barbers stays two services"); assert.ok(x.data.ownerLink);
    x = await post({ action: "importSquire", token: TOKEN, slug: "levelup", data });
    assert.equal(x.data.appointments, 4, "running it again replaces, doesn't double");
    { const sch = await fetch(BASE + "/api/schedule?instant=1", { headers: { "X-Forwarded-Host": "levelup.localhost" } }).then((q) => q.json());
      const kids = sch.services.filter((q) => q.name === "Kids Cut").map((q) => [q.price, q.barbers.join(",")]).sort();
      assert.deepEqual(kids, [[40, "seth-long"], [45, "snow-d"]], "each barber's own Kids Cut price"); }
    // Owner logs in through the link and reads the dashboard.
    const link = new URL((await post({ action: "importSquire", token: TOKEN, slug: "levelup", data, ownerLink: true })).data.ownerLink);
    const H = { "Content-Type": "application/json", "X-Forwarded-Host": "levelup.localhost" };
    let r = await fetch(BASE + "/api/admin/login", { method: "POST", headers: H, body: JSON.stringify({ action: "reset", token: link.searchParams.get("reset") || link.hash.replace(/^#?reset=/, ""), password: "Longpassword-123" }) });
    const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
    assert.equal(r.status, 200, await r.text());
    r = await fetch(BASE + "/api/admin/books", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ action: "dash", from: d(-30), to: d(10) }) });
    const dash = (await r.json()).dash;
    assert.equal(dash.cuts, 4); assert.equal(dash.money.gross, 55 + 80 + 50 + 25, "prices from the catalog, multi-service visits add up");
    assert.equal(dash.rebookRate, null, "Squire doesn't say when visits were booked, so no rebook rate from imports");
    assert.equal(dash.newClients, 2);
    // Squire history (Appointments CSV): when visits were booked, cash/card, tips, no-shows, and an older visit the calendar didn't have.
    const us = (iso) => { const [y, m, dd] = iso.split("-"); return `${+m}/${+dd}/${y}`; };
    const hrow = (staff, day, time, client, service, cost, extra = {}) => ({ staff, date: us(day), time, client, service, cost: String(cost), dur: "30", status: "Completed", ...extra });
    const rows = [
      hrow("Snow D", days[0], "10:00 am", "Jo Client", "Standard Haircut", 55, { pay: "Cash", tip: "10", cdate: us(d(-30)), ctime: "9:00 am" }),
      hrow("Snow D", days[1], "10:00 am", "Jo Client", "Beard Trim w/ Razor, Standard Haircut", 80, { pay: "Squire Card", cdate: us(days[0]), ctime: "10:15 am" }),
      hrow("Seth Long", days[3], "12:00 pm", "Al Other", "Beard trim, w/ razor", 25, { status: "Upcoming", cdate: us(days[2]), ctime: "11:30 am" }),
      hrow("Snow D", d(-10), "2:00 pm", "Ghost", "Standard Haircut", 55, { status: "No-Show" }),
      hrow("Seth Long", d(-25), "9:00 am", "Pat Old", "Haircut", 50, { pay: "Cash" }),
      hrow("Kiley K", d(-5), "9:00 am", "Somebody", "Haircut", 50, { pay: "Cash" }),
    ];
    r = await fetch(BASE + "/api/admin/books", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ action: "squireHistory", rows }) });
    const hx = await r.json(); assert.equal(r.status, 200, JSON.stringify(hx)); assert.equal(hx.rows, 5); assert.deepEqual(hx.unknownBarbers, ["Kiley K"]);
    r = await fetch(BASE + "/api/admin/books", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ action: "dash", from: d(-30), to: d(10) }) });
    const dh = (await r.json()).dash;
    assert.equal(dh.cuts, 5, "the older visit from history is added"); assert.equal(dh.money.gross, 55 + 80 + 50 + 25 + 50);
    assert.equal(dh.rebookable, 3); assert.equal(dh.rebooks, 2, "booked-in-the-chair visits count from the history's booking times");
    assert.equal(dh.money.paidCash, 2); assert.equal(dh.money.paidCard, 1); assert.equal(dh.money.tips, 10); assert.equal(dh.noShows, 1);
    r = await fetch(BASE + "/api/admin/books", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ action: "squireHistoryClear" }) });
    assert.equal(r.status, 200);
    r = await fetch(BASE + "/api/admin/books", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ action: "dash", from: d(-30), to: d(10) }) });
    assert.equal((await r.json()).dash.cuts, 4, "removing the history puts it back");
    // Apprentice portal: the owner makes Seth an apprentice, logs signed-off hours, ticks a checkoff; the list shows progress.
    { const A = (b) => fetch(BASE + "/api/admin/books", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify(b) }).then(async (q) => ({ status: q.status, data: await q.json() }));
      assert.equal((await A({ action: "apprSet", slug: "seth-long", on: true })).status, 200);
      let a = await A({ action: "apprLog", slug: "seth-long", date: d(-1), hours: 8, note: "Fades on the floor" }); assert.equal(a.data.approvedHours, 8);
      assert.equal((await A({ action: "apprLog", slug: "seth-long", date: d(5), hours: 8 })).status, 400, "no future hours");
      a = await A({ action: "apprCheck", slug: "seth-long", id: "m1", on: true }); assert.equal(a.data.checksDone, 1); assert.equal(a.data.checksTotal, 8);
      a = await A({ action: "apprView" }); assert.equal(a.data.apprentices[0].approvedHours, 8); assert.equal(a.data.settings.goalHours, 1650);
      assert.equal((await A({ action: "apprMaterials", items: [{ title: "Vol 1", url: "javascript:alert(1)" }, { title: "Vol 2", url: "https://example.com/v2" }] })).data.materials.length, 1, "https links only"); }
    // Onboarding link: owner fills shop details, socials and team; the website reads them back publicly.
    const ob = new URL((await post({ action: "importSquire", token: TOKEN, slug: "levelup", data, onboardLink: true })).data.onboardLink);
    const G = (u) => fetch(BASE + u, { headers: { "X-Forwarded-Host": "levelup.localhost" } }).then(async (q) => ({ status: q.status, data: await q.json(), cors: q.headers.get("access-control-allow-origin") }));
    assert.equal((await G("/api/artists?onboard=wrong-token-123")).status, 404);
    let v = await G(`/api/artists?onboard=${ob.searchParams.get("t")}`); assert.equal(v.status, 200); assert.ok(v.data.team.some((t) => t.name === "Seth Long"));
    r = await fetch(BASE + "/api/status", { method: "POST", headers: H, body: JSON.stringify({ action: "onboardSave", t: ob.searchParams.get("t"),
      shop: { phone: "907-651-9424", about: "North Pole's barbershop." }, socials: { instagram: "@levelup907", facebook: "facebook.com/levelup907" },
      team: [{ slug: "seth-long", title: "Barber", years: "6", bio: "Fades and beards.", instagram: "@sethcuts", styles: "Fades, beards", listed: true }], extra: { promote: "Gift cards" } }) });
    assert.equal(r.status, 200, await r.text());
    v = await G("/api/artists"); assert.equal(v.cors, "*");
    assert.equal(v.data.shop.about, "North Pole's barbershop."); assert.equal(v.data.shop.socials.facebook, "https://facebook.com/levelup907"); assert.equal(v.data.shop.instagram, "levelup907");
    const seth = v.data.artists.find((a) => a.slug === "seth-long"); assert.equal(seth.title, "Barber"); assert.equal(seth.instagram, "@sethcuts"); assert.deepEqual(seth.styles, ["Fades", "beards"]);
    // Google ranking from the morning search task: first ingest sets the searches; due/ingest need the token; fee for the owner only.
    const RH = { "X-Forwarded-Host": "levelup.localhost", Authorization: "Bearer " + "r".repeat(30) };
    assert.equal((await fetch(BASE + "/api/artists?rank=due", { headers: { "X-Forwarded-Host": "levelup.localhost" } })).status, 401);
    let k = await fetch(BASE + "/api/artists?rank=due", { headers: RH }).then((q) => q.json()); assert.equal(k.due, false, "no searches yet");
    const S3 = { "barbershop North Pole": { rank: 2, top: ["A", "Level Up Barbershop"] }, "barber North Pole AK": { rank: 1, top: ["Level Up Barbershop"] }, "barbershop near me": { rank: null, top: [] } };
    r = await fetch(BASE + "/api/artists?rank=ingest", { method: "POST", headers: { ...RH, "Content-Type": "application/json" }, body: JSON.stringify({ rating: 4.9, reviews: 120, searches: S3 }) });
    assert.equal(r.status, 200, await r.text());
    k = await fetch(BASE + "/api/artists?rank=due", { headers: RH }).then((q) => q.json()); assert.equal(k.due, false); assert.equal(k.searches.length, 3);
    let inbox = await fetch(BASE + "/api/admin/inbox", { headers: { ...H, Cookie: cookie } }).then((q) => q.json());
    assert.equal(inbox.rankings.searches[0].rank, 2); assert.equal(inbox.rankings.latestAvg, 4.7); assert.equal(inbox.rankings.fee, 50, "avg 4.7 rounds to #5: +$50"); assert.ok(inbox.rankings.feeProjected);
    r = await fetch(BASE + "/api/admin/books", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ action: "rankSearches", searches: [...Object.keys(S3), "fade North Pole", "beard trim North Pole", "sixth"] }) });
    assert.equal(r.status, 400, "up to 5");
    r = await fetch(BASE + "/api/admin/books", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ action: "rankSearches", searches: [...Object.keys(S3), "fade North Pole"] }) });
    assert.equal((await r.json()).rankings.searches.length, 4);
    x = await post({ action: "importSquireClear", token: TOKEN, slug: "levelup" }); assert.equal(x.data.appointments, 4);
    console.log("ok - Squire import: shop, team hours, services, calendar, dashboard, appointment history (rebooks, cash/card, tips, no-shows), apprentice portal, onboarding link (shop, socials, team), Google ranking ingest with fee and owner searches, clean removal");
  } catch (e) { console.error(e); console.error(log.slice(-3000)); process.exitCode = 1; } finally { srv.kill(); }
})();
