import { ValidationError } from "../errors.js";

/**
 * The simple "table of records" resources served by one generic set of routes.
 * Column types: text | number | date, a trailing "!" means required.
 * `read` / `write` are permission names (see auth/permissions.js).
 */
export const RESOURCES = {
  projects: { read: "projects:read", write: "projects:write", projectOf: "id",
    cols: { name: "text!", client: "text", location: "text", budget: "number", start: "date", end: "date", manager: "text", status: "text" } },
  tasks: { read: "projects:read", write: "projects:write", projectOf: "project",
    cols: { project: "text!", title: "text!", assignee: "text", priority: "text", start: "date", due: "date", status: "text" } },
  costs: { read: "projects:read", write: "projects:write", projectOf: "project",
    cols: { project: "text!", category: "text", item: "text!", amount: "number!", date: "date", supplier: "text" } },
  logs: { read: "projects:read", write: "projects:write", projectOf: "project",
    cols: { project: "text!", date: "date", weather: "text", workers: "number", work: "text!", delays: "text", visitors: "text", safety: "text" } },
  issues: { read: "projects:read", write: "projects:write", projectOf: "project",
    cols: { project: "text!", type: "text", title: "text!", owner: "text", severity: "text", due: "date", detail: "text", cost: "number", status: "text" } },
  locations: { read: "catalog:read", write: "catalog:write",
    cols: { region: "text!", district: "text!" } },
  materials: { read: "catalog:read", write: "catalog:write",
    cols: { name: "text!", category: "text", unit: "text!", size: "text", description: "text" } },
  suppliers: { read: "catalog:read", write: "catalog:write",
    cols: { name: "text!", contact: "text", phone: "text", location_id: "text", notes: "text" } },
  rates: { read: "catalog:read", write: "catalog:write",
    cols: { material: "text!", supplier: "text", location_id: "text!", price: "number!", note: "text" } },
};
/** The tables that make up "project data" (what /api/data returns). */
export const PROJECT_TABLES = ["projects", "tasks", "costs", "logs", "issues"];

/** Turn a request body into column values: only known columns, "" becomes null, numbers and dates checked. */
export function clean(resource, body, { partial = false } = {}) {
  const spec = RESOURCES[resource].cols, out = {};
  for (const [col, def] of Object.entries(spec)) {
    if (!(col in body)) continue;
    const type = def.replace("!", "");
    let v = body[col];
    if (v === "" || v === undefined) v = null;
    if (v !== null) {
      if (type === "number") { v = Number(v); if (!Number.isFinite(v)) throw new ValidationError(`${col} must be a number`); }
      else {
        v = String(v).trim();
        if (v.length > 5000) throw new ValidationError(`${col} is too long`);
        if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError(`${col} must be a date (YYYY-MM-DD)`);
      }
    }
    out[col] = v;
  }
  if (!partial) for (const [col, def] of Object.entries(spec)) if (def.endsWith("!") && (out[col] === undefined || out[col] === null)) throw new ValidationError(`${col} is required`);
  return out;
}
