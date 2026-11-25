-- Subscription placeholders. Nothing is charged yet; these tables let the product record plans and usage from day one.

CREATE TABLE plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  limits JSONB NOT NULL,                              -- e.g. {"boq_jobs_per_month": 3}; null/absent = unlimited
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES plans(code),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','cancelled')),
  current_period_end TIMESTAMPTZ,
  updated TIMESTAMPTZ NOT NULL
);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_usage_user ON usage_events (user_id, kind, at);

INSERT INTO plans (code, name, price_monthly, currency, limits, active) VALUES
  ('free', 'Free', 0, 'UGX', '{"boq_jobs_per_month": 3}', 1),
  ('pro', 'Pro', 0, 'UGX', '{"boq_jobs_per_month": 50}', 1),
  ('enterprise', 'Enterprise', 0, 'UGX', '{}', 1);
