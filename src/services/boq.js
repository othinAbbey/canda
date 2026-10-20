import crypto from "node:crypto";
import { HttpError, ValidationError, notFound } from "../errors.js";
import { newId, now } from "../ids.js";
import { can } from "../auth/permissions.js";
import { BoqError } from "./boqClient.js";

/** A BoqError that got this far means the service answered but refused: report it as 502. */
const asHttp = (p) => p.catch((e) => { throw e instanceof BoqError ? new HttpError(502, e.message) : e; });
const ACTIVE = ["queued", "reading", "building"];
const present = (j) => j && {
  id: j.id, user_id: j.user_id, filename: j.filename, status: j.status, stage: j.stage, error: j.error, result: j.result, usage: j.usage,
  cost_usd: j.cost_usd, cached: !!j.cached, created_at: j.created, updated_at: j.updated, has_xlsx: !!j.has_xlsx,
  total: j.result?.totals?.total ?? null, currency: j.result?.currency ?? null,
};
const fromRemote = (r) => ({ status: r.status, stage: r.stage ?? null, error: r.error ?? null, result: r.result ?? null, usage: r.usage ?? null, cost_usd: r.cost_usd ?? null, cached: r.cached ? 1 : 0 });

/**
 * BOQ jobs belong to the user who uploaded the drawing. The PDF and the Excel result are kept in our database;
 * the BOQ service is only the worker that reads the drawing. Nothing here trusts the browser about ownership.
 */
export function createBoq({ boq, client: rawClient, billing, audit, config }) {
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  /** Same client, but outside-world failures become clean HTTP errors (503 = service down, 502 = service refused). */
  const client = Object.fromEntries(Object.entries(rawClient).map(([name, fn]) => [name, async (...a) => {
    try { return await fn.apply(rawClient, a); }
    catch (e) { if (e instanceof BoqError) throw e.status === 0 ? new HttpError(503, e.message) : e; throw e; }
  }]));

  async function mine(actor, id) {
    const j = await boq.get(id);
    if (!j || (j.user_id !== actor.id && !can(actor.role, "boq:all"))) throw notFound("job not found");    // do not reveal other people's ids
    return j;
  }

  /** Bring our copy up to date from the BOQ service, and keep the finished Excel file. */
  async function sync(job) {
    if (!ACTIVE.includes(job.status) || !job.remote_job_id) return job;
    let remote;
    try { remote = await client.job(job.remote_job_id); }
    catch (e) {
      if (e instanceof BoqError && e.status === 404) return boq.update(job.id, { status: "failed", stage: "failed", error: "The BOQ service lost this job. Please upload the drawing again." }, now());
      return job;                                                    // service briefly unreachable: keep what we have
    }
    let updated = await boq.update(job.id, fromRemote(remote), now());
    if (updated.status === "done" && !updated.has_xlsx) updated = await keepExcel(updated, remote);
    return updated;
  }
  async function keepExcel(job, remote) {
    try { return await boq.update(job.id, { xlsx: await client.xlsx(job.remote_job_id), xlsx_name: remote?.result?.xlsx || `${job.filename.replace(/\.pdf$/i, "")}-BOQ.xlsx` }, now()); }
    catch { return job; }                                            // retried on the next download
  }

  return {
    config: () => asHttp(client.config()),
    rates: () => asHttp(client.rates()),
    async saveRates(actor, rows) { const r = await asHttp(client.saveRates(rows)); await audit.log(actor, { action: "update", entity: "boq_rates", summary: `saved ${r.saved ?? rows.length} rate rows` }); return r; },

    async list(actor, { all = false } = {}) {
      const rows = await boq.list(all && can(actor.role, "boq:all") ? null : actor.id);
      return rows.map(present);
    },
    async get(actor, id) { return present(await sync(await mine(actor, id))); },

    async create(actor, { filename, bytes, force }) {
      if (!bytes.length) throw new ValidationError("the file is empty");
      if (bytes.length > maxBytes) throw new HttpError(413, `file is larger than ${config.maxUploadMb} MB`);
      if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ValidationError("that file is not a PDF");
      await billing.assertWithinLimit(actor, "boq_job");
      const name = String(filename || "drawings.pdf").replace(/[\\/\x00-\x1f]/g, "_").slice(0, 150);
      const id = newId();
      await boq.insert({ id, userId: actor.id, filename: name, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), pdf: bytes, at: now() });
      await billing.record(actor, "boq_job");
      await audit.log(actor, { action: "create", entity: "boq_jobs", id, summary: name });
      try {
        const remote = await client.createJob(bytes, name, { force: !!force });
        return present(await boq.update(id, { ...fromRemote(remote), remote_job_id: remote.id }, now()));
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 502;
        const message = e instanceof HttpError || e instanceof BoqError ? e.message : "Could not start the BOQ job.";
        await boq.update(id, { status: "failed", stage: "failed", error: message }, now());
        throw new HttpError(status, message);
      }
    },

    async rebuild(actor, id) {
      const job = await mine(actor, id);
      if (job.status !== "done" || !job.remote_job_id) throw new HttpError(409, "only a finished job can be rebuilt");
      let remote;
      try { remote = await client.rebuild(job.remote_job_id); } catch (e) { throw e instanceof HttpError ? e : new HttpError(502, e.message); }
      const updated = await boq.update(id, fromRemote(remote), now());
      return present(await keepExcel({ ...updated, has_xlsx: 0 }, remote));
    },

    async excel(actor, id) {
      const job = await mine(actor, id);
      let row = await boq.xlsx(id);
      if (!row?.xlsx && job.status === "done" && job.remote_job_id) { await keepExcel(job, job.result); row = await boq.xlsx(id); }
      if (!row?.xlsx) throw notFound("the Excel file is not ready");
      return { name: row.xlsx_name || "BOQ.xlsx", data: Buffer.from(row.xlsx) };
    },
    async pdf(actor, id) { await mine(actor, id); const r = await boq.pdf(id); return { name: r.filename, data: Buffer.from(r.pdf) }; },
    async remove(actor, id) {
      const job = await mine(actor, id);
      await boq.remove(id);
      await audit.log(actor, { action: "delete", entity: "boq_jobs", id, summary: job.filename });
    },
  };
}
