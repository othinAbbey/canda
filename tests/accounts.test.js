import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";

describe("accounts", () => {
  let t, admin, adminId, userId;
  before(async () => { t = await startTestApp(); });
  after(() => t.close());

  it("starts in setup mode; the first sign-up becomes admin", async () => {
    assert.equal((await t.call("GET", "/api/health")).body.setup_required, true);
    const r = await t.call("POST", "/api/auth/register", { email: "Boss@X.com", password: "bosspass123", name: "Boss" });
    assert.equal(r.status, 201); assert.equal(r.body.user.role, "admin"); assert.equal(r.body.user.email, "boss@x.com");
    assert.ok(r.body.user.permissions.includes("users:manage"));
    admin = r.body.token; adminId = r.body.user.id;
    assert.equal((await t.call("GET", "/api/health")).body.setup_required, false);
  });

  it("later sign-ups become plain users when sign-up is open, with read-only catalog rights", async () => {
    const r = await t.call("POST", "/api/auth/register", { email: "jane@x.com", password: "janepass123" });
    assert.equal(r.status, 201); assert.equal(r.body.user.role, "user"); userId = r.body.user.id;
    assert.ok(r.body.user.permissions.includes("catalog:read")); assert.ok(!r.body.user.permissions.includes("catalog:write"));
    assert.equal((await t.call("POST", "/api/auth/register", { email: "JANE@x.com", password: "janepass123" })).status, 409);
    assert.equal((await t.call("POST", "/api/auth/register", { email: "bad", password: "janepass123" })).status, 400);
    assert.equal((await t.call("POST", "/api/auth/register", { email: "c@x.com", password: "short" })).status, 400);
  });

  it("sign-up can be closed", async () => {
    const closed = await startTestApp({ env: { ALLOW_SIGNUP: "false" } });
    await closed.account("a@x.com");
    assert.equal((await closed.call("POST", "/api/auth/register", { email: "b@x.com", password: "password123" })).status, 403);
    await closed.close();
  });

  it("rejects bad passwords, missing and forged tokens; email is case-insensitive", async () => {
    assert.equal((await t.call("POST", "/api/auth/login", { email: "boss@x.com", password: "nope" })).status, 401);
    assert.equal((await t.call("GET", "/api/me")).status, 401);
    assert.equal((await t.call("GET", "/api/me", null, "x.y")).status, 401);
    assert.equal((await t.call("POST", "/api/auth/login", { email: "BOSS@x.com", password: "bosspass123" })).status, 200);
  });

  it("admin creates accounts, changes roles; guards the last admin and self-delete", async () => {
    assert.equal((await t.call("POST", "/api/users", { email: "x@x.com", password: "password123", role: "wizard" }, admin)).status, 400);
    assert.equal((await t.call("POST", "/api/users", { email: "jane@x.com", password: "password123", role: "user" }, admin)).status, 409);
    assert.equal((await t.call("PATCH", `/api/users/${userId}`, { role: "manager" }, admin)).body.role, "manager");
    assert.equal((await t.call("PATCH", `/api/users/${adminId}`, { role: "user" }, admin)).status, 400);       // only admin
    assert.equal((await t.call("PATCH", `/api/users/${adminId}`, { status: "disabled" }, admin)).status, 400);
    assert.equal((await t.call("DELETE", `/api/users/${adminId}`, null, admin)).status, 400);
    await t.call("PATCH", `/api/users/${userId}`, { role: "user" }, admin);
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
