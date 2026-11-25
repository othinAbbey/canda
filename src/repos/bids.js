import { newId, now } from "../ids.js";
import { one } from "../db/index.js";

const list = (ids) => ids.map((_, i) => `$${i + 1}`).join(",");

/** A tender's bid: its requirements checklist, uploaded bid documents and AI reading state. */
export const bidsRepo = (db) => ({
  tender: (id, organizationId) => one(db, "SELECT * FROM tenders WHERE id = $1 AND organization_id = $2", [id, organizationId]),
  tenderAny: (id) => one(db, "SELECT * FROM tenders WHERE id = $1", [id]),
  isAssignee: async (tender, userId) => !!(await one(db, "SELECT 1 AS x FROM tender_tasks WHERE tender = $1 AND assignee = $2", [tender, userId])),
  setAi: (id, values) => {
    const cols = Object.keys(values);
    return one(db, `UPDATE tenders SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1} RETURNING id`, [...Object.values(values), id]);
  },
  pendingReads: () => db.query("SELECT id FROM tenders WHERE ai_status IN ('queued', 'reading')"),

  requirements: (tender) => db.query(`SELECT r.*, u.name AS done_by_name, u.email AS done_by_email FROM tender_requirements r LEFT JOIN users u ON u.id = r.done_by
    WHERE r.tender = $1 ORDER BY r.position, r.created, r.id`, [tender]),
  requirement: (id, organizationId) => one(db, "SELECT r.* FROM tender_requirements r JOIN tenders td ON td.id = r.tender WHERE r.id = $1 AND td.organization_id = $2", [id, organizationId]),
  countsFor(tenderIds) {
    if (!tenderIds.length) return Promise.resolve([]);
    return db.query(`SELECT tender, status, COUNT(*) AS n FROM tender_requirements WHERE tender IN (${list(tenderIds)}) GROUP BY tender, status`, tenderIds);
  },
  nextPosition: async (tender) => Number((await one(db, "SELECT COALESCE(MAX(position), 0) AS n FROM tender_requirements WHERE tender = $1", [tender]))?.n ?? 0) + 1,
  insertRequirement: (r, userId) => one(db, `INSERT INTO tender_requirements (id, created, created_by, tender, position, text, category, mandatory, source, found_in)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [newId(), now(), userId, r.tender, r.position, r.text, r.category, r.mandatory ?? null, r.source, r.found_in ?? null]),
  updateRequirement(id, values) {
    const row = { ...values, updated: now() }, cols = Object.keys(row);
    return one(db, `UPDATE tender_requirements SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1} RETURNING *`, [...Object.values(row), id]);
  },
  removeRequirement: (id) => one(db, "DELETE FROM tender_requirements WHERE id = $1 RETURNING id", [id]),

  documents: (tender) => db.query(`SELECT d.id, d.created, d.tender, d.name, d.mime, d.size, d.note, d.uploaded_by, u.name AS uploaded_by_name, u.email AS uploaded_by_email
    FROM tender_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.tender = $1 ORDER BY d.created, d.id`, [tender]),
  documentData: (tender) => db.query("SELECT id, name, mime, size, data FROM tender_documents WHERE tender = $1 ORDER BY created, id", [tender]),
  document: (id, organizationId) => one(db, "SELECT d.* FROM tender_documents d JOIN tenders td ON td.id = d.tender WHERE d.id = $1 AND td.organization_id = $2", [id, organizationId]),
  insertDocument: (d) => one(db, "INSERT INTO tender_documents (id, created, tender, name, mime, size, sha256, note, uploaded_by, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
    [newId(), now(), d.tender, d.name, d.mime, d.size, d.sha256, d.note, d.uploadedBy, d.data]),
  removeDocument: (id) => one(db, "DELETE FROM tender_documents WHERE id = $1 RETURNING id", [id]),
});
