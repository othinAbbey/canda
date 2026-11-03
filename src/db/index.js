import { createPgDb } from "./pg.js";

/** Small helpers over any adapter. Keep SQL in repos; keep adapters tiny. */
export const one = async (db, sql, params) => (await db.query(sql, params))[0] ?? null;
export const count = async (db, sql, params) => Number((await one(db, sql, params))?.n ?? 0);

export async function createDb(config) {
  if (!/^postgres(ql)?:\/\//.test(config.databaseUrl || "")) throw new Error("DATABASE_URL must start with postgres://");
  return createPgDb(config.databaseUrl);
}
