import { created } from "../http/reply.js";

export default function scheduleRoutes(r, { schedule }) {
  const read = { perm: "projects:read" }, write = { perm: "projects:write" };
  r.get("/api/projects/:id/schedule", read, (c) => schedule.get(c.params.id, c.query.today));
  r.post("/api/projects/:id/schedule/apply", write, (c) => schedule.apply(c.user, c.params.id));
  r.post("/api/projects/:id/baseline", write, async (c) => schedule.baseline(c.user, c.params.id, await c.json()));
  r.post("/api/task_links", write, async (c) => created(await schedule.addLink(c.user, await c.json())));
  r.patch("/api/task_links/:id", write, async (c) => schedule.updateLink(c.user, c.params.id, await c.json()));
  r.delete("/api/task_links/:id", write, async (c) => { await schedule.removeLink(c.user, c.params.id); return { deleted: true }; });
}
