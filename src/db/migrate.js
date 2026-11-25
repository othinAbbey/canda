import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/**
 * Applies migrations/NNN_name.sql in order, once each, each in its own transaction.
 * Migrations are plain SQL and are never edited after release: add a new file instead.
 */
export async function migrate(db, log = () => {}) {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL)");
  const done = new Set((await db.query("SELECT version FROM schema_migrations")).map((r) => r.version));
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    await db.tx(async (t) => {
      await t.exec(fs.readFileSync(path.join(dir, f), "utf8"));
      await t.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)", [f, new Date().toISOString()]);
    });
    log(`applied ${f}`);
  }
}
