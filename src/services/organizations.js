import { ValidationError, notFound } from "../errors.js";
import { now } from "../ids.js";

/** Logos are stored as small data URLs so the website can show them with no extra request or file storage.
 *  Raster images only (an SVG can carry script). */
const LOGO = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;
export const LOGO_MAX_BYTES = 512 * 1024;
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46], webp: [0x52, 0x49, 0x46, 0x46] };

export function cleanLogo(v) {
  if (v === null || v === "") return null;                                   // remove the logo
  const m = LOGO.exec(String(v));
  if (!m) throw new ValidationError("logo must be a PNG, JPEG, WebP or GIF image");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > LOGO_MAX_BYTES) throw new ValidationError(`logo must be ${LOGO_MAX_BYTES / 1024} KB or smaller`);
  if (!MAGIC[m[1]].every((b, i) => bytes[i] === b)) throw new ValidationError("that file is not a valid image");
  return m[0];
}

const NAME_MIN = 2, NAME_MAX = 120;

/**
 * A company name clean enough to store and show in the UI. Shared by registration (a brand-new organization)
 * and the organization settings screen (renaming an existing one, added later).
 */
export function cleanOrgName(name) {
  const n = String(name || "").trim();
  if (n.length < NAME_MIN || n.length > NAME_MAX) throw new ValidationError(`company name must be ${NAME_MIN} to ${NAME_MAX} characters`);
  return n;
}

/** What other services and routes may show about an organization -- never anything more than this shape. */
export const publicOrg = (o) => o && { id: o.id, name: o.name, logo_url: o.logo_url };

/**
 * Organization lookup. Creating one happens inside accounts.register(), in the same database transaction as
 * its first admin user, so a half-finished signup can never leave an organization with no one able to sign
 * into it (see services/accounts.js for why that has to be a single transaction, not two service calls).
 */
export function createOrganizations({ repo, audit }) {
  return {
    publicOrg,
    get: (id) => repo.byId(id),
    /** Company settings: an admin renames the company or changes its logo. Only fields sent are changed. */
    async update(actor, body = {}) {
      const before = await repo.byId(actor.organization_id);
      if (!before) throw notFound();
      const patch = { ...before, updated: now() };
      if (body.name !== undefined) patch.name = cleanOrgName(body.name);
      if (body.logo_url !== undefined) patch.logo_url = cleanLogo(body.logo_url);
      const row = await repo.update(before.id, patch);
      const changed = [patch.name !== before.name && "name", patch.logo_url !== before.logo_url && "logo"].filter(Boolean);
      await audit?.log(actor, { action: "update", entity: "organizations", id: before.id, summary: `company settings: ${changed.join(", ") || "no change"}`,
        changes: patch.name !== before.name ? { name: [before.name, patch.name] } : null });
      return publicOrg(row);
    },
  };
}
