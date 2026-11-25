import { one } from "../db/index.js";

export const organizationsRepo = (db) => ({
  byId: (id) => one(db, "SELECT * FROM organizations WHERE id = $1", [id]),
  create: (o) => one(db, "INSERT INTO organizations (id, name, created) VALUES ($1, $2, $3) RETURNING *", [o.id, o.name, o.created]),
  update: (id, patch) => one(
    db,
    "UPDATE organizations SET name = $1, logo_url = $2, contact_email = $3, contact_phone = $4, address = $5, updated = $6 WHERE id = $7 RETURNING *",
    [patch.name, patch.logo_url, patch.contact_email, patch.contact_phone, patch.address, patch.updated, id],
  ),
});
