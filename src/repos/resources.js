import { RESOURCES } from "../domain/resources.js";
import { newId, now } from "../ids.js";
import { one } from "../db/index.js";

const q = (name) => `"${name}"`;                       // quote identifiers ("end" and "date" are SQL keywords)
const known = (table) => { if (!RESOURCES[table]) throw new Error(`unknown resource ${table}`); return q(table); };

/** Generic data access for every table in RESOURCES. Table and column names come from that fixed list, never from input. */
export const resourcesRepo = (db) => ({
  list(table, { project } = {}) {
    const t = known(table);
    return project ? db.query(`SELECT * FROM ${t} WHERE "project" = $1 ORDER BY "id"`, [project]) : db.query(`SELECT * FROM ${t} ORDER BY "id"`);
  },
  get: (table, id) => one(db, `SELECT * FROM ${known(table)} WHERE "id" = $1`, [id]),
  insert(table, values, userId = null) {
    const row = { id: newId(), created: now(), created_by: userId, ...values };
    const cols = Object.keys(row);
    return one(db, `INSERT INTO ${known(table)} (${cols.map(q).join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, Object.values(row));
  },
  update(table, id, values) {
    const row = { ...values, updated: now() }, cols = Object.keys(row);
    return one(db, `UPDATE ${known(table)} SET ${cols.map((c, i) => `${q(c)} = $${i + 1}`).join(", ")} WHERE "id" = $${cols.length + 1} RETURNING *`, [...Object.values(row), id]);
  },
  remove: (table, id) => one(db, `DELETE FROM ${known(table)} WHERE "id" = $1 RETURNING *`, [id]),
});
