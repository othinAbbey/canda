import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";

const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");

describe("company settings and inbox isolation", () => {
  let t, admin, manager, rival, org, rivalOrg;
  before(async () => {
    t = await startTestApp();
    admin = await t.account("boss@alpha.test"); manager = await t.account("pm@alpha.test", "manager", admin);
    rival = await t.account("boss@beta.test");
    org = (await t.call("GET", "/api/me", null, admin)).body.organization.id;
    rivalOrg = (await t.call("GET", "/api/me", null, rival)).body.organization.id;
  });
  after(() => t.close());

  it("everyone in the company sees its name; only admins change name and logo", async () => {
    const o = (await t.call("GET", "/api/organization", null, manager)).body;
    assert.equal(o.id, org); assert.equal(o.logo_url, null);
    assert.equal((await t.call("PATCH", "/api/organization", { name: "Hacked" }, manager)).status, 403);
    const r = await t.call("PATCH", "/api/organization", { name: "  Alpha Builders  ", logo_url: PNG }, admin);
    assert.equal(r.status, 200); assert.equal(r.body.name, "Alpha Builders"); assert.equal(r.body.logo_url, PNG);
    const me = (await t.call("GET", "/api/me", null, manager)).body;
    assert.equal(me.organization.name, "Alpha Builders"); assert.equal(me.organization.logo_url, PNG);
    assert.equal((await t.call("PATCH", "/api/organization", { logo_url: null }, admin)).body.logo_url, null);
    assert.equal((await t.call("GET", "/api/organization", null, rival)).body.name, "boss@beta.test company");   // the other company is untouched
  });

  it("rejects bad names and anything that is not a small raster image", async () => {
    for (const body of [{ name: "x" }, { logo_url: "https://evil.test/a.png" }, { logo_url: "data:image/svg+xml;base64,PHN2Zz4=" },
      { logo_url: "data:image/png;base64," + Buffer.from("not a png").toString("base64") },
      { logo_url: "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(600 * 1024)]).toString("base64") }])
      assert.equal((await t.call("PATCH", "/api/organization", body, admin)).status, 400, JSON.stringify(body).slice(0, 60));
  });

  it("website messages land in one company's inbox and stay there", async () => {
    assert.equal((await t.call("POST", "/api/contact", { name: "Joan", email: "j@x.com", message: "Quote please", organization: org })).status, 201);
    assert.equal((await t.call("POST", "/api/contact", { name: "Joan", email: "j@x.com", message: "Quote please", organization: "org_nope" })).status, 400);
    const mine = (await t.call("GET", "/api/messages", null, manager)).body;
    assert.equal(mine.length, 1);
    assert.deepEqual((await t.call("GET", "/api/messages", null, rival)).body, []);
    assert.equal((await t.call("PATCH", `/api/messages/${mine[0].id}`, { status: "read" }, rival)).status, 404);
    assert.equal((await t.call("DELETE", `/api/messages/${mine[0].id}`, null, rival)).status, 404);
    assert.equal(rivalOrg !== org, true);
  });
});
