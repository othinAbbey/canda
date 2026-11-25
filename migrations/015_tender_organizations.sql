-- Each company's tender pipeline, tender tasks and saved searches are private to that company.
-- tenders had UNIQUE (source, external_id) across the whole system, which would stop two companies saving the same
-- World Bank notice. A unique constraint cannot be changed in place portably, so the three linked tables are rebuilt:
-- create the new tables, copy the rows, drop the old ones, rename. Existing rows go to the company of whoever created
-- them (C & A where that person is unknown).

CREATE TABLE tenders_v2 (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  title TEXT NOT NULL, buyer TEXT, country TEXT, description TEXT, type TEXT, method TEXT,
  published DATE, deadline DATE, url TEXT,
  status TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved','interested','bidding','submitted','won','lost','dismissed')),
  notes TEXT,
  value NUMERIC(16,2) CHECK (value IS NULL OR value >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency IN ('UGX', 'USD', 'EUR', 'KES', 'TZS')),
  UNIQUE (organization_id, source, external_id)
);
INSERT INTO tenders_v2 (id, created, updated, created_by, organization_id, source, external_id, title, buyer, country, description, type, method,
  published, deadline, url, status, notes, value, currency)
SELECT t.id, t.created, t.updated, t.created_by, COALESCE((SELECT u.organization_id FROM users u WHERE u.id = t.created_by), 'org_canda'),
  t.source, t.external_id, t.title, t.buyer, t.country, t.description, t.type, t.method, t.published, t.deadline, t.url, t.status, t.notes, t.value, t.currency
FROM tenders t;

CREATE TABLE tender_tasks_v2 (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  tender TEXT NOT NULL REFERENCES tenders_v2(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due DATE,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  notes TEXT
);
INSERT INTO tender_tasks_v2 (id, created, updated, created_by, tender, title, assignee, due, priority, status, notes)
SELECT id, created, updated, created_by, tender, title, assignee, due, priority, status, notes FROM tender_tasks;

CREATE TABLE tender_task_copies_v2 (
  task TEXT NOT NULL REFERENCES tender_tasks_v2(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task, user_id)
);
INSERT INTO tender_task_copies_v2 (task, user_id) SELECT task, user_id FROM tender_task_copies;

DROP TABLE tender_task_copies;
DROP TABLE tender_tasks;
DROP TABLE tenders;
ALTER TABLE tenders_v2 RENAME TO tenders;
ALTER TABLE tender_tasks_v2 RENAME TO tender_tasks;
ALTER TABLE tender_task_copies_v2 RENAME TO tender_task_copies;

CREATE INDEX idx_tenders_org_status ON tenders (organization_id, status, deadline);
CREATE INDEX idx_tender_tasks_tender ON tender_tasks (tender);
CREATE INDEX idx_tender_tasks_assignee ON tender_tasks (assignee, status);
CREATE INDEX idx_tender_copies_user ON tender_task_copies (user_id);

-- Saved searches: same idea, no unique rule involved, so a plain column is enough.
ALTER TABLE tender_searches ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'org_canda' REFERENCES organizations(id) ON DELETE CASCADE;
UPDATE tender_searches SET organization_id = COALESCE((SELECT u.organization_id FROM users u WHERE u.id = tender_searches.created_by), 'org_canda');
CREATE INDEX idx_tender_searches_org ON tender_searches (organization_id);
