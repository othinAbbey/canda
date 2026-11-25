import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readRequirements } from "../src/domain/requirements.js";
import { startTestApp } from "./support/testApp.js";

const BID_TEXT = `INSTRUCTIONS TO BIDDERS
Section 2: Eligibility and qualification requirements
1. Bidders shall submit a certified copy of the Certificate of Incorporation.
2. A valid Trading Licence for 2026.
3. Tax clearance certificate from URA valid at the bid closing date.
4. Bid security of UGX 5,000,000 in the form of a bank guarantee.
5. Evidence of at least two similar works completed in the last five years.
6. CVs of the key staff: site engineer and foreman.
a) Audited financial statements for the last three years.
The mandatory site visit will be held on 2 December 2026 at 10:00 am.
Bids must be sealed, signed and stamped, one original and two copies.
Bidders shall submit a certified copy of the Certificate of Incorporation.
Thank you.`;

describe("built-in requirements reader", () => {
  it("lists the requirements, in order, without duplicates, with a category each", () => {
    const items = readRequirements(BID_TEXT);
    const texts = items.map((i) => i.text);
    assert.equal(texts[0], "Bidders shall submit a certified copy of the Certificate of Incorporation.");
    assert.ok(texts.includes("Bid security of UGX 5,000,000 in the form of a bank guarantee."));
    assert.ok(texts.includes("Audited financial statements for the last three years."));
    assert.ok(texts.some((t) => /site visit/.test(t)));
    assert.equal(texts.filter((t) => /Incorporation/.test(t)).length, 1);            // the repeated line is listed once
    assert.ok(!texts.includes("Thank you.") && !texts.includes("INSTRUCTIONS TO BIDDERS"));
    assert.equal(items.find((i) => /Bid security/.test(i.text)).category, "Bid security and money");
    assert.equal(items.find((i) => /site visit/.test(i.text)).category, "Dates and meetings");
    assert.equal(items.find((i) => /Trading Licence/.test(i.text)).category, "Company documents");
    assert.equal(items.find((i) => /CVs/.test(i.text)).category, "Technical");
  });
  it("breaks a long paragraph into sentences", () => {
    const para = `${"The contract is for the construction of a staff house and associated works in the district. ".repeat(2)}Bidders must provide a work plan. Bidders shall attach proof of NSSF registration.`;
    const texts = readRequirements(para).map((i) => i.text);
    assert.ok(texts.includes("Bidders must provide a work plan."));
    assert.ok(texts.includes("Bidders shall attach proof of NSSF registration."));
  });
});

