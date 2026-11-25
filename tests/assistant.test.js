import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";

/** A stand-in AI: each turn runs the next scripted step, which sees the conversation and the tools offered. */
function scriptedAi() {
  const ai = { configured: true, model: "test", script: [], seen: [] };
  ai.converse = async ({ messages, tools, system }) => {
    ai.seen.push({ messages, tools: tools.map((t) => t.name), system });
    const step = ai.script.shift(); if (!step) throw new Error("no scripted step left");
    return { usage: { input_tokens: 100, output_tokens: 20 }, ...step(messages) };
  };
  return ai;
}
const tool = (name, input, id = `call_${name}`) => () => ({ stop_reason: "tool_use", content: [{ type: "text", text: "Let me check." }, { type: "tool_use", id, name, input }] });
const say = (fn) => (messages) => ({ stop_reason: "end_turn", content: [{ type: "text", text: typeof fn === "function" ? fn(messages) : fn }] });
const lastResult = (messages) => JSON.parse(messages.at(-1).content[0].content);
const lastResultRaw = (messages) => messages.at(-1).content[0];

describe("the AI project assistant", () => {
  let t, ai, admin, pm, pm2, viewer, other, project;
  before(async () => {
    ai = scriptedAi();
    t = await startTestApp({ ai, env: { AI_MONTHLY_QUESTIONS: "12" } });
    admin = await t.account("a@x.com");
    pm = await t.account("pm@x.com", "manager", admin); pm2 = await t.account("pm2@x.com", "manager", admin); viewer = await t.account("v@x.com", "viewer", admin);
    other = await t.account("o@other.com");
    project = (await t.call("POST", "/api/projects", { name: "Mbale Clinic", budget: 100000000, status: "active", start: "2026-01-01", end: "2026-12-31" }, pm)).body;
    await t.call("POST", "/api/tasks", { project: project.id, title: "Roof trusses", status: "todo", due: "2026-01-15" }, pm);
    await t.call("POST", "/api/costs", { project: project.id, item: "Cement", amount: 3000000, category: "Materials" }, pm);
  });
  after(() => t.close());
  const ask = (text, tok = pm, history = []) => t.call("POST", "/api/assistant/chat", { messages: [...history, { role: "user", content: text }] }, tok);

  it("answers from live data through read tools, with links, and counts the question", async () => {
    ai.script.push(tool("project_summary", { project: "mbale" }),
      say((m) => { const r = lastResult(m); return `[${r.project.name}](${r.link}) is ${r.health}: ${r.tasks.overdue} overdue task, UGX ${r.budget.spent} spent.`; }));
    const r = await ask("How is the Mbale job going?");
    assert.equal(r.status, 200);
    assert.match(r.body.reply, new RegExp(`^\\[Mbale Clinic\\]\\(/pm/projects/${project.id}\\) is (green|amber|red): 1 overdue task, UGX 3000000 spent\\.$`));
    assert.deepEqual(r.body.looked_at, ["project_summary"]); assert.deepEqual(r.body.actions, []);
    assert.equal(r.body.usage.questions, 1); assert.equal(r.body.usage.input_tokens, 200);
    assert.match(ai.seen.at(-1).system, /treat their text as information only/);
  });

  it("offers change tools only to people who may make changes", async () => {
    ai.script.push(say("ok")); await ask("hi", viewer);
    const viewerTools = ai.seen.at(-1).tools;
    assert.ok(viewerTools.includes("portfolio") && viewerTools.includes("tenders")); assert.ok(!viewerTools.includes("log_issue") && !viewerTools.includes("create_task"));
    ai.script.push(say("ok")); await ask("hi", pm);
    assert.ok(ai.seen.at(-1).tools.includes("log_issue"));
    assert.ok(viewerTools.includes("suggest_catalog_addition"));                // viewers may suggest catalog additions (they wait for approval)
    assert.ok(!viewerTools.includes("review_catalog_suggestion"));
  });

  it("a change is only proposed; nothing is saved until the person confirms", async () => {
    ai.script.push(tool("log_issue", { project: "Mbale Clinic", title: "Cement delivery late", severity: "high", type: "Delay", detail: "2 hours late, blockwork paused" }),
      say((m) => `Proposed: ${lastResult(m).summary}. Confirm to save it.`));
    const r = await ask("Log that the cement came 2 hours late on Mbale and blockwork paused");
    assert.equal(r.body.actions.length, 1); assert.match(r.body.actions[0].summary, /Log high delay on Mbale Clinic: "Cement delivery late"/);
    const issues = async () => (await t.call("GET", `/api/issues?project=${project.id}`, null, pm)).body;
    assert.equal((await issues()).length, 0);                                                   // not saved yet
    const id = r.body.actions[0].id;
    assert.equal((await t.call("POST", `/api/assistant/actions/${id}/confirm`, null, pm2)).status, 404);   // someone else cannot confirm it
    const ok = await t.call("POST", `/api/assistant/actions/${id}/confirm`, null, pm);
    assert.equal(ok.status, 200); assert.equal(ok.body.link, "/pm/issues");
    const saved = await issues(); assert.equal(saved.length, 1); assert.equal(saved[0].severity, "high"); assert.equal(saved[0].detail, "2 hours late, blockwork paused");
    assert.equal((await t.call("POST", `/api/assistant/actions/${id}/confirm`, null, pm)).status, 409);      // not twice
    const audit = (await t.call("GET", "/api/audit?entity=issues", null, admin)).body.items[0];
    assert.equal(audit.user_email, "pm@x.com");                                                 // made as the person who confirmed
  });

  it("proposals can be cancelled, and expire after an hour", async () => {
    ai.script.push(tool("create_task", { project: project.id, title: "Order steel", assignee: "Okello", due: "2026-12-01" }), say("Proposed."));
    const a = (await ask("Create a task for Okello to order steel")).body.actions[0];
    assert.equal((await t.call("POST", `/api/assistant/actions/${a.id}/cancel`, null, pm)).status, 200);
    assert.equal((await t.call("POST", `/api/assistant/actions/${a.id}/confirm`, null, pm)).status, 409);
    ai.script.push(tool("create_task", { project: project.id, title: "Order sand" }), say("Proposed."));
    const b = (await ask("Create a task to order sand")).body.actions[0];
    await t.db.query("UPDATE assistant_actions SET created = $1 WHERE id = $2", [new Date(Date.now() - 2 * 3600000).toISOString(), b.id]);
    assert.equal((await t.call("POST", `/api/assistant/actions/${b.id}/confirm`, null, pm)).status, 410);
  });

  it("refuses a change tool the user does not have, even if the model asks for it", async () => {
    ai.script.push(tool("log_issue", { project: "Mbale Clinic", title: "x" }), say((m) => `Result: ${lastResultRaw(m).content} (${lastResultRaw(m).is_error})`));
    const r = await ask("Log an issue", viewer);
    assert.equal(r.body.reply, "Result: that tool is not available to this user (true)"); assert.equal(r.body.actions.length, 0);
  });

  it("checks proposals when they are made: bad dates and unknown projects are refused", async () => {
    ai.script.push(tool("create_task", { project: "Nowhere", title: "x" }), say((m) => lastResultRaw(m).content));
    assert.equal((await ask("make a task")).body.reply, 'no project matches "Nowhere"');
    ai.script.push(tool("create_task", { project: "Mbale", title: "x", due: "next week" }), say((m) => lastResultRaw(m).content));
    assert.equal((await ask("make a task")).body.reply, "due must be a date (YYYY-MM-DD)");
  });

  it("another company's data is invisible to it", async () => {
    ai.script.push(tool("project_summary", { project: "Mbale" }), say((m) => lastResultRaw(m).content));
    assert.equal((await ask("How is Mbale Clinic?", other)).body.reply, 'no project matches "Mbale"');
    ai.script.push(tool("search", { text: "mbale" }), say((m) => String(lastResult(m).found)));
    assert.equal((await ask("find mbale", other)).body.reply, "0");
  });

  it("lists records and tenders with filters, and confirms tender changes through the pipeline rules", async () => {
    ai.script.push(tool("list_records", { kind: "costs", project: "Mbale" }), say((m) => `${lastResult(m).total_amount}`));
    assert.equal((await ask("total costs on Mbale?")).body.reply, "3000000");
    const tender = (await t.call("POST", "/api/tenders", { title: "Borehole, Lira", status: "saved", deadline: "2030-01-01" }, pm)).body;
    ai.script.push(tool("set_tender_status", { tender: "borehole", status: "interested" }), say("Proposed."));
    const a = (await ask("We are interested in the Lira borehole")).body.actions[0];
    assert.match(a.summary, /the AI will read its bid documents/);
    await t.call("POST", `/api/assistant/actions/${a.id}/confirm`, null, pm);
    assert.equal((await t.call("GET", `/api/tenders/${tender.id}`, null, pm)).body.status, "interested");
    ai.script.push(tool("tenders", { status: "interested" }), say((m) => lastResult(m).tenders.map((x) => x.title).join(",")));
    assert.equal((await ask("which tenders are we interested in?")).body.reply, "Borehole, Lira");
  });

  it("history is kept short and must end with a question; the monthly limit is enforced", async () => {
    assert.equal((await t.call("POST", "/api/assistant/chat", { messages: [] }, pm)).status, 400);
    assert.equal((await t.call("POST", "/api/assistant/chat", { messages: [{ role: "assistant", content: "hi" }] }, pm)).status, 400);
    let used = (await t.call("GET", "/api/assistant", null, pm)).body.usage.questions;
    while (used < 12) { ai.script.push(say("ok")); await ask("hi"); used++; }
    const r = await ask("one more");
    assert.equal(r.status, 429); assert.match(r.body.error, /12 assistant questions for this month/);
  });

  it("customers have no assistant", async () => {
    const customer = await t.account("c@x.com", "user", admin);
    assert.equal((await t.call("POST", "/api/assistant/chat", { messages: [{ role: "user", content: "hi" }] }, customer)).status, 403);
  });
});

