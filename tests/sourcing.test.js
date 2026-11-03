import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CalcError, calculate, parseBlockSize, parseMix } from "../src/domain/calc.js";
import { startTestApp } from "./support/testApp.js";

describe("calculator (pure)", () => {
  const item = (r, key) => r.items.find((i) => i.key === key);
  it("concrete 1:2:4 for 1 m3 matches the standard factors", () => {
    const r = calculate({ structure: "Concrete", length: 1, width: 1, height: 1, wastage: 0 });
    assert.equal(item(r, "cement").quantity, 7);                 // 6.34 bags rounded up
    assert.equal(item(r, "sand").quantity, 0.44);
    assert.equal(item(r, "aggregate").quantity, 0.88);
    assert.equal(item(r, "water").quantity, 158);                // 0.5 x 316.8 kg cement
  });
  it("blockwork counts units with joints and sizes mortar from the block", () => {
    const r = calculate({ structure: "Internal Wall", length: 10, height: 3, wastage: 0 }, { name: "Hollow Block 200x200x400", size: "200 X 200 X 400" });
    assert.equal(item(r, "blocks").quantity, 349);               // 30 m2 x 11.61 per m2
    assert.equal(item(r, "cement").quantity, 4);
    assert.equal(item(r, "sand").quantity, 0.53);
    assert.equal(item(r, "blocks").material, "Hollow Block 200x200x400");
  });
  it("wastage raises quantities; slab and mortar work", () => {
    const a = calculate({ structure: "Slab", length: 4, width: 3, height: 0.15, wastage: 0 }).items[0].quantity;
    const b = calculate({ structure: "Slab", length: 4, width: 3, height: 0.15, wastage: 0.1 }).items[0].quantity;
    assert.ok(b > a);
    assert.equal(calculate({ structure: "Mortar", length: 1, width: 1, height: 1, mix: "1:3", wastage: 0 }).items.find((i) => i.key === "sand").quantity, 0.95);
  });
  it("rejects bad input with clear messages", () => {
    const bad = (i, re, blk) => assert.throws(() => calculate(i, blk), (e) => e instanceof CalcError && re.test(e.message));
    bad({ structure: "Roof", length: 1 }, /unknown structure/);
    bad({ structure: "Concrete", length: -1, width: 1, height: 1 }, /length must be/);
    bad({ structure: "Concrete", length: "abc", width: 1, height: 1 }, /length must be/);
    bad({ structure: "Concrete", length: 1, width: 1, height: 1, mix: "1:2" }, /mix must look like/);
    bad({ structure: "Concrete", length: 1, width: 1, height: 1, mix: "2:2:4" }, /1 part cement/);
    bad({ structure: "Concrete", length: 1, width: 1, height: 1, wastage: 2 }, /wastage/);
    bad({ structure: "Internal Wall", length: 1, height: 1 }, /choose a block/);
    assert.deepEqual(parseMix("1:2:4", 3), [1, 2, 4]);
    assert.deepEqual(parseBlockSize("150 X 200 X 400"), { length: 0.4, height: 0.2, thickness: 0.15 });
  });
});


