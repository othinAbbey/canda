-- Progress on tender tasks, so directors and administrators can follow the work (Company Tasks page).
--  stage        : where the bid stands (NULL = not a bid, or not started)
--  requirements : the checklist of what the tender asks for, ticked off by the person doing the work
--  updates      : short progress notes from the person doing the work
ALTER TABLE tender_tasks ADD COLUMN stage TEXT CHECK (stage IS NULL OR stage IN ('not_started', 'documents', 'site_visit', 'preparing', 'pricing', 'review', 'submitted'));

CREATE TABLE tender_task_requirements (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  task TEXT NOT NULL REFERENCES tender_tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'na')),
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'reader', 'assistant')),   -- typed, found by the built-in reader, or by the AI assistant (next version)
  done_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ
);
CREATE INDEX idx_task_requirements_task ON tender_task_requirements (task, position);

CREATE TABLE tender_task_updates (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  task TEXT NOT NULL REFERENCES tender_tasks(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  stage TEXT
);
CREATE INDEX idx_task_updates_task ON tender_task_updates (task, created);
