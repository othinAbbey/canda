import { newId, now } from "../ids.js";
import { one } from "../db/index.js";

const LISTING = `SELECT l.*, o.name AS company_name, o.logo_url AS company_logo, COALESCE(u.name, u.email) AS posted_by
  FROM market_listings l JOIN organizations o ON o.id = l.organization_id LEFT JOIN users u ON u.id = l.created_by`;
const RESPONSE = `SELECT r.*, o.name AS company_name, o.logo_url AS company_logo, COALESCE(u.name, u.email) AS sent_by,
  l.title AS listing_title, l.kind AS listing_kind, l.trade AS listing_trade, l.organization_id AS listing_org, lo.name AS listing_company
  FROM market_responses r JOIN organizations o ON o.id = r.organization_id LEFT JOIN users u ON u.id = r.created_by
  JOIN market_listings l ON l.id = r.listing JOIN organizations lo ON lo.id = l.organization_id`;
const cols = (row) => Object.keys(row);

/** The shared marketplace. Listings are readable by every company; responses only by the two companies involved (enforced in the service). */
export const marketRepo = (db) => ({
  list({ kind, trade, region, status, q, organizationId, limit = 200 } = {}) {
    const where = [], params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
    if (kind) add("l.kind = ?", kind);
    if (trade) add("l.trade = ?", trade);
    if (region) add("l.region = ?", region);
    if (status) add("l.status = ?", status);
    if (organizationId) add("l.organization_id = ?", organizationId);
    if (q) { params.push(`%${String(q).toLowerCase()}%`); const n = `$${params.length}`; where.push(`(LOWER(l.title) LIKE ${n} OR LOWER(COALESCE(l.description, '')) LIKE ${n} OR LOWER(o.name) LIKE ${n} OR LOWER(COALESCE(l.district, '')) LIKE ${n})`); }
    return db.query(`${LISTING} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY l.created DESC, l.id DESC LIMIT ${Math.min(Number(limit) || 200, 500)}`, params);
  },
  get: (id) => one(db, `${LISTING} WHERE l.id = $1`, [id]),
  insert(l) {
    const row = { id: newId(), created: now(), ...l };
    return one(db, `INSERT INTO market_listings (${cols(row).join(",")}) VALUES (${cols(row).map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, Object.values(row));
  },
  update(id, organizationId, values) {
    const row = { ...values, updated: now() }, c = cols(row);
    return one(db, `UPDATE market_listings SET ${c.map((k, i) => `${k} = $${i + 1}`).join(", ")} WHERE id = $${c.length + 1} AND organization_id = $${c.length + 2} RETURNING id`, [...Object.values(row), id, organizationId]);
  },
  remove: (id, organizationId) => one(db, "DELETE FROM market_listings WHERE id = $1 AND organization_id = $2 RETURNING id", [id, organizationId]),

  /** How many responses each of these listings has (for the poster's own listings). */
  async counts(ids) {
    if (!ids.length) return new Map();
    const rows = await db.query(`SELECT listing, COUNT(*) AS n, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS unread FROM market_responses
      WHERE listing IN (${ids.map((_, i) => `$${i + 1}`).join(",")}) AND status <> 'withdrawn' GROUP BY listing`, ids);
    return new Map(rows.map((r) => [r.listing, { n: Number(r.n), unread: Number(r.unread) }]));
  },
  /** This company's response to each of these listings, if any. */
  async mine(ids, organizationId) {
    if (!ids.length) return new Map();
    const rows = await db.query(`SELECT id, listing, status FROM market_responses WHERE organization_id = $1 AND listing IN (${ids.map((_, i) => `$${i + 2}`).join(",")})`, [organizationId, ...ids]);
    return new Map(rows.map((r) => [r.listing, r]));
  },

  responsesFor: (listing) => db.query(`${RESPONSE} WHERE r.listing = $1 ORDER BY r.created DESC`, [listing]),
  responsesBy: (organizationId) => db.query(`${RESPONSE} WHERE r.organization_id = $1 ORDER BY r.created DESC`, [organizationId]),
  response: (id) => one(db, `${RESPONSE} WHERE r.id = $1`, [id]),
  responseOf: (listing, organizationId) => one(db, "SELECT * FROM market_responses WHERE listing = $1 AND organization_id = $2", [listing, organizationId]),
  insertResponse(r) {
    const row = { id: newId(), created: now(), status: "new", ...r };
    return one(db, `INSERT INTO market_responses (${cols(row).join(",")}) VALUES (${cols(row).map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, Object.values(row));
  },
  updateResponse(id, values) {
    const row = { ...values, updated: now() }, c = cols(row);
    return one(db, `UPDATE market_responses SET ${c.map((k, i) => `${k} = $${i + 1}`).join(", ")} WHERE id = $${c.length + 1} RETURNING id`, [...Object.values(row), id]);
  },
});