describe("catalog and calculator", () => {
  let t, admin, manager, user, S, kampala, wakiso, gulu;
  before(async () => {
    t = await startTestApp();
    admin = await t.account("a@x.com"); manager = await t.account("m@x.com", "manager", admin); user = await t.account("u@x.com", "user", admin);
    S = (await t.call("GET", "/api/sourcing", null, user)).body;
    const loc = (d) => S.locations.find((l) => l.district === d).id;
    kampala = loc("Kampala"); wakiso = loc("Wakiso"); gulu = loc("Gulu");
  });
  after(() => t.close());

  it("is seeded with every district, 15 materials and sample Kampala rates; users can read it", () => {
    assert.equal(S.locations.length, 114); assert.equal(S.materials.length, 15); assert.equal(S.rates.length, 8);
    assert.deepEqual([...new Set(S.locations.map((l) => l.region))].sort(), ["Central", "Eastern", "Northern", "Western"]);
    assert.equal(typeof S.locations[0].id, "string");
  });
  it("seeding is safe to repeat", async () => {
    const { seedIfEmpty } = await import("../src/seed.js");
    await seedIfEmpty(t.db); await seedIfEmpty(t.db);
    assert.equal((await t.db.query("SELECT COUNT(*) AS n FROM locations"))[0].n, 114);
    assert.equal((await t.db.query("SELECT COUNT(*) AS n FROM materials"))[0].n, 15);
  });
  it("admin writes the catalog directly; validation and uniqueness hold", async () => {
    const sup = await t.call("POST", "/api/suppliers", { name: "Hima Depot", phone: "0700000000", location_id: kampala }, admin);
    assert.equal(sup.status, 201);
    const cement = S.materials.find((m) => m.name === "Cement");
    const rate = await t.call("POST", "/api/rates", { material: cement.id, supplier: sup.body.id, location_id: kampala, price: "33000" }, admin);
    assert.equal(rate.status, 201); assert.equal(rate.body.price, 33000);
    assert.equal((await t.call("POST", "/api/rates", { material: cement.id, location_id: kampala, price: -5 }, admin)).status, 400);
    assert.equal((await t.call("POST", "/api/rates", { material: "nope", location_id: kampala, price: 5 }, admin)).status, 400);
    assert.equal((await t.call("POST", "/api/materials", { name: "Cement", unit: "bags" }, admin)).status, 400);
    assert.equal((await t.call("PATCH", `/api/rates/${rate.body.id}`, { price: 34000 }, admin)).body.price, 34000);
    assert.equal((await t.call("DELETE", `/api/suppliers/${sup.body.id}`, null, admin)).status, 200);
    assert.equal((await t.call("GET", `/api/rates/${rate.body.id}`, null, user)).body.supplier, null);   // rate kept, supplier cleared
    const audit = (await t.call("GET", "/api/audit?entity=rates", null, admin)).body.items;
    assert.ok(audit.some((a) => a.action === "update" && a.changes.price[0] === 33000 && a.changes.price[1] === 34000));
    await t.call("DELETE", `/api/rates/${rate.body.id}`, null, admin);
  });
  it("calculates and prices: district, then region, then anywhere", async () => {
    const q = (extra, tok = user) => t.call("POST", "/api/quantities", { structure: "Concrete", length: 1, width: 1, height: 1, wastage: 0, ...extra }, tok);
    const k = (await q({ location_id: kampala })).body;
    assert.equal(k.total, 7 * 36000 + 26400 + 96800); assert.equal(k.unpriced, 0);
    assert.equal(k.items.find((i) => i.key === "cement").rate_scope, "district");
    assert.equal(k.items.find((i) => i.key === "water").rate, null);
    assert.equal((await q({ location_id: wakiso })).body.items.find((i) => i.key === "cement").rate_scope, "region");
    assert.equal((await q({ location_id: gulu })).body.items.find((i) => i.key === "cement").rate_scope, "anywhere");
    assert.equal((await q({})).body.total, k.total);
    assert.equal((await q({ location_id: "nope" })).status, 400);
    const wall = await t.call("POST", "/api/quantities", { structure: "Internal Wall", length: 10, height: 3, wastage: 0, block: "Hollow Block 200x200x400", location_id: kampala }, user);
    assert.equal(wall.status, 200); assert.equal(wall.body.items[0].quantity, 349); assert.equal(wall.body.items[0].total, 349 * 2800);
    assert.equal((await t.call("POST", "/api/quantities", { structure: "Internal Wall", length: 10, height: 3, block: "Gold Bricks" }, user)).status, 400);
    assert.equal((await t.call("POST", "/api/quantities", { structure: "Concrete", length: 0, width: 1, height: 1 }, user)).status, 400);
    assert.deepEqual((await t.call("GET", "/api/structures", null, user)).body.map((s) => s.name), ["Internal Wall", "Foundation", "Concrete", "Slab", "Mortar"]);
  });
});

