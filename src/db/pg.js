import { DbError } from "../errors.js";

const KIND = { 23505: "unique", 23503: "fk", 23514: "check", 23502: "notnull" };
const wrap = (e) => (KIND[e.code] ? new DbError(KIND[e.code], e.message) : e);

/** Every database adapter has this shape: query(sql, params) -> rows, exec(sql), tx(fn), close(). */
function api(client) {
  return {
    async query(sql, params = []) { try { return (await client.query(sql, params)).rows; } catch (e) { throw wrap(e); } },
    async exec(sql) { try { await client.query(sql); } catch (e) { throw wrap(e); } },
  };
}

export async function createPgDb(connectionString, { max = 10 } = {}) {
  const { default: pg } = await import("pg");                    // loaded here so tests do not need the package
  pg.types.setTypeParser(20, Number);                             // bigint
  pg.types.setTypeParser(1700, Number);                           // numeric
  pg.types.setTypeParser(1082, (v) => v);                         // date -> "YYYY-MM-DD"
  pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz -> ISO string
  const pool = new pg.Pool({ connectionString, max });
  return {
    ...api(pool),
    async tx(fn) {
      const c = await pool.connect();
      try { await c.query("BEGIN"); const out = await fn(api(c)); await c.query("COMMIT"); return out; }
      catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
      finally { c.release(); }
    },
    close: () => pool.end(),
  };
}
