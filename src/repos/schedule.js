import { newId, now } from "../ids.js";
import { one } from "../db/index.js";

export const scheduleRepo = (db) => ({
  links: (project) => db.query("SELECT * FROM task_links WHERE project = $1 ORDER BY id", [project]),
  link: (id) => one(db, "SELECT * FROM task_links WHERE id = $1", [id]),
  insertLink: (l, userId) => one(db, "INSERT INTO task_links (id, created, created_by, project, predecessor, successor, type, lag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    [newId(), now(), userId, l.project, l.predecessor, l.successor, l.type, l.lag]),
  updateLink: (id, l) => one(db, "UPDATE task_links SET type = $1, lag = $2, updated = $3 WHERE id = $4 RETURNING *", [l.type, l.lag, now(), id]),
  removeLink: (id) => one(db, "DELETE FROM task_links WHERE id = $1 RETURNING *", [id]),
  /** Used by "apply schedule" and "set baseline": writes dates for one task. */
  setDates: (id, { start, due, duration }) => one(db, "UPDATE tasks SET start = $1, due = $2, duration = COALESCE(duration, $3), updated = $4 WHERE id = $5 RETURNING id", [start, due, duration, now(), id]),
  setBaseline: (id, start, end) => one(db, "UPDATE tasks SET baseline_start = $1, baseline_end = $2, updated = $3 WHERE id = $4 RETURNING id", [start, end, now(), id]),
});
