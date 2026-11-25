-- AI bid reading.
-- 1. The requirements checklist belongs to the TENDER, not to one task: the AI fills it as soon as the company shows
--    interest, before anyone is assigned, and every task on that tender shares it. Rebuilt and copied, as in 015.
-- 2. Bid documents: uploaded when the notice has none to read (documents bought, collected, or sent by email).
-- 3. On each tender, where the AI reading stands and what it found.

CREATE TABLE tender_requirements (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  tender TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  category TEXT,
  mandatory BOOLEAN,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'na')),
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'reader', 'assistant')),   -- typed, built-in reader, or the AI
  found_in TEXT,                                                                              -- which document the AI found it in
  done_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ
);
INSERT INTO tender_requirements (id, created, updated, created_by, tender, position, text, category, status, note, source, done_by, done_at)
SELECT r.id, r.created, r.updated, r.created_by, t.tender, r.position, r.text, r.category, r.status, r.note, r.source, r.done_by, r.done_at
FROM tender_task_requirements r JOIN tender_tasks t ON t.id = r.task;
DROP TABLE tender_task_requirements;
CREATE INDEX idx_tender_requirements_tender ON tender_requirements (tender, position);

CREATE TABLE tender_documents (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL,
  tender TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, sha256 TEXT,
  note TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  data BYTEA NOT NULL
);
CREATE INDEX idx_tender_documents_tender ON tender_documents (tender, created);

-- ai_status: NULL (never read) | queued | reading | done | needs_documents | failed
ALTER TABLE tenders ADD COLUMN ai_status TEXT;
ALTER TABLE tenders ADD COLUMN ai_summary TEXT;        -- JSON: what the AI found (deadline, bid security, how to get the documents...)
ALTER TABLE tenders ADD COLUMN ai_error TEXT;
ALTER TABLE tenders ADD COLUMN ai_read_at TIMESTAMPTZ;
