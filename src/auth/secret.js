import crypto from "node:crypto";
import { one } from "../db/index.js";

/** The token-signing secret: from TOKEN_SECRET, otherwise generated once and kept in the database. */
export async function ensureSecret(db, config) {
  if (config.tokenSecret) return config.tokenSecret;
  const row = await one(db, "SELECT value FROM settings WHERE key = 'secret'");
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO settings (key, value) VALUES ('secret', $1)", [secret]);
  return secret;
}
