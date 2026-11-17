// Squire import on the sandbox: creates the shop, team, hours, services and calendar; dashboard reads it; clear takes it out.
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert/strict");
const PORT = 4600 + Math.floor(Math.random() * 300), BASE = `http://localhost:${PORT}`, DATA = fs.mkdtempSync(path.join(os.tmpdir(), "bw-imp-"));
const TOKEN = "t".repeat(32);
(async () => {
  const srv = spawn(process.execPath, ["dev-server.js"], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, PLATFORM_PASSWORD: "control-pass", SESSION_SECRET: "s3cret", BEAMBOOK_DOMAIN: "localhost", TZ: "UTC", STORE_NAMESPACE: "sandbox", IMPORT_TOKEN: TOKEN } });
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
      catalog: { "snows services": [["Standard Haircut", 55, 30, true], ["Beard Trim w/ Razor", 25, 15, true]], "licensed barber services": [["Haircut", 50, 45, true], ["Beard trim, w/ razor", 25, 30, true], ["Hidden thing", 5, 15, false]] },
      days, raw: ["Standard Haircut", "Beard Trim w/ Razor, Standard Haircut", "Haircut", "Beard trim, w/ razor"],
      rows: [[0, 600, 30, 1, "Jo Client", 0, 1], [1, 600, 45, 1, "Jo Client", 1, 0], [2, 660, 45, 2, "Al Other", 2, 0], [3, 720, 30, 2, "Al Other", 3, 0], [3, 600, 30, 0, "Nobody", 0, 0]],
      blocks: [[3, 780, 30, 1]],
    };
    let x = await post({ action: "importSquire", token: "wrong", slug: "levelup", data });
    assert.equal(x.status, 403);
    x = await post({ action: "importSquire", token: TOKEN, slug: "levelup", shop: { name: "Level Up Barbershop", ownerName: "Snow", ownerEmail: "snow@example.com", artistName: "Snow D" }, data });
    assert.equal(x.status, 200, JSON.stringify(x.data));
    assert.equal(x.data.appointments, 4, "rows for unknown team members are skipped"); assert.equal(x.data.bookedAhead, 1); assert.equal(x.data.services, 4, "hidden services left out"); assert.ok(x.data.ownerLink);
    x = await post({ action: "importSquire", token: TOKEN, slug: "levelup", data });
    assert.equal(x.data.appointments, 4, "running it again replaces, doesn't double");
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
    x = await post({ action: "importSquireClear", token: TOKEN, slug: "levelup" }); assert.equal(x.data.appointments, 4);
    console.log("ok - Squire import: shop, team hours, services, calendar, dashboard, onboarding link (shop, socials, team), clean removal");
  } catch (e) { console.error(e); console.error(log.slice(-3000)); process.exitCode = 1; } finally { srv.kill(); }
})();