describe("catalog suggestions need admin approval", () => {
  let t, admin, user, other;
  before(async () => { t = await startTestApp(); admin = await t.account("a@x.com"); user = await t.account("u@x.com", "user", admin); other = await t.account("o@x.com", "user", admin); });
  after(() => t.close());
  const mats = async () => (await t.call("GET", "/api/materials", null, admin)).body.length;

  it("a user's suggestion waits as pending and is not in the catalog", async () => {
    const before = await mats();
    const r = await t.call("POST", "/api/proposals", { kind: "material", payload: { name: "Steel Mesh", unit: "sheets", category: "Steel" } }, user);
    assert.equal(r.status, 201); assert.equal(r.body.status, "pending"); assert.equal(r.body.payload.name, "Steel Mesh");
    assert.equal(await mats(), before);
    assert.equal((await t.call("GET", "/api/proposals", null, user)).body.length, 1);
    assert.equal((await t.call("GET", "/api/proposals", null, other)).body.length, 0);                 // only your own
    assert.equal((await t.call("GET", "/api/proposals?status=pending", null, admin)).body.length, 1);  // admin sees all
  });
  it("an admin approves it: the real record appears, owned by the submitter, and it cannot be decided twice", async () => {
    const [p] = (await t.call("GET", "/api/proposals?status=pending", null, admin)).body;
    assert.equal((await t.call("POST", `/api/proposals/${p.id}/approve`, {}, user)).status, 403);
    const done = await t.call("POST", `/api/proposals/${p.id}/approve`, { note: "ok" }, admin);
    assert.equal(done.status, 200); assert.equal(done.body.status, "approved"); assert.ok(done.body.result_id);
    const made = (await t.call("GET", `/api/materials/${done.body.result_id}`, null, user)).body;
    assert.equal(made.name, "Steel Mesh"); assert.equal(made.created_by, p.submitted_by);
    assert.equal((await t.call("POST", `/api/proposals/${p.id}/approve`, {}, admin)).status, 409);
    assert.equal((await t.call("POST", `/api/proposals/${p.id}/reject`, {}, admin)).status, 409);
  });
  it("rejects duplicates and bad input up front; rejection keeps the catalog unchanged", async () => {
    assert.equal((await t.call("POST", "/api/proposals", { kind: "material", payload: { name: "cement", unit: "bags" } }, user)).status, 409);
    assert.equal((await t.call("POST", "/api/proposals", { kind: "location", payload: { region: "central", district: "KAMPALA" } }, user)).status, 409);
    assert.equal((await t.call("POST", "/api/proposals", { kind: "material", payload: { name: "No unit" } }, user)).status, 400);
    assert.equal((await t.call("POST", "/api/proposals", { kind: "banana", payload: {} }, user)).status, 400);
    assert.equal((await t.call("POST", "/api/proposals", { kind: "supplier", payload: { name: "S", location_id: "nope" } }, user)).status, 400);
    const p = (await t.call("POST", "/api/proposals", { kind: "location", payload: { region: "Central", district: "Newtown" } }, user)).body;
    const before = (await t.call("GET", "/api/locations", null, admin)).body.length;
    const rej = await t.call("POST", `/api/proposals/${p.id}/reject`, { note: "not a district" }, admin);
    assert.equal(rej.body.status, "rejected"); assert.equal(rej.body.review_note, "not a district");
    assert.equal((await t.call("GET", "/api/locations", null, admin)).body.length, before);
  });
  it("suppliers and locations go through the same flow", async () => {
    const loc = (await t.call("POST", "/api/proposals", { kind: "location", payload: { region: "Central", district: "Newtown" } }, user)).body;
    const l = (await t.call("POST", `/api/proposals/${loc.id}/approve`, {}, admin)).body.result_id;
    const sup = (await t.call("POST", "/api/proposals", { kind: "supplier", payload: { name: "New Cement Depot", phone: "0700", location_id: l } }, user)).body;
    const made = (await t.call("POST", `/api/proposals/${sup.id}/approve`, {}, admin)).body.result_id;
    assert.equal((await t.call("GET", `/api/suppliers/${made}`, null, user)).body.location_id, l);
  });
  it("a duplicate that appeared while pending cannot be approved; users can withdraw their pending ones", async () => {
    const p = (await t.call("POST", "/api/proposals", { kind: "material", payload: { name: "Gravel", unit: "m3" } }, user)).body;
    await t.call("POST", "/api/materials", { name: "Gravel", unit: "m3" }, admin);
    assert.equal((await t.call("POST", `/api/proposals/${p.id}/approve`, {}, admin)).status, 409);
    const q = (await t.call("POST", "/api/proposals", { kind: "material", payload: { name: "Rebar", unit: "bars" } }, user)).body;
    assert.equal((await t.call("DELETE", `/api/proposals/${q.id}`, null, other)).status, 404);
    assert.equal((await t.call("DELETE", `/api/proposals/${q.id}`, null, user)).status, 200);
  });
  it("an admin's own suggestion is approved immediately; every step is audited", async () => {
    const r = await t.call("POST", "/api/proposals", { kind: "material", payload: { name: "Binding Wire", unit: "kg" } }, admin);
    assert.equal(r.body.status, "approved");
    assert.ok((await t.call("GET", "/api/materials", null, user)).body.some((m) => m.name === "Binding Wire"));
    const actions = (await t.call("GET", "/api/audit?entity=proposals&limit=100", null, admin)).body.items.map((i) => i.action);
    for (const a of ["propose", "approve", "reject", "withdraw"]) assert.ok(actions.includes(a), a);
  });
});

