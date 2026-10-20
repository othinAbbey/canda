import { created } from "../http/reply.js";

export default function contactRoutes(r, { contact }) {
  r.post("/api/contact", { public: true }, async (c) => { await contact.submit(await c.json(), c.ip); return created({ ok: true }); });
  r.get("/api/messages", { perm: "messages:read" }, () => contact.list());
  r.patch("/api/messages/:id", { perm: "messages:read" }, async (c) => contact.setStatus(c.user, c.params.id, (await c.json()).status));
  r.delete("/api/messages/:id", { perm: "messages:manage" }, async (c) => { await contact.remove(c.user, c.params.id); return { deleted: true }; });
}
