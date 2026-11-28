import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";
import { eligibleTender, headlineOk, kampalaDay, shorten } from "../src/domain/social.js";

const day = (n) => new Date(Date.now() + 3 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const NOTICES = [
  { source: "fake", external_id: "N1", title: "Construction of a staff house at Gulu Health Centre III", buyer: "Gulu District", country: "Uganda", deadline: day(20), published: day(-1), url: "https://example.org/n1" },
  { source: "fake", external_id: "N2", title: "Rehabilitation of 3 classroom blocks in Mbale", buyer: "Ministry of Education", country: "Uganda", deadline: day(30), published: day(-2), url: "https://example.org/n2" },
  { source: "fake", external_id: "N3", title: "Construction of a borehole in Lira", buyer: "Lira DLG", country: "Uganda", deadline: day(1), published: day(-1) },          // closes too soon
  { source: "fake", external_id: "N4", title: "Road works contract award, Masaka", type: "Contract Award", country: "Uganda", published: day(-1) },                     // an award
  { source: "fake", external_id: "N5", title: "Supply of laptops", country: "Uganda", deadline: day(20), published: day(-1) },                                        // not works
  { source: "fake", external_id: "N6", title: "Upgrading of Kasese market roads", buyer: "Kasese MC", country: "Uganda", deadline: null, published: day(-3) },
];
const provider = { id: "fake", name: "Fake feed", note: "", search: async () => ({ total: NOTICES.length, items: NOTICES }) };

function fakeAi() {
  const ai = { configured: true, calls: 0, answer: null };
  ai.converse = async ({ tools }) => { ai.calls++; return { content: [{ type: "tool_use", name: tools[0].name, input: ai.answer }] }; };
  return ai;
}

describe("daily social posts for the Buildsuite360 team", () => {
  let t, team, viewer, helper, other, ai;
  before(async () => {
    ai = fakeAi();
    t = await startTestApp({ tenders: [provider], ai, env: { BUILDSUITE_TEAM_EMAILS: "Team@Buildsuite.test, helper@buildsuite.test" } });
    team = await t.account("team@buildsuite.test");
    viewer = await t.account("viewer@buildsuite.test", "viewer", team);        // same company, not on the list
    helper = await t.account("helper@buildsuite.test", "viewer", team);        // on the list, with only a viewer role
    other = await t.account("boss@acme.test");
    // another company's listings: one it allows Buildsuite360 to feature, one it doesn't
    const base = { kind: "subcontract", trade: "Roofing", district: "Gulu", region: "Northern", deadline: day(25), value: 45000000, contact_phone: "+256700000001" };
    assert.equal((await t.call("POST", "/api/market/listings", { ...base, title: "Roofing for 3 classroom blocks", feature_social: true }, other)).status, 201);
    assert.equal((await t.call("POST", "/api/market/listings", { ...base, title: "Private plastering job" }, other)).status, 201);
  });
  after(() => t.close());

  it("only the listed emails are the Buildsuite360 team, whatever their role", async () => {
    assert.equal((await t.call("GET", "/api/me", null, team)).body.platform_team, true);    // listed (in any letter case)
    assert.equal((await t.call("GET", "/api/me", null, other)).body.platform_team, false);
    assert.equal((await t.call("GET", "/api/social/posts", null, team)).status, 200);
    assert.equal((await t.call("GET", "/api/social/posts", null, helper)).status, 200);    // a viewer, but listed
    assert.equal((await t.call("GET", "/api/social/posts", null, other)).status, 403);     // an admin, not listed
    assert.equal((await t.call("GET", "/api/social/posts", null, viewer)).status, 403);    // same company, not listed
    assert.equal((await t.call("GET", "/api/social/posts")).status, 401);
  });

  it("without the AI: picks open building tenders and opted-in listings, copies facts, never contact details", async () => {
    ai.configured = false;
    const r = await t.call("POST", "/api/social/posts/generate", {}, team);
    assert.equal(r.status, 201);
    const p = r.body, refs = p.items.map((s) => s.ref);
    assert.equal(p.day, kampalaDay()); assert.equal(p.status, "draft"); assert.equal(p.made_by, "rules");
    assert.ok(refs.includes("fake|N1") && refs.includes("fake|N2") && refs.includes("fake|N6"));
    for (const bad of ["fake|N3", "fake|N4", "fake|N5"]) assert.ok(!refs.includes(bad) && !p.spare.some((s) => s.ref === bad), bad);
    const listing = p.items.find((s) => s.kind === "subcontract");
    assert.equal(listing.headline, "Roofing for 3 classroom blocks"); assert.equal(listing.who, "boss@acme.test company"); assert.equal(listing.value, "UGX 45,000,000");
    assert.ok(!JSON.stringify(p).includes("+256700000001"));
    assert.ok(!JSON.stringify(p).includes("Private plastering"));
    const n1 = p.items.find((s) => s.ref === "fake|N1");
    assert.equal(n1.closes, day(20)); assert.equal(n1.who, "Gulu District"); assert.equal(n1.source_name, "Fake feed");
    assert.match(p.caption, /buildsuite360\.org/);
    // asking again returns the same draft
    assert.equal((await t.call("POST", "/api/social/posts/generate", {}, team)).body.id, p.id);
  });

  it("with the AI: its picks are used, but a headline that adds a number and a caption with numbers are refused", async () => {
    ai.configured = true;
    ai.answer = { picks: [
      { ref: "fake|N2", headline: "Fix 3 classroom blocks in Mbale" },
      { ref: "fake|N1", headline: "Gulu staff house worth UGX 900m" },          // 900 is not in the notice: title used instead
      { ref: "fake|NOPE", headline: "Invented" },                                // not a candidate: ignored
    ], caption: "Over 100 jobs today!" };
    const p = (await t.call("POST", "/api/social/posts/generate", { replace: true }, team)).body;
    assert.equal(p.made_by, "ai");
    assert.deepEqual(p.items.map((s) => s.headline), ["Fix 3 classroom blocks in Mbale", "Construction of a staff house at Gulu Health Centre III"]);
    assert.ok(!/100/.test(p.caption));
  });

  it("a draft is edited from its own slides only, approved, then marked posted, and can't be remade after", async () => {
    const [p] = (await t.call("GET", "/api/social/posts", null, team)).body;
    const spare = p.spare[0];
    assert.equal((await t.call("PATCH", `/api/social/posts/${p.id}`, { items: [{ ref: "fake|N5" }] }, team)).status, 400);
    assert.equal((await t.call("PATCH", `/api/social/posts/${p.id}`, { items: [{ ref: p.items[0].ref, headline: "Win UGX 2bn now" }] }, team)).status, 400);
    const e = await t.call("PATCH", `/api/social/posts/${p.id}`, { items: [{ ref: spare.ref }, { ref: p.items[0].ref, headline: "Classroom blocks, Mbale" }], caption: "Fresh tenders for builders" }, team);
    assert.equal(e.status, 200);
    assert.deepEqual(e.body.items.map((s) => s.ref), [spare.ref, p.items[0].ref]);
    assert.ok(e.body.spare.some((s) => s.ref === p.items[1].ref));
    assert.equal((await t.call("POST", `/api/social/posts/${p.id}/posted`, {}, team)).status, 400);       // approve first
    assert.equal((await t.call("POST", `/api/social/posts/${p.id}/approve`, null, team)).body.status, "approved");
    assert.equal((await t.call("POST", "/api/social/posts/generate", { replace: true }, team)).status, 400);
    // editing an approved post sends it back to draft
    assert.equal((await t.call("PATCH", `/api/social/posts/${p.id}`, { caption: "Fresh tenders for builders today" }, team)).body.status, "draft");
    await t.call("POST", `/api/social/posts/${p.id}/approve`, null, team);
    assert.equal((await t.call("POST", `/api/social/posts/${p.id}/posted`, { url: "javascript:alert(1)" }, team)).status, 400);
    const done = await t.call("POST", `/api/social/posts/${p.id}/posted`, { url: "https://www.tiktok.com/@buildsuite360/video/1" }, team);
    assert.equal(done.body.status, "posted"); assert.ok(done.body.posted_at);
    assert.equal((await t.call("PATCH", `/api/social/posts/${p.id}`, { caption: "x" }, team)).status, 400);
    assert.equal((await t.call("PATCH", `/api/social/posts/${p.id}`, { caption: "x" }, other)).status, 403);
  });

  it("reads a notice photo into advert fields for the team only, copying facts and dropping bad dates", async () => {
    const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]);
    ai.configured = true;
    ai.answer = { notices: [{ notice_type: "Tender", method: "Open domestic bidding", title: "Framework contracts for supplies, services and works", buyer: "The Judiciary",
      reference: "JUD/NCONS/26-27/00760", summary: "65 lots: supplies, services and works", fee: "UGX 100,000", closes_date: "2026-12-17", closes_time: "11:00AM", website: "www.judiciary.go.ug" },
      { notice_type: "Consultancy", title: "Project Coordinator", buyer: "IUCEA", closes_date: "11th December" }], caption: "Suppliers and contractors: the Judiciary wants bids. Check the official notice before you bid." };
    const r = await t.call("POST", "/api/social/read-notice", null, team, png);
    assert.equal(r.status, 200);
    assert.equal(r.body.notices.length, 2);
    assert.equal(r.body.notices[0].reference, "JUD/NCONS/26-27/00760"); assert.equal(r.body.notices[0].closes_date, "2026-12-17");
    assert.equal(r.body.notices[1].closes_date, null);                                  // not a real date: left for the person to fill
    assert.match(r.body.caption, /Judiciary/);
    assert.equal((await t.call("POST", "/api/social/read-notice", null, other, png)).status, 403);
    assert.equal((await t.call("POST", "/api/social/read-notice", null, team, Buffer.from("hello, not a picture"))).status, 400);
    ai.configured = false;
    assert.equal((await t.call("POST", "/api/social/read-notice", null, team, png)).status, 503);
  });

  it("the next day leaves out what was already posted this week", async () => {
    ai.configured = false;
    const next = (await t.call("POST", "/api/social/posts/generate", { day: day(1) }, team)).body;
    const [today] = (await t.call("GET", "/api/social/posts", null, team)).body.filter((x) => x.day === kampalaDay());
    for (const s of today.items) assert.ok(!next.items.some((n) => n.ref === s.ref), s.ref);
  });
});

describe("social post rules", () => {
  it("headlines may shorten but never add numbers", () => {
    const rec = { title: "Rehabilitation of 3 classroom blocks in Mbale" };
    assert.ok(headlineOk("3 classroom blocks, Mbale", rec));
    assert.ok(!headlineOk("5 classroom blocks", rec));
    assert.ok(!headlineOk("", rec));
    assert.ok(!headlineOk("x".repeat(81), rec));
    assert.equal(shorten("a ".repeat(60)).length <= 80, true);
  });
  it("tenders must be works, open at least 3 more days and recent", () => {
    const d = "2026-11-26";
    assert.ok(eligibleTender({ title: "Construction of a school", deadline: "2026-12-10", published: "2026-11-25" }, d));
    assert.ok(!eligibleTender({ title: "Construction of a school", deadline: "2026-11-28" }, d));
    assert.ok(!eligibleTender({ title: "Supply of laptops", deadline: "2026-12-10" }, d));
    assert.ok(!eligibleTender({ title: "Construction of a school", published: "2026-10-01" }, d));
    assert.ok(!eligibleTender({ title: "Consultancy for road design" }, d));
  });
});
