import { created } from "../http/reply.js";

export default function roleRoutes(r, { roles, accounts }) {
  r.get("/api/roles", { perm: "users:manage" }, () => roles.list());
  r.get("/api/permissions", { perm: "roles:manage" }, () => roles.catalog());
  r.post("/api/roles", { perm: "roles:manage" }, async (c) => created(await roles.create(c.user, await c.json())));
  r.patch("/api/roles/:code", { perm: "roles:manage" }, async (c) => roles.update(c.user, c.params.code, await c.json()));
  r.delete("/api/roles/:code", { perm: "roles:manage" }, async (c) => { await roles.remove(c.user, c.params.code); return { deleted: true }; });
}
