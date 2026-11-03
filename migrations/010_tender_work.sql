-- Tender value (so the pipeline can be totalled) and tasks assigned to project managers, with copies to others.
ALTER TABLE tenders ADD COLUMN value NUMERIC(16,2) CHECK (value IS NULL OR value >= 0);
ALTER TABLE tenders ADD COLUMN currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency IN ('UGX', 'USD', 'EUR', 'KES', 'TZS'));

CREATE TABLE tender_tasks (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  tender TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due DATE,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  notes TEXT
);
CREATE INDEX idx_tender_tasks_tender ON tender_tasks (tender);
CREATE INDEX idx_tender_tasks_assignee ON tender_tasks (assignee, status);

-- "Copied in": people who see the task without being responsible for it (for example the general project manager).
CREATE TABLE tender_task_copies (
  task TEXT NOT NULL REFERENCES tender_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task, user_id)
);
CREATE INDEX idx_tender_copies_user ON tender_task_copies (user_id);
