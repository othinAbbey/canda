-- Site chat: rooms where site engineers and staff talk, with the bot in them.
-- One room for the whole company plus one per project (made when first opened).
-- The bot reads project-room messages and drafts site logs and issues; a person checks the draft and saves it.
CREATE TABLE chat_rooms (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project TEXT REFERENCES projects(id) ON DELETE CASCADE,          -- NULL: the company-wide room
  name TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, project)
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL,
  room TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,            -- NULL: written by the bot
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'bot', 'draft')),
  body TEXT NOT NULL DEFAULT '',
  draft TEXT,                       -- JSON for kind 'draft': { type, fields, status, from_message, saved_id, saved_by, ... }
  meta TEXT,                        -- JSON: e.g. the assistant's proposed actions on a bot answer
  reply_to TEXT
);
CREATE INDEX idx_chat_messages_room ON chat_messages (room, created);

CREATE TABLE chat_reads (
  room TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (room, user_id)
);

-- chat messages the bot read this month (separate from assistant questions, with their own limit)
ALTER TABLE assistant_usage ADD COLUMN chat_reads INTEGER NOT NULL DEFAULT 0;
