-- Daily social media posts made by the Buildsuite360 team itself (the platform's own company), not by customer companies.
-- One post a day: a short portrait video of new tenders and featured subcontracts, with its caption. A person on the team
-- checks it and approves it, then posts it by hand (TikTok, WhatsApp Status) and marks it posted.
-- items and spare are JSON lists of slides. Every fact on a slide (buyer, place, closing date, value, link) is copied from the
-- tender or listing record; only `headline`, a shorter wording of the record's own title, may be written by the AI or a person.
CREATE TABLE social_posts (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ,
  day DATE NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted', 'skipped')),
  items TEXT NOT NULL,
  spare TEXT NOT NULL DEFAULT '[]',
  caption TEXT NOT NULL,
  hashtags TEXT NOT NULL DEFAULT '',
  made_by TEXT NOT NULL DEFAULT 'rules' CHECK (made_by IN ('ai', 'rules')),
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ, posted_url TEXT
);

-- A company chooses, per listing, whether Buildsuite360 may feature it on its social media. Off unless they tick it.
ALTER TABLE market_listings ADD COLUMN feature_social BOOLEAN NOT NULL DEFAULT FALSE;
