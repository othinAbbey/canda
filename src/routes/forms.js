import { created } from "../http/reply.js";

export default function formRoutes(r, { forms }) {
  const read = { perm: "projects:read" }, write = { perm: "projects:write" };
  r.get("/api/form_templates", read, () => forms.templates());
  r.get("/api/forms", read, (c) => forms.list(c.user, c.query));
  r.get("/api/forms/:id", read, (c) => forms.get(c.user, c.params.id));
  r.post("/api/forms", write, async (c) => created(await forms.create(c.user, await c.json())));
  r.patch("/api/forms/:id", write, async (c) => forms.update(c.user, c.params.id, await c.json()));
  r.post("/api/forms/:id/copy", write, async (c) => created(await forms.copy(c.user, c.params.id)));
  r.delete("/api/forms/:id", write, async (c) => { await forms.remove(c.user, c.params.id); return { deleted: true }; });
}
