-- The AI project assistant.
-- assistant_actions: changes the assistant PROPOSED. Nothing is saved to projects or tenders until the person who
--   asked clicks Confirm; then the change is made as that person, with their rights, and recorded in the audit trail.
-- assistant_usage: questions and AI tokens per company per month, for the monthly limit and the bill.
CREATE TABLE assistant_actions (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  input TEXT NOT NULL,                 -- JSON, as checked when proposed
  summary TEXT NOT NULL,               -- what the person is asked to confirm
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled', 'failed')),
  result TEXT,
  done_at TIMESTAMPTZ
);
CREATE INDEX idx_assistant_actions_user ON assistant_actions (user_id, created);

CREATE TABLE assistant_usage (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month TEXT NOT NULL,                 -- YYYY-MM
  questions INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, month)
);
