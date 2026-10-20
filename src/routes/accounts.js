import { created } from "../http/reply.js";

export default function accountRoutes(r, { accounts, billing }) {
  // sign-up and sign-in
  r.post("/api/auth/register", { public: true }, async (c) => created(await accounts.register(await c.json(), c.ip)));
  r.post("/api/auth/login", { public: true }, async (c) => accounts.login(await c.json(), c.ip));
  r.post("/api/auth/reset", { public: true }, async (c) => accounts.resetWithCode(await c.json(), c.ip));

  // the signed-in user
  r.get("/api/me", {}, async (c) => ({ ...accounts.pub(c.user), plan: await billing.planOf(c.user) }));
  r.post("/api/me/password", {}, async (c) => accounts.changePassword(c.user, await c.json(), c.ip));

  // admin: manage accounts
  const admin = { perm: "users:manage" };
  r.get("/api/users", admin, () => accounts.list());
  r.post("/api/users", admin, async (c) => created(await accounts.createUser(c.user, await c.json())));
  r.post("/api/users/:id/reset", admin, (c) => accounts.issueResetCode(c.user, c.params.id));
  r.patch("/api/users/:id", admin, async (c) => {
    const b = await c.json(); let out = null;
    if (b.role !== undefined) out = await accounts.setRole(c.user, c.params.id, b.role);
    if (b.status !== undefined) out = await accounts.setStatus(c.user, c.params.id, b.status);
    return out ?? {};
  });
  r.delete("/api/users/:id", admin, async (c) => { await accounts.remove(c.user, c.params.id); return { deleted: true }; });
  r.patch("/api/users/:id/plan", { perm: "billing:manage" }, async (c) => billing.setPlan(c.user, c.params.id, (await c.json()).plan));
}
