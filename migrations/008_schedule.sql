-- MS Project style scheduling: task links, percent complete, milestones, summary tasks (parent), baselines, working calendar.

ALTER TABLE tasks ADD COLUMN duration INTEGER;                                   -- working days; NULL = derive from start and due
ALTER TABLE tasks ADD COLUMN percent INTEGER NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100);
ALTER TABLE tasks ADD COLUMN milestone INTEGER NOT NULL DEFAULT 0 CHECK (milestone IN (0, 1));
ALTER TABLE tasks ADD COLUMN parent TEXT REFERENCES tasks(id) ON DELETE SET NULL; -- a task with children is a summary task
ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN baseline_start DATE;
ALTER TABLE tasks ADD COLUMN baseline_end DATE;

ALTER TABLE projects ADD COLUMN workweek TEXT NOT NULL DEFAULT 'mon-sat' CHECK (workweek IN ('mon-fri', 'mon-sat', 'all'));

-- Dependencies. type: FS finish-to-start, SS start-to-start, FF finish-to-finish, SF start-to-finish. lag in working days (may be negative).
CREATE TABLE task_links (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'SS', 'FF', 'SF')),
  lag INTEGER NOT NULL DEFAULT 0,
  UNIQUE (predecessor, successor),
  CHECK (predecessor <> successor)
);
CREATE INDEX idx_links_project ON task_links (project);
