import { RESOURCES } from "../domain/resources.js";
import { newId, now } from "../ids.js";
import { one } from "../db/index.js";

const q = (name) => `"${name}"`;                       // quote identifiers ("end" and "date" are SQL keywords)
const known = (table) => { if (!RESOURCES[table]) throw new Error(`unknown resource ${table}`); return q(table); };

/** Generic data access for every table in RESOURCES. Table and column names come from that fixed list, never from input. */
export const resourcesRepo = (db) => ({
  list(table, { project, organizationId } = {}) {
    const t = known(table);
    if (table === "projects" && organizationId) {
      return db.query(`SELECT * FROM ${t} WHERE "organization_id" = $1 ORDER BY "id"`, [organizationId]);
    }
    if (RESOURCES[table].projectOf && table !== "projects" && organizationId) {
      const params = project ? [organizationId, project] : [organizationId];
      return db.query(`SELECT r.* FROM ${t} r JOIN projects p ON p.id = r."project" WHERE p.organization_id = $1${project ? ' AND r."project" = $2' : ""} ORDER BY r."id"`, params);
    }
    return project ? db.query(`SELECT * FROM ${t} WHERE "project" = $1 ORDER BY "id"`, [project]) : db.query(`SELECT * FROM ${t} ORDER BY "id"`);
  },
  get(table, id, organizationId) {
    const t = known(table);
    if (table === "projects" && organizationId) return one(db, `SELECT * FROM ${t} WHERE "id" = $1 AND "organization_id" = $2`, [id, organizationId]);
    if (RESOURCES[table].projectOf && table !== "projects" && organizationId) {
      return one(db, `SELECT r.* FROM ${t} r JOIN projects p ON p.id = r."project" WHERE r."id" = $1 AND p.organization_id = $2`, [id, organizationId]);
    }
    return one(db, `SELECT * FROM ${t} WHERE "id" = $1`, [id]);
  },
  insert(table, values, userId = null, organizationId = null) {
    const row = { id: newId(), created: now(), created_by: userId, ...(table === "projects" ? { organization_id: organizationId } : {}), ...values };
    const cols = Object.keys(row);
    return one(db, `INSERT INTO ${known(table)} (${cols.map(q).join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, Object.values(row));
  },
  update(table, id, values, organizationId) {
    const row = { ...values, updated: now() }, cols = Object.keys(row);
    const params = [...Object.values(row), id];
    let where = `"id" = $${cols.length + 1}`;
    if (organizationId && table === "projects") { params.push(organizationId); where += ` AND "organization_id" = $${params.length}`; }
    else if (organizationId && RESOURCES[table].projectOf) {
      params.push(organizationId);
      where += ` AND "project" IN (SELECT id FROM projects WHERE organization_id = $${params.length})`;
    }
    return one(db, `UPDATE ${known(table)} SET ${cols.map((c, i) => `${q(c)} = $${i + 1}`).join(", ")} WHERE ${where} RETURNING *`, params);
  },
  remove(table, id, organizationId) {
    const params = [id];
    let where = `"id" = $1`;
    if (organizationId && table === "projects") { params.push(organizationId); where += ` AND "organization_id" = $2`; }
    else if (organizationId && RESOURCES[table].projectOf) {
      params.push(organizationId);
      where += ` AND "project" IN (SELECT id FROM projects WHERE organization_id = $2)`;
    }
    return one(db, `DELETE FROM ${known(table)} WHERE ${where} RETURNING *`, params);
  },
});
