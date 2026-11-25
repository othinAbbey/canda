import { one } from "../db/index.js";

const META = "f.id, f.created, f.project, f.name, f.mime, f.size, f.sha256, f.category, f.note, f.uploaded_by, u.email AS uploader";

export const filesRepo = (db) => ({
  insert: (f) => db.query("INSERT INTO files (id, created, project, name, mime, size, sha256, category, note, uploaded_by, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [f.id, f.created, f.project, f.name, f.mime, f.size, f.sha256, f.category, f.note, f.uploadedBy, f.data]),
  listMeta: (project, organizationId) => db.query(`SELECT ${META} FROM files f LEFT JOIN users u ON u.id = f.uploaded_by JOIN projects p ON p.id = f.project WHERE p.organization_id = $1${project ? " AND f.project = $2" : ""} ORDER BY f.id DESC`, project ? [organizationId, project] : [organizationId]),
  meta: (id, organizationId) => one(db, `SELECT ${META} FROM files f LEFT JOIN users u ON u.id = f.uploaded_by JOIN projects p ON p.id = f.project WHERE f.id = $1 AND p.organization_id = $2`, [id, organizationId]),
  data: (id, organizationId) => one(db, "SELECT f.name, f.mime, f.size, f.data FROM files f JOIN projects p ON p.id = f.project WHERE f.id = $1 AND p.organization_id = $2", [id, organizationId]),
  remove: (id, organizationId) => one(db, "DELETE FROM files WHERE id = $1 AND project IN (SELECT id FROM projects WHERE organization_id = $2) RETURNING id, name, project", [id, organizationId]),
});
