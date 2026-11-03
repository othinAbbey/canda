import { one } from "../db/index.js";
import { parseJson, toJson } from "../json.js";

// Everything except the two big binary columns.
const COLS = "id, user_id, filename, pdf_sha256, status, stage, error, remote_job_id, result, usage, cost_usd, cached, xlsx_name, created, updated, CASE WHEN xlsx IS NULL THEN 0 ELSE 1 END AS has_xlsx";
const view = (r) => r && { ...r, result: parseJson(r.result), usage: parseJson(r.usage) };
const PATCHABLE = ["status", "stage", "error", "remote_job_id", "result", "usage", "cost_usd", "cached", "xlsx_name", "xlsx"];

export const boqRepo = (db) => ({
  insert: (j) => db.query("INSERT INTO boq_jobs (id, user_id, filename, pdf_sha256, pdf, status, stage, created, updated) VALUES ($1,$2,$3,$4,$5,'queued','queued',$6,$6)",
    [j.id, j.userId, j.filename, j.sha256, j.pdf, j.at]),
  get: async (id) => view(await one(db, `SELECT ${COLS} FROM boq_jobs WHERE id = $1`, [id])),
  list: async (userId, limit = 50) => (await db.query(`SELECT ${COLS} FROM boq_jobs ${userId ? "WHERE user_id = $1" : ""} ORDER BY id DESC LIMIT ${Number(limit)}`, userId ? [userId] : [])).map(view),
  async update(id, patch, at) {
    const row = { ...patch, updated: at }, cols = Object.keys(row);
    if (cols.some((c) => c !== "updated" && !PATCHABLE.includes(c))) throw new Error("unexpected boq_jobs column");
    const val = (c, v) => (c === "result" || c === "usage" ? toJson(v) : v);
    return view(await one(db, `UPDATE boq_jobs SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1} RETURNING ${COLS}`, [...cols.map((c) => val(c, row[c])), id]));
  },
  pdf: (id) => one(db, "SELECT filename, pdf FROM boq_jobs WHERE id = $1", [id]),
  xlsx: (id) => one(db, "SELECT xlsx_name, xlsx FROM boq_jobs WHERE id = $1", [id]),
  remove: (id) => one(db, "DELETE FROM boq_jobs WHERE id = $1 RETURNING id", [id]),
});
