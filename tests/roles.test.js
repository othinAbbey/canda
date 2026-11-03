import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";

describe("roles and access", () => {
  let t, admin, manager, user;
  before(async () => { t = await startTestApp(); admin = await t.account("a@x.com"); manager = await t.account("m@x.com", "manager", admin); user = await t.account("u@x.com", "user", admin); });
  after(() => t.close());
  const roles = async () => (await t.call("GET", "/api/roles", null, admin)).body;
  const idOf = async (tok) => (await t.call("GET", "/api/me", null, tok)).body.id;

  it("starts with the built-in roles, shown with friendly names; only an admin can see or manage them", async () => {
    const list = await roles();
    assert.deepEqual(list.map((r) => r.code).sort(), ["admin", "general_pm", "manager", "user", "viewer"]);
    assert.equal(list.find((r) => r.code === "manager").name, "Project Manager"); assert.equal(list.find((r) => r.code === "general_pm").name, "General Project Manager");
    assert.deepEqual(list.find((r) => r.code === "admin").permissions, ["*"]); assert.ok(list.every((r) => r.builtin));
    assert.equal(list.find((r) => r.code === "manager").users, 1);
    assert.equal((await t.call("GET", "/api/roles", null, manager)).status, 403);
    assert.equal((await t.call("GET", "/api/permissions", null, manager)).status, 403);
    const cat = (await t.call("GET", "/api/permissions", null, admin)).body;
    assert.ok(cat.find((p) => p.key === "tenders:assign").label); assert.equal(cat.find((p) => p.key === "users:manage").adminOnly, true);
    assert.equal((await t.call("GET", "/api/me", null, manager)).body.role_name, "Project Manager");
  });

  it("an admin creates a custom role with chosen rights; invalid roles are refused", async () => {
    const r = await t.call("POST", "/api/roles", { name: "Estimator", description: "Prices tenders", permissions: ["catalog:read", "tenders:read", "tenders:write", "boq:use"] }, admin);
    assert.equal(r.status, 201); assert.equal(r.body.code, "estimator");
    assert.equal((await t.call("POST", "/api/roles", { name: "estimator", permissions: ["catalog:read"] }, admin)).status, 409);
    assert.equal((await t.call("POST", "/api/roles", { name: "Boss", permissions: ["users:manage"] }, admin)).status, 400);          // admin-only right
    assert.equal((await t.call("POST", "/api/roles", { name: "Odd", permissions: ["fly:planes"] }, admin)).status, 400);
    assert.equal((await t.call("POST", "/api/roles", { name: "Empty", permissions: [] }, admin)).status, 400);
    assert.equal((await t.call("POST", "/api/roles", { name: "x", permissions: ["catalog:read"] }, admin)).status, 400);
    assert.equal((await t.call("POST", "/api/roles", { name: "Sneaky", permissions: ["catalog:read"] }, manager)).status, 403);
  });

  it("users get the rights of their role; editing the role changes them at once", async () => {
    const est = (await t.call("POST", "/api/users", { email: "e@x.com", password: "password123", role: "estimator", name: "Esther" }, admin));
    assert.equal(est.status, 201); assert.equal(est.body.role_name, "Estimator");
    const tok = (await t.call("POST", "/api/auth/login", { email: "e@x.com", password: "password123" })).body.token;
    const me = (await t.call("GET", "/api/me", null, tok)).body;
    assert.deepEqual(me.permissions, ["boq:use", "catalog:read", "tenders:read", "tenders:write"]);
    assert.equal((await t.call("GET", "/api/tenders", null, tok)).status, 200);
    assert.equal((await t.call("GET", "/api/data", null, tok)).status, 403);                           // no project rights yet
    assert.equal((await t.call("PATCH", "/api/roles/estimator", { permissions: ["catalog:read", "tenders:read", "projects:read"] }, admin)).status, 200);
    assert.equal((await t.call("GET", "/api/data", null, tok)).status, 200);                           // same session, new rights
    assert.equal((await t.call("POST", "/api/tenders", { title: "x" }, tok)).status, 403);             // tenders:write was removed
  });

  it("the Administrator role is fixed; built-ins cannot be deleted; a role in use cannot be deleted", async () => {
    assert.equal((await t.call("PATCH", "/api/roles/admin", { permissions: ["catalog:read"] }, admin)).status, 400);
    assert.equal((await t.call("DELETE", "/api/roles/admin", null, admin)).status, 400);
    assert.equal((await t.call("DELETE", "/api/roles/manager", null, admin)).status, 400);
    const used = await t.call("DELETE", "/api/roles/estimator", null, admin);
    assert.equal(used.status, 409); assert.match(used.body.error, /1 user has this role/);
    const e = (await t.call("GET", "/api/users", null, admin)).body.find((u) => u.email === "e@x.com");
    assert.equal((await t.call("PATCH", `/api/users/${e.id}`, { role: "viewer" }, admin)).body.role, "viewer");
    assert.equal((await t.call("DELETE", "/api/roles/estimator", null, admin)).status, 200);
    assert.equal((await t.call("DELETE", "/api/roles/estimator", null, admin)).status, 404);
  });

  it("an unknown role cannot be given to anyone; the first account is an admin who can create more admins", async () => {
    assert.equal((await t.call("POST", "/api/users", { email: "z@x.com", password: "password123", role: "wizard" }, admin)).status, 400);
    assert.equal((await t.call("PATCH", `/api/users/${await idOf(user)}`, { role: "wizard" }, admin)).status, 400);
    const second = await t.call("POST", "/api/users", { email: "boss2@x.com", password: "password123", role: "admin" }, admin);
    assert.equal(second.status, 201); assert.equal(second.body.role, "admin");
    const tok = (await t.call("POST", "/api/auth/login", { email: "boss2@x.com", password: "password123" })).body.token;
    assert.equal((await t.call("POST", "/api/users", { email: "n@x.com", password: "password123", role: "manager" }, tok)).status, 201);      // the new admin can create users too
  });

  it("role changes are audited", async () => {
    const actions = (await t.call("GET", "/api/audit?entity=roles&limit=50", null, admin)).body.items.map((i) => i.action);
    for (const a of ["create", "update", "delete"]) assert.ok(actions.includes(a), a);
  });
});
