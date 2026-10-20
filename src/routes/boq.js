import { created, file } from "../http/reply.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export default function boqRoutes(r, { boq }, { config }) {
  const use = { perm: "boq:use" }, rates = { perm: "boq:rates" };
  r.get("/api/boq/config", use, () => boq.config());
  r.get("/api/boq/rates", rates, () => boq.rates());
  r.put("/api/boq/rates", rates, async (c) => boq.saveRates(c.user, (await c.json()).rows));

  r.get("/api/boq/jobs", use, (c) => boq.list(c.user, { all: c.query.scope === "all" }));
  // The drawing PDF is the request body; filename and options go in the query string.
  r.post("/api/boq/jobs", use, async (c) => created(await boq.create(c.user, { filename: c.query.name, force: c.query.force === "true", bytes: await c.raw(config.maxUploadMb * 1048576) })));
  r.get("/api/boq/jobs/:id", use, (c) => boq.get(c.user, c.params.id));
  r.post("/api/boq/jobs/:id/rebuild", use, (c) => boq.rebuild(c.user, c.params.id));
  r.get("/api/boq/jobs/:id/boq.xlsx", use, async (c) => { const f = await boq.excel(c.user, c.params.id); return file({ name: f.name, type: XLSX, data: f.data }); });
  r.get("/api/boq/jobs/:id/pdf", use, async (c) => { const f = await boq.pdf(c.user, c.params.id); return file({ name: f.name, type: "application/pdf", data: f.data }); });
  r.delete("/api/boq/jobs/:id", use, async (c) => { await boq.remove(c.user, c.params.id); return { deleted: true }; });
}
