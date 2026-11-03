import { one } from "../db/index.js";

/** Lookups the catalog features need beyond plain CRUD. */
export const catalogRepo = (db) => ({
  materialByName: (name) => one(db, "SELECT id, name, unit, size FROM materials WHERE LOWER(name) = LOWER($1)", [String(name)]),
  materialByNameOrId: (v) => one(db, "SELECT id, name, unit, size FROM materials WHERE LOWER(name) = LOWER($1) OR id = $1", [String(v)]),
  location: (id) => one(db, "SELECT * FROM locations WHERE id = $1", [id]),
  locationByPlace: (region, district) => one(db, "SELECT id FROM locations WHERE LOWER(region) = LOWER($1) AND LOWER(district) = LOWER($2)", [region, district]),
  ratesFor: (materialId) => db.query("SELECT r.price, r.location_id, l.region, s.name AS supplier FROM rates r JOIN locations l ON l.id = r.location_id LEFT JOIN suppliers s ON s.id = r.supplier WHERE r.material = $1 ORDER BY r.price", [materialId]),
  locations: () => db.query("SELECT * FROM locations ORDER BY region, district"),
  counts: async () => ({ locations: (await one(db, "SELECT COUNT(*) AS n FROM locations")).n, materials: (await one(db, "SELECT COUNT(*) AS n FROM materials")).n }),
});
