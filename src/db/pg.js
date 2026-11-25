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

/** Decide whether to encrypt. Hosted providers (Render, Neon, Supabase ...) refuse plain connections from outside. */
export function sslOption(connectionString, ssl = "auto") {
  if (ssl === "auto") {
    const host = new URL(connectionString).hostname;
    ssl = host.includes(".") && !["127.0.0.1", "localhost"].includes(host);
  }
  return ssl ? { rejectUnauthorized: false } : false;              // encrypted; providers often use certs Node can't verify
}

export async function createPgDb(connectionString, { max = 10, ssl = "auto" } = {}) {
  const { default: pg } = await import("pg");                    // loaded here so tests do not need the package
  pg.types.setTypeParser(20, Number);                             // bigint
  pg.types.setTypeParser(1700, Number);                           // numeric
  pg.types.setTypeParser(1082, (v) => v);                         // date -> "YYYY-MM-DD"
  pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz -> ISO string
  const url = new URL(connectionString);
  for (const k of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(k);  // these would override the ssl option below
  let sslOpt = sslOption(connectionString, ssl);
  let pool = new pg.Pool({ connectionString: url.toString(), max, ssl: sslOpt });
  try { await pool.query("SELECT 1"); }
  catch (e) {
    // The server insists on encryption (e.g. PGSSL=false copied to a hosted database): retry once with SSL on.
    if (sslOpt || !(e.code === "28000" || /ssl|tls|encrypt/i.test(e.message))) throw e;
    await pool.end().catch(() => {});
    console.warn("database requires SSL; reconnecting with SSL on (remove PGSSL=false to skip this retry)");
    sslOpt = { rejectUnauthorized: false };
    pool = new pg.Pool({ connectionString: url.toString(), max, ssl: sslOpt });
    await pool.query("SELECT 1");
  }
  console.log(`database: connected to ${url.hostname} (ssl ${sslOpt ? "on" : "off"})`);
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