describe("company tasks: progress, requirements and oversight", () => {
  let t, admin, gpm, pm, pm2, director, viewer, other, ids = {}, task, task2;
  before(async () => {
    t = await startTestApp();
    admin = await t.account("a@x.com");
    const make = async (email, role) => { const tok = await t.account(email, role, admin); ids[email] = (await t.call("GET", "/api/me", null, tok)).body.id; return tok; };
    gpm = await make("gpm@x.com", "general_pm"); pm = await make("pm@x.com", "manager"); pm2 = await make("pm2@x.com", "manager");
    director = await make("d@x.com", "director"); viewer = await make("v@x.com", "viewer");
    other = await t.account("boss@other.com");                                  // another company's administrator
    const tender = (await t.call("POST", "/api/tenders", { title: "Staff house, Gulu", deadline: "2030-12-10", status: "bidding" }, gpm)).body;
    task = (await t.call("POST", `/api/tenders/${tender.id}/tasks`, { title: "Prepare and submit bid", assignee: ids["pm@x.com"], due: "2030-12-03" }, gpm)).body;
    task2 = (await t.call("POST", `/api/tenders/${tender.id}/tasks`, { title: "Price the steel", assignee: ids["pm2@x.com"], due: "2020-01-01" }, gpm)).body;
  });
  after(() => t.close());

  it("the Director role exists and has the oversee right; managers do not", async () => {
    const roles = (await t.call("GET", "/api/roles", null, admin)).body;
    const d = roles.find((r) => r.code === "director");
    assert.equal(d.name, "Director"); assert.ok(d.permissions.includes("tasks:oversee"));
    assert.ok(!roles.find((r) => r.code === "manager").permissions.includes("tasks:oversee"));
    assert.equal((await t.call("GET", "/api/company_tasks", null, pm)).status, 403);
    assert.equal((await t.call("GET", "/api/company_tasks", null, viewer)).status, 403);
    assert.equal((await t.call("GET", "/api/company_tasks", null, director)).status, 200);
    assert.equal((await t.call("GET", "/api/company_tasks", null, admin)).status, 200);
  });

  it("the assignee reads requirements from pasted text and adds the ones they pick", async () => {
    const r = await t.call("POST", `/api/tender_tasks/${task.id}/read_requirements`, { text: BID_TEXT }, pm);
    assert.equal(r.status, 200); assert.equal(r.body.reader, "built-in"); assert.ok(r.body.items.length >= 8);
    assert.equal((await t.call("POST", `/api/tender_tasks/${task.id}/read_requirements`, { text: "short" }, pm)).status, 400);
    const pick = r.body.items.slice(0, 4);
    const added = await t.call("POST", `/api/tender_tasks/${task.id}/requirements`, { items: pick, source: "reader" }, pm);
    assert.equal(added.status, 201); assert.equal(added.body.checklist.length, 4);
    assert.equal(added.body.checklist[0].source, "reader"); assert.ok(added.body.checklist[0].category);
    await t.call("POST", `/api/tender_tasks/${task.id}/requirements`, { text: "Fill in the form of bid" }, pm);
    const again = await t.call("POST", `/api/tender_tasks/${task.id}/read_requirements`, { text: BID_TEXT }, pm);
    assert.equal(again.body.items.filter((i) => i.already).length, 4);                // already on the checklist
  });

  it("ticking requirements moves the progress; not applicable items do not count", async () => {
    const d = (await t.call("GET", `/api/tender_tasks/${task.id}`, null, pm)).body;
    assert.equal(d.can_edit, true); assert.equal(d.progress, 0); assert.deepEqual(d.requirements, { total: 5, done: 0, na: 0 });
    const [a, b, c] = d.checklist;
    const r1 = await t.call("PATCH", `/api/tender_requirements/${a.id}`, { status: "done", note: "Collected from registry" }, pm);
    assert.equal(r1.status, 200); assert.equal(r1.body.checklist[0].done_by_email, "pm@x.com"); assert.equal(r1.body.checklist[0].note, "Collected from registry");
    await t.call("PATCH", `/api/tender_requirements/${b.id}`, { status: "done" }, pm);
    const r3 = await t.call("PATCH", `/api/tender_requirements/${c.id}`, { status: "na" }, pm);
    assert.equal(r3.body.checklist.find((x) => x.id === c.id).status, "na");
    const after = (await t.call("GET", `/api/tender_tasks/${task.id}`, null, pm)).body;
    assert.deepEqual(after.requirements, { total: 4, done: 2, na: 1 }); assert.equal(after.progress, 50);
    assert.equal((await t.call("PATCH", `/api/tender_requirements/${a.id}`, { status: "maybe" }, pm)).status, 400);
  });

  it("progress notes and stages build the timeline; the stage starts the task", async () => {
    const r = await t.call("POST", `/api/tender_tasks/${task.id}/updates`, { body: "Bought the bid documents.", stage: "documents" }, pm);
    assert.equal(r.status, 201); assert.equal(r.body.stage, "documents"); assert.equal(r.body.stage_name, "Getting the bid documents"); assert.equal(r.body.status, "doing");
    assert.match(r.body.updates[0].body, /Moved to: Getting the bid documents\. Bought the bid documents\./);
    const p = await t.call("PATCH", `/api/tender_tasks/${task.id}`, { stage: "site_visit" }, pm);
    assert.equal(p.body.stage, "site_visit"); assert.match(p.body.last_update.body, /Site visit/);
    assert.equal((await t.call("POST", `/api/tender_tasks/${task.id}/updates`, { stage: "flying" }, pm)).status, 400);
    assert.equal((await t.call("POST", `/api/tender_tasks/${task.id}/updates`, { body: " " }, pm)).status, 400);
  });

  it("directors see everything but cannot change it; others in the company cannot change it either", async () => {
    const d = await t.call("GET", `/api/tender_tasks/${task.id}`, null, director);
    assert.equal(d.status, 200); assert.equal(d.body.can_edit, false); assert.equal(d.body.checklist.length, 5);
    assert.equal((await t.call("POST", `/api/tender_tasks/${task.id}/updates`, { body: "hi" }, director)).status, 403);
    assert.equal((await t.call("PATCH", `/api/tender_requirements/${d.body.checklist[3].id}`, { status: "done" }, director)).status, 403);
    assert.equal((await t.call("POST", `/api/tender_tasks/${task.id}/requirements`, { text: "x requirement" }, pm2)).status, 404);   // pm2 has nothing to do with this task
    assert.equal((await t.call("GET", `/api/tender_tasks/${task.id}`, null, viewer)).status, 404);
    // the general PM assigns tasks, so may also work on them
    assert.equal((await t.call("POST", `/api/tender_tasks/${task.id}/updates`, { body: "Checked the pricing" }, gpm)).status, 201);
  });

  it("the company view totals the work and shows how each person is doing", async () => {
    const r = (await t.call("GET", "/api/company_tasks", null, director)).body;
    assert.equal(r.totals.tasks, 2); assert.equal(r.totals.open, 2); assert.equal(r.totals.overdue, 1);
    assert.equal(r.tasks[0].id, task2.id);                                        // overdue first
    const mine = r.tasks.find((x) => x.id === task.id);
    assert.equal(mine.progress, 50); assert.equal(mine.stage, "site_visit"); assert.equal(mine.last_update.body, "Checked the pricing");
    const p1 = r.people.find((p) => p.id === ids["pm@x.com"]), p2 = r.people.find((p) => p.id === ids["pm2@x.com"]);
    assert.equal(p1.average_progress, 50); assert.equal(p2.overdue, 1); assert.equal(r.people[0].id, ids["pm2@x.com"]);
    assert.equal(r.stages.length, 7);
    const only = (await t.call("GET", `/api/company_tasks?assignee=${ids["pm@x.com"]}`, null, director)).body;
    assert.deepEqual(only.tasks.map((x) => x.id), [task.id]);
    // My assignments shows the same progress
    assert.equal((await t.call("GET", "/api/tender_tasks?mine=1", null, pm)).body[0].progress, 50);
  });

  it("another company sees none of it", async () => {
    assert.equal((await t.call("GET", "/api/company_tasks", null, other)).body.tasks.length, 0);
    assert.equal((await t.call("GET", `/api/tender_tasks/${task.id}`, null, other)).status, 404);
    const req = (await t.call("GET", `/api/tender_tasks/${task.id}`, null, pm)).body.checklist[0];
    assert.equal((await t.call("PATCH", `/api/tender_requirements/${req.id}`, { status: "pending" }, other)).status, 404);
    assert.equal((await t.call("DELETE", `/api/tender_requirements/${req.id}`, null, other)).status, 404);
  });

  it("requirements can be removed, and go with the tender", async () => {
    const d = (await t.call("GET", `/api/tender_tasks/${task.id}`, null, pm)).body;
    const r = await t.call("DELETE", `/api/tender_requirements/${d.checklist[4].id}`, null, pm);
    assert.equal(r.status, 200); assert.equal(r.body.checklist.length, 4);
    assert.equal((await t.call("DELETE", `/api/tender_tasks/${task.id}`, null, gpm)).status, 200);
    // the checklist belongs to the tender, so it stays when a task is deleted, and goes with the tender
    assert.equal((await t.db.query("SELECT COUNT(*) AS n FROM tender_requirements")).map((x) => Number(x.n))[0], 4);
    assert.equal((await t.call("DELETE", `/api/tenders/${task.tender}`, null, gpm)).status, 200);
    assert.equal((await t.db.query("SELECT COUNT(*) AS n FROM tender_requirements")).map((x) => Number(x.n))[0], 0);
  });
});
