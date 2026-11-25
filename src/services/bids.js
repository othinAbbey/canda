import crypto from "node:crypto";
import path from "node:path";
import { can } from "../auth/permissions.js";
import { categorize, readRequirements } from "../domain/requirements.js";
import { HttpError, ValidationError, notFound } from "../errors.js";
import { bidsRepo } from "../repos/bids.js";
import { docxText, documentLinks, htmlToText } from "../tenders/docText.js";
import { FetchError, fetchPublic } from "../tenders/safeFetch.js";
import { AiError, CATEGORIES } from "./aiClient.js";

const INTERESTED = ["interested", "bidding"];               // showing interest starts the AI reading
const DOC_TYPES = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain" };
const MAX_PDF_TOTAL = 20 * 1048576;                         // what goes to the AI in one request (it allows 32 MB, base64 adds a third)
const MAX_TEXT = 150000;                                    // characters of web page / Word text per document
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const AI_ACTOR = (tender) => ({ id: null, email: "AI assistant", organization_id: tender.organization_id });

/** Runs one job at a time; asking for a tender already waiting does nothing (several uploads lead to one reading). */
function createQueue(run, delayMs) {
  const waiting = new Set(); let chain = Promise.resolve();
  return {
    add(id) {
      if (waiting.has(id)) return; waiting.add(id);
      chain = chain.then(() => new Promise((r) => setTimeout(r, delayMs))).then(() => { waiting.delete(id); return run(id); }).catch((e) => console.error("bid reading:", e));
    },
    idle: () => chain,
  };
}

/**
 * The bid behind a tender: the requirements checklist, bid documents, and the AI that reads them.
 * The AI reads the notice page (and the documents it links to) and any uploaded bid documents, then fills the checklist.
 */
