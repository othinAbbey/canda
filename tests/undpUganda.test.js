import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUndpProvider } from "../src/tenders/undp.js";

const feed = (items) => `<?xml version="1.0"?><rdf:RDF>${items.map(([id, t, d]) => `<item rdf:about="https://u.test/${id}"><title>${t}</title><link>https://u.test/${id}</link><description>Application Deadline: ${d}</description><dc:date>2026-11-24</dc:date></item>`).join("")}</rdf:RDF>`;
const UGA = feed([["1", "UNDP-UGA-00617 - Construction of Equipment Storage Structures - UNDP - UGANDA", "09-Dec-26"]]);
const RAF = feed([["2", "UNDP-KEN-00100 - Borehole drilling - UNDP - KENYA", "15-Dec-26"]]);
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => "application/xml" }, arrayBuffer: async () => new TextEncoder().encode(body).buffer });

describe("UNDP Uganda", () => {
  it("labels notices with their country office and includes Uganda's feed on an all-countries search", async () => {
    const asked = [];
    const p = createUndpProvider({ fetchImpl: async (url) => { asked.push(url); return reply(url.endsWith("UGA.xml") ? UGA : RAF); } });
    const all = await p.search({});
    assert.deepEqual(all.items.map((x) => x.buyer).sort(), ["UNDP Kenya", "UNDP Uganda"]);
    assert.ok(asked.some((u) => u.endsWith("UGA.xml")) && asked.some((u) => u.endsWith("RAF.xml")));
    const ug = await p.search({ country: "Uganda" });
    assert.equal(ug.total, 1); assert.equal(ug.items[0].buyer, "UNDP Uganda"); assert.equal(ug.items[0].deadline, "2026-12-09");
    assert.match(p.name, /UNDP Uganda/);
  });
  it("still shows Uganda's notices if the Africa feed fails", async () => {
    const p = createUndpProvider({ fetchImpl: async (url) => (url.endsWith("UGA.xml") ? reply(UGA) : reply("", 404)) });
    assert.equal((await p.search({})).total, 1);
  });
});
