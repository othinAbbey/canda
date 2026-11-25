-- Website messages belong to one company's inbox. Messages received before multi-tenancy were C & A's.
ALTER TABLE messages ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'org_canda' REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX idx_messages_organization ON messages (organization_id, id);
