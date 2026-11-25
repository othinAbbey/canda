-- Filled-in site forms (Daily Site Report, RFI, Concrete Pour Checklist ...). What each form asks lives in code
-- (src/domain/forms/templates.js); a record keeps the template code and version it was filled against, plus the answers.
CREATE TABLE form_records (
  id TEXT PRIMARY KEY,
  created TIMESTAMPTZ NOT NULL,
  updated TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  seq INTEGER NOT NULL,
  reference TEXT NOT NULL,            -- e.g. DSR-004: numbered per project and form type
  title TEXT,
  record_date DATE NOT NULL,
  status TEXT NOT NULL,
  data JSONB
);
CREATE UNIQUE INDEX idx_form_records_number ON form_records (project, template, seq);
CREATE INDEX idx_form_records_list ON form_records (project, record_date, id);
