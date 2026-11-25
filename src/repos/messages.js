import { newId, now } from "../ids.js";
import { one } from "../db/index.js";

/** Website messages. Every read and change is limited to one organization's inbox. */
export const messagesRepo = (db) => ({
  insert: (m) => db.query("INSERT INTO messages (id, created, name, email, phone, message, organization_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [newId(), now(), m.name, m.email, m.phone, m.message, m.organizationId]),
  list: (organizationId) => db.query("SELECT * FROM messages WHERE organization_id = $1 ORDER BY id DESC", [organizationId]),
  setStatus: (id, status, organizationId) => one(db, "UPDATE messages SET status = $1 WHERE id = $2 AND organization_id = $3 RETURNING *", [status, id, organizationId]),
  remove: (id, organizationId) => one(db, "DELETE FROM messages WHERE id = $1 AND organization_id = $2 RETURNING id", [id, organizationId]),
});