describe("contact form and inbox", () => {
  let t, admin, manager, user;
  before(async () => { t = await startTestApp(); admin = await t.account("a@x.com"); manager = await t.account("m@x.com", "manager", admin); user = await t.account("u@x.com", "user", admin); });
  after(() => t.close());
  const send = (b) => t.call("POST", "/api/contact", { name: "Joan", email: "joan@site.com", message: "Please quote a 3-bedroom house", ...b });
  it("stores public messages; managers read and triage them", async () => {
    assert.equal((await send({ phone: "0772000000" })).status, 201);
    const inbox = (await t.call("GET", "/api/messages", null, manager)).body;
    assert.equal(inbox.length, 1); assert.equal(inbox[0].status, "new"); assert.equal(inbox[0].phone, "0772000000");
    assert.equal((await t.call("GET", "/api/messages")).status, 401); assert.equal((await t.call("GET", "/api/messages", null, user)).status, 403);
    assert.equal((await t.call("PATCH", `/api/messages/${inbox[0].id}`, { status: "read" }, manager)).body.status, "read");
    assert.equal((await t.call("PATCH", `/api/messages/${inbox[0].id}`, { status: "bogus" }, manager)).status, 400);
  });
  it("rejects bad input, ignores bots, rate-limits, and only admins delete", async () => {
    assert.equal((await send({ email: "nope" })).status, 400); assert.equal((await send({ name: "" })).status, 400); assert.equal((await send({ message: "hi" })).status, 400);
    const n = (await t.call("GET", "/api/messages", null, admin)).body.length;
    assert.equal((await send({ website: "http://spam" })).status, 201);
    assert.equal((await t.call("GET", "/api/messages", null, admin)).body.length, n);
    let last; for (let i = 0; i < 8; i++) last = await send({});
    assert.equal(last.status, 429);
    const [m] = (await t.call("GET", "/api/messages", null, admin)).body;
    assert.equal((await t.call("DELETE", `/api/messages/${m.id}`, null, manager)).status, 403);
    assert.equal((await t.call("DELETE", `/api/messages/${m.id}`, null, admin)).status, 200);
  });
});
