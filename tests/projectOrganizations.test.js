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
