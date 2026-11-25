import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";

describe("tender value, project managers and assigned tasks", () => {
  let t, admin, gpm, gpm2, pm, pm2, viewer, customer, ids = {}, tender;
  before(async () => {
    t = await startTestApp();
    admin = await t.account("a@x.com");
    const make = async (email, role) => { const tok = await t.account(email, role, admin); ids[email] = (await t.call("GET", "/api/me", null, tok)).body.id; return tok; };
    gpm = await make("gpm@x.com", "general_pm"); gpm2 = await make("gpm2@x.com", "general_pm"); pm = await make("pm@x.com", "manager"); pm2 = await make("pm2@x.com", "manager");
    viewer = await make("v@x.com", "viewer"); customer = await make("c@x.com", "user");
    tender = (await t.call("POST", "/api/tenders", { title: "Health Centre III", buyer: "Mukono", deadline: "2026-12-01", value: "250000000", currency: "UGX" }, gpm)).body;
  });
  after(() => t.close());
  const login = async (email) => (await t.call("POST", "/api/auth/login", { email, password: "password123" })).body.token;   // disabling a user signs them out, so sign in again
  const assign = (body, tok = gpm, id = tender.id) => t.call("POST", `/api/tenders/${id}/tasks`, { title: "Prepare the bid", assignee: ids["pm@x.com"], ...body }, tok);

  it("tenders carry a value and currency, and the pipeline is totalled per currency", async () => {
    assert.equal(tender.value, 250000000); assert.equal(tender.currency, "UGX");
    const mk = (title, status, value, currency = "UGX") => t.call("POST", "/api/tenders", { title, status, value, currency }, gpm);
    await mk("Borehole", "bidding", 40000000); await mk("Road", "submitted", 10000000); await mk("Won job", "won", 5000000); await mk("Lost job", "lost", 7000000);
    await mk("Dismissed", "dismissed", 99000000); await mk("USD tender", "interested", 1000, "USD"); await mk("No value", "saved", null);
    const s = (await t.call("GET", "/api/tenders/summary", null, viewer)).body;
    assert.equal(s.open.UGX, 300000000); assert.equal(s.open.USD, 1000);                       // 250m saved + 40m bidding + 10m submitted; dismissed ignored
    assert.equal(s.won.UGX, 5000000); assert.equal(s.lost.UGX, 7000000);
    assert.equal(s.counts.saved, 2); assert.equal(s.counts.bidding, 1);
    assert.equal((await t.call("GET", "/api/tenders/summary", null, customer)).status, 403);
    assert.equal((await t.call("POST", "/api/tenders", { title: "bad", currency: "XXX" }, gpm)).status, 400);
    assert.equal((await t.call("POST", "/api/tenders", { title: "bad", value: -1 }, gpm)).status, 400);
    assert.equal((await t.call("PATCH", `/api/tenders/${tender.id}`, { value: 300000000 }, pm)).body.value, 300000000);   // editable afterwards
  });

  it("the assignment dropdown lists only active project managers", async () => {
    const list = (await t.call("GET", "/api/team?role=manager", null, gpm)).body;
    assert.deepEqual(list.map((p) => p.email).sort(), ["pm2@x.com", "pm@x.com"]); assert.equal(list[0].role_name, "Project Manager");
    await t.call("PATCH", `/api/users/${ids["pm2@x.com"]}`, { status: "disabled" }, admin);
    assert.deepEqual((await t.call("GET", "/api/team?role=manager", null, gpm)).body.map((p) => p.email), ["pm@x.com"]);
    await t.call("PATCH", `/api/users/${ids["pm2@x.com"]}`, { status: "active" }, admin); pm2 = await login("pm2@x.com");
    const staff = (await t.call("GET", "/api/team", null, gpm)).body.map((p) => p.email);        // no role filter: all staff, never customers
    assert.ok(staff.includes("gpm@x.com") && staff.includes("v@x.com") && !staff.includes("c@x.com"));
    assert.equal((await t.call("GET", "/api/team", null, customer)).status, 403);
  });

  it("assigning creates the task and automatically copies in every general project manager", async () => {
    const r = await assign({ due: "2026-11-24", priority: "high", notes: "Site visit first" });
    assert.equal(r.status, 201); assert.equal(r.body.assignee, ids["pm@x.com"]); assert.equal(r.body.tender_title, "Health Centre III"); assert.equal(r.body.status, "todo");
    assert.deepEqual(r.body.copies.map((c) => c.email).sort(), ["gpm2@x.com", "gpm@x.com"]);          // both general PMs, including the sender
    const extra = await assign({ title: "Price the steel", cc: [ids["v@x.com"]] });
    assert.deepEqual(extra.body.copies.map((c) => c.email).sort(), ["gpm2@x.com", "gpm@x.com", "v@x.com"]);
    const audit = (await t.call("GET", "/api/audit?entity=tender_tasks", null, admin)).body.items.find((i) => i.action === "assign");
    assert.match(audit.summary, /Prepare the bid|Price the steel/);
  });

  it("refuses wrong assignees, bad input, and people without the right", async () => {
    const bad = async (body, status, re) => { const r = await assign(body); assert.equal(r.status, status, JSON.stringify(body)); if (re) assert.match(r.body.error, re); };
    await bad({ assignee: ids["gpm@x.com"] }, 400, /project manager/);              // a general PM is not in the project-manager list
    await bad({ assignee: ids["v@x.com"] }, 400, /project manager/);
    await bad({ assignee: "nobody" }, 400, /project manager/);
    await bad({ title: " " }, 400, /title/); await bad({ due: "next week" }, 400, /date/); await bad({ priority: "urgent" }, 400, /priority/);
    await bad({ cc: [ids["c@x.com"]] }, 400, /cannot be copied/);                   // customers cannot be copied
    assert.equal((await assign({}, pm)).status, 403);                                 // a project manager cannot assign
    assert.equal((await assign({}, viewer)).status, 403);
    assert.equal((await assign({}, gpm, "missing")).status, 404);
    await t.call("PATCH", `/api/users/${ids["pm@x.com"]}`, { status: "disabled" }, admin);
    await bad({}, 400, /project manager/);                                            // disabled people cannot be chosen
    await t.call("PATCH", `/api/users/${ids["pm@x.com"]}`, { status: "active" }, admin); pm = await login("pm@x.com");
  });

  it("each person sees their own work: assigned to them or copied to them", async () => {
    const mine = async (tok) => (await t.call("GET", "/api/tender_tasks?mine=1", null, tok)).body;
    const forPm = await mine(pm), forGpm = await mine(gpm);
    assert.ok(forPm.length >= 2 && forPm.every((x) => x.relation === "assigned"));
    assert.ok(forGpm.length >= 2 && forGpm.every((x) => x.relation === "copied")); assert.equal(forGpm[0].tender_title, "Health Centre III");
    assert.equal((await mine(pm2)).length, 0); assert.equal((await mine(viewer)).length, 1);        // viewer was copied on one
    assert.equal((await t.call("GET", `/api/tender_tasks?tender=${tender.id}`, null, viewer)).body.length >= 2, true);
    assert.equal((await t.call("GET", "/api/tender_tasks?mine=1", null, customer)).status, 403);
  });

  it("the assignee updates progress; only assigners change the title or priority; others are refused", async () => {
    const task = (await t.call("GET", "/api/tender_tasks?mine=1", null, pm)).body[0];
    const done = await t.call("PATCH", `/api/tender_tasks/${task.id}`, { status: "doing", notes: "Visited site" }, pm);
    assert.equal(done.status, 200); assert.equal(done.body.status, "doing"); assert.equal(done.body.notes, "Visited site");
    assert.equal((await t.call("PATCH", `/api/tender_tasks/${task.id}`, { title: "Renamed" }, pm)).status, 403);
    assert.equal((await t.call("PATCH", `/api/tender_tasks/${task.id}`, { status: "done" }, pm2)).status, 403);        // someone else's task
    assert.equal((await t.call("PATCH", `/api/tender_tasks/${task.id}`, { title: "Renamed", priority: "low" }, gpm)).body.title, "Renamed");
    assert.equal((await t.call("PATCH", `/api/tender_tasks/${task.id}`, { status: "finished" }, pm)).status, 400);
    assert.equal((await t.call("PATCH", "/api/tender_tasks/nope", { status: "done" }, gpm)).status, 404);
    assert.deepEqual((await t.call("GET", "/api/audit?entity=tender_tasks&action=update", null, admin)).body.items[0].changes.status ?? null, null);
  });

  it("deleting a task or a tender cleans up; only assigners delete tasks", async () => {
    const [task] = (await t.call("GET", `/api/tender_tasks?tender=${tender.id}`, null, gpm)).body;
    assert.equal((await t.call("DELETE", `/api/tender_tasks/${task.id}`, null, pm)).status, 403);
    assert.equal((await t.call("DELETE", `/api/tender_tasks/${task.id}`, null, gpm)).status, 200);
    assert.equal((await t.call("DELETE", `/api/tenders/${tender.id}`, null, gpm)).status, 200);
    assert.equal((await t.db.query("SELECT COUNT(*) AS n FROM tender_tasks"))[0].n, 0);
    assert.equal((await t.db.query("SELECT COUNT(*) AS n FROM tender_task_copies"))[0].n, 0);
  });
});
