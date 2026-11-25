import { created } from "../http/reply.js";

export default function tenderRoutes(r, { tenders, tenderWork }) {
  // The pipeline and saved searches are ordinary resources (routes/resources.js). These are the extras.
  // Registered BEFORE the generic routes so "/api/tenders/search" is not read as a tender id.
  const read = { perm: "tenders:read" }, assign = { perm: "tenders:assign" };
  r.get("/api/tenders/sources", read, () => tenders.sources());
  r.get("/api/tenders/search", read, (c) => tenders.search(c.user, c.query));
  r.get("/api/tenders/summary", read, (c) => tenderWork.summary(c.user));
  r.get("/api/team", read, (c) => tenderWork.team(c.user, c.query));

  r.post("/api/tenders/:id/tasks", assign, async (c) => created(await tenderWork.assign(c.user, c.params.id, await c.json())));
  r.get("/api/tender_tasks", read, (c) => tenderWork.list(c.user, { mine: c.query.mine === "1", tender: c.query.tender, status: c.query.status }));
  r.patch("/api/tender_tasks/:id", read, async (c) => tenderWork.update(c.user, c.params.id, await c.json()));
  // Progress: the checklist of requirements, progress notes and the bid stage. Who may see or change a task is decided in the service.
  r.get("/api/tender_task_stages", read, () => tenderWork.stages());
  r.get("/api/tender_tasks/:id", read, (c) => tenderWork.detail(c.user, c.params.id));
  r.post("/api/tender_tasks/:id/requirements", read, async (c) => created(await tenderWork.addRequirements(c.user, c.params.id, await c.json())));
  r.post("/api/tender_tasks/:id/read_requirements", read, async (c) => tenderWork.readRequirements(c.user, c.params.id, await c.json()));
  r.post("/api/tender_tasks/:id/updates", read, async (c) => created(await tenderWork.postUpdate(c.user, c.params.id, await c.json())));
  r.patch("/api/tender_requirements/:id", read, async (c) => tenderWork.updateRequirement(c.user, c.params.id, await c.json()));
  r.delete("/api/tender_requirements/:id", read, (c) => tenderWork.removeRequirement(c.user, c.params.id));
  // Company Tasks: every task in the company and how far each person has got. Directors and administrators.
  r.get("/api/company_tasks", { perm: "tasks:oversee" }, (c) => tenderWork.company(c.user, c.query));
  r.delete("/api/tender_tasks/:id", assign, async (c) => { await tenderWork.remove(c.user, c.params.id); return { deleted: true }; });
}
