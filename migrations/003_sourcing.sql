-- Material sourcing: where (locations), who sells (suppliers), what (materials), at what price (rates).
-- Everyone can read; only admins write directly. Everyone else submits proposals that an admin approves.

CREATE TABLE locations (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  region TEXT NOT NULL, district TEXT NOT NULL,
  UNIQUE (region, district)
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL, contact TEXT, phone TEXT,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL, notes TEXT
);

CREATE TABLE materials (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL UNIQUE, category TEXT, unit TEXT NOT NULL, size TEXT, description TEXT
);

CREATE TABLE rates (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  material TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  supplier TEXT REFERENCES suppliers(id) ON DELETE SET NULL,          -- NULL = general market rate
  location_id TEXT NOT NULL REFERENCES locations(id),
  price NUMERIC(16,2) NOT NULL CHECK (price >= 0), note TEXT
);
CREATE INDEX idx_rates_material ON rates (material, location_id);

-- Suggestions from non-admin users. Approving one creates the real record.
CREATE TABLE catalog_proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('material','supplier','location')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  result_id TEXT                                                      -- id of the record created on approval
);
CREATE INDEX idx_proposals_status ON catalog_proposals (status, submitted_at);
