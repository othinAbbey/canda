import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";

describe("project organization isolation", () => {
  let t, companyA, companyB, projectA, taskA, fileA;

  before(async () => {
    t = await startTestApp();
    companyA = await t.account("a@company-a.test");
    companyB = await t.account("b@company-b.test");
    projectA = (await t.call("POST", "/api/projects", { name: "Company A project" }, companyA)).body;
    taskA = (await t.call("POST", "/api/tasks", { project: projectA.id, title: "Company A task" }, companyA)).body;
    const uploaded = await t.call("POST", `/api/files?project=${projectA.id}&name=notes.txt`, undefined, companyA, Buffer.from("company A"));
    fileA = uploaded.body;
  });
  after(() => t.close());

  it("only lists each company's projects and project children", async () => {
    const projects = await t.call("GET", "/api/projects", null, companyB);
    const data = await t.call("GET", "/api/data", null, companyB);
    const tasks = await t.call("GET", `/api/tasks?project=${projectA.id}`, null, companyB);
    assert.deepEqual(projects.body, []);
    assert.deepEqual(data.body.projects, []);
    assert.deepEqual(data.body.tasks, []);
    assert.deepEqual(tasks.body, []);
  });

  it("hides another company's project, task, summary and schedule by id", async () => {
    for (const path of [
      `/api/projects/${projectA.id}`,
      `/api/tasks/${taskA.id}`,
      `/api/projects/${projectA.id}/summary`,
      `/api/projects/${projectA.id}/schedule`,
    ]) {
      assert.equal((await t.call("GET", path, null, companyB)).status, 404, path);
    }
  });

  it("rejects cross-company project creation and updates", async () => {
    assert.equal((await t.call("POST", "/api/tasks", { project: projectA.id, title: "Foreign task" }, companyB)).status, 404);
    assert.equal((await t.call("PATCH", `/api/projects/${projectA.id}`, { name: "Changed by B" }, companyB)).status, 404);
    assert.equal((await t.call("DELETE", `/api/projects/${projectA.id}`, null, companyB)).status, 404);
    assert.equal((await t.call("GET", `/api/projects/${projectA.id}`, null, companyA)).body.name, "Company A project");
  });

  it("keeps documents and audit records inside their company", async () => {
    assert.deepEqual((await t.call("GET", `/api/files?project=${projectA.id}`, null, companyB)).body, []);
    assert.equal((await t.call("GET", `/api/files/${fileA.id}/download`, null, companyB)).status, 404);
    assert.equal((await t.call("DELETE", `/api/files/${fileA.id}`, null, companyB)).status, 404);
    const audit = await t.call("GET", "/api/audit", null, companyB);
    assert.equal(audit.status, 200);
    assert.equal(audit.body.items.some((r) => r.project === projectA.id), false);
  });
});

describe("project organization isolation: every project area", () => {
  let t, a, b, project, task, taskB, projectB;
  before(async () => {
    t = await startTestApp();
    a = await t.account("owner@alpha.test");
    b = await t.account("owner@beta.test");
    project = (await t.call("POST", "/api/projects", { name: "Alpha HQ", budget: 1000 }, a)).body;
    task = (await t.call("POST", "/api/tasks", { project: project.id, title: "Alpha slab" }, a)).body;
    for (const [path, body] of [["costs", { item: "Cement", amount: 5 }], ["logs", { work: "Digging" }], ["issues", { title: "Clash" }]])
      assert.equal((await t.call("POST", `/api/${path}`, { project: project.id, ...body }, a)).status, 201);
    projectB = (await t.call("POST", "/api/projects", { name: "Beta Shop" }, b)).body;
    taskB = (await t.call("POST", "/api/tasks", { project: projectB.id, title: "Beta roof" }, b)).body;
  });
  after(() => t.close());

  it("each company sees only its own costs, logs, issues and portfolio", async () => {
    for (const path of ["costs", "logs", "issues", "tasks", "projects"]) {
      const rows = (await t.call("GET", `/api/${path}`, null, b)).body;
      assert.ok(rows.every((r) => (r.project ?? r.id) !== project.id), path);
    }
    const data = (await t.call("GET", "/api/data", null, b)).body;
    assert.deepEqual(data.projects.map((p) => p.name), ["Beta Shop"]);
    assert.equal(data.costs.length + data.logs.length + data.issues.length, 0);
    const portfolio = (await t.call("GET", "/api/summary", null, b)).body;
    if (portfolio?.projects) assert.deepEqual(portfolio.projects.map((p) => p.name), ["Beta Shop"]);
    const exported = (await t.call("GET", "/api/export", null, b)).body;
    assert.deepEqual(exported.projects.map((p) => p.name), ["Beta Shop"]);
  });

  it("cannot read, change or delete another company's project records by id", async () => {
    const cost = (await t.call("GET", "/api/costs", null, a)).body[0];
    assert.equal((await t.call("GET", `/api/costs/${cost.id}`, null, b)).status, 404);
    assert.equal((await t.call("PATCH", `/api/costs/${cost.id}`, { amount: 1 }, b)).status, 404);
    assert.equal((await t.call("DELETE", `/api/costs/${cost.id}`, null, b)).status, 404);
    assert.equal((await t.call("PATCH", `/api/tasks/${task.id}`, { title: "hijacked" }, b)).status, 404);
    assert.equal((await t.call("PATCH", `/api/tasks/${taskB.id}`, { project: project.id }, b)).status, 404);   // cannot move own task into another company's project
    assert.equal((await t.call("GET", `/api/costs/${cost.id}`, null, a)).body.amount, 5);
  });

  it("cannot link to, nest under or upload into another company's project", async () => {
    assert.equal((await t.call("PATCH", `/api/tasks/${taskB.id}`, { parent: task.id }, b)).status, 400);
    const link = await t.call("POST", "/api/task_links", { predecessor: task.id, successor: taskB.id }, b);
    assert.ok([400, 404].includes(link.status), `link status ${link.status}`);
    const up = await t.call("POST", `/api/files?project=${project.id}&name=x.txt`, undefined, b, Buffer.from("x"));
    assert.ok([400, 404].includes(up.status));
    assert.equal((await t.call("POST", `/api/projects/${project.id}/schedule/apply`, {}, b)).status, 404);
  });
});
