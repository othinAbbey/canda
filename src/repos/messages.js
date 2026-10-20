import { newId, now } from "../ids.js";
import { one } from "../db/index.js";

export const messagesRepo = (db) => ({
  insert: (m) => db.query("INSERT INTO messages (id, created, name, email, phone, message) VALUES ($1,$2,$3,$4,$5,$6)", [newId(), now(), m.name, m.email, m.phone, m.message]),
  list: () => db.query("SELECT * FROM messages ORDER BY id DESC"),
  setStatus: (id, status) => one(db, "UPDATE messages SET status = $1 WHERE id = $2 RETURNING *", [status, id]),
  remove: (id) => one(db, "DELETE FROM messages WHERE id = $1 RETURNING id", [id]),
});
