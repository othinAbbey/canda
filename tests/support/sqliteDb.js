// TEST-ONLY database adapter. Production uses PostgreSQL (src/db/pg.js).
// It runs the very same migrations and queries on Node's built-in SQLite so the suite can run anywhere.
// SQL in this project is written in the portable subset: $1 placeholders, RETURNING, no Postgres-only functions.
import { DatabaseSync } from "node:sqlite";
import { DbError } from "../../src/errors.js";

const KIND = [[/UNIQUE constraint failed/, "unique"], [/FOREIGN KEY constraint failed/, "fk"], [/CHECK constraint failed/, "check"], [/NOT NULL constraint failed/, "notnull"]];
const wrap = (e) => { const m = KIND.find(([re]) => re.test(e.message)); return m ? new DbError(m[1], e.message) : e; };
const sql$ = (s) => s.replace(/\$(\d+)/g, "?$1");
const norm = (v) => (v === undefined ? null : v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v) : v);
const out = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v) : v]));

export function createSqliteDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  let lock = Promise.resolve();            // one transaction at a time on the single connection
  const api = {
    async query(sql, params = []) { try { return db.prepare(sql$(sql)).all(...params.map(norm)).map(out); } catch (e) { throw wrap(e); } },
    async exec(sql) { try { db.exec(sql); } catch (e) { throw wrap(e); } },
  };
  return {
    ...api,
    tx(fn) {
      const run = lock.then(async () => {
        db.exec("BEGIN");
        try { const r = await fn(api); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
      });
      lock = run.catch(() => {});
      return run;
    },
    close() { try { db.close(); } catch { /* already closed */ } },
  };
}
