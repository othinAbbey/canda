import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./testApp.js";

describe("accounts", () => {
  let t, admin, adminId, userId, rivalToken;
  before(async () => { t = await startTestApp(); });
  after(() => t.close());

  it("the first sign-up creates a new organization and becomes its admin", async () => {
    const r = await t.call("POST", "/api/auth/register", { email: "Boss@X.com", password: "bosspass123", name: "Boss", organization_name: "C & A Contractors" });
    assert.equal(r.status, 201); assert.equal(r.body.user.role, "admin"); assert.equal(r.body.user.email, "boss@x.com");
    assert.ok(r.body.user.permissions.includes("users:manage"));
    assert.ok(r.body.user.organization_id);                   // a fresh organization now exists behind this account
    admin = r.body.token; adminId = r.body.user.id;
    assert.equal((await t.call("GET", "/api/me", null, admin)).body.organization.name, "C & A Contractors");
  });

  it("registering needs a company name; duplicate emails are still blocked across companies", async () => {
    assert.equal((await t.call("POST", "/api/auth/register", { email: "x@x.com", password: "password123" })).status, 400);               // no organization_name
    assert.equal((await t.call("POST", "/api/auth/register", { email: "y@x.com", password: "password123", organization_name: "" })).status, 400);
    assert.equal((await t.call("POST", "/api/auth/register", { email: "bad", password: "password123", organization_name: "Y Ltd" })).status, 400);
    assert.equal((await t.call("POST", "/api/auth/register", { email: "y@x.com", password: "short", organization_name: "Y Ltd" })).status, 400);
    assert.equal((await t.call("POST", "/api/auth/register", { email: "BOSS@x.com", password: "password123", organization_name: "Another Co" })).status, 409);  // email is unique system-wide, not per company
  });

  it("a second sign-up gets its OWN organization, invisible to the first admin", async () => {
    const r = await t.call("POST", "/api/auth/register", { email: "other@x.com", password: "password123", organization_name: "Rival Builders" });
    assert.equal(r.status, 201); assert.equal(r.body.user.role, "admin");
    assert.notEqual(r.body.user.organization_id, (await t.call("GET", "/api/me", null, admin)).body.organization_id);
    rivalToken = r.body.token;
    assert.ok(!(await t.call("GET", "/api/users", null, admin)).body.some((u) => u.email === "other@x.com"));
  });

  it("sign-up can be closed", async () => {
    const closed = await startTestApp({ env: { ALLOW_SIGNUP: "false" } });
    assert.equal((await closed.call("POST", "/api/auth/register", { email: "b@x.com", password: "password123", organization_name: "B Ltd" })).status, 403);
    await closed.close();
  });

  it("rejects bad passwords, missing and forged tokens; email is case-insensitive", async () => {
    assert.equal((await t.call("POST", "/api/auth/login", { email: "boss@x.com", password: "nope" })).status, 401);
    assert.equal((await t.call("GET", "/api/me")).status, 401);
    assert.equal((await t.call("GET", "/api/me", null, "x.y")).status, 401);
    assert.equal((await t.call("POST", "/api/auth/login", { email: "BOSS@x.com", password: "bosspass123" })).status, 200);
  });

  it("admin invites a teammate into their own organization; guards the last admin and self-delete", async () => {
    assert.equal((await t.call("POST", "/api/users", { email: "x@x.com", password: "password123", role: "wizard" }, admin)).status, 400);
    const r = await t.call("POST", "/api/users", { email: "jane@x.com", password: "janepass123", role: "user" }, admin);
    assert.equal(r.status, 201); assert.equal(r.body.role, "user"); userId = r.body.id;
    assert.equal((await t.call("POST", "/api/users", { email: "jane@x.com", password: "password123", role: "user" }, admin)).status, 409);
    assert.equal((await t.call("PATCH", `/api/users/${userId}`, { role: "manager" }, admin)).body.role, "manager");
    assert.equal((await t.call("PATCH", `/api/users/${adminId}`, { role: "user" }, admin)).status, 400);       // only admin
    assert.equal((await t.call("PATCH", `/api/users/${adminId}`, { status: "disabled" }, admin)).status, 400);
    assert.equal((await t.call("DELETE", `/api/users/${adminId}`, null, admin)).status, 400);
    await t.call("PATCH", `/api/users/${userId}`, { role: "user" }, admin);
  });

  it("one company's admin cannot see, reset, or modify a user from a different company", async () => {
    assert.ok(!(await t.call("GET", "/api/users", null, rivalToken)).body.some((u) => u.email === "jane@x.com"));
    assert.equal((await t.call("POST", `/api/users/${userId}/reset`, null, rivalToken)).status, 404);
    assert.equal((await t.call("PATCH", `/api/users/${userId}`, { role: "manager" }, rivalToken)).status, 404);
    assert.equal((await t.call("PATCH", `/api/users/${userId}`, { status: "disabled" }, rivalToken)).status, 404);
    assert.equal((await t.call("DELETE", `/api/users/${userId}`, null, rivalToken)).status, 404);
  });

  it("disabling an account blocks sign-in and kills its existing tokens", async () => {
    const tok = (await t.call("POST", "/api/auth/login", { email: "jane@x.com", password: "janepass123" })).body.token;
    assert.equal((await t.call("GET", "/api/me", null, tok)).status, 200);
    assert.equal((await t.call("PATCH", `/api/users/${userId}`, { status: "disabled" }, admin)).body.status, "disabled");
    assert.equal((await t.call("GET", "/api/me", null, tok)).status, 401);
    assert.equal((await t.call("POST", "/api/auth/login", { email: "jane@x.com", password: "janepass123" })).status, 401);
    await t.call("PATCH", `/api/users/${userId}`, { status: "active" }, admin);
    assert.equal((await t.call("POST", "/api/auth/login", { email: "jane@x.com", password: "janepass123" })).status, 200);
  });

  it("one-time reset codes: wrong, short, valid once, old sessions die", async () => {
    const old = (await t.call("POST", "/api/auth/login", { email: "jane@x.com", password: "janepass123" })).body.token;
    assert.equal((await t.call("POST", `/api/users/${userId}/reset`, null, old)).status, 403);
    const { body } = await t.call("POST", `/api/users/${userId}/reset`, null, admin);
    assert.match(body.code, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
    assert.equal((await t.call("POST", "/api/auth/reset", { email: "jane@x.com", code: "WRONG-CODE1", password: "newpass1234" })).status, 400);
    assert.equal((await t.call("POST", "/api/auth/reset", { email: "jane@x.com", code: body.code, password: "short" })).status, 400);
    const ok = await t.call("POST", "/api/auth/reset", { email: "JANE@x.com", code: body.code.toLowerCase(), password: "newpass1234" });
    assert.equal(ok.status, 200);
    assert.equal((await t.call("GET", "/api/me", null, old)).status, 401);
    assert.equal((await t.call("GET", "/api/me", null, ok.body.token)).status, 200);
    assert.equal((await t.call("POST", "/api/auth/reset", { email: "jane@x.com", code: body.code, password: "another1234" })).status, 400);   // single use
  });

  it("expired codes are refused", async () => {
    const short = await startTestApp({ env: { RESET_MINUTES: "-1" } });
    const a = await short.account("a@x.com"), id = (await short.call("GET", "/api/me", null, a)).body.id;
    const code = (await short.call("POST", `/api/users/${id}/reset`, null, a)).body.code;
    assert.equal((await short.call("POST", "/api/auth/reset", { email: "a@x.com", code, password: "password456" })).status, 400);
    await short.close();
  });

  it("changing your own password needs the current one and signs out other devices", async () => {
    const t1 = (await t.call("POST", "/api/auth/login", { email: "jane@x.com", password: "newpass1234" })).body.token;
    assert.equal((await t.call("POST", "/api/me/password", { current: "bad", password: "freshpass123" }, t1)).status, 400);
    const r = await t.call("POST", "/api/me/password", { current: "newpass1234", password: "freshpass123" }, t1);
    assert.equal(r.status, 200);
    assert.equal((await t.call("GET", "/api/me", null, t1)).status, 401);
    assert.equal((await t.call("GET", "/api/me", null, r.body.token)).status, 200);
  });

  it("limits repeated failed sign-ins", async () => {
    let last; for (let i = 0; i < 12; i++) last = await t.call("POST", "/api/auth/login", { email: "boss@x.com", password: "wrong-pass" });
    assert.equal(last.status, 429);
  });
});
