-- Roles are rows, so an admin can define new ones. The list of rights a role can hold lives in src/auth/permissions.js.
CREATE TABLE roles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL,                      -- e.g. ["catalog:read","tenders:read"]; ["*"] = everything
  builtin INTEGER NOT NULL DEFAULT 0,              -- built-in roles cannot be deleted
  created TIMESTAMPTZ NOT NULL, updated TIMESTAMPTZ
);

-- users.role used to be limited to four fixed values by a CHECK. Replace the column (dropping a column drops its CHECK) so any role code is allowed.
-- The application checks the code against the roles table.
ALTER TABLE users ADD COLUMN role_new TEXT;
UPDATE users SET role_new = role;
ALTER TABLE users DROP COLUMN role;
ALTER TABLE users RENAME COLUMN role_new TO role;
CREATE INDEX idx_users_role ON users (role);
