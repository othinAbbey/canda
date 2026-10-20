import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BoqError } from "../src/services/boqClient.js";
import { startTestApp } from "./support/testApp.js";

/** Stands in for the BOQ service: a job finishes on its second poll. */
function fakeBoq() {
  const jobs = new Map(); let n = 0; const state = { down: false };
  const done = { currency: "UGX", totals: { total: 1234 }, xlsx: "plan-BOQ.xlsx", issues: [], sections: [], unpriced: [], counts: { drawings: 1, rooms: 2, openings: 3 }, document_warnings: [] };
  return {
    state, jobs, calls: [],
    config: async () => ({ ai_provider: "gemini", model: "m", api_key_set: true, max_pdf_mb: 20, currency: "UGX" }),
    rates: async () => ({ fields: ["item_code", "rate"], rows: [] }),
    saveRates: async (rows) => ({ saved: rows.length }),
    async createJob(pdf, filename) {
      this.calls.push({ pdf, filename });
      if (state.down) throw new BoqError(0, "The BOQ service is not reachable right now. Try again shortly.");
      const id = `r${++n}`; jobs.set(id, { id, filename, status: "reading", stage: "Reading the drawings", polls: 0 }); return { ...jobs.get(id) };
    },
    async job(id) {
      if (state.down) throw new BoqError(0, "down");
      const j = jobs.get(id); if (!j) throw new BoqError(404, "job not found");
      if (++j.polls >= 2) Object.assign(j, { status: "done", stage: "done", result: done, usage: { input_tokens: 100, output_tokens: 50 }, cost_usd: 0.01, cached: false });
      return { ...j };
    },
    rebuild: async (id) => ({ ...jobs.get(id), result: { ...done, totals: { total: 999 } } }),
    xlsx: async (id) => { if (!jobs.has(id)) throw new BoqError(404, "gone"); return Buffer.from("XLSX-BYTES"); },
  };
}
const PDF = Buffer.from("%PDF-1.7 pretend drawing set");

describe("BOQ jobs belong to the user who uploaded them", () => {
  let t, fake, admin, jane, bob, job;
  before(async () => {
    fake = fakeBoq(); t = await startTestApp({ boq: fake, env: { MAX_UPLOAD_MB: "0.01" } });
    admin = await t.account("a@x.com"); jane = await t.account("jane@x.com", "user", admin); bob = await t.account("bob@x.com", "user", admin);
  });
  after(() => t.close());
  const post = (q, bytes, tok = jane) => t.call("POST", `/api/boq/jobs?${q}`, null, tok, bytes);

  it("uploads a PDF, stores it in the database under the uploader, and starts the remote job", async () => {
    const r = await post("name=plan.pdf", PDF);
    assert.equal(r.status, 201); assert.equal(r.body.status, "reading"); assert.equal(r.body.filename, "plan.pdf");
    job = r.body;
    assert.equal(r.body.pdf, undefined);                                                         // never sent back in listings
    const row = (await t.db.query("SELECT user_id, pdf, remote_job_id FROM boq_jobs WHERE id = $1", [job.id]))[0];
    assert.equal(row.user_id, (await t.call("GET", "/api/me", null, jane)).body.id);
    assert.deepEqual(Buffer.from(row.pdf), PDF); assert.equal(row.remote_job_id, "r1");
    assert.deepEqual(fake.calls[0].pdf, PDF);                                                    // the PDF goes straight through, as a PDF
  });
  it("rejects non-PDFs, empty files and oversize files", async () => {
    assert.equal((await post("name=x.pdf", Buffer.from("not a pdf at all"))).status, 400);
    assert.equal((await post("name=x.pdf", Buffer.alloc(0))).status, 400);
    assert.equal((await post("name=x.pdf", Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(50_000)]))).status, 413);
  });
  it("follows the job to completion and keeps the Excel file in the database", async () => {
    const first = await t.call("GET", `/api/boq/jobs/${job.id}`, null, jane);
    assert.equal(first.body.status, "reading");
    const second = await t.call("GET", `/api/boq/jobs/${job.id}`, null, jane);
    assert.equal(second.body.status, "done"); assert.equal(second.body.result.totals.total, 1234); assert.equal(second.body.cost_usd, 0.01); assert.equal(second.body.has_xlsx, true);
    fake.jobs.clear();                                                                           // the BOQ service forgets everything...
    const xl = await t.call("GET", `/api/boq/jobs/${job.id}/boq.xlsx`, null, jane);              // ...but the download still works
    assert.equal(xl.status, 200); assert.equal(xl.body.toString(), "XLSX-BYTES"); assert.match(xl.headers.get("content-disposition"), /plan-BOQ\.xlsx/);
    const pdf = await t.call("GET", `/api/boq/jobs/${job.id}/pdf`, null, jane);
    assert.deepEqual(pdf.body, PDF);
  });
  it("other users cannot see, download or delete it; admins can see everything", async () => {
    for (const [m, p] of [["GET", ""], ["GET", "/boq.xlsx"], ["GET", "/pdf"], ["POST", "/rebuild"], ["DELETE", ""]]) assert.equal((await t.call(m, `/api/boq/jobs/${job.id}${p}`, null, bob)).status, 404, `${m} ${p}`);
    assert.equal((await t.call("GET", "/api/boq/jobs", null, bob)).body.length, 0);
    assert.equal((await t.call("GET", "/api/boq/jobs", null, jane)).body.length, 1);
    assert.equal((await t.call("GET", "/api/boq/jobs", null, admin)).body.length, 0);             // admin's own list is its own...
    const all = (await t.call("GET", "/api/boq/jobs?scope=all", null, admin)).body;               // ...unless asked for everything
    assert.equal(all.length, 1); assert.equal(all[0].total, 1234); assert.equal(all[0].currency, "UGX");
    assert.equal((await t.call("GET", `/api/boq/jobs/${job.id}`, null, admin)).status, 200);
    assert.equal((await t.call("GET", "/api/boq/jobs?scope=all", null, bob)).body.length, 0);     // a user cannot widen the scope
  });
  it("rebuilds with current rates", async () => {
    const j = (await post("name=again.pdf", PDF)).body;
    await t.call("GET", `/api/boq/jobs/${j.id}`, null, jane); await t.call("GET", `/api/boq/jobs/${j.id}`, null, jane);
    const r = await t.call("POST", `/api/boq/jobs/${j.id}/rebuild`, null, jane);
    assert.equal(r.status, 200); assert.equal(r.body.result.totals.total, 999);
    assert.equal((await t.call("POST", "/api/boq/jobs/nope/rebuild", null, jane)).status, 404);
  });
  it("reports an unreachable BOQ service clearly and keeps a failed record", async () => {
    fake.state.down = true;
    const r = await post("name=down.pdf", PDF);
    assert.equal(r.status, 503); assert.match(r.body.error, /not reachable/);
    const failed = (await t.call("GET", "/api/boq/jobs", null, jane)).body.find((j) => j.filename === "down.pdf");
    assert.equal(failed.status, "failed"); assert.match(failed.error, /not reachable/);
    fake.state.down = false;
  });
  it("marks a job failed if the BOQ service lost it, and survives short outages while polling", async () => {
    const j = (await post("name=lost.pdf", PDF)).body;
    fake.state.down = true;
    assert.equal((await t.call("GET", `/api/boq/jobs/${j.id}`, null, jane)).body.status, "reading");   // outage: keep what we have
    fake.state.down = false; fake.jobs.clear();
    const after = (await t.call("GET", `/api/boq/jobs/${j.id}`, null, jane)).body;
    assert.equal(after.status, "failed"); assert.match(after.error, /lost this job/);
  });
  it("deletes a job and its stored files", async () => {
    const j = (await post("name=del.pdf", PDF)).body;
    assert.equal((await t.call("DELETE", `/api/boq/jobs/${j.id}`, null, jane)).status, 200);
    assert.equal((await t.db.query("SELECT COUNT(*) AS n FROM boq_jobs WHERE id = $1", [j.id]))[0].n, 0);
  });
  it("only admins touch the shared rate book; everyone can read the service status", async () => {
    assert.equal((await t.call("GET", "/api/boq/config", null, jane)).body.ai_provider, "gemini");
    assert.equal((await t.call("GET", "/api/boq/rates", null, jane)).status, 403);
    assert.equal((await t.call("PUT", "/api/boq/rates", { rows: [{ item_code: "A" }] }, jane)).status, 403);
    assert.equal((await t.call("PUT", "/api/boq/rates", { rows: [{ item_code: "A" }] }, admin)).body.saved, 1);
  });
});

