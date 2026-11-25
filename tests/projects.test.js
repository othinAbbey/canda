import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";

describe("projects, documents, audit, summary", () => {
  let t, admin, manager, projectId;
  before(async () => { t = await startTestApp({ env: { MAX_UPLOAD_MB: "0.01" } }); admin = await t.account("a@x.com"); manager = await t.account("m@x.com", "manager", admin); });
  after(() => t.close());
  const up = (q, bytes, tok = manager) => t.call("POST", `/api/files?${q}`, null, tok, bytes);

  it("creates, reads, updates projects and rejects invalid values", async () => {
    const p = await t.call("POST", "/api/projects", { name: "Clinic", budget: "5000000", start: "2026-01-01", end: "", status: "active" }, manager);
    assert.equal(p.status, 201); assert.equal(p.body.budget, 5000000); assert.equal(p.body.end, null); projectId = p.body.id;
    assert.equal(p.body.created_by.length > 5, true);
    assert.equal((await t.call("POST", "/api/projects", { budget: 1 }, manager)).status, 400);
    assert.equal((await t.call("POST", "/api/projects", { name: "X", status: "bogus" }, manager)).status, 400);
    assert.equal((await t.call("POST", "/api/projects", { name: "X", start: "01/02/2026" }, manager)).status, 400);
    assert.equal((await t.call("POST", "/api/projects", { name: "X", budget: "abc" }, manager)).status, 400);
    assert.equal((await t.call("POST", "/api/projects", { name: "X", budget: -5 }, manager)).status, 400);
    const u = await t.call("PATCH", `/api/projects/${projectId}`, { status: "complete" }, manager);
    assert.equal(u.body.status, "complete"); assert.equal(u.body.name, "Clinic"); assert.ok(u.body.updated);
    assert.equal((await t.call("GET", "/api/projects/nope", null, manager)).status, 404);
  });

  it("links children to projects, filters by project, and cascades deletes", async () => {
    assert.equal((await t.call("POST", "/api/tasks", { title: "t", project: "missing" }, manager)).status, 400);
    const task = await t.call("POST", "/api/tasks", { title: "Pour slab", project: projectId, priority: "high" }, manager);
    assert.equal(task.status, 201); assert.equal(task.body.status, "todo");
    for (const [path, body] of [["costs", { item: "Cement", amount: 250000, category: "Materials" }], ["logs", { work: "Foundations", workers: 12 }], ["issues", { title: "Drawing clash", type: "RFI" }]])
      assert.equal((await t.call("POST", `/api/${path}`, { project: projectId, ...body }, manager)).status, 201);
    assert.equal((await t.call("GET", `/api/tasks?project=${projectId}`, null, manager)).body.length, 1);
    assert.deepEqual(Object.keys((await t.call("GET", "/api/data", null, manager)).body).sort(), ["costs", "issues", "logs", "projects", "tasks"]);
    await up(`project=${projectId}&name=a.pdf`, Buffer.from("x"));
    assert.equal((await t.call("DELETE", `/api/projects/${projectId}`, null, manager)).status, 200);
    const all = (await t.call("GET", "/api/data", null, manager)).body;
    assert.equal(all.tasks.length + all.costs.length + all.logs.length + all.issues.length, 0);
    assert.equal((await t.db.query("SELECT COUNT(*) AS n FROM files"))[0].n, 0);               // documents go with the project
  });

  it("stores documents in the database and serves identical bytes", async () => {
    projectId = (await t.call("POST", "/api/projects", { name: "Tower", budget: 1000, start: "2026-01-01", end: "2026-12-31", status: "active" }, manager)).body.id;
    const bytes = Buffer.from("%PDF-1.4 drawing \u00e9\u4e2d");
    const r = await up(`project=${projectId}&name=Floor%20plan%20%C3%A9.pdf&category=Drawings&note=rev%20B`, bytes);
    assert.equal(r.status, 201); assert.equal(r.body.size, bytes.length); assert.equal(r.body.uploader, "m@x.com"); assert.equal(r.body.data, undefined);
    assert.equal((await t.call("GET", `/api/files?project=${projectId}`, null, manager)).body.length, 1);
    const dl = await t.call("GET", `/api/files/${r.body.id}/download`, null, manager);
    assert.deepEqual(dl.body, bytes); assert.match(dl.headers.get("content-disposition"), /^attachment;/); assert.equal(dl.headers.get("content-type"), "application/pdf");
    assert.equal((await t.call("GET", `/api/files/${r.body.id}/download`)).status, 401);
    assert.equal((await t.call("DELETE", `/api/files/${r.body.id}`, null, manager)).status, 200);
    assert.equal((await t.call("GET", `/api/files/${r.body.id}/download`, null, manager)).status, 404);
  });

  it("rejects bad types, oversize, empty, unknown project, and read-only users", async () => {
    assert.equal((await up(`project=${projectId}&name=run.exe`, Buffer.from("MZ"))).status, 400);
    assert.equal((await up(`project=${projectId}&name=../../etc/passwd`, Buffer.from("x"))).status, 400);
    assert.equal((await up(`project=${projectId}&name=big.pdf`, Buffer.alloc(50_000, 1))).status, 413);
    assert.equal((await up(`project=${projectId}&name=e.pdf`, Buffer.alloc(0))).status, 400);
    assert.equal((await up(`project=nope&name=a.pdf`, Buffer.from("x"))).status, 400);
    const viewer = await t.account("v@x.com", "viewer", admin);
    assert.equal((await up(`project=${projectId}&name=a.pdf`, Buffer.from("x"), viewer)).status, 403);
    assert.equal((await t.call("GET", `/api/files?project=${projectId}`, null, viewer)).status, 200);
  });

  it("audit records who changed what, with before/after values; append-only; manager+ only", async () => {
    const task = (await t.call("POST", "/api/tasks", { project: projectId, title: "Pour slab" }, manager)).body;
    await t.call("PATCH", `/api/tasks/${task.id}`, { status: "doing" }, manager);
    await t.call("DELETE", `/api/tasks/${task.id}`, null, manager);
    const { body } = await t.call("GET", `/api/audit?entity=tasks&project=${projectId}`, null, manager);
    assert.deepEqual(body.items.map((i) => i.action), ["delete", "update", "create"]);
    assert.deepEqual(body.items[1].changes.status, ["todo", "doing"]); assert.equal(body.items[1].user_email, "m@x.com");
    assert.equal(body.items[0].changes.title, "Pour slab");
    const all = (await t.call("GET", "/api/audit?limit=200", null, admin)).body.items.map((i) => i.action);
    for (const a of ["register", "create", "update", "delete", "upload"]) assert.ok(all.includes(a), a);
    const page = await t.call("GET", "/api/audit?limit=2", null, admin);
    assert.equal(page.body.items.length, 2); assert.ok(page.body.next);
    assert.ok((await t.call("GET", `/api/audit?limit=2&before=${page.body.next}`, null, admin)).body.items.every((i) => i.id < page.body.next));
    assert.equal((await t.call("DELETE", "/api/audit/x", null, admin)).status, 404);
  });

  it("summary: progress, budget, forecast, issues, logs, health with reasons", async () => {
    const id = (await t.call("POST", "/api/projects", { name: "Old", budget: 1000, start: "2020-01-01", end: "2020-12-31", status: "active" }, manager)).body.id;
    const mk = (path, b) => t.call("POST", `/api/${path}`, { project: id, ...b }, manager);
    await mk("tasks", { title: "A", status: "done" }); await mk("tasks", { title: "B", due: "2020-02-01" }); await mk("tasks", { title: "C", due: "2099-01-01" });
    await mk("costs", { item: "Cement", amount: 600, category: "Materials" }); await mk("costs", { item: "Labour", amount: 500, category: "Labour" });
    await mk("logs", { work: "Dig", workers: 5, date: "2020-03-01" }); await mk("logs", { work: "Pour", workers: 7, date: "2020-03-02", delays: "rain", safety: "cut finger" });
    await mk("issues", { title: "Clash", severity: "high", type: "RFI" }); await mk("issues", { title: "Old", status: "closed" });
    await up(`project=${id}&name=a.pdf`, Buffer.from("x"));
    const s = (await t.call("GET", `/api/projects/${id}/summary`, null, manager)).body;
    assert.deepEqual([s.tasks.todo, s.tasks.doing, s.tasks.done, s.tasks.total, s.tasks.overdue], [2, 0, 1, 3, 1]);
    assert.equal(s.schedule.progress_pct, 33.3); assert.equal(s.schedule.elapsed_pct, 100);
    assert.equal(s.budget.spent, 1100); assert.equal(s.budget.remaining, -100); assert.equal(s.budget.used_pct, 110); assert.equal(s.budget.forecast, 3300);
    assert.deepEqual(s.budget.by_category.map((c) => c.category), ["Materials", "Labour"]);
    assert.deepEqual([s.site_logs.count, s.site_logs.worker_days, s.site_logs.delays, s.site_logs.safety_incidents, s.site_logs.last_date], [2, 12, 1, 1, "2020-03-02"]);
    assert.deepEqual([s.issues.open, s.issues.high, s.files.n], [1, 1, 1]);
    assert.equal(s.health, "red"); assert.ok(s.reasons.includes("Spending is over budget")); assert.ok(s.reasons.some((r) => /Past the planned finish/.test(r)));
    assert.equal(s.upcoming[0].title, "B"); assert.ok(s.activity.length > 0 && s.activity[0].user_email);
    assert.equal((await t.call("GET", "/api/projects/nope/summary", null, manager)).status, 404);
  });

  it("a healthy project is green and the portfolio rolls up", async () => {
    const id = (await t.call("POST", "/api/projects", { name: "Fine", budget: 10000, status: "active" }, manager)).body.id;
    await t.call("POST", "/api/costs", { project: id, item: "x", amount: 100 }, manager);
    const s = (await t.call("GET", `/api/projects/${id}/summary`, null, manager)).body;
    assert.equal(s.health, "green"); assert.deepEqual(s.reasons, []); assert.equal(s.schedule.elapsed_pct, null);
    const p = (await t.call("GET", "/api/summary", null, manager)).body;
    assert.equal(p.totals.projects, p.projects.length); assert.equal(p.totals.health.green + p.totals.health.amber + p.totals.health.red, p.totals.projects);
  });
});
