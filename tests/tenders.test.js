import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createWorldBankProvider, normalize, toDate } from "../src/tenders/worldbank.js";
import { startTestApp } from "./support/testApp.js";

// A response shaped like the World Bank API: notices keyed by id (arrays are handled too).
const NOTICES = {
  OP001: { id: "OP001", bid_description: "Construction of Water Supply Scheme", notice_type: "Invitation for Bids", project_ctry_name: "Uganda", project_name: "Water Project",
    contact_organization: "Ministry of Water", submission_deadline_date: "2026-12-31T00:00:00Z", noticedate: "2026-10-01", procurement_method_name: "National Competitive Bidding", bid_reference_no: "UG-1" },
  OP002: { id: "OP002", bid_description: "Supply of laptops", notice_type: "Invitation for Bids", project_ctry_name: "Kenya", noticedate: "2026-10-05" },
  OP003: { id: "OP003", bid_description: "Road works", notice_type: "Contract Award", contact_ctry_name: "Uganda", noticedate: "February 03, 2026" },
};
function fakeFetch(body = { total: 3, procnotices: NOTICES }, status = 200) {
  const calls = [];
  const f = async (url) => { calls.push(String(url)); return { ok: status === 200, status, json: async () => body }; };
  f.calls = calls; return f;
}

describe("World Bank provider", () => {
  it("normalises notices, filters by country, sorts newest first and builds a link", async () => {
    const f = fakeFetch();
    const r = await createWorldBankProvider({ fetchImpl: f }).search({ q: "water", country: "Uganda" });
    assert.deepEqual(r.items.map((t) => t.external_id), ["OP001", "OP003"]);   // Kenya removed; newest first (Oct before Feb)
    const t = r.items[0];
    assert.equal(t.title, "Construction of Water Supply Scheme"); assert.equal(t.buyer, "Ministry of Water"); assert.equal(t.deadline, "2026-12-31");
    assert.equal(t.country, "Uganda"); assert.equal(t.type, "Invitation for Bids"); assert.match(t.url, /procurement-detail\/OP001$/);
    const url = new URL(f.calls[0]);
    assert.equal(url.searchParams.get("format"), "json"); assert.equal(url.searchParams.get("qterm"), "Uganda water"); assert.equal(url.searchParams.get("rows"), "50");
  });
  it("accepts an array response, missing fields and odd dates", async () => {
    const r = await createWorldBankProvider({ fetchImpl: fakeFetch({ total: "2", procnotices: [{ id: "A" }, { notice_id: "B", notice_title: "T" }, null] }) }).search({});
    assert.equal(r.total, 2); assert.deepEqual(r.items.map((t) => t.external_id).sort(), ["A", "B"]); assert.equal(r.items.find((t) => t.external_id === "A").title, "(no title)");
    assert.equal(toDate("February 03, 2026"), "2026-02-03"); assert.equal(toDate("2026-02-03T10:00:00Z"), "2026-02-03"); assert.equal(toDate("nonsense"), null); assert.equal(toDate(null), null);
    assert.equal(normalize({ id: "X" }).url.endsWith("/X"), true);
  });
  it("reports failures in plain words", async () => {
    await assert.rejects(createWorldBankProvider({ fetchImpl: fakeFetch({}, 500) }).search({}), /returned an error \(500\)/);
    await assert.rejects(createWorldBankProvider({ fetchImpl: async () => { throw new Error("offline"); } }).search({}), /did not answer/);
  });
});

