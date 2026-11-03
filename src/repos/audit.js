import { newId, now } from "../ids.js";
import { parseJson, toJson } from "../json.js";

/** Append-only. There is deliberately no update or delete here. */
export const auditRepo = (db) => ({
  insert: (e) => db.query("INSERT INTO audit (id, at, user_id, user_email, action, entity, entity_id, project, summary, changes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [newId(), now(), e.userId, e.userEmail, e.action, e.entity, e.entityId, e.project, String(e.summary || "").slice(0, 200), toJson(e.changes)]),

  async list({ project, entity, action, user, before, limit = 50 } = {}) {
    const where = [], params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
    if (project) add("project = ?", project);
    if (entity) add("entity = ?", entity);
    if (action) add("action = ?", action);
    if (user) add("LOWER(user_email) LIKE ?", `%${String(user).toLowerCase()}%`);
    if (before) add("id < ?", String(before));
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await db.query(`SELECT * FROM audit ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ${n}`, params);
    const items = rows.map((r) => ({ ...r, changes: parseJson(r.changes) }));
    return { items, next: items.length === n ? items[items.length - 1].id : null };
  },
  recentForProject: (project, n = 8) => db.query(`SELECT at, user_email, action, entity, summary FROM audit WHERE project = $1 ORDER BY id DESC LIMIT ${n}`, [project]),
});
