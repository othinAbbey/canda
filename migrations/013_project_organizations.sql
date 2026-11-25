-- Keep project records and their audit history inside the owning company.
ALTER TABLE projects ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'org_canda' REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX idx_projects_organization ON projects (organization_id);

ALTER TABLE audit ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'org_canda' REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX idx_audit_organization ON audit (organization_id, id);
