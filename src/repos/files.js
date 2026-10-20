import { one } from "../db/index.js";

const META = "f.id, f.created, f.project, f.name, f.mime, f.size, f.sha256, f.category, f.note, f.uploaded_by, u.email AS uploader";

export const filesRepo = (db) => ({
  insert: (f) => db.query("INSERT INTO files (id, created, project, name, mime, size, sha256, category, note, uploaded_by, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [f.id, f.created, f.project, f.name, f.mime, f.size, f.sha256, f.category, f.note, f.uploadedBy, f.data]),
  listMeta: (project) => db.query(`SELECT ${META} FROM files f LEFT JOIN users u ON u.id = f.uploaded_by ${project ? "WHERE f.project = $1" : ""} ORDER BY f.id DESC`, project ? [project] : []),
  meta: (id) => one(db, `SELECT ${META} FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.id = $1`, [id]),
  data: (id) => one(db, "SELECT name, mime, size, data FROM files WHERE id = $1", [id]),
  remove: (id) => one(db, "DELETE FROM files WHERE id = $1 RETURNING id, name, project", [id]),
});
