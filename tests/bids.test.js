import assert from "node:assert/strict";
import zlib from "node:zlib";
import { after, before, describe, it } from "node:test";
import { normalise } from "../src/services/aiClient.js";
import { docxText, documentLinks, htmlToText } from "../src/tenders/docText.js";
import { FetchError, fetchPublic, isPrivateAddress } from "../src/tenders/safeFetch.js";
import { startTestApp } from "./support/testApp.js";

/** A minimal .docx: a zip holding word/document.xml (deflated, as Word does). */
function makeDocx(paragraphs) {
  const name = Buffer.from("word/document.xml");
  const xml = Buffer.from(`<?xml version="1.0"?><w:document><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  const data = zlib.deflateRawSync(xml);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(xml.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(xml.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const cdStart = local.length + name.length + data.length, cd = Buffer.concat([central, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, name, data, cd, end]);
}
const PDF = Buffer.from("%PDF-1.4\n% a tiny stand-in for a real bid document\n%%EOF");

describe("reading documents and pages", () => {
  it("turns a web page into text and finds the bid documents it links to", () => {
    const html = `<html><head><style>.x{}</style><script>alert(1)</script></head><body><h1>ITB: Staff house</h1><p>Bid security&nbsp;UGX 5,000,000 &amp; a site visit.</p>
      <ul><li>Certificate of incorporation</li></ul><a href="/docs/itb.pdf">Bidding document</a> <a href="https://x.org/about">About us</a> <a href="dl?id=3">Download tender document</a></body></html>`;
    const text = htmlToText(html);
    assert.match(text, /Bid security UGX 5,000,000 & a site visit\./); assert.match(text, /- Certificate of incorporation/); assert.ok(!/alert/.test(text));
    assert.deepEqual(documentLinks(html, "https://buyer.org/tenders/1").map((l) => l.url), ["https://buyer.org/docs/itb.pdf", "https://buyer.org/tenders/dl?id=3"]);
  });
  it("reads the text of a Word file", () => {
    assert.equal(docxText(makeDocx(["Bidders shall submit a tax clearance certificate.", "Bid validity: 90 days &amp; more."])), "Bidders shall submit a tax clearance certificate.\nBid validity: 90 days & more.");
    assert.throws(() => docxText(Buffer.from("not a zip")), /not a Word/);
  });
  it("keeps only known fields, types and lengths from what the AI returns", () => {
    const n = normalise({ summary: "  Staff house.  ", documents_available: "yes", deadline: "2026-12-10", requirements: [{ text: "Tax clearance", category: "Made up", mandatory: "true" }, { text: "" }, null, { text: "Bid security UGX 5m", category: "Bid security and money", mandatory: true }], extra: "dropped" });
    assert.equal(n.summary, "Staff house."); assert.equal(n.documents_available, false); assert.equal(n.extra, undefined);
    assert.deepEqual(n.requirements, [{ text: "Tax clearance", category: "Other", mandatory: false, found_in: null }, { text: "Bid security UGX 5m", category: "Bid security and money", mandatory: true, found_in: null }]);
  });
});

describe("the bid reader never calls private addresses", () => {
  it("knows private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
    for (const ip of ["8.8.8.8", "41.210.0.1", "2001:4860:4860::8888"]) assert.ok(!isPrivateAddress(ip), ip);
  });
  it("refuses dangerous links before connecting", async () => {
    for (const url of ["file:///etc/passwd", "http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "http://localhost:8100/api/users", "http://[::1]/", "ftp://x.org/a",
      "http://user:pw@example.com/", "http://example.com:5432/", "http://db.internal/", "not a url"]) {
      await assert.rejects(fetchPublic(url), FetchError, url);
    }
  });
});

describe("AI bid reading, checklist and bid documents", () => {
  let t, admin, gpm, pm, viewer, director, other, ids = {};
  const calls = [];
  const pages = {
    "https://buyer.org/itb/1": { contentType: "text/html", body: Buffer.from(`<h1>Invitation to bid: staff house, Gulu</h1><p>The bidding document is attached.</p><a href="/itb/1/document.pdf">Bidding document (PDF)</a>`) },
    "https://buyer.org/itb/1/document.pdf": { contentType: "application/pdf", body: PDF },
    "https://newspaper.ug/advert": { contentType: "text/html", body: Buffer.from(`<p>Ministry of Works invites bids for a borehole in Lira. Bid documents may be purchased from the procurement office, room 4, at a non-refundable fee of UGX 100,000. Deadline 10 December 2026.</p>`.repeat(2)) },
  };
  const fetcher = async (url) => { const p = pages[url]; if (!p) throw new FetchError("the website answered 404"); return { url, status: 200, ...p }; };
  const ai = {
    configured: true, model: "test-model",
    async readBid({ tender, sources }) {
      calls.push({ tender: tender.title, sources: sources.map((s) => ({ kind: s.kind, name: s.name, text: s.text?.slice(0, 200) })) });
      if (tender.title.includes("fail")) { const { AiError } = await import("../src/services/aiClient.js"); throw new AiError("the AI service is busy; try again in a few minutes"); }
      const full = sources.some((s) => s.kind === "pdf" || /tax clearance/i.test(s.text || ""));
      return normalise(full
        ? { summary: "Construction of a staff house.", documents_available: true, deadline: "2026-12-10", bid_security: "UGX 5,000,000 bank guarantee", site_visit: "2 Dec 2026, mandatory",
          requirements: [{ text: "Certified copy of the certificate of incorporation", category: "Company documents", mandatory: true, found_in: "Bidding document (PDF)" },
            { text: "Bid security of UGX 5,000,000", category: "Bid security and money", mandatory: true }, { text: "Tax clearance certificate", category: "Company documents", mandatory: true }] }
        : { summary: "Borehole in Lira.", documents_available: false, how_to_obtain: "Procurement office, room 4", document_fee: "UGX 100,000 non-refundable",
          requirements: [{ text: "Buy the bid documents from the procurement office (UGX 100,000)", category: "How to submit", mandatory: true }] });
    },
  };
  before(async () => {
    t = await startTestApp({ ai, fetcher });
    admin = await t.account("a@x.com");
    const make = async (email, role) => { const tok = await t.account(email, role, admin); ids[email] = (await t.call("GET", "/api/me", null, tok)).body.id; return tok; };
    gpm = await make("gpm@x.com", "general_pm"); pm = await make("pm@x.com", "manager"); viewer = await make("v@x.com", "viewer"); director = await make("d@x.com", "director");
    other = await t.account("o@other.com");
  });
  after(() => t.close());
  const idle = () => t.app.services.bids.idle();
  const bid = (id, tok = gpm) => t.call("GET", `/api/tenders/${id}/bid`, null, tok);

  it("saving a tender does not read it; marking it interested does, once", async () => {
    const tender = (await t.call("POST", "/api/tenders", { title: "Staff house, Gulu", url: "https://buyer.org/itb/1", status: "saved" }, gpm)).body;
    await idle(); assert.equal((await bid(tender.id)).body.ai.status, null); assert.equal(calls.length, 0);
    await t.call("PATCH", `/api/tenders/${tender.id}`, { status: "interested" }, gpm);
    assert.ok(["queued", "reading", "done"].includes((await bid(tender.id)).body.ai.status));
    await idle();
    const b = (await bid(tender.id)).body;
    assert.equal(b.ai.status, "done"); assert.equal(b.ai.found.bid_security, "UGX 5,000,000 bank guarantee"); assert.equal(b.ai.found.reader, "ai"); assert.equal(b.ai.found.model, "test-model");
    assert.deepEqual(b.ai.found.sources, ["Tender notice web page", "Bidding document (PDF)"]);       // the page AND the PDF it links to
    assert.equal(b.checklist.length, 3); assert.equal(b.checklist[0].source, "assistant"); assert.ok(b.checklist[0].mandatory); assert.equal(b.checklist[0].found_in, "Bidding document (PDF)");
    assert.equal(calls[0].sources[1].kind, "pdf");
    await t.call("PATCH", `/api/tenders/${tender.id}`, { status: "bidding" }, gpm); await idle();
    assert.equal(calls.length, 1);                                                              // not read again
    const audit = (await t.call("GET", "/api/audit?entity=tenders", null, admin)).body.items.find((i) => /requirements? added to the checklist/.test(i.summary));
    assert.equal(audit.user_email, "AI assistant");
  });

  it("a notice without the documents asks for them; uploading them reads them and adds what is new", async () => {
    const tender = (await t.call("POST", "/api/tenders", { title: "Borehole, Lira", url: "https://newspaper.ug/advert", status: "interested" }, gpm)).body;   // created as interested
    await idle();
    let b = (await bid(tender.id)).body;
    assert.equal(b.ai.status, "needs_documents"); assert.match(b.ai.error, /upload them here/); assert.equal(b.ai.found.document_fee, "UGX 100,000 non-refundable");
    assert.equal(b.checklist.length, 1);
    const docx = makeDocx(["Bidders shall submit a tax clearance certificate.", "Bid security of UGX 5,000,000."]);
    const up = await t.call("POST", `/api/tenders/${tender.id}/documents?name=${encodeURIComponent("Bidding document.docx")}`, null, pm, docx);   // the assigned PM? no: pm has tenders:write
    assert.equal(up.status, 201); assert.equal(up.body.documents.length, 1); assert.equal(up.body.documents[0].name, "Bidding document.docx");
    await idle();
    b = (await bid(tender.id)).body;
    assert.equal(b.ai.status, "done"); assert.equal(b.checklist.length, 4);
    const last = calls.at(-1).sources;
    assert.ok(last.some((s) => s.name === "Bidding document.docx" && /tax clearance/.test(s.text)));
    // downloading it back
    const dl = await t.call("GET", `/api/tender_documents/${b.documents[0].id}/download`, null, viewer);
    assert.equal(dl.status, 200); assert.equal(Buffer.compare(dl.body, docx), 0);
  });

  it("uploads must be real PDF, Word or text files", async () => {
    const tender = (await t.call("POST", "/api/tenders", { title: "Uploads" }, gpm)).body;
    const up = (name, body) => t.call("POST", `/api/tenders/${tender.id}/documents?name=${encodeURIComponent(name)}&read=0`, null, gpm, body);
    assert.equal((await up("virus.exe", Buffer.from("MZ"))).status, 400);
    assert.equal((await up("fake.pdf", Buffer.from("hello"))).status, 400);
    assert.equal((await up("fake.docx", Buffer.from("hello"))).status, 400);
    assert.equal((await up("empty.txt", Buffer.alloc(0))).status, 400);
    assert.equal((await up("../../etc/notes.txt", Buffer.from("Bidders shall submit a CV."))).body.documents[0].name, "notes.txt");
    assert.equal((await bid(tender.id)).body.ai.status, null);                                     // read=0: not read
  });

  it("a tender with no link and no documents asks for the documents; Read now needs one of them", async () => {
    const tender = (await t.call("POST", "/api/tenders", { title: "No link", status: "interested" }, gpm)).body;
    await idle();
    assert.equal((await bid(tender.id)).body.ai.status, "needs_documents");
    assert.equal((await t.call("POST", `/api/tenders/${tender.id}/ai_read`, null, gpm)).status, 400);
  });

  it("AI errors are kept, shown plainly, and Read again works", async () => {
    const tender = (await t.call("POST", "/api/tenders", { title: "Will fail", url: "https://buyer.org/itb/1", status: "interested" }, gpm)).body;
    await idle();
    const b = (await bid(tender.id)).body;
    assert.equal(b.ai.status, "failed"); assert.equal(b.ai.error, "the AI service is busy; try again in a few minutes");
    const again = await t.call("POST", `/api/tenders/${tender.id}/ai_read`, null, gpm);
    assert.equal(again.status, 200); assert.equal(again.body.ai.status, "queued");
    await idle();
  });

  it("a broken notice link is reported, not hidden", async () => {
    const tender = (await t.call("POST", "/api/tenders", { title: "Dead link", url: "https://gone.org/x", status: "interested" }, gpm)).body;
    await idle();
    const b = (await bid(tender.id)).body;
    assert.equal(b.ai.status, "needs_documents"); assert.match(b.ai.error, /could not be read \(the website answered 404\)/);
  });

  it("who may see and change a bid", async () => {
    const tender = (await t.call("POST", "/api/tenders", { title: "Rights" }, gpm)).body;
    const add = (tok) => t.call("POST", `/api/tenders/${tender.id}/requirements`, { text: "Tax clearance certificate" }, tok);
    assert.equal((await bid(tender.id, viewer)).body.can_edit, false);
    assert.equal((await add(viewer)).status, 403); assert.equal((await add(director)).status, 403);
    assert.equal((await add(pm)).status, 201);
    assert.equal((await add(pm)).body.checklist.length, 1);                                         // the same text is not added twice
    assert.equal((await bid(tender.id, other)).status, 404);
    assert.equal((await add(other)).status, 404);
    assert.equal((await t.call("POST", `/api/tenders/${tender.id}/ai_read`, null, viewer)).status, 403);
    const doc = (await t.call("POST", `/api/tenders/${tender.id}/documents?name=a.txt&read=0`, null, gpm, Buffer.from("Bidders shall submit a CV."))).body.documents[0];
    assert.equal((await t.call("GET", `/api/tender_documents/${doc.id}/download`, null, other)).status, 404);
    assert.equal((await t.call("DELETE", `/api/tender_documents/${doc.id}`, null, viewer)).status, 403);
    assert.equal((await t.call("DELETE", `/api/tender_documents/${doc.id}`, null, gpm)).body.documents.length, 0);
  });
});

describe("without an AI key", () => {
  let t, admin;
  before(async () => {
    const fetcher = async (url) => ({ url, status: 200, contentType: "text/html", body: Buffer.from(`<ol>${"<li>Bidders shall submit a certified copy of the trading licence.</li><li>Bid security of UGX 2,000,000.</li>".repeat(1)}</ol>`) });
    t = await startTestApp({ fetcher });
    admin = await t.account("a@x.com");
  });
  after(() => t.close());
  it("the built-in reader lists what it can from the notice page, and says the AI is not set up", async () => {
    const tender = (await t.call("POST", "/api/tenders", { title: "Plain", url: "https://buyer.org/p", status: "interested" }, admin)).body;
    await t.app.services.bids.idle();
    const b = (await t.call("GET", `/api/tenders/${tender.id}/bid`, null, admin)).body;
    assert.equal(b.ai.available, false); assert.equal(b.ai.found.reader, "built-in");
    assert.deepEqual(b.checklist.map((r) => r.text), ["Bidders shall submit a certified copy of the trading licence.", "Bid security of UGX 2,000,000."]);
    assert.equal(b.checklist[0].source, "reader");
  });
});
