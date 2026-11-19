// The official ranking report (localdata.tools): ranks, Friday average and fee come from it; reviews from Beam's own check.
const assert = require("assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "beam-report-"));
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.KV_REST_API_URL;
const tenant = require("../lib/tenant"), rc = require("../lib/rankcheck");
const row = (keyword, ranks) => ({ keyword, enabled: true, bestRankings: Object.fromEntries(Object.entries(ranks).map(([d, r]) => [d, { rank: r }])) });
const feed = { rankings: { last_page: 1, data: [
  row("Barbershop North Pole", { "2026-11-19": 1, "2026-11-20": 1 }),
  row("Barbershop North Pole AK", { "2026-11-19": 1, "2026-11-20": 2 }),
  row("Barbershop near me", { "2026-11-19": 2, "2026-11-20": 0 }), // 0 = not in the results
] } };
let calls = 0; const fetchFn = async (u) => { calls++; assert.match(u, /localdata\.tools\/v2\/campaigns\/52783\/rankings\?type=google-maps/); return { ok: true, json: async () => feed }; };
(async () => {
  await tenant.saveRecord({ slug: "rt", name: "Report Test", hosts: [], ranking: { searches: ["barber North Pole AK"] } }, { isNew: true });
  await tenant.runAs("rt", async () => {
    assert.equal(rc.reportId("https://localdata.tools/results/52783"), "52783");
    assert.equal(rc.reportId("https://evil.example/results/52783"), null);
    await assert.rejects(rc.saveReport("https://example.com/x"), /report's link/);
    await rc.ingest({ date: "2026-11-18", searches: { "barber North Pole AK": { rank: 3 } }, reviews: 268, rating: 4.9 }, { now: Date.parse("2026-11-18T20:00:00Z") });
  });
  await tenant.runAs("rt", () => rc.saveReport("https://localdata.tools/results/52783"));
  await tenant.runAs("rt", async () => {
    const now = Date.parse("2026-11-20T22:00:00Z");
    await rc.reportChecks({ now, fetchFn, fresh: true });
    const k = await rc.summary({ now });
    assert.equal(k.report, "https://localdata.tools/results/52783");
    assert.deepEqual(k.searches.map((x) => [x.q, x.rank, x.change]), [["Barbershop North Pole", 1, 0], ["Barbershop North Pole AK", 2, -1], ["Barbershop near me", 11, -9]]);
    assert.equal(k.reviews, 268, "reviews still from Beam's own check");
    assert.equal(k.checksThisMonth, 1, "Nov 20 is a Friday"); assert.equal(k.monthAvg, 4.7); assert.equal(k.fee, 50);
    await rc.reportChecks({ now: now + 60e3, fetchFn }); assert.equal(calls, 1, "cached for an hour");
  });
  console.log("ok - official report: ranks, change, Friday average and fee from localdata.tools; reviews from Beam; cached");
})().catch((e) => { console.error(e); process.exit(1); });