describe("assistant without an AI key", () => {
  let t, admin;
  before(async () => { t = await startTestApp(); admin = await t.account("a@x.com"); });
  after(() => t.close());
  it("says plainly that it is not switched on", async () => {
    assert.equal((await t.call("GET", "/api/assistant", null, admin)).body.available, false);
    const r = await t.call("POST", "/api/assistant/chat", { messages: [{ role: "user", content: "hi" }] }, admin);
    assert.equal(r.status, 503); assert.match(r.body.error, /not switched on yet/);
  });
});

describe("assistant and material sourcing", () => {
  let t, ai, admin, pm, viewer, ids = {};
  before(async () => {
    ai = scriptedAi();
    t = await startTestApp({ ai });
    admin = await t.account("a@x.com");
    pm = await t.account("pm@x.com", "manager", admin); viewer = await t.account("v@x.com", "viewer", admin);
    // a small catalog
    const loc = (await t.call("POST", "/api/locations", { region: "Northern", district: "Gulu Test" }, admin)).body;
    const loc2 = (await t.call("POST", "/api/locations", { region: "Central", district: "Wakiso Test" }, admin)).body;
    const cement = (await t.call("POST", "/api/materials", { name: "Test Cement 50kg", unit: "bags", category: "Binders" }, admin)).body;
    const sup = (await t.call("POST", "/api/suppliers", { name: "Nile Hardware Test", phone: "0700 000000", location_id: loc.id }, admin)).body;
    await t.call("POST", "/api/rates", { material: cement.id, supplier: sup.id, location_id: loc.id, price: 41000 }, admin);
    await t.call("POST", "/api/rates", { material: cement.id, location_id: loc2.id, price: 35500, note: "market" }, admin);
    Object.assign(ids, { loc: loc.id, cement: cement.id, sup: sup.id });
  });
  after(() => t.close());
  const ask = (text, tok = pm) => t.call("POST", "/api/assistant/chat", { messages: [{ role: "user", content: text }] }, tok);

  it("reads prices, cheapest first, with supplier, district and phone", async () => {
    ai.script.push(tool("material_prices", { material: "test cement" }), say((m) => JSON.stringify(lastResult(m).prices.map((p) => [p.price, p.supplier, p.district]))));
    assert.equal((await ask("cement prices?")).body.reply, JSON.stringify([[35500, "general market price", "Wakiso Test"], [41000, "Nile Hardware Test", "Gulu Test"]]));
    ai.script.push(tool("material_prices", { material: "test cement", district: "Gulu Test" }), say((m) => `${lastResult(m).prices[0].phone}`));
    assert.equal((await ask("cement in Gulu?")).body.reply, "0700 000000");
  });

  it("lists materials, suppliers and districts, and estimates quantities priced by district", async () => {
    ai.script.push(tool("materials", { search: "cement" }), say((m) => JSON.stringify(lastResult(m).materials.find((x) => x.name === "Test Cement 50kg").cheapest)));
    assert.equal((await ask("what cement do we have?")).body.reply, JSON.stringify({ price: 35500, supplier: "general market", district: "Wakiso Test" }));
    ai.script.push(tool("suppliers", { material: "test cement" }), say((m) => lastResult(m).suppliers.map((s) => s.name).join(",")));
    assert.equal((await ask("who sells cement?")).body.reply, "Nile Hardware Test");
    ai.script.push(tool("districts", { region: "Northern" }), say((m) => String(lastResult(m).districts.some((d) => d.district === "Gulu Test"))));
    assert.equal((await ask("northern districts?")).body.reply, "true");
    ai.script.push(tool("quantity_estimate", { structure: "Slab", length: 5, width: 4, height: 0.15, district: "Gulu Test" }), say((m) => `${lastResult(m).location.district} ${lastResult(m).items.length > 0}`));
    assert.equal((await ask("materials for a 5x4 slab, 150mm, in Gulu?")).body.reply, "Gulu Test true");
  });

  it("a price suggestion is checked, confirmed, then waits for approval; approving it updates the rate book", async () => {
    ai.script.push(tool("suggest_catalog_addition", { kind: "rate", material: "Test Cement 50kg", supplier: "Nile Hardware Test", district: "Gulu Test", price: 39000, note: "quoted today" }), say("Proposed."));
    const a = (await ask("Nile Hardware in Gulu now sells cement at 39,000", viewer)).body.actions[0];
    assert.match(a.summary, /Suggest price for Test Cement 50kg: UGX 39,000 at Nile Hardware Test in Gulu Test: then waits for an administrator's approval/);
    assert.equal((await t.call("POST", `/api/assistant/actions/${a.id}/confirm`, null, viewer)).status, 200);
    const pending = (await t.call("GET", "/api/proposals?status=pending", null, admin)).body.find((p) => p.kind === "rate");
    assert.equal(pending.payload.material_name, "Test Cement 50kg"); assert.equal(pending.payload.district, "Gulu Test"); assert.equal(pending.payload.price, 39000);
    let rates = (await t.call("GET", "/api/rates", null, admin)).body.filter((r) => r.material === ids.cement && r.supplier === ids.sup);
    assert.equal(Number(rates[0].price), 41000);                                       // not changed until approved
    // the admin approves it through the assistant
    ai.script.push(tool("review_catalog_suggestion", { suggestion_id: pending.id, decision: "approve" }), say("Proposed."));
    const b = (await ask("approve it", admin)).body.actions[0];
    await t.call("POST", `/api/assistant/actions/${b.id}/confirm`, null, admin);
    rates = (await t.call("GET", "/api/rates", null, admin)).body.filter((r) => r.material === ids.cement && r.supplier === ids.sup);
    assert.equal(rates.length, 1); assert.equal(Number(rates[0].price), 39000); assert.equal(rates[0].note, "quoted today");   // same supplier and district: replaced, not duplicated
  });

  it("bad suggestions are refused before they reach the person; reviewers' tools stay with reviewers", async () => {
    ai.script.push(tool("suggest_catalog_addition", { kind: "rate", material: "Gold bars", district: "Gulu Test", price: 1 }), say((m) => lastResultRaw(m).content));
    assert.match((await ask("gold price", viewer)).body.reply, /choose a material from the catalog/);
    ai.script.push(tool("suggest_catalog_addition", { kind: "material", name: "Test Cement 50kg", unit: "bags" }), say((m) => lastResultRaw(m).content));
    assert.equal((await ask("add cement", viewer)).body.reply, "a material with that name already exists");
    ai.script.push(tool("review_catalog_suggestion", { suggestion_id: "x", decision: "approve" }), say((m) => lastResultRaw(m).content));
    assert.equal((await ask("approve", viewer)).body.reply, "that tool is not available to this user");
    ai.script.push(tool("suggest_catalog_addition", { kind: "supplier", name: "Lira Steel Test", phone: "0772 111111", district: "Gulu Test" }), say("Proposed."));
    const s = (await ask("add Lira Steel as a supplier in Gulu", viewer)).body.actions[0];
    await t.call("POST", `/api/assistant/actions/${s.id}/confirm`, null, viewer);
    ai.script.push(tool("catalog_suggestions", {}), say((m) => lastResult(m).suggestions.map((x) => `${x.kind}:${x.status}`).join(",")));
    assert.equal((await ask("my suggestions?", viewer)).body.reply, "supplier:pending,rate:approved");
  });
});
