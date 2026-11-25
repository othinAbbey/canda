import { now } from "../ids.js";
import { one } from "../db/index.js";
import { toJson } from "../json.js";

export const rolesRepo = (db) => ({
  list: () => db.query("SELECT * FROM roles ORDER BY builtin DESC, name"),
  get: (code) => one(db, "SELECT * FROM roles WHERE code = $1", [code]),
  insert: (r) => one(db, "INSERT INTO roles (code, name, description, permissions, builtin, created) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [r.code, r.name, r.description, toJson(r.permissions), r.builtin ? 1 : 0, now()]),
  update: (code, r) => one(db, "UPDATE roles SET name = $1, description = $2, permissions = $3, updated = $4 WHERE code = $5 RETURNING *", [r.name, r.description, toJson(r.permissions), now(), code]),
  remove: (code) => one(db, "DELETE FROM roles WHERE code = $1 RETURNING code", [code]),
  userCounts: () => db.query("SELECT role, COUNT(*) AS n FROM users GROUP BY role"),
});
