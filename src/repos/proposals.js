import { newId, now } from "../ids.js";
import { one } from "../db/index.js";
import { parseJson, toJson } from "../json.js";

const view = (r) => r && { ...r, payload: parseJson(r.payload, {}) };
const SELECT = "SELECT p.*, u.email AS submitted_by_email FROM catalog_proposals p LEFT JOIN users u ON u.id = p.submitted_by";

export const proposalsRepo = (db) => ({
  insert: async (kind, payload, userId) => view(await one(db, "INSERT INTO catalog_proposals (id, kind, payload, status, submitted_by, submitted_at) VALUES ($1,$2,$3,'pending',$4,$5) RETURNING *",
    [newId(), kind, toJson(payload), userId, now()])),
  async list({ status, submittedBy } = {}) {
    const where = [], params = [];
    if (status) { params.push(status); where.push(`p.status = $${params.length}`); }
    if (submittedBy) { params.push(submittedBy); where.push(`p.submitted_by = $${params.length}`); }
    return (await db.query(`${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.id DESC`, params)).map(view);
  },
  get: async (id) => view(await one(db, `${SELECT} WHERE p.id = $1`, [id])),
  /** Only a pending proposal can be decided; returns null if it already was. */
  decide: async (id, { status, reviewer, note, resultId }) => view(await one(db,
    "UPDATE catalog_proposals SET status = $1, reviewed_by = $2, reviewed_at = $3, review_note = $4, result_id = $5 WHERE id = $6 AND status = 'pending' RETURNING *",
    [status, reviewer, now(), note || null, resultId || null, id])),
  withdraw: (id, userId) => one(db, "DELETE FROM catalog_proposals WHERE id = $1 AND submitted_by = $2 AND status = 'pending' RETURNING id", [id, userId]),
  countPending: async () => (await one(db, "SELECT COUNT(*) AS n FROM catalog_proposals WHERE status = 'pending'")).n,
});
