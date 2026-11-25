import { newId } from "../ids.js";
import { one } from "../db/index.js";
import { parseJson } from "../json.js";

export const billingRepo = (db) => ({
  plans: async () => (await db.query("SELECT * FROM plans WHERE active = 1 ORDER BY price_monthly, code")).map((p) => ({ ...p, limits: parseJson(p.limits, {}) })),
  plan: async (code) => { const p = await one(db, "SELECT * FROM plans WHERE code = $1", [code]); return p && { ...p, limits: parseJson(p.limits, {}) }; },
  subscription: (userId) => one(db, "SELECT * FROM subscriptions WHERE user_id = $1", [userId]),
  ensure: (userId, at) => db.query("INSERT INTO subscriptions (user_id, plan_code, status, updated) VALUES ($1,'free','active',$2) ON CONFLICT (user_id) DO NOTHING", [userId, at]),
  setPlan: (userId, code, at) => one(db, "UPDATE subscriptions SET plan_code = $1, updated = $2 WHERE user_id = $3 RETURNING *", [code, at, userId]),
  recordUsage: (userId, kind, at, units = 1) => db.query("INSERT INTO usage_events (id, user_id, kind, units, at) VALUES ($1,$2,$3,$4,$5)", [newId(), userId, kind, units, at]),
  usageSince: async (userId, kind, since) => Number((await one(db, "SELECT COALESCE(SUM(units), 0) AS n FROM usage_events WHERE user_id = $1 AND kind = $2 AND at >= $3", [userId, kind, since])).n),
});
