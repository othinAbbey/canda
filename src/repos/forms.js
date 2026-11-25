import { one } from "../db/index.js";
import { newId, now } from "../ids.js";
import { toJson } from "../json.js";

const SELECT = `SELECT f.*, p.name AS project_name, COALESCE(u.name, u.email) AS created_by_name
  FROM form_records f JOIN projects p ON p.id = f.project LEFT JOIN users u ON u.id = f.created_by`;

export const formsRepo = (db) => ({
  list({ project, template, status, organizationId, limit = 500 } = {}) {
    const where = ["p.organization_id = $1"], params = [organizationId];
    for (const [col, v] of [["f.project", project], ["f.template", template], ["f.status", status]]) if (v) { params.push(v); where.push(`${col} = $${params.length}`); }
    return db.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY f.record_date DESC, f.id DESC LIMIT ${Math.min(Number(limit) || 500, 1000)}`, params);
  },
  get: (id, organizationId) => one(db, `${SELECT} WHERE f.id = $1 AND p.organization_id = $2`, [id, organizationId]),
  nextSeq: async (project, template) => Number((await one(db, "SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM form_records WHERE project = $1 AND template = $2", [project, template])).n),
  insert: (r) => one(db, "INSERT INTO form_records (id, created, updated, created_by, updated_by, project, template, template_version, seq, reference, title, record_date, status, data) VALUES ($1,$2,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",
    [newId(), now(), r.userId, r.project, r.template, r.version, r.seq, r.reference, r.title, r.recordDate, r.status, toJson(r.data)]),
  update: (id, r, userId) => one(db, "UPDATE form_records SET title = $1, record_date = $2, status = $3, data = $4, updated = $5, updated_by = $6 WHERE id = $7 RETURNING id",
    [r.title, r.recordDate, r.status, toJson(r.data), now(), userId, id]),
  remove: (id) => one(db, "DELETE FROM form_records WHERE id = $1 RETURNING id", [id]),
});
