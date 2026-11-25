import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { decode, parseFeed } from "../src/tenders/rss.js";
import { createAfdbProvider, normalizeAfdb } from "../src/tenders/afdb.js";
import { createUndpProvider } from "../src/tenders/undp.js";
import { mentions } from "../src/tenders/feedTools.js";
import { startTestApp } from "./support/testApp.js";

// Shaped like the real AfDB feed: RSS 2.0, "type - country - project" titles, repeated items, double-encoded apostrophes.
const AFDB = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Projects Procurement</title>
<item><title>Avis d&amp;#039;appel d&amp;#039;offres - Ouganda - Projet d&amp;#039;eau de Kampala</title><link>https://www.afdb.org/en/documents/a1</link>
<description>&lt;p&gt;Construction of water mains&lt;/p&gt;</description><pubDate>Mon, 23 Nov 2026 20:11:52 +0000</pubDate><guid isPermaLink="true">https://www.afdb.org/node/1</guid></item>
<item><title>Avis d&amp;#039;appel d&amp;#039;offres - Ouganda - Projet d&amp;#039;eau de Kampala</title><link>https://www.afdb.org/en/documents/a1</link><pubDate>Mon, 23 Nov 2026 20:11:52 +0000</pubDate><guid isPermaLink="true">https://www.afdb.org/node/1</guid></item>
<item><title>Specific Procurement Notice - Kenya - Road upgrade Lot 2</title><link>https://www.afdb.org/en/documents/b2</link><description><![CDATA[Civil works for roads]]></description><pubDate>Tue, 24 Nov 2026 08:00:00 +0000</pubDate><guid>https://www.afdb.org/node/2</guid></item>
<item><title>General Procurement Notice - Uganda - Rural electrification</title><link>https://www.afdb.org/en/documents/c3</link><description></description><pubDate>Fri, 20 Nov 2026 08:00:00 +0000</pubDate><guid>https://www.afdb.org/node/3</guid></item>
</channel></rss>`;
// Shaped like UNDP's real country feeds (RSS 1.0 / RDF): "REF - title - UNDP - COUNTRY", deadline in the description.
const UNDP = `<?xml version="1.0" encoding="ISO-8859-1" ?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://procurement-notices.undp.org/"><title>UNDP Procurement Notices</title></channel>
<item rdf:about="https://procurement-notices.undp.org/view_negotiation.cfm?nego_id=52056"><title>UNDP-UGA-00617 - Construction of Equipment Storage Structures - UNDP - UGANDA</title><link>https://procurement-notices.undp.org/view_negotiation.cfm?nego_id=52056</link>
<description>Application Deadline: 09-Dec-26</description><dc:date>2026-11-24T00:00:00-05:00</dc:date></item>
<item rdf:about="https://procurement-notices.undp.org/view_negotiation.cfm?nego_id=50604"><title>UNDP-HQ-02355 - Project to Improve Waste Management in Masaka City, Uganda - UNDP - UGANDA</title><link>https://procurement-notices.undp.org/view_negotiation.cfm?nego_id=50604</link>
<description>Application Deadline: 10-Dec-26</description><dc:date>2026-10-12T00:00:00-05:00</dc:date></item>
</rdf:RDF>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom notice</title><link href="https://x.test/1"/><id>tag:x,1</id><updated>2026-11-01T00:00:00Z</updated><summary>Hello &amp; welcome</summary></entry></feed>`;
const fakeFetch = (body, status = 200) => {
  const f = async (url) => { f.calls++; f.urls.push(url); const bytes = Buffer.from(body, /ISO-8859-1/i.test(body.slice(0, 100)) ? "latin1" : "utf8");
    return { ok: status < 400, status, headers: { get: () => null }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }; };
  f.calls = 0; f.urls = []; return f;
};

describe("tender feeds", () => {
  it("reads RSS 2.0, RSS 1.0 (RDF) and Atom, decoding double-encoded text", () => {
    assert.equal(decode("d&amp;#039;eau"), "d'eau");
    const a = parseFeed(AFDB);
    assert.equal(a.length, 4); assert.equal(a[0].title, "Avis d'appel d'offres - Ouganda - Projet d'eau de Kampala"); assert.equal(a[0].description, "Construction of water mains");
    assert.equal(a[2].description, "Civil works for roads");
    const u = parseFeed(UNDP);
    assert.equal(u.length, 2); assert.equal(u[0].date, "2026-11-24T00:00:00-05:00"); assert.equal(u[0].id, "https://procurement-notices.undp.org/view_negotiation.cfm?nego_id=52056");
    const t = parseFeed(ATOM);
    assert.deepEqual([t[0].title, t[0].link, t[0].description], ["Atom notice", "https://x.test/1", "Hello & welcome"]);
  });

  it("matches countries by English and French names, and office codes as whole words", () => {
    assert.ok(mentions("Avis - Ouganda - x", "Uganda")); assert.ok(mentions("UNDP-UGA-00321", "Uganda"));
    assert.ok(!mentions("Bugaga village", "Uganda")); assert.ok(mentions("anything", ""));
  });

  it("AfDB: splits the title, de-duplicates, filters by country and keywords, newest first, fetches once", async () => {
    assert.deepEqual(Object.fromEntries(Object.entries(normalizeAfdb(parseFeed(AFDB)[0])).filter(([k]) => ["title", "country", "type", "published"].includes(k))),
      { title: "Projet d'eau de Kampala", country: "Uganda", type: "Avis d'appel d'offres", published: "2026-11-23" });
    const f = fakeFetch(AFDB), p = createAfdbProvider({ fetchImpl: f });
    const ug = await p.search({ country: "Uganda" });
    assert.deepEqual(ug.items.map((x) => x.title), ["Projet d'eau de Kampala", "Rural electrification"]);
    assert.equal((await p.search({ q: "road" })).items[0].country, "Kenya");
    assert.equal((await p.search({ country: "Uganda", q: "water" })).total, 1);
    assert.equal(f.calls, 1);                                                             // the feed is kept for 10 minutes
  });

  it("UNDP: reads the real title format and short deadlines; picks the country office feed, or Africa", async () => {
    const f = fakeFetch(UNDP), p = createUndpProvider({ fetchImpl: f });
    const ug = await p.search({ country: "Uganda" });
    assert.deepEqual(ug.items.map((x) => [x.title, x.country, x.deadline, x.published, x.description]), [
      ["Construction of Equipment Storage Structures", "Uganda", "2026-12-09", "2026-11-24", "Ref UNDP-UGA-00617"],
      ["Project to Improve Waste Management in Masaka City, Uganda", "Uganda", "2026-12-10", "2026-10-12", "Ref UNDP-HQ-02355"]]);
    assert.equal((await p.search({ country: "Uganda", q: "storage" })).total, 1);
    await p.search({});                                                        // all countries -> the Africa feed
    await p.search({ country: "Tanzania" });
    assert.deepEqual(f.urls.map((u) => u.split("/").pop()), ["UGA.xml", "RAF.xml", "URT.xml"]);
    assert.equal((await p.search({ country: "Narnia" })).total, 0);
  });

  it("decodes feeds in the charset they declare", async () => {
    const latin = `<?xml version="1.0" encoding="ISO-8859-1" ?><rss version="2.0"><channel><item><title>R\u00e9habilitation - Ouganda - \u00c9cole</title><link>https://x/1</link><guid>g1</guid></item></channel></rss>`;
    const p = createAfdbProvider({ fetchImpl: fakeFetch(latin) });
    assert.equal((await p.search({})).items[0].title, "\u00c9cole");
  });

  it("explains a bad address or an outage", async () => {
    await assert.rejects(createAfdbProvider({ fetchImpl: fakeFetch("<html>nope</html>") }).search({}), /did not send a feed/);
    await assert.rejects(createAfdbProvider({ fetchImpl: fakeFetch("", 503) }).search({}), /error \(503\)/);
    await assert.rejects(createAfdbProvider({ fetchImpl: async () => { throw new Error("x"); } }).search({}), /did not answer/);
  });
});

