-- Price (rate) suggestions: like materials, suppliers and districts, a suggested price waits for an admin's approval.
-- The kind check cannot be changed in place on every database, so the table is rebuilt and copied (as in 015 and 018).
CREATE TABLE catalog_proposals_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('material','supplier','location','rate')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  result_id TEXT
);
INSERT INTO catalog_proposals_new (id, kind, payload, status, submitted_by, submitted_at, reviewed_by, reviewed_at, review_note, result_id)
SELECT id, kind, payload, status, submitted_by, submitted_at, reviewed_by, reviewed_at, review_note, result_id FROM catalog_proposals;
DROP TABLE catalog_proposals;
ALTER TABLE catalog_proposals_new RENAME TO catalog_proposals;
CREATE INDEX idx_proposals_status ON catalog_proposals (status, submitted_at);