export function createBids({ db, audit, ai, fetcher = fetchPublic, delayMs = 3000, autoRead = true }) {
  const repo = bidsRepo(db);

  async function access(actor, tenderId) {
    const tender = await repo.tender(tenderId, actor.organization_id); if (!tender) throw notFound("tender not found");
    const edit = can(actor, "tenders:write") || (await repo.isAssignee(tender.id, actor.id));
    return { tender, edit };
  }
  const mustEdit = (a) => { if (!a.edit) throw new HttpError(403, "only staff who work on tenders, or someone given a task on this tender, can change its checklist"); };
  const aiState = (t) => ({ status: t.ai_status || null, error: t.ai_error || null, read_at: t.ai_read_at || null, found: t.ai_summary ? JSON.parse(t.ai_summary) : null,
    available: !!ai?.configured });

  async function addItems(tender, items, source, userId) {
    const have = new Set((await repo.requirements(tender)).map((r) => norm(r.text)));
    let position = await repo.nextPosition(tender), added = 0;
    await db.tx(async (t) => {
      const w = bidsRepo(t);
      for (const x of items) {
        const k = norm(x.text); if (!k || have.has(k)) continue; have.add(k);
        await w.insertRequirement({ tender, position: position++, text: x.text, category: x.category || categorize(x.text), mandatory: x.mandatory, source, found_in: x.found_in }, userId);
        added++;
      }
    });
    return added;
  }

  // ---- the reading itself --------------------------------------------------------------------------------------
  /** Everything there is to read: the notice page, PDFs/Word files it links to, and uploaded documents. */
  async function gather(tender) {
    const sources = [], skipped = []; let pdfBytes = 0;
    const addPdf = (name, data) => { if (pdfBytes + data.length > MAX_PDF_TOTAL) { skipped.push({ name, reason: "too large to send with the others" }); return; } pdfBytes += data.length; sources.push({ kind: "pdf", name, data }); };
    const addFile = (name, body, type) => {
      if (type === "pdf" || body.subarray(0, 5).toString() === "%PDF-") return addPdf(name, body);
      if (type === "docx") { try { sources.push({ kind: "text", name, text: docxText(body).slice(0, MAX_TEXT) }); } catch { skipped.push({ name, reason: "could not read the Word file" }); } return; }
      sources.push({ kind: "text", name, text: body.toString("utf8").slice(0, MAX_TEXT) });
    };

    if (tender.url) {
      try {
        const page = await fetcher(tender.url, { maxBytes: 15 * 1048576 });
        if (page.contentType.includes("pdf") || page.body.subarray(0, 5).toString() === "%PDF-") addPdf("Tender notice (PDF)", page.body);
        else {
          const html = page.body.toString("utf8"), text = htmlToText(html);
          if (text.length > 80) sources.push({ kind: "text", name: "Tender notice web page", text: text.slice(0, MAX_TEXT) });
          for (const link of documentLinks(html, page.url)) {
            try {
              const doc = await fetcher(link.url, { maxBytes: 15 * 1048576 });
              const ext = doc.contentType.includes("pdf") ? "pdf" : doc.contentType.includes("wordprocessingml") || /\.docx(\?|$)/i.test(link.url) ? "docx" : null;
              if (!ext && doc.body.subarray(0, 5).toString() !== "%PDF-") { skipped.push({ name: link.label, reason: "not a PDF or Word file" }); continue; }
              addFile(link.label, doc.body, ext);
            } catch (e) { skipped.push({ name: link.label, reason: e instanceof FetchError ? e.message : "could not be downloaded" }); }
          }
        }
      } catch (e) { skipped.push({ name: "Tender notice", reason: e instanceof FetchError ? e.message : "could not be opened" }); }
    }
    for (const d of await repo.documentData(tender.id)) addFile(d.name, Buffer.from(d.data), path.extname(d.name).slice(1).toLowerCase());
    return { sources, skipped };
  }

  async function read(tenderId) {
    const tender = await repo.tenderAny(tenderId); if (!tender) return;
    await repo.setAi(tender.id, { ai_status: "reading", ai_error: null });
    try {
      const { sources, skipped } = await gather(tender);
      if (!sources.length) {
        const why = tender.url ? `The notice could not be read (${skipped.map((s) => s.reason).join("; ") || "nothing found"}).` : "This tender has no link to its notice.";
        await repo.setAi(tender.id, { ai_status: "needs_documents", ai_error: `${why} Upload the bid documents and they will be read.`, ai_read_at: new Date().toISOString(),
          ai_summary: JSON.stringify({ documents_available: false, sources: [], skipped }) });
        return;
      }
      let found, reader;
      if (ai?.configured) { found = await ai.readBid({ tender, sources }); reader = "ai"; }
      else {                                                    // no AI key: the built-in reader does what it can with the text
        const text = sources.filter((s) => s.kind === "text").map((s) => s.text).join("\n");
        found = { summary: null, documents_available: sources.some((s) => s.kind === "pdf") ? false : text.length > 2000, requirements: readRequirements(text) };
        reader = "built-in";
      }
      const added = await addItems(tender.id, found.requirements, reader === "ai" ? "assistant" : "reader", null);
      const needs = !found.documents_available;
      await repo.setAi(tender.id, {
        ai_status: needs ? "needs_documents" : "done", ai_read_at: new Date().toISOString(),
        ai_error: needs ? "The full bid documents were not found. If they must be bought or collected, upload them here once you have them, and they will be read." : null,
        ai_summary: JSON.stringify({ ...found, requirements: undefined, found: found.requirements.length, added, reader, model: reader === "ai" ? ai.model : null,
          sources: sources.map((s) => s.name), skipped }),
      });
      await audit.log(AI_ACTOR(tender), { action: "update", entity: "tenders", id: tender.id, summary: `${tender.title}: bid documents read, ${added} requirement${added === 1 ? "" : "s"} added to the checklist` });
    } catch (e) {
      const msg = e instanceof AiError || e instanceof FetchError ? e.message : "something went wrong while reading the documents";
      if (!(e instanceof AiError || e instanceof FetchError)) console.error("bid reading failed:", e);
      await repo.setAi(tender.id, { ai_status: "failed", ai_error: msg, ai_read_at: new Date().toISOString() });
    }
  }
  const queue = createQueue(read, delayMs);
  const enqueue = async (tenderId) => { await repo.setAi(tenderId, { ai_status: "queued", ai_error: null }); queue.add(tenderId); };

  return {
    idle: () => queue.idle(),
    /** After a restart, finish readings that were waiting or running. */
    async resume() { for (const r of await repo.pendingReads()) queue.add(r.id); },

    /** Called after a tender is saved: showing interest (or starting to bid) starts the reading, once. */
    async onTenderSaved(row, before) {
      if (!autoRead || !INTERESTED.includes(row.status) || row.ai_status) return;
      if (before && INTERESTED.includes(before.status)) return;
      await enqueue(row.id);
    },

    async detail(actor, tenderId) {
      const a = await access(actor, tenderId);
      const [checklist, documents] = await Promise.all([repo.requirements(tenderId), repo.documents(tenderId)]);
      const { ai_summary, data, ...tender } = a.tender;   // eslint-disable-line no-unused-vars
      return { tender, can_edit: a.edit, ai: aiState(a.tender), checklist, documents, categories: CATEGORIES };
    },
    checklist: (tenderId) => repo.requirements(tenderId),
    countsFor: (tenderIds) => repo.countsFor(tenderIds),

    /** Read again (the AI reads the notice and every uploaded document; items already on the checklist are kept, not repeated). */
    async readNow(actor, tenderId) {
      const a = await access(actor, tenderId); mustEdit(a);
      if (["queued", "reading"].includes(a.tender.ai_status)) throw new HttpError(409, "the documents are already being read");
      if (!a.tender.url && !(await repo.documents(tenderId)).length) throw new ValidationError("add the link to the notice, or upload the bid documents first");
      await enqueue(tenderId);
      await audit.log(actor, { action: "update", entity: "tenders", id: tenderId, summary: `${a.tender.title}: asked the AI to read the bid documents` });
      return this.detail(actor, tenderId);
    },

    async addRequirements(actor, tenderId, body) {
      const a = await access(actor, tenderId); mustEdit(a);
      const source = body.source || "manual";
      if (!["manual", "reader"].includes(source)) throw new ValidationError("source must be manual or reader");
      const items = (Array.isArray(body.items) ? body.items : [body]).map((x) => (typeof x === "string" ? { text: x } : x || {}))
        .map((x) => ({ text: String(x.text || "").replace(/\s+/g, " ").trim(), category: String(x.category || "").trim().slice(0, 60) || null })).filter((x) => x.text);
      if (!items.length) throw new ValidationError("write the requirement");
      if (items.length > 100) throw new ValidationError("add at most 100 requirements at a time");
      if (items.some((x) => x.text.length > 500)) throw new ValidationError("keep each requirement under 500 characters");
      const added = await addItems(tenderId, items, source, actor.id);
      await audit.log(actor, { action: "update", entity: "tenders", id: tenderId, summary: `${a.tender.title}: ${added} requirement${added === 1 ? "" : "s"} added (${source})` });
      return this.detail(actor, tenderId);
    },

    async readText(actor, tenderId, body) {
      mustEdit(await access(actor, tenderId));
      const text = String(body.text || "");
      if (text.trim().length < 20) throw new ValidationError("paste the requirements section of the bid document (at least a few lines)");
      if (text.length > 200000) throw new ValidationError("the text is too long: paste the instructions to bidders and the requirements sections only");
      const have = new Set((await repo.requirements(tenderId)).map((r) => norm(r.text)));
      return { reader: "built-in", items: readRequirements(text).map((x) => ({ ...x, already: have.has(norm(x.text)) })) };
    },

    async updateRequirement(actor, reqId, body) {
      const req = await repo.requirement(reqId, actor.organization_id); if (!req) throw notFound("requirement not found");
      const a = await access(actor, req.tender); mustEdit(a);
      const values = {};
      if ("status" in body) {
        if (!["pending", "done", "na"].includes(body.status)) throw new ValidationError("status must be one of pending, done, na");
        values.status = body.status; values.done_by = body.status === "done" ? actor.id : null; values.done_at = body.status === "done" ? new Date().toISOString() : null;
      }
      if ("note" in body) values.note = String(body.note || "").trim().slice(0, 1000) || null;
      if ("text" in body) { const t = String(body.text || "").trim(); if (!t || t.length > 500) throw new ValidationError("the requirement needs text (up to 500 characters)"); values.text = t; }
      if ("category" in body) values.category = String(body.category || "").trim().slice(0, 60) || null;
      if (!Object.keys(values).length) throw new ValidationError("nothing to change");
      await repo.updateRequirement(reqId, values);
      if (values.status && values.status !== req.status) await audit.log(actor, { action: "update", entity: "tenders", id: req.tender, summary: `${a.tender.title}: "${req.text.slice(0, 80)}" ${values.status === "done" ? "done" : values.status === "na" ? "not applicable" : "reopened"}` });
      return this.detail(actor, req.tender);
    },

    async removeRequirement(actor, reqId) {
      const req = await repo.requirement(reqId, actor.organization_id); if (!req) throw notFound("requirement not found");
      mustEdit(await access(actor, req.tender));
      await repo.removeRequirement(reqId);
      return this.detail(actor, req.tender);
    },

    maxBytes: 25 * 1048576,
    /** Bid documents bought, collected or received by email. Reading starts by itself a few seconds later. */
    async upload(actor, tenderId, { name, note, bytes, read = true }) {
      const a = await access(actor, tenderId); mustEdit(a);
      const clean = path.basename(String(name || "document").replace(/\\/g, "/")).replace(/[\x00-\x1f]/g, "").slice(0, 150) || "document";
      const ext = path.extname(clean).slice(1).toLowerCase();
      if (!DOC_TYPES[ext]) throw new ValidationError("upload the bid documents as PDF, Word (.docx) or text (.txt) files");
      if (!bytes.length) throw new ValidationError("the file is empty");
      if (ext === "pdf" && bytes.subarray(0, 5).toString() !== "%PDF-") throw new ValidationError("that file is not a real PDF");
      if (ext === "docx" && bytes.subarray(0, 2).toString() !== "PK") throw new ValidationError("that file is not a real Word (.docx) document");
      await repo.insertDocument({ tender: tenderId, name: clean, mime: DOC_TYPES[ext], size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        note: String(note || "").slice(0, 500) || null, uploadedBy: actor.id, data: bytes });
      await audit.log(actor, { action: "upload", entity: "tenders", id: tenderId, summary: `${a.tender.title}: bid document ${clean} (${bytes.length} bytes)` });
      if (read && !["queued", "reading"].includes((await repo.tender(tenderId, actor.organization_id)).ai_status)) await enqueue(tenderId);
      return this.detail(actor, tenderId);
    },
    async download(actor, docId) {
      const d = await repo.document(docId, actor.organization_id); if (!d) throw notFound("document not found");
      await access(actor, d.tender);
      return d;
    },
    async removeDocument(actor, docId) {
      const d = await repo.document(docId, actor.organization_id); if (!d) throw notFound("document not found");
      const a = await access(actor, d.tender); mustEdit(a);
      await repo.removeDocument(docId);
      await audit.log(actor, { action: "delete", entity: "tenders", id: d.tender, summary: `${a.tender.title}: bid document ${d.name} removed` });
      return this.detail(actor, d.tender);
    },
  };
}
