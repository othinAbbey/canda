-- BOQ extraction jobs. The uploaded PDF and the generated Excel file are stored here, under the user who uploaded them.

CREATE TABLE boq_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  pdf_sha256 TEXT NOT NULL,
  pdf BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','reading','building','done','failed')),
  stage TEXT, error TEXT,
  remote_job_id TEXT,                                -- id inside the BOQ service
  result JSONB, usage JSONB,
  cost_usd NUMERIC(12,4), cached INTEGER NOT NULL DEFAULT 0,
  xlsx_name TEXT, xlsx BYTEA,
  created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_boq_user ON boq_jobs (user_id, created);
