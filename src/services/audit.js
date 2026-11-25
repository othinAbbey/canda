/** Records who did what. Never throws: a failed audit write must not break the request that caused it. */
export function createAudit(repo) {
  return {
    async log(actor, { action, entity, id = null, project = null, summary = "", changes = null }) {
      try { await repo.insert({ userId: actor?.id ?? null, userEmail: actor?.email ?? null, organizationId: actor?.organization_id ?? "org_canda", action, entity, entityId: id, project, summary, changes }); }
      catch (e) { console.error("audit write failed:", e.message); }
    },
    list: (actor, filters) => repo.list({ ...filters, organizationId: actor.organization_id }),
  };
}
