import { RESOURCES } from "../domain/resources.js";
import { created } from "../http/reply.js";

/** The same five routes for every resource in domain/resources.js. */
export default function resourceRoutes(r, { resources, summary }) {
  for (const [table, def] of Object.entries(RESOURCES)) {
    const read = { perm: def.read }, write = { perm: def.write };
    r.get(`/api/${table}`, read, (c) => resources.list(table, { project: c.query.project }));
    r.get(`/api/${table}/:id`, read, (c) => resources.get(table, c.params.id));
    r.post(`/api/${table}`, write, async (c) => created(await resources.create(c.user, table, await c.json())));
    r.patch(`/api/${table}/:id`, write, async (c) => resources.update(c.user, table, c.params.id, await c.json()));
    r.delete(`/api/${table}/:id`, write, async (c) => { await resources.remove(c.user, table, c.params.id); return { deleted: true }; });
  }
  r.get("/api/data", { perm: "projects:read" }, () => summary.data());
  r.get("/api/export", { perm: "projects:write" }, async () => ({ exported: new Date().toISOString(), ...(await summary.data()), ...Object.fromEntries(await Promise.all(["locations", "materials", "suppliers", "rates"].map(async (t) => [t, await resources.list(t)]))) }));
}
