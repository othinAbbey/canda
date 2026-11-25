import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";
import { createSqliteDb } from "./support/sqliteDb.js";
import { migrate } from "../src/db/migrate.js";
import { createRoles } from "../src/services/roles.js";
import { rolesRepo } from "../src/repos/roles.js";

const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

describe("tender pipeline is private to each company", () => {
  let t, a, b;
  before(async () => { t = await startTestApp(); a = await t.account("boss@alpha.test"); b = await t.account("boss@beta.test"); });
  after(() => t.close());

  it("each company sees, totals and changes only its own tenders; both can save the same notice", async () => {
    const mine = await t.call("POST", "/api/tenders", { title: "Alpha bid: Yumbe office", value: 500000000, currency: "UGX", status: "bidding" }, a);
    assert.equal(mine.status, 201);
    const same = { title: "WB notice", source: "worldbank", external_id: "OP000123" };
    assert.equal((await t.call("POST", "/api/tenders", same, a)).status, 201);
    assert.equal((await t.call("POST", "/api/tenders", same, b)).status, 201);              // used to collide across companies
    assert.equal((await t.call("POST", "/api/tenders", same, a)).status, 400);              // still unique within a company
    assert.deepEqual((await t.call("GET", "/api/tenders", null, b)).body.map((x) => x.title), ["WB notice"]);
    assert.equal((await t.call("GET", `/api/tenders/${mine.body.id}`, null, b)).status, 404);
    assert.equal((await t.call("PATCH", `/api/tenders/${mine.body.id}`, { status: "lost" }, b)).status, 404);
    assert.equal((await t.call("GET", "/api/tenders/summary", null, b)).body.open.UGX ?? 0, 0);
    assert.equal((await t.call("GET", "/api/tenders/summary", null, a)).body.open.UGX, 500000000);
    await t.call("POST", "/api/tender_searches", { name: "Alpha search", keywords: "water" }, a);
    assert.deepEqual((await t.call("GET", "/api/tender_searches", null, b)).body, []);
  });

  it("tasks can only go to your own project managers, and stay inside the company", async () => {
    const pm = await t.account("pm@alpha.test", "manager", a);
    const rivalPm = await t.account("pm@beta.test", "manager", b);
    const team = (await t.call("GET", "/api/team?role=manager", null, a)).body.map((p) => p.email);
    assert.deepEqual(team, ["pm@alpha.test"]);
    const [tender] = (await t.call("GET", "/api/tenders", null, a)).body;
    const rivalId = (await t.call("GET", "/api/me", null, rivalPm)).body.id, pmId = (await t.call("GET", "/api/me", null, pm)).body.id;
    assert.equal((await t.call("POST", `/api/tenders/${tender.id}/tasks`, { title: "Bid", assignee: rivalId }, a)).status, 400);
    assert.equal((await t.call("POST", `/api/tenders/${tender.id}/tasks`, { title: "Bid", assignee: pmId }, b)).status, 404);
    const task = await t.call("POST", `/api/tenders/${tender.id}/tasks`, { title: "Bid", assignee: pmId }, a);
    assert.equal(task.status, 201);
    assert.deepEqual((await t.call("GET", "/api/tender_tasks", null, b)).body, []);
    assert.equal((await t.call("PATCH", `/api/tender_tasks/${task.body.id}`, { status: "done" }, b)).status, 404);
  });
});

