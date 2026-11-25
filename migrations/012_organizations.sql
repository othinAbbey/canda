-- Multi-tenancy: every company that signs up gets its own organization. Every user belongs to exactly one
-- (no shared logins across companies in this version -- someone working with two client companies uses two
-- email addresses). Project data, the material catalog, tenders, BOQ jobs and forms are scoped to an
-- organization in later migrations; this one only introduces the organizations table and attaches users to it.

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,               -- set later via the organization settings screen
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  created TIMESTAMPTZ NOT NULL,
  updated TIMESTAMPTZ
);

-- Every row created before multi-tenancy existed has to belong to SOME organization: give it one so the
-- NOT NULL below is satisfiable. This also makes C & A Contractors itself tenant #1 of its own product,
-- same as how most SaaS companies run their own business on the thing they sell.
INSERT INTO organizations (id, name, created) VALUES ('org_canda', 'C & A Contractors Limited', '2026-01-01T00:00:00.000Z');

-- A DEFAULT on ADD COLUMN backfills every existing row in one statement (works the same in Postgres and
-- SQLite); this avoids ALTER COLUMN ... SET NOT NULL, which SQLite cannot do at all (see migration 009 for
-- the same constraint on this adapter, worked around the same way: never alter a column in place).
ALTER TABLE users ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'org_canda' REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX idx_users_organization ON users (organization_id);
