-- Tender tracking: a pipeline of opportunities (saved from a search or typed in by hand) and shared saved searches.

CREATE TABLE tenders (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',               -- 'worldbank', 'manual', ...
  external_id TEXT,                                    -- the notice id at the source (NULL for manual entries)
  title TEXT NOT NULL, buyer TEXT, country TEXT, description TEXT, type TEXT, method TEXT,
  published DATE, deadline DATE, url TEXT,
  status TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved','interested','bidding','submitted','won','lost','dismissed')),
  notes TEXT,
  UNIQUE (source, external_id)
);
CREATE INDEX idx_tenders_status ON tenders (status, deadline);

CREATE TABLE tender_searches (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL, keywords TEXT, country TEXT, source TEXT
);
