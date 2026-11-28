import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEgpProvider, egpDate, parseEgpList, parseEgpNotice } from "../src/tenders/egp.js";

// Shaped like the portal's home page: each row links to its notice three times (coat of arms, category, bold title cut short).
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ahead = (n) => { const d = new Date(Date.now() + 3 * 3600000 + n * 86400000); return [`${M[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, "0")} ${d.getUTCFullYear()}`, d.toISOString().slice(0, 10)]; };
const [D1, ISO1] = ahead(14), [D2] = ahead(20);
const row = (id, cat, title, date, logoHref) => `<tr><td><a href="${logoHref || `https://egpuganda.go.ug/index/${id}_egp`}"><img src="https://egpuganda.go.ug/images/court-of-arms.png"></a><br><a href="https://egpuganda.go.ug/index/${id}_egp">${cat}</a></td><td><a href="https://egpuganda.go.ug/index/${id}_egp"><b>${title}</b></a></td><td>${date}</td></tr>`;
const LIST = `<html><body><div id="tab-1-1"><table class="table">
${row("426791082", "Non Consultancy Services", "Framework contract for Funeral management...", D1)}
${row("428515208", "Works", "Civil Works for Upgrading to Bitumen standard...", D1, "#")}
${row("426391960", "Consultancy Services", "Supervision of works &amp; designs", D2)}
${row("428515208", "Works", "duplicate in another tab", D1)}
${row("90037466", "Supplies", "Additional funds for new security equipment a...", "Jul-26 2023")}
</table></div></body></html>`;
// Shaped like a notice page: the entity in a sentence, then a table with a header row and a data row.
const NOTICE = `<html><body><h3>Request for Quotation Notice</h3><p>Ministry of Information, Communications Technology and National Guidance has allocated funds to be used for the above indicated.</p>
<table><tr><th>No #</th><th>Procurement Ref Number</th><th>Subject of Procurement</th></tr><tr><td>1</td><td>MOICT/NCONS/2026-2027/00047</td><td>Framework contract for Funeral management services</td></tr></table>
<p>Suppliers are invited to submit bids through e-GP.</p><form>Email Address <input> Title <input> Description <textarea></textarea></form></body></html>`;
const OLDSTYLE = `<p>The Ministry of Works and Transport invites sealed bids from eligible bidders.</p><p>Procurement Ref Number: MOWT/WRKS/2026-2027/00016</p><p>Subject of Procurement: Civil works for the Jjanyi-Dundu-Akright road</p><p>The deadline for bid submission shall be at 10:00 am on 11th December, 2026.</p>`;
const page = (body, status = 200) => ({ ok: status < 400, status, text: async () => body });

describe("Uganda eGP portal", () => {
  it("reads dates in the portal's forms", () => {
    assert.equal(egpDate("Dec-11 2026"), "2026-12-11");
    assert.equal(egpDate("on 11th December, 2026."), "2026-12-11");
    assert.equal(egpDate("soon"), null);
  });
  it("reads the bid notice list: the title link (not the logo or category), category, date, link; no duplicates", () => {
    const l = parseEgpList(LIST);
    assert.equal(l.length, 4);
    assert.deepEqual(l[0], { id: "426791082", title: "Framework contract for Funeral management", category: "Non Consultancy Services", date: ISO1, url: "https://egpuganda.go.ug/index/426791082_egp" });
    assert.equal(l[1].title, "Civil Works for Upgrading to Bitumen standard"); assert.equal(l[1].category, "Works");
    assert.equal(l[1].url, "https://egpuganda.go.ug/index/428515208_egp");
    assert.equal(l[2].category, "Consultancy Services"); assert.equal(l[2].title, "Supervision of works & designs");
  });
  it("reads a notice's page: reference, the subject from its table, the entity that allocated funds", () => {
    assert.deepEqual(parseEgpNotice(NOTICE), { ref: "MOICT/NCONS/2026-2027/00047", subject: "Framework contract for Funeral management services",
      entity: "Ministry of Information, Communications Technology and National Guidance", deadline: null });
    assert.deepEqual(parseEgpNotice(OLDSTYLE), { ref: "MOWT/WRKS/2026-2027/00016", subject: "Civil works for the Jjanyi-Dundu-Akright road",
      entity: "Ministry of Works and Transport", deadline: "2026-12-11" });
  });
  it("searches Uganda only, uses the notice pages' details, and keeps going if one page fails", async () => {
    const asked = [];
    const fetchImpl = async (url, opts) => {
      asked.push([url, opts.headers["user-agent"]]);
      if (url.endsWith("/")) return page(LIST);
      if (url.includes("426791082")) return page(NOTICE);
      if (url.includes("426391960")) return page("", 500);
      return page("<p>nothing useful</p>");
    };
    const p = createEgpProvider({ fetchImpl });
    const r = await p.search({ country: "Uganda" });
    assert.equal(r.total, 3);                                       // the 2023 notice has closed: left out
    assert.ok(!r.items.some((x) => x.external_id === "90037466"));
    const f = r.items.find((x) => x.external_id === "426791082");
    assert.equal(f.title, "Framework contract for Funeral management services"); assert.equal(f.reference, "MOICT/NCONS/2026-2027/00047");
    assert.equal(f.buyer, "Ministry of Information, Communications Technology and National Guidance"); assert.equal(f.deadline, ISO1); assert.equal(f.country, "Uganda");
    assert.equal(r.items.find((x) => x.external_id === "426391960").title, "Supervision of works & designs");   // its page failed: list words used
    assert.match(asked[0][1], /Buildsuite360/);
    assert.equal((await p.search({ country: "Kenya" })).total, 0);
    assert.equal((await p.search({ q: "bitumen" })).total, 1);
    const n = asked.length; await p.search({ q: "works" }); assert.equal(asked.length, n);     // cached
  });
  it("says so plainly when the portal can't be read", async () => {
    await assert.rejects(createEgpProvider({ fetchImpl: async () => page("<html>maintenance</html>") }).search({}), /no bid notices could be read/);
    await assert.rejects(createEgpProvider({ fetchImpl: async () => page("", 403) }).search({}), /eGP portal returned an error \(403\)/);
  });
});
