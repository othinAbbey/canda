import { created } from "../http/reply.js";

/** The shared subcontracts marketplace (see services/market.js for who sees what). */
export default function marketRoutes(r, { market }) {
  const read = { perm: "market:read" }, post = { perm: "market:post" };
  r.get("/api/market/options", read, () => market.options());
  r.get("/api/market/listings", read, (c) => market.list(c.user, { ...c.query, mine: c.query.mine === "1" }));
  r.get("/api/market/listings/:id", read, (c) => market.get(c.user, c.params.id));
  r.post("/api/market/listings", post, async (c) => created(await market.create(c.user, await c.json())));
  r.patch("/api/market/listings/:id", post, async (c) => market.update(c.user, c.params.id, await c.json()));
  r.delete("/api/market/listings/:id", post, async (c) => { await market.remove(c.user, c.params.id); return { deleted: true }; });
  r.post("/api/market/listings/:id/responses", post, async (c) => created(await market.respond(c.user, c.params.id, await c.json())));
  r.get("/api/market/responses", read, (c) => market.sent(c.user));
  r.patch("/api/market/responses/:id", post, async (c) => market.updateResponse(c.user, c.params.id, await c.json()));
}
