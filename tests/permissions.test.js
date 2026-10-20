import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ALL_PERMISSIONS, can, permissionsOf } from "../src/auth/permissions.js";
import { startTestApp } from "./support/testApp.js";

describe("permission matrix", () => {
  it("admin has every right; others only their own", () => {
    for (const p of ALL_PERMISSIONS) assert.ok(can("admin", p), p);
    assert.ok(can("user", "catalog:read") && can("user", "catalog:propose") && can("user", "boq:use"));
    assert.ok(!can("user", "catalog:write") && !can("user", "projects:read") && !can("user", "proposals:review"));
    assert.ok(can("viewer", "projects:read") && !can("viewer", "projects:write"));
    assert.ok(can("manager", "projects:write") && can("manager", "audit:read") && !can("manager", "catalog:write") && !can("manager", "users:manage"));
    assert.deepEqual(permissionsOf("nobody"), []);
  });
});

describe("rights enforced over HTTP", () => {
  let t, tok, material, location;
  before(async () => {
    t = await startTestApp();
    const admin = await t.account("admin@x.com");
    tok = { admin, manager: await t.account("m@x.com", "manager", admin), viewer: await t.account("v@x.com", "viewer", admin), user: await t.account("u@x.com", "user", admin) };
    const s = (await t.call("GET", "/api/sourcing", null, admin)).body; material = s.materials[0].id; location = s.locations[0].id;
  });
  after(() => t.close());

  // [role, method, path, body, expected status]
  const project = { name: "P" };
  const cases = [
    ["user", "GET", "/api/sourcing", null, 200], ["user", "GET", "/api/materials", null, 200], ["user", "POST", "/api/quantities", { structure: "Concrete", length: 1, width: 1, height: 1 }, 200],
    ["user", "POST", "/api/materials", { name: "X", unit: "u" }, 403], ["user", "PATCH", "/api/materials/x", { name: "Y" }, 403], ["user", "DELETE", "/api/materials/x", null, 403],
    ["user", "POST", "/api/rates", { material: "m", location_id: "l", price: 1 }, 403], ["user", "POST", "/api/suppliers", { name: "S" }, 403], ["user", "POST", "/api/locations", { region: "R", district: "D" }, 403],
    ["user", "GET", "/api/data", null, 403], ["user", "GET", "/api/projects", null, 403], ["user", "GET", "/api/summary", null, 403], ["user", "GET", "/api/files", null, 403],
    ["user", "GET", "/api/audit", null, 403], ["user", "GET", "/api/users", null, 403], ["user", "GET", "/api/messages", null, 403],
    ["user", "GET", "/api/boq/jobs", null, 200], ["user", "GET", "/api/boq/rates", null, 403], ["user", "POST", "/api/proposals/x/approve", {}, 403],
    ["viewer", "GET", "/api/data", null, 200], ["viewer", "GET", "/api/summary", null, 200], ["viewer", "POST", "/api/projects", project, 403], ["viewer", "GET", "/api/audit", null, 403],
    ["viewer", "POST", "/api/materials", { name: "X", unit: "u" }, 403], ["viewer", "GET", "/api/export", null, 403],
    ["manager", "POST", "/api/projects", project, 201], ["manager", "GET", "/api/audit", null, 200], ["manager", "GET", "/api/messages", null, 200], ["manager", "GET", "/api/export", null, 200],
    ["manager", "POST", "/api/materials", { name: "X", unit: "u" }, 403], ["manager", "GET", "/api/users", null, 403], ["manager", "DELETE", "/api/messages/x", null, 403], ["manager", "GET", "/api/boq/rates", null, 403],
    ["admin", "POST", "/api/materials", { name: "Steel Mesh", unit: "sheets" }, 201], ["admin", "GET", "/api/users", null, 200], ["admin", "GET", "/api/boq/rates", null, 503],   // 503: no BOQ service is running in this test
  ];
  for (const [role, method, path, body, want] of cases) {
    it(`${role} ${method} ${path} -> ${want}`, async () => { assert.equal((await t.call(method, path, body, tok[role])).status, want); });
  }
  it("catalog IDs are real for the admin-only writes (positive control)", async () => {
    assert.equal((await t.call("POST", "/api/rates", { material, location_id: location, price: 10 }, tok.admin)).status, 201);
    assert.equal((await t.call("POST", "/api/rates", { material, location_id: location, price: 10 }, tok.manager)).status, 403);
  });
  it("nobody anonymous gets in, and unknown paths and methods are handled", async () => {
    assert.equal((await t.call("GET", "/api/sourcing")).status, 401);
    assert.equal((await t.call("GET", "/api/nothing", null, tok.admin)).status, 404);
    assert.equal((await t.call("PUT", "/api/projects", {}, tok.admin)).status, 405);
  });
});
