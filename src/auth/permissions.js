/**
 * Who may do what. This file is the single source of truth for rights:
 * routes ask for a permission name, never for a role. To change what a role can do, edit GRANTS.
 */
export const ROLES = ["admin", "manager", "viewer", "user"];

const CATALOG_READER = ["catalog:read", "catalog:propose", "boq:use", "billing:read"];
const GRANTS = {
  // a signed-up customer: sees the material catalog, suggests additions, uses BOQ on their own files
  user: [...CATALOG_READER],
  // staff with read-only access to project data
  viewer: [...CATALOG_READER, "projects:read", "files:read"],
  // project staff
  manager: [...CATALOG_READER, "projects:read", "projects:write", "files:read", "files:write", "audit:read", "messages:read"],
  // admin gets everything, including the admin-only rights below
  admin: ["*"],
};

/** Rights that only admins hold. */
const ADMIN_ONLY = ["users:manage", "catalog:write", "proposals:review", "boq:rates", "boq:all", "billing:manage", "messages:manage"];

export const ALL_PERMISSIONS = [...new Set([...Object.values(GRANTS).flat().filter((p) => p !== "*"), ...ADMIN_ONLY])].sort();

export const permissionsOf = (role) => (role === "admin" ? ALL_PERMISSIONS : [...new Set(GRANTS[role] || [])].sort());
export const can = (role, permission) => role === "admin" || (GRANTS[role] || []).includes(permission);
