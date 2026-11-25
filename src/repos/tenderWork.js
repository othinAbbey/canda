import { newId, now } from "../ids.js";
import { one } from "../db/index.js";

export const tenderWorkRepo = (db) => ({
  summary: (organizationId) => db.query("SELECT status, currency, COUNT(*) AS n, COALESCE(SUM(value), 0) AS total FROM tenders WHERE organization_id = $1 GROUP BY status, currency", [organizationId]),

  insertTask: (t, userId) => one(db, "INSERT INTO tender_tasks (id, created, created_by, tender, title, assignee, due, priority, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    [newId(), now(), userId, t.tender, t.title, t.assignee, t.due, t.priority, t.notes]),
  insertCopy: (task, userId) => db.query("INSERT INTO tender_task_copies (task, user_id) VALUES ($1,$2)", [task, userId]),
  task: (id, organizationId) => one(db, "SELECT t.* FROM tender_tasks t JOIN tenders td ON td.id = t.tender WHERE t.id = $1 AND td.organization_id = $2", [id, organizationId]),
  removeTask: (id) => one(db, "DELETE FROM tender_tasks WHERE id = $1 RETURNING id", [id]),
  updateTask(id, values) {
    const row = { ...values, updated: now() }, cols = Object.keys(row);
    return one(db, `UPDATE tender_tasks SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1} RETURNING *`, [...Object.values(row), id]);
  },

  /** Tasks with the tender and assignee names. `mine`: assigned to this user OR copied to them. */
  tasks({ organizationId, tender, status, mine } = {}) {
    const where = ["td.organization_id = $1"], params = [organizationId];
    if (tender) { params.push(tender); where.push(`t.tender = $${params.length}`); }
    if (status) { params.push(status); where.push(`t.status = $${params.length}`); }
    if (mine) { params.push(mine); where.push(`(t.assignee = $${params.length} OR t.id IN (SELECT task FROM tender_task_copies WHERE user_id = $${params.length}))`); }
    return db.query(`SELECT t.*, td.title AS tender_title, td.deadline AS tender_deadline, td.status AS tender_status, td.buyer AS tender_buyer, u.name AS assignee_name, u.email AS assignee_email
      FROM tender_tasks t JOIN tenders td ON td.id = t.tender JOIN users u ON u.id = t.assignee
      WHERE ${where.join(" AND ")} ORDER BY CASE WHEN t.due IS NULL THEN 1 ELSE 0 END, t.due, t.id`, params);
  },
  /** Requirement counts per task and status, for progress bars. */
  requirementCounts(taskIds) {
    if (!taskIds.length) return Promise.resolve([]);
    return db.query(`SELECT task, status, COUNT(*) AS n FROM tender_task_requirements WHERE task IN (${taskIds.map((_, i) => `$${i + 1}`).join(",")}) GROUP BY task, status`, taskIds);
  },
  /** The newest progress note of each task. */
  lastUpdates(taskIds) {
    if (!taskIds.length) return Promise.resolve([]);
    const list = taskIds.map((_, i) => `$${i + 1}`).join(",");
    return db.query(`SELECT p.task, p.body, p.created, u.name AS by_name, u.email AS by_email FROM tender_task_updates p LEFT JOIN users u ON u.id = p.created_by
      WHERE p.task IN (${list}) AND p.created = (SELECT MAX(q.created) FROM tender_task_updates q WHERE q.task = p.task)`, taskIds);
  },

  requirements: (task) => db.query(`SELECT r.*, u.name AS done_by_name, u.email AS done_by_email FROM tender_task_requirements r LEFT JOIN users u ON u.id = r.done_by
    WHERE r.task = $1 ORDER BY r.position, r.created, r.id`, [task]),
  requirement: (id, organizationId) => one(db, `SELECT r.* FROM tender_task_requirements r JOIN tender_tasks t ON t.id = r.task JOIN tenders td ON td.id = t.tender
    WHERE r.id = $1 AND td.organization_id = $2`, [id, organizationId]),
  nextPosition: async (task) => Number((await one(db, "SELECT COALESCE(MAX(position), 0) AS n FROM tender_task_requirements WHERE task = $1", [task]))?.n ?? 0) + 1,
  insertRequirement: (r, userId) => one(db, "INSERT INTO tender_task_requirements (id, created, created_by, task, position, text, category, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    [newId(), now(), userId, r.task, r.position, r.text, r.category, r.source]),
  updateRequirement(id, values) {
    const row = { ...values, updated: now() }, cols = Object.keys(row);
    return one(db, `UPDATE tender_task_requirements SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1} RETURNING *`, [...Object.values(row), id]);
  },
  removeRequirement: (id) => one(db, "DELETE FROM tender_task_requirements WHERE id = $1 RETURNING id", [id]),

  updates: (task) => db.query(`SELECT p.*, u.name AS by_name, u.email AS by_email FROM tender_task_updates p LEFT JOIN users u ON u.id = p.created_by
    WHERE p.task = $1 ORDER BY p.created DESC, p.id DESC`, [task]),
  insertUpdate: (p, userId) => one(db, "INSERT INTO tender_task_updates (id, created, created_by, task, body, stage) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [newId(), now(), userId, p.task, p.body, p.stage]),

  copiesFor(taskIds) {
    if (!taskIds.length) return Promise.resolve([]);
    return db.query(`SELECT c.task, c.user_id, u.name, u.email FROM tender_task_copies c JOIN users u ON u.id = c.user_id WHERE c.task IN (${taskIds.map((_, i) => `$${i + 1}`).join(",")})`, taskIds);
  },
});
