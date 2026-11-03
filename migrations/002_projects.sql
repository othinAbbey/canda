-- Project management. Column names match the API field names; "end" and "date" are quoted because they are SQL keywords.

CREATE TABLE projects (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL, client TEXT, location TEXT,
  budget NUMERIC(16,2) CHECK (budget IS NULL OR budget >= 0),
  start DATE, "end" DATE, manager TEXT,
  status TEXT CHECK (status IN ('planning','active','on hold','complete'))
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, assignee TEXT,
  priority TEXT CHECK (priority IN ('low','medium','high')),
  start DATE, due DATE,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done'))
);

CREATE TABLE costs (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT, item TEXT NOT NULL, amount NUMERIC(16,2) NOT NULL, "date" DATE, supplier TEXT
);

CREATE TABLE logs (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  "date" DATE, weather TEXT, workers INTEGER CHECK (workers IS NULL OR workers >= 0),
  work TEXT NOT NULL, delays TEXT, visitors TEXT, safety TEXT
);

CREATE TABLE issues (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT, title TEXT NOT NULL, owner TEXT,
  severity TEXT CHECK (severity IN ('low','medium','high')),
  due DATE, detail TEXT, cost NUMERIC(16,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in review','closed'))
);

-- Uploaded documents: metadata and the bytes themselves live in the database (one backup covers everything).
CREATE TABLE files (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL,
  project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, sha256 TEXT,
  category TEXT, note TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  data BYTEA NOT NULL
);

CREATE INDEX idx_tasks_project ON tasks (project);
CREATE INDEX idx_costs_project ON costs (project);
CREATE INDEX idx_logs_project ON logs (project, "date");
CREATE INDEX idx_issues_project ON issues (project, status);
CREATE INDEX idx_files_project ON files (project);
