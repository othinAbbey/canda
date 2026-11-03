import { created } from "../http/reply.js";

export default function tenderRoutes(r, { tenders, tenderWork }) {
  // The pipeline and saved searches are ordinary resources (routes/resources.js). These are the extras.
  // Registered BEFORE the generic routes so "/api/tenders/search" is not read as a tender id.
  const read = { perm: "tenders:read" }, assign = { perm: "tenders:assign" };
  r.get("/api/tenders/sources", read, () => tenders.sources());
  r.get("/api/tenders/search", read, (c) => tenders.search(c.query));
  r.get("/api/tenders/summary", read, () => tenderWork.summary());
  r.get("/api/team", read, (c) => tenderWork.team(c.query));

  r.post("/api/tenders/:id/tasks", assign, async (c) => created(await tenderWork.assign(c.user, c.params.id, await c.json())));
  r.get("/api/tender_tasks", read, (c) => tenderWork.list(c.user, { mine: c.query.mine === "1", tender: c.query.tender, status: c.query.status }));
  r.patch("/api/tender_tasks/:id", read, async (c) => tenderWork.update(c.user, c.params.id, await c.json()));
  r.delete("/api/tender_tasks/:id", assign, async (c) => { await tenderWork.remove(c.user, c.params.id); return { deleted: true }; });
}