describe("subscription placeholders", () => {
  let t, admin, jane, janeId;
  before(async () => {
    t = await startTestApp({ boq: fakeBoq(), env: { ENFORCE_PLAN_LIMITS: "true" } });
    admin = await t.account("a@x.com"); jane = await t.account("jane@x.com", "user", admin); janeId = (await t.call("GET", "/api/me", null, jane)).body.id;
  });
  after(() => t.close());
  it("every account starts on the free plan; nothing can be bought yet", async () => {
    assert.equal((await t.call("GET", "/api/me", null, jane)).body.plan.code, "free");
    const b = (await t.call("GET", "/api/billing", null, jane)).body;
    assert.equal(b.billing_enabled, false); assert.equal(b.plan.code, "free"); assert.equal(b.plan.limits.boq_jobs_per_month, 3);
    assert.equal(b.available_plans.length, 3);
    assert.equal((await t.call("POST", "/api/billing/checkout", {}, jane)).status, 501);
  });
  it("records usage and enforces the plan limit when enforcement is on; an admin can change the plan", async () => {
    for (let i = 0; i < 3; i++) assert.equal((await t.call("POST", "/api/boq/jobs?name=a.pdf", null, jane, PDF)).status, 201);
    assert.equal((await t.call("GET", "/api/billing", null, jane)).body.usage.boq_jobs_this_month, 3);
    const blocked = await t.call("POST", "/api/boq/jobs?name=a.pdf", null, jane, PDF);
    assert.equal(blocked.status, 402); assert.match(blocked.body.error, /Free plan allows 3/);
    assert.equal((await t.call("PATCH", `/api/users/${janeId}/plan`, { plan: "pro" }, jane)).status, 403);
    assert.equal((await t.call("PATCH", `/api/users/${janeId}/plan`, { plan: "gold" }, admin)).status, 400);
    assert.equal((await t.call("PATCH", `/api/users/${janeId}/plan`, { plan: "pro" }, admin)).body.plan_code, "pro");
    assert.equal((await t.call("POST", "/api/boq/jobs?name=a.pdf", null, jane, PDF)).status, 201);
  });
  it("limits are ignored while enforcement is off (the default)", async () => {
    const off = await startTestApp({ boq: fakeBoq() });
    const a = await off.account("a@x.com");
    for (let i = 0; i < 5; i++) assert.equal((await off.call("POST", "/api/boq/jobs?name=a.pdf", null, a, PDF)).status, 201);
    await off.close();
  });
});
