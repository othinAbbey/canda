import { created } from "../http/reply.js";

export default function proposalRoutes(r, { proposals }) {
  r.post("/api/proposals", { perm: "catalog:propose" }, async (c) => created(await proposals.submit(c.user, await c.json())));
  r.get("/api/proposals", { perm: "catalog:propose" }, (c) => proposals.list(c.user, { status: c.query.status }));
  r.post("/api/proposals/:id/approve", { perm: "proposals:review" }, async (c) => proposals.approve(c.user, c.params.id, (await c.json()).note));
  r.post("/api/proposals/:id/reject", { perm: "proposals:review" }, async (c) => proposals.reject(c.user, c.params.id, (await c.json()).note));
  r.delete("/api/proposals/:id", { perm: "catalog:propose" }, async (c) => { await proposals.withdraw(c.user, c.params.id); return { deleted: true }; });
}
