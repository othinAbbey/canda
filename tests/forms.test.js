import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";

describe("site forms", () => {
  let t, a, b, project;
  const dsr = { conditions: { weather: "Sunny", prepared_by: "Okello" }, progress: { work_done: "Blockwork to ground floor" },
    safety: { toolbox: "yes", ppe: "yes", incidents: "None" }, labour: [{ trade: "Masons", workers: 6 }] };
  before(async () => {
    t = await startTestApp();
    a = await t.account("site@alpha.test"); b = await t.account("site@beta.test");
    project = (await t.call("POST", "/api/projects", { name: "Clinic" }, a)).body;
  });
  after(() => t.close());

  it("lists the templates", async () => {
    const codes = (await t.call("GET", "/api/form_templates", null, a)).body.map((x) => x.code);
    for (const c of ["DSR", "RFI", "CPC"]) assert.ok(codes.includes(c), c);
  });

  it("creates numbered records, copies and edits them", async () => {
    const r1 = await t.call("POST", "/api/forms", { project: project.id, template: "DSR", record_date: "2026-11-24", data: dsr }, a);
    assert.equal(r1.status, 201, JSON.stringify(r1.body)); assert.equal(r1.body.reference, "DSR-001"); assert.equal(r1.body.data.conditions.weather, "Sunny");
    const r2 = await t.call("POST", `/api/forms/${r1.body.id}/copy`, {}, a);
    assert.equal(r2.status, 201); assert.equal(r2.body.reference, "DSR-002");
    const up = await t.call("PATCH", `/api/forms/${r1.body.id}`, { status: "submitted" }, a);
    assert.equal(up.status, 200); assert.equal(up.body.status, "submitted");
    const list = (await t.call("GET", `/api/forms?project=${project.id}`, null, a)).body;
    assert.equal(list.length, 2); assert.equal(list[0].project_name, "Clinic");
    assert.equal((await t.call("POST", "/api/forms", { project: project.id, template: "DSR", data: {} , status: "submitted" }, a)).status, 400);   // required answers missing
  });

  it("another company cannot see, change or file forms against the project", async () => {
    const [rec] = (await t.call("GET", "/api/forms", null, a)).body;
    assert.deepEqual((await t.call("GET", "/api/forms", null, b)).body, []);
    assert.equal((await t.call("GET", `/api/forms/${rec.id}`, null, b)).status, 404);
    assert.equal((await t.call("PATCH", `/api/forms/${rec.id}`, { title: "x" }, b)).status, 404);
    assert.equal((await t.call("DELETE", `/api/forms/${rec.id}`, null, b)).status, 404);
    assert.equal((await t.call("POST", "/api/forms", { project: project.id, template: "DSR", data: dsr }, b)).status, 400);
    assert.equal((await t.call("DELETE", `/api/forms/${rec.id}`, null, a)).status, 200);
  });
});