describe("All sources search", () => {
  let t, a;
  const stub = (id, items, fail) => ({ id, name: id.toUpperCase(), note: "", search: async () => { if (fail) throw new Error(`${id} is down`); return { total: items.length, items }; } });
  const item = (source, id, published) => ({ source, external_id: id, title: `${source} ${id}`, published });
  before(async () => {
    t = await startTestApp({ tenders: [stub("worldbank", [item("worldbank", "W1", "2026-11-10")]), stub("afdb", [item("afdb", "A1", "2026-11-24"), item("afdb", "A2", "2026-11-01")]), stub("undp", [], true)] });
    a = await t.account("boss@alpha.test");
  });
  after(() => t.close());

  it("merges every source newest first, reports a failing one, and marks what is already in this company's pipeline", async () => {
    const src = (await t.call("GET", "/api/tenders/sources", null, a)).body.map((s) => s.id);
    assert.deepEqual(src, ["all", "worldbank", "afdb", "undp"]);
    await t.call("POST", "/api/tenders", { title: "afdb A2", source: "afdb", external_id: "A2" }, a);
    const r = (await t.call("GET", "/api/tenders/search?country=Uganda", null, a)).body;
    assert.deepEqual(r.items.map((x) => x.external_id), ["A1", "W1", "A2"]);
    assert.ok(r.items[2].pipeline_id); assert.equal(r.items[0].pipeline_id, null);
    assert.deepEqual(r.failed.map((f) => f.source), ["undp"]);
    const b = await t.account("boss@beta.test");
    assert.equal((await t.call("GET", "/api/tenders/search", null, b)).body.items[2].pipeline_id, null);   // the other company's pipeline is not shown
  });
});
