/**
 * Who may do what. Routes ask for a PERMISSION name, never a role name.
 *
 * - PERMISSIONS is the catalog of rights that exist (with labels for the admin screen).
 * - BUILT_IN_ROLES are the starting roles; they are copied into the `roles` table the first time the server runs.
 *   After that the table is the truth, and an admin can edit roles or add new ones (Roles & Access page).
 * - can(subject, permission) works on anything with a `permissions` list: the signed-in user object.
 */
export const PERMISSIONS = [
  { key: "catalog:read", group: "Material sourcing", label: "See materials, suppliers, locations and rates; use the calculator" },
  { key: "catalog:propose", group: "Material sourcing", label: "Suggest new materials, suppliers or locations" },
  { key: "catalog:write", group: "Material sourcing", label: "Edit the catalog directly" },
  { key: "proposals:review", group: "Material sourcing", label: "Approve or reject catalog suggestions" },
  { key: "boq:use", group: "BOQ extraction", label: "Upload drawings and use own BOQ jobs" },
  { key: "boq:all", group: "BOQ extraction", label: "See everyone's BOQ jobs" },
  { key: "boq:rates", group: "BOQ extraction", label: "Edit the shared BOQ rate book" },
  { key: "projects:read", group: "Projects", label: "See projects, tasks, schedule, budget, logs and issues" },
  { key: "projects:write", group: "Projects", label: "Create and change project data" },
  { key: "files:read", group: "Projects", label: "See project documents" },
  { key: "files:write", group: "Projects", label: "Upload and delete project documents" },
  { key: "tenders:read", group: "Tenders", label: "Search tenders, see the pipeline and tasks" },
  { key: "tenders:write", group: "Tenders", label: "Save and edit tenders in the pipeline" },
  { key: "tenders:assign", group: "Tenders", label: "Assign tender tasks to project managers" },
  { key: "audit:read", group: "Oversight", label: "See the audit trail" },
  { key: "messages:read", group: "Oversight", label: "Read and triage website messages" },
  { key: "messages:manage", group: "Oversight", label: "Delete website messages" },
  { key: "billing:read", group: "Account", label: "See own plan and usage" },
  { key: "billing:manage", group: "Account", label: "Change other people's plans" },
  { key: "users:manage", group: "Administration", label: "Create, disable and delete users; reset passwords", adminOnly: true },
  { key: "roles:manage", group: "Administration", label: "Create and edit roles", adminOnly: true },
];
export const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key).sort();
export const ADMIN_ONLY = new Set(PERMISSIONS.filter((p) => p.adminOnly).map((p) => p.key));

const CUSTOMER = ["catalog:read", "catalog:propose", "boq:use", "billing:read"];
const STAFF_READ = [...CUSTOMER, "projects:read", "files:read", "tenders:read"];

export const BUILT_IN_ROLES = {
  admin: { name: "Administrator", description: "Everything, including users and roles.", permissions: ["*"] },
  general_pm: {
    name: "General Project Manager",
    description: "Oversees all projects and tenders. Assigns tender tasks and is copied on them.",
    permissions: [...STAFF_READ, "projects:write", "files:write", "tenders:write", "tenders:assign", "audit:read", "messages:read"],
  },
  manager: {
    name: "Project Manager",
    description: "Runs projects and receives tender tasks.",
    permissions: [...STAFF_READ, "projects:write", "files:write", "tenders:write", "audit:read", "messages:read"],
  },
  viewer: { name: "Viewer", description: "Read-only access to project data and tenders.", permissions: STAFF_READ },
  user: { name: "Customer", description: "Material catalog, calculator and own BOQ extraction.", permissions: CUSTOMER },
};

/** can(user, "catalog:write"). `user.permissions` is attached when the request is authenticated. */
export const can = (subject, permission) => {
  const list = subject?.permissions;
  return Array.isArray(list) && (list.includes("*") || list.includes(permission));
};