describe("subcontracts marketplace", () => {
  let t, a, aViewer, b, c, sub, avail;
  before(async () => {
    t = await startTestApp();
    a = await t.account("boss@alpha.test"); aViewer = await t.account("view@alpha.test", "viewer", a);
    b = await t.account("boss@beta.test"); c = await t.account("boss@gamma.test");
  });
  after(() => t.close());

  it("a company posts a subcontract and an availability; every company sees them", async () => {
    const r = await t.call("POST", "/api/market/listings", { kind: "subcontract", title: "Roofing for 3 classroom blocks", trade: "Roofing", region: "Northern", district: "Gulu",
      start_date: future(20), end_date: future(60), deadline: future(10), value: 45000000, description: "Supply and fix IT4 sheets", contact_phone: "0772000000" }, a);
    assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.company_name, "boss@alpha.test company"); assert.equal(r.body.own, true);
    sub = r.body;
    const v = await t.call("POST", "/api/market/listings", { kind: "availability", title: "Steel fixing team free from next month", trade: "Steel fixing", crew_size: 8, equipment: "Bar benders" }, b);
    assert.equal(v.status, 201); assert.equal(v.body.contact_email, "boss@beta.test");          // falls back to the poster's email
    avail = v.body;
    const seen = (await t.call("GET", "/api/market/listings?kind=subcontract", null, c)).body;
    assert.equal(seen.length, 1); assert.equal(seen[0].own, false); assert.equal(seen[0].contact_phone, "0772000000"); assert.equal(seen[0].responses, undefined);
    assert.equal((await t.call("GET", "/api/market/listings?trade=Steel%20fixing", null, aViewer)).body.length, 1);   // viewers can browse
    assert.equal((await t.call("GET", "/api/market/listings?q=gulu", null, c)).body.length, 1);
  });

  it("validates listings and needs the posting right", async () => {
    for (const body of [{ kind: "x", title: "t", trade: "Roofing" }, { kind: "subcontract", title: "", trade: "Roofing" }, { kind: "subcontract", title: "t", trade: "Juggling" },
      { kind: "subcontract", title: "t", trade: "Roofing", deadline: "2020-01-01" }, { kind: "subcontract", title: "t", trade: "Roofing", start_date: future(9), end_date: future(2) }])
      assert.equal((await t.call("POST", "/api/market/listings", body, a)).status, 400, JSON.stringify(body));
    assert.equal((await t.call("POST", "/api/market/listings", { kind: "subcontract", title: "t", trade: "Roofing" }, aViewer)).status, 403);
    assert.equal((await t.call("GET", "/api/market/listings")).status, 401);
  });

  it("only the owner edits, closes or deletes a listing", async () => {
    assert.equal((await t.call("PATCH", `/api/market/listings/${sub.id}`, { title: "hijacked" }, b)).status, 404);
    assert.equal((await t.call("DELETE", `/api/market/listings/${sub.id}`, null, c)).status, 404);
    assert.equal((await t.call("PATCH", `/api/market/listings/${sub.id}`, { value: 50000000 }, a)).body.value, 50000000);
  });

  it("other companies apply; only the poster and the applicant see an application", async () => {
    assert.equal((await t.call("POST", `/api/market/listings/${sub.id}/responses`, { message: "We roofed 12 schools", contact_phone: "0700" }, a)).status, 400);   // own listing
    const appB = await t.call("POST", `/api/market/listings/${sub.id}/responses`, { message: "We can start in 2 weeks", price: 42000000, contact_phone: "0701111111" }, b);
    assert.equal(appB.status, 201, JSON.stringify(appB.body));
    const appC = await t.call("POST", `/api/market/listings/${sub.id}/responses`, { message: "Team of 10 roofers", contact_email: "jobs@gamma.test" }, c);
    assert.equal(appC.status, 201);
    assert.equal((await t.call("POST", `/api/market/listings/${sub.id}/responses`, { message: "no contact" }, c)).status, 400);
    const again = await t.call("POST", `/api/market/listings/${sub.id}/responses`, { message: "Updated offer", price: 40000000, contact_phone: "0701111111" }, b);
    assert.equal(again.body.id, appB.body.id); assert.equal(again.body.price, 40000000);          // second send edits, no duplicate

    const owner = (await t.call("GET", `/api/market/listings/${sub.id}`, null, a)).body;
    assert.equal(owner.response_list.length, 2); assert.deepEqual(owner.responses, { n: 2, unread: 2 });
    const asB = (await t.call("GET", `/api/market/listings/${sub.id}`, null, b)).body;
    assert.equal(asB.response_list, undefined); assert.equal(asB.my_response.message, "Updated offer");
    assert.equal((await t.call("GET", "/api/market/responses", null, c)).body.length, 1);
    assert.equal((await t.call("GET", "/api/market/responses", null, c)).body[0].message, "Team of 10 roofers");

    assert.equal((await t.call("PATCH", `/api/market/responses/${appB.body.id}`, { status: "accepted" }, c)).status, 404);   // a third company
    assert.equal((await t.call("PATCH", `/api/market/responses/${appB.body.id}`, { status: "accepted" }, b)).status, 400);   // applicant cannot accept itself
    assert.equal((await t.call("PATCH", `/api/market/responses/${appB.body.id}`, { status: "shortlisted" }, a)).body.status, "shortlisted");
    assert.equal((await t.call("PATCH", `/api/market/responses/${appC.body.id}`, { status: "withdrawn" }, c)).body.status, "withdrawn");
    assert.equal((await t.call("PATCH", `/api/market/responses/${appC.body.id}`, { status: "accepted" }, a)).status, 400);
    assert.equal((await t.call("PATCH", `/api/market/responses/${appB.body.id}`, { status: "accepted" }, a)).body.status, "accepted");
    assert.equal((await t.call("PATCH", `/api/market/responses/${appB.body.id}`, { message: "change" }, b)).status, 409);
  });

  it("companies contact an available subcontractor; closed listings leave the public list", async () => {
    const inv = await t.call("POST", `/api/market/listings/${avail.id}/responses`, { message: "Need 8 steel fixers in Gulu for 6 weeks", contact_phone: "0772000000" }, a);
    assert.equal(inv.status, 201);
    assert.equal((await t.call("GET", `/api/market/listings/${avail.id}`, null, b)).body.response_list.length, 1);
    await t.call("PATCH", `/api/market/listings/${sub.id}`, { status: "awarded" }, a);
    assert.equal((await t.call("GET", "/api/market/listings?kind=subcontract", null, c)).body.length, 0);
    assert.equal((await t.call("GET", "/api/market/listings?mine=1", null, a)).body.length, 1);           // still in My listings
    assert.equal((await t.call("POST", `/api/market/listings/${sub.id}/responses`, { message: "late", contact_phone: "1" }, c)).status, 400);
  });
});

describe("new rights reach roles saved before they existed", () => {
  it("adds the marketplace rights once, keeps admin edits afterwards", async () => {
    const db = createSqliteDb(); await migrate(db);
    const repo = rolesRepo(db), audit = { log: async () => {} };
    await repo.insert({ code: "manager", name: "Project Manager", description: null, permissions: ["projects:read"], builtin: true });   // as saved by an older version
    const roles = createRoles({ repo, audit });
    await roles.ensureBuiltIns();
    assert.ok(roles.permissionsOf("manager").includes("market:post"));
    assert.ok(roles.permissionsOf("viewer").includes("market:read"));
    await repo.update("manager", { name: "Project Manager", description: null, permissions: ["projects:read"] });                 // an admin removes it again
    await roles.ensureBuiltIns();
    assert.ok(!roles.permissionsOf("manager").includes("market:post"));
    db.close();
  });
});
