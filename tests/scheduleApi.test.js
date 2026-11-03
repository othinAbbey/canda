import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";

describe("schedule over HTTP", () => {
  let t, admin, manager, viewer, user, pid, A, B, C, P;
  before(async () => {
    t = await startTestApp();
    admin = await t.account("a@x.com"); manager = await t.account("m@x.com", "manager", admin); viewer = await t.account("v@x.com", "viewer", admin); user = await t.account("u@x.com", "user", admin);
    pid = (await t.call("POST", "/api/projects", { name: "Clinic", start: "2026-01-05", workweek: "mon-fri" }, manager)).body.id;     // 2026-01-05 is a Monday
    const mk = async (title, extra = {}) => (await t.call("POST", "/api/tasks", { project: pid, title, ...extra }, manager)).body;
    A = await mk("Foundations", { duration: 5 }); B = await mk("Walls", { duration: 3 }); C = await mk("Roof", { duration: 2 });
  });
  after(() => t.close());
  const sched = async (tok = manager) => (await t.call("GET", `/api/projects/${pid}/schedule?today=2026-01-05`, null, tok)).body;
  const by = (s) => Object.fromEntries(s.tasks.map((x) => [x.id, x]));

  it("links tasks with types and lags, and computes dates and the critical path", async () => {
    const l1 = await t.call("POST", "/api/task_links", { predecessor: A.id, successor: B.id }, manager);
    assert.equal(l1.status, 201); assert.equal(l1.body.type, "FS"); assert.equal(l1.body.lag, 0);
    await t.call("POST", "/api/task_links", { predecessor: B.id, successor: C.id, type: "fs", lag: 1 }, manager);
    const s = await sched(); const x = by(s);
    assert.deepEqual([x[A.id].scheduled_start, x[A.id].scheduled_finish], ["2026-01-05", "2026-01-09"]);
    assert.deepEqual([x[B.id].scheduled_start, x[B.id].scheduled_finish], ["2026-01-12", "2026-01-14"]);
    assert.deepEqual([x[C.id].scheduled_start, x[C.id].scheduled_finish], ["2026-01-16", "2026-01-19"]);      // lag 1 working day, then over the weekend
    assert.equal(s.project.finish, "2026-01-19"); assert.equal(s.project.critical_tasks, 3); assert.ok(s.tasks.every((r) => r.critical));
    assert.equal(s.links.length, 2); assert.equal(s.project.workweek ?? "mon-fri", "mon-fri");
  });

  it("refuses bad links: self, duplicate, loop, other project, bad type, bad lag", async () => {
    const bad = async (body, status, re) => { const r = await t.call("POST", "/api/task_links", body, manager); assert.equal(r.status, status, JSON.stringify(body)); if (re) assert.match(r.body.error, re); };
    await bad({ predecessor: A.id, successor: A.id }, 400, /itself/);
    await bad({ predecessor: A.id, successor: B.id }, 409, /already linked/);
    await bad({ predecessor: C.id, successor: A.id }, 400, /loop/);                                  // A -> B -> C already
    await bad({ predecessor: A.id, successor: "nope" }, 404);
    await bad({ predecessor: A.id, successor: C.id, type: "XX" }, 400, /type must be/);
    await bad({ predecessor: A.id, successor: C.id, lag: 1.5 }, 400, /lag/);
    const other = (await t.call("POST", "/api/projects", { name: "Other" }, manager)).body.id;
    const foreign = (await t.call("POST", "/api/tasks", { project: other, title: "Elsewhere" }, manager)).body;
    await bad({ predecessor: A.id, successor: foreign.id }, 400, /same project/);
  });

  it("changing a link type or lag reschedules; removing a link frees the task", async () => {
    const links = (await sched()).links, ab = links.find((l) => l.predecessor === A.id);
    assert.equal((await t.call("PATCH", `/api/task_links/${ab.id}`, { type: "SS", lag: 2 }, manager)).body.type, "SS");
    assert.equal(by(await sched())[B.id].scheduled_start, "2026-01-07");                             // starts 2 working days after A starts
    assert.equal((await t.call("DELETE", `/api/task_links/${ab.id}`, null, manager)).status, 200);
    assert.equal(by(await sched())[B.id].scheduled_start, "2026-01-05");
    assert.equal((await t.call("DELETE", `/api/task_links/${ab.id}`, null, manager)).status, 404);
    await t.call("POST", "/api/task_links", { predecessor: A.id, successor: B.id }, manager);          // restore
  });

  it("applies the schedule to the saved task dates, once", async () => {
    const r = await t.call("POST", `/api/projects/${pid}/schedule/apply`, null, manager);
    assert.equal(r.status, 200); assert.ok(r.body.moved >= 2);
    const saved = (await t.call("GET", `/api/tasks/${B.id}`, null, manager)).body;
    assert.deepEqual([saved.start, saved.due], ["2026-01-12", "2026-01-14"]);
    assert.equal((await t.call("POST", `/api/projects/${pid}/schedule/apply`, null, manager)).body.moved, 0);   // already in line
    assert.ok((await t.call("GET", `/api/audit?entity=projects&action=schedule`, null, admin)).body.items.length >= 2);
  });

  it("saves a baseline, shows slip when work is delayed, and can clear it", async () => {
    await t.call("POST", `/api/projects/${pid}/baseline`, {}, manager);
    assert.equal(by(await sched())[C.id].finish_variance, 0);
    await t.call("PATCH", `/api/tasks/${A.id}`, { duration: 7 }, manager);                             // Foundations take 2 days longer
    const s = await sched(); const x = by(s);
    assert.equal(x[A.id].finish_variance, 2); assert.equal(x[C.id].finish_variance, 2); assert.equal(s.project.finish, "2026-01-21");
    await t.call("POST", `/api/projects/${pid}/baseline`, { clear: true }, manager);
    assert.equal(by(await sched())[C.id].finish_variance, null);
  });

  it("summary tasks roll up; parents are validated", async () => {
    P = (await t.call("POST", "/api/tasks", { project: pid, title: "Structure" }, manager)).body;
    for (const id of [A.id, B.id]) assert.equal((await t.call("PATCH", `/api/tasks/${id}`, { parent: P.id }, manager)).status, 200);
    const x = by(await sched());
    assert.equal(x[P.id].summary, true); assert.equal(x[P.id].scheduled_start, "2026-01-05"); assert.equal(x[A.id].level, 1); assert.equal(x[A.id].wbs.startsWith(x[P.id].wbs + "."), true);
    assert.equal((await t.call("PATCH", `/api/tasks/${P.id}`, { parent: A.id }, manager)).status, 400);       // would sit inside its own child
    assert.equal((await t.call("PATCH", `/api/tasks/${P.id}`, { parent: P.id }, manager)).status, 400);
    const other = (await t.call("POST", "/api/projects", { name: "Other2" }, manager)).body.id;
    const foreign = (await t.call("POST", "/api/tasks", { project: other, title: "x" }, manager)).body;
    assert.equal((await t.call("PATCH", `/api/tasks/${A.id}`, { parent: foreign.id }, manager)).status, 400);
    assert.equal((await t.call("PATCH", `/api/tasks/${A.id}`, { parent: "missing" }, manager)).status, 400);
  });

  it("keeps percent complete and status in step; validates the new fields", async () => {
    const set = async (body) => (await t.call("PATCH", `/api/tasks/${C.id}`, body, manager));
    assert.equal((await set({ percent: 40 })).body.status, "doing");
    assert.equal((await set({ percent: 100 })).body.status, "done");
    assert.equal((await set({ status: "todo" })).body.percent, 0);
    assert.equal((await set({ status: "done" })).body.percent, 100);
    assert.equal((await set({ percent: 150 })).status, 400); assert.equal((await set({ percent: 2.5 })).status, 400);
    assert.equal((await set({ duration: -1 })).status, 400); assert.equal((await set({ milestone: 2 })).status, 400);
    assert.equal((await set({ milestone: 1 })).body.milestone, 1);
    assert.equal((await t.call("PATCH", `/api/projects/${pid}`, { workweek: "weekends" }, manager)).status, 400);
    assert.equal((await t.call("PATCH", `/api/projects/${pid}`, { workweek: "mon-sat" }, manager)).body.workweek, "mon-sat");
  });

  it("deleting a task removes its links; deleting a project removes everything; rights apply", async () => {
    const s = await sched(); assert.ok(s.links.length >= 1);
    await t.call("DELETE", `/api/tasks/${B.id}`, null, manager);
    assert.equal((await sched()).links.some((l) => l.predecessor === B.id || l.successor === B.id), false);
    assert.equal((await t.call("GET", `/api/projects/${pid}/schedule`, null, viewer)).status, 200);
    assert.equal((await t.call("POST", "/api/task_links", { predecessor: A.id, successor: C.id }, viewer)).status, 403);
    assert.equal((await t.call("POST", `/api/projects/${pid}/baseline`, {}, viewer)).status, 403);
    assert.equal((await t.call("POST", `/api/projects/${pid}/schedule/apply`, null, viewer)).status, 403);
    assert.equal((await t.call("GET", `/api/projects/${pid}/schedule`, null, user)).status, 403);
    assert.equal((await t.call("GET", "/api/projects/nope/schedule", null, manager)).status, 404);
    await t.call("DELETE", `/api/projects/${pid}`, null, manager);
    assert.equal((await t.db.query("SELECT COUNT(*) AS n FROM task_links"))[0].n, 0);
  });
});
