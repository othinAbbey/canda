import { ADMIN_ONLY, ALL_PERMISSIONS, BUILT_IN_ROLES, PERMISSIONS } from "../auth/permissions.js";
import { HttpError, ValidationError, notFound } from "../errors.js";
import { parseJson } from "../json.js";

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const TTL = 5000;     // another server may have changed a role: re-read at most every 5 seconds

/** Roles and what each may do. Kept in memory and refreshed, because every request asks "may this user do that?". */
export function createRoles({ repo, audit }) {
  let cache = new Map(), loadedAt = 0;
  const expand = (perms) => (perms.includes("*") ? ALL_PERMISSIONS : [...new Set(perms)].sort());

  async function reload() {
    cache = new Map((await repo.list()).map((r) => [r.code, { ...r, builtin: !!r.builtin, permissions: expand(parseJson(r.permissions, [])) }]));
    loadedAt = Date.now();
  }
  async function clean({ name, description, permissions }) {
    const n = String(name || "").trim();
    if (n.length < 2 || n.length > 60) throw new ValidationError("give the role a name (2 to 60 characters)");
    if (!Array.isArray(permissions) || !permissions.length) throw new ValidationError("choose at least one right for this role");
    const known = new Set(ALL_PERMISSIONS), bad = permissions.filter((p) => !known.has(p));
    if (bad.length) throw new ValidationError(`unknown rights: ${bad.join(", ")}`);
    const adminOnly = permissions.filter((p) => ADMIN_ONLY.has(p));
    if (adminOnly.length) throw new ValidationError(`only the Administrator role can have: ${adminOnly.join(", ")}`);
    return { name: n, description: String(description || "").trim().slice(0, 300) || null, permissions: [...new Set(permissions)].sort() };
  }

  return {
    reload,
    /** Makes sure the built-in roles exist (never overwrites changes an admin made). */
    async ensureBuiltIns() {
      for (const [code, r] of Object.entries(BUILT_IN_ROLES)) if (!(await repo.get(code))) await repo.insert({ code, ...r, builtin: true });
      await reload();
    },
    async fresh() { if (Date.now() - loadedAt > TTL) await reload(); },
    permissionsOf: (code) => cache.get(code)?.permissions || [],
    exists: (code) => cache.has(code),
    nameOf: (code) => cache.get(code)?.name || code,
    codes: () => [...cache.keys()],
    catalog: () => PERMISSIONS,

    async list() {
      const counts = Object.fromEntries((await repo.userCounts()).map((r) => [r.role, r.n]));
      return [...cache.values()].map((r) => ({ code: r.code, name: r.name, description: r.description, builtin: r.builtin, permissions: r.code === "admin" ? ["*"] : r.permissions, users: counts[r.code] || 0 }));
    },
    async create(admin, body) {
      const v = await clean(body), code = slug(v.name);
      if (!code) throw new ValidationError("the role name needs letters or numbers");
      if (cache.has(code)) throw new HttpError(409, "a role with that name already exists");
      const row = await repo.insert({ code, ...v, builtin: false }); await reload();
      await audit.log(admin, { action: "create", entity: "roles", id: code, summary: `${v.name} (${v.permissions.length} rights)` });
      return { code, ...v, builtin: false, users: 0, created: row.created };
    },
    async update(admin, code, body) {
      const before = cache.get(code); if (!before) throw notFound("role not found");
      if (code === "admin") throw new ValidationError("the Administrator role cannot be changed");
      const v = await clean({ name: body.name ?? before.name, description: body.description ?? before.description, permissions: body.permissions ?? before.permissions });
      await repo.update(code, v); await reload();
      await audit.log(admin, { action: "update", entity: "roles", id: code, summary: v.name, changes: { permissions: [before.permissions, v.permissions] } });
      return { code, ...v, builtin: before.builtin };
    },
    async remove(admin, code) {
      const r = cache.get(code); if (!r) throw notFound("role not found");
      if (r.builtin) throw new ValidationError("built-in roles cannot be deleted");
      const used = (await repo.userCounts()).find((c) => c.role === code)?.n || 0;
      if (used) throw new HttpError(409, `${used} user${used === 1 ? " has" : "s have"} this role; move them to another role first`);
      await repo.remove(code); await reload();
      await audit.log(admin, { action: "delete", entity: "roles", id: code, summary: r.name });
    },
  };
}
