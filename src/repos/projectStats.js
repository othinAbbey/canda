import { count, one } from "../db/index.js";

/** The aggregate queries behind the project summary. All portable SQL; the arithmetic lives in services/summary.js. */
export const projectStatsRepo = (db) => ({
  taskCounts: (p) => db.query("SELECT status, COUNT(*) AS n FROM tasks WHERE project = $1 GROUP BY status", [p]),
  overdueTasks: (p, today) => count(db, "SELECT COUNT(*) AS n FROM tasks WHERE project = $1 AND status <> 'done' AND due IS NOT NULL AND due < $2", [p, today]),
  spent: async (p) => Number((await one(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM costs WHERE project = $1", [p])).n),
  byCategory: (p) => db.query("SELECT COALESCE(category, 'Uncategorised') AS category, SUM(amount) AS amount FROM costs WHERE project = $1 GROUP BY COALESCE(category, 'Uncategorised') ORDER BY amount DESC", [p]),
  logs: (p) => one(db, "SELECT COUNT(*) AS n, MAX(\"date\") AS last_date, COALESCE(SUM(workers), 0) AS worker_days, COUNT(delays) AS delays, COUNT(safety) AS safety FROM logs WHERE project = $1", [p]),
  recentSafety: (p, since) => count(db, "SELECT COUNT(*) AS n FROM logs WHERE project = $1 AND safety IS NOT NULL AND \"date\" >= $2", [p, since]),
  openIssues: (p) => db.query("SELECT severity, type, due FROM issues WHERE project = $1 AND status <> 'closed'", [p]),
  files: (p) => one(db, "SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files WHERE project = $1", [p]),
  upcoming: (p) => db.query("SELECT id, title, assignee, due, priority, status FROM tasks WHERE project = $1 AND status <> 'done' ORDER BY CASE WHEN due IS NULL THEN 1 ELSE 0 END, due, id LIMIT 6", [p]),
  projectIds: () => db.query("SELECT id FROM projects ORDER BY id"),
});
