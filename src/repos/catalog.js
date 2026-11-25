import { one } from "../db/index.js";

/** Lookups the catalog features need beyond plain CRUD. */
export const catalogRepo = (db) => ({
  materialByName: (name) => one(db, "SELECT id, name, unit, size FROM materials WHERE LOWER(name) = LOWER($1)", [String(name)]),
  materialByNameOrId: (v) => one(db, "SELECT id, name, unit, size FROM materials WHERE LOWER(name) = LOWER($1) OR id = $1", [String(v)]),
  location: (id) => one(db, "SELECT * FROM locations WHERE id = $1", [id]),
  locationByPlace: (region, district) => one(db, "SELECT id FROM locations WHERE LOWER(region) = LOWER($1) AND LOWER(district) = LOWER($2)", [region, district]),
  ratesFor: (materialId) => db.query("SELECT r.price, r.location_id, l.region, s.name AS supplier FROM rates r JOIN locations l ON l.id = r.location_id LEFT JOIN suppliers s ON s.id = r.supplier WHERE r.material = $1 ORDER BY r.price", [materialId]),
  locations: () => db.query("SELECT * FROM locations ORDER BY region, district"),
  locationByIdOrDistrict: (v) => db.query("SELECT * FROM locations WHERE id = $1 OR LOWER(district) = LOWER($1)", [String(v)]),
  supplierByNameOrId: (v) => one(db, "SELECT id, name FROM suppliers WHERE id = $1 OR LOWER(name) = LOWER($1)", [String(v)]),
  sameRate: (material, supplier, location) => one(db, `SELECT id, price FROM rates WHERE material = $1 AND location_id = $2 AND ${supplier ? "supplier = $3" : "supplier IS NULL"}`, supplier ? [material, location, supplier] : [material, location]),
  /** Every price with names, for answering questions about the rate book. */
  rateBook: () => db.query(`SELECT r.id, r.price, r.note, r.updated, r.created, m.id AS material_id, m.name AS material, m.unit, m.category, s.id AS supplier_id, s.name AS supplier, s.phone AS supplier_phone,
    l.id AS location_id, l.district, l.region FROM rates r JOIN materials m ON m.id = r.material JOIN locations l ON l.id = r.location_id LEFT JOIN suppliers s ON s.id = r.supplier ORDER BY m.name, r.price`),
  counts: async () => ({ locations: (await one(db, "SELECT COUNT(*) AS n FROM locations")).n, materials: (await one(db, "SELECT COUNT(*) AS n FROM materials")).n }),
});
