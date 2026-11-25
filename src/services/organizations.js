import { ValidationError } from "../errors.js";

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
export function createOrganizations({ repo }) {
  return {
    publicOrg,
    get: (id) => repo.byId(id),
  };
}
