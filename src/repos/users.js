import { count, one } from "../db/index.js";

export const usersRepo = (db) => ({
  byId: (id) => one(db, "SELECT * FROM users WHERE id = $1", [id]),
  byEmail: (email) => one(db, "SELECT * FROM users WHERE email = $1", [email]),
  count: () => count(db, "SELECT COUNT(*) AS n FROM users"),
  countActiveAdmins: () => count(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'"),
  list: () => db.query("SELECT id, email, name, role, status, created FROM users ORDER BY created, id"),
  create: (u) => one(db, "INSERT INTO users (id, email, name, role, status, password_hash, token_version, created) VALUES ($1,$2,$3,$4,'active',$5,0,$6) RETURNING *",
    [u.id, u.email, u.name, u.role, u.passwordHash, u.created]),
  /** Changing the password bumps token_version, which invalidates every token issued before. */
  setPassword: (id, hash) => one(db, "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING *", [hash, id]),
  setRole: (id, role) => one(db, "UPDATE users SET role = $1 WHERE id = $2 RETURNING *", [role, id]),
  setStatus: (id, status) => one(db, "UPDATE users SET status = $1, token_version = token_version + 1 WHERE id = $2 RETURNING *", [status, id]),
  remove: (id) => one(db, "DELETE FROM users WHERE id = $1 RETURNING *", [id]),

  async replaceReset(userId, codeHash, expires) {
    await db.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
    await db.query("INSERT INTO password_resets (user_id, code_hash, expires) VALUES ($1,$2,$3)", [userId, codeHash, expires]);
  },
  findReset: (userId, codeHash) => one(db, "SELECT * FROM password_resets WHERE user_id = $1 AND code_hash = $2", [userId, codeHash]),
  clearResets: (userId) => db.query("DELETE FROM password_resets WHERE user_id = $1", [userId]),
});
