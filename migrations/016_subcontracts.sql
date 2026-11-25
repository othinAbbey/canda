-- Subcontracts marketplace: the one area shared by every company.
--  kind 'subcontract'  : a company offers part of its work to others (apply by a deadline)
--  kind 'availability' : a company or team says it is free to take subcontracts in a trade
-- A response is an application (to a subcontract) or an invitation/enquiry (to an availability). Only the two companies involved see it.
CREATE TABLE market_listings (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('subcontract', 'availability')),
  title TEXT NOT NULL,
  trade TEXT NOT NULL,
  description TEXT,
  region TEXT, district TEXT,
  start_date DATE, end_date DATE,          -- work period, or available from / until
  deadline DATE,                           -- subcontracts: apply by
  value NUMERIC(16,2) CHECK (value IS NULL OR value >= 0),   -- estimated subcontract value, or typical rate for availability
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency IN ('UGX', 'USD', 'EUR', 'KES', 'TZS')),
  crew_size INTEGER CHECK (crew_size IS NULL OR crew_size >= 0),
  equipment TEXT,
  requirements TEXT,
  contact_name TEXT, contact_phone TEXT, contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awarded', 'closed'))
);
CREATE INDEX idx_market_listings_open ON market_listings (kind, status, created);
CREATE INDEX idx_market_listings_org ON market_listings (organization_id, created);

CREATE TABLE market_responses (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  listing TEXT NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,   -- the company responding
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  price NUMERIC(16,2) CHECK (price IS NULL OR price >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX' CHECK (currency IN ('UGX', 'USD', 'EUR', 'KES', 'TZS')),
  contact_name TEXT, contact_phone TEXT, contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'shortlisted', 'accepted', 'declined', 'withdrawn')),
  UNIQUE (listing, organization_id)        -- one response per company per listing (it can be edited)
);
CREATE INDEX idx_market_responses_org ON market_responses (organization_id, created);

-- New rights for roles that already exist are added once (see roles.ensureBuiltIns); this records which grants have run,
-- so a right an admin later removes is not added back.
CREATE TABLE role_grants (id TEXT PRIMARY KEY, applied TIMESTAMPTZ NOT NULL);
