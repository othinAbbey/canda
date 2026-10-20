import { loadConfig } from "../../src/config.js";
import { migrate } from "../../src/db/migrate.js";
import { createApp } from "../../src/http/app.js";
import { seedIfEmpty } from "../../src/seed.js";
import { createSqliteDb } from "./sqliteDb.js";

/** A running API on a random port with an in-memory database. `boq` stubs the BOQ service. */
export async function startTestApp({ env = {}, seed = true, boq } = {}) {
  const db = createSqliteDb();
  await migrate(db);
  if (seed) await seedIfEmpty(db);
  const config = loadConfig({ TOKEN_SECRET: "test-secret", CORS_ORIGINS: "http://localhost:3000", ...env });
  const app = await createApp({ db, config, boqClient: boq });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  /** call(method, path, body?, token?, raw?) -> { status, body, headers }. raw sends bytes instead of JSON. */
  const call = async (method, path, body, token, raw) => {
    const r = await fetch(base + path, { method, headers: { ...(raw ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: raw ?? (body === undefined || body === null ? undefined : JSON.stringify(body)) });
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, headers: r.headers, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  /** Sign up (first call = admin) or have an admin create the account, then return its token. */
  const account = async (email, role, adminToken) => {
    if (!adminToken) return (await call("POST", "/api/auth/register", { email, password: "password123", name: email })).body.token;
    await call("POST", "/api/users", { email, password: "password123", role }, adminToken);
    return (await call("POST", "/api/auth/login", { email, password: "password123" })).body.token;
  };
  return { base, call, account, db, app, close: async () => { await app.close(); db.close(); } };
}