describe("tender search and pipeline over HTTP", () => {
  let t, admin, manager, user, fetchStub;
  before(async () => {
    fetchStub = fakeFetch();
    t = await startTestApp({ tenders: [createWorldBankProvider({ fetchImpl: fetchStub })] });
    admin = await t.account("a@x.com"); manager = await t.account("m@x.com", "manager", admin); user = await t.account("u@x.com", "user", admin);
  });
  after(() => t.close());

  it("only staff can search; sources are listed", async () => {
    assert.equal((await t.call("GET", "/api/tenders/search?country=Uganda", null, user)).status, 403);
    assert.equal((await t.call("GET", "/api/tenders/search")).status, 401);
    assert.equal((await t.call("GET", "/api/tenders/sources", null, manager)).body[0].id, "worldbank");
  });
  it("returns live results, and caches identical searches", async () => {
    const r = await t.call("GET", "/api/tenders/search?q=water&country=Uganda", null, manager);
    assert.equal(r.status, 200); assert.equal(r.body.items.length, 2); assert.equal(r.body.items[0].pipeline_id, null); assert.equal(r.body.has_more, false);
    const calls = fetchStub.calls.length;
    await t.call("GET", "/api/tenders/search?q=water&country=Uganda", null, manager);
    assert.equal(fetchStub.calls.length, calls);                         // second one came from memory
    assert.equal((await t.call("GET", "/api/tenders/search?source=nope", null, manager)).status, 400);
  });
  it("saving a notice puts it in the pipeline; it is flagged in later searches; duplicates are refused", async () => {
    const hit = (await t.call("GET", "/api/tenders/search?q=water&country=Uganda", null, manager)).body.items[0];
    const { pipeline_id, pipeline_status, ...notice } = hit;
    const saved = await t.call("POST", "/api/tenders", notice, manager);
    assert.equal(saved.status, 201); assert.equal(saved.body.status, "saved"); assert.equal(saved.body.deadline, "2026-12-31");
    const again = (await t.call("GET", "/api/tenders/search?q=water&country=Uganda", null, manager)).body.items[0];
    assert.equal(again.pipeline_id, saved.body.id); assert.equal(again.pipeline_status, "saved");
    assert.equal((await t.call("POST", "/api/tenders", notice, manager)).status, 400);                       // same notice twice
  });
  it("tracks a tender through its stages; manual entries; rights; audit", async () => {
    const manual = await t.call("POST", "/api/tenders", { title: "Construction of Health Centre III", buyer: "Mukono District", deadline: "2026-11-15", url: "https://egpuganda.go.ug/" }, manager);
    assert.equal(manual.body.source, "manual"); assert.equal(manual.body.external_id, null);
    assert.equal((await t.call("POST", "/api/tenders", { title: "Another manual" }, manager)).status, 201);  // several manual rows are fine
    const id = manual.body.id;
    assert.equal((await t.call("PATCH", `/api/tenders/${id}`, { status: "bidding", notes: "Site visit on Friday" }, manager)).body.status, "bidding");
    assert.equal((await t.call("PATCH", `/api/tenders/${id}`, { status: "maybe" }, manager)).status, 400);
    assert.equal((await t.call("POST", "/api/tenders", { title: "x", deadline: "tomorrow" }, manager)).status, 400);
    assert.equal((await t.call("POST", "/api/tenders", { title: "nope" }, user)).status, 403);
    const viewer = await t.account("v@x.com", "viewer", admin);
    assert.equal((await t.call("GET", "/api/tenders", null, viewer)).status, 200); assert.equal((await t.call("POST", "/api/tenders", { title: "no" }, viewer)).status, 403);
    const ch = (await t.call("GET", "/api/audit?entity=tenders", null, admin)).body.items.find((i) => i.action === "update");
    assert.deepEqual(ch.changes.status, ["saved", "bidding"]);
    assert.equal((await t.call("DELETE", `/api/tenders/${id}`, null, manager)).status, 200);
  });
  it("saved searches are shared among staff", async () => {
    const s = await t.call("POST", "/api/tender_searches", { name: "Water works in Uganda", keywords: "water borehole", country: "Uganda", source: "worldbank" }, manager);
    assert.equal(s.status, 201);
    assert.equal((await t.call("GET", "/api/tender_searches", null, admin)).body.length, 1);
    assert.equal((await t.call("POST", "/api/tender_searches", { keywords: "x" }, manager)).status, 400);     // name required
  });
  it("a failing source gives a clear 502, not a crash", async () => {
    const down = await startTestApp({ tenders: [createWorldBankProvider({ fetchImpl: fakeFetch({}, 503) })] });
    const a = await down.account("a@x.com");
    const r = await down.call("GET", "/api/tenders/search?q=x", null, a);
    assert.equal(r.status, 502); assert.match(r.body.error, /World Bank/);
    await down.close();
  });
});
