import { HttpError, ValidationError, notFound } from "../errors.js";
import { clean } from "../domain/resources.js";
import { can } from "../auth/permissions.js";
import { proposalsRepo } from "../repos/proposals.js";
import { resourcesRepo } from "../repos/resources.js";

const TABLE = { material: "materials", supplier: "suppliers", location: "locations" };

/**
 * Catalog suggestions. A non-admin submits a material, supplier or location; it stays "pending" until an admin approves it,
 * and only then does the real record exist. An admin's own submission is approved immediately.
 */
export function createProposals({ db, catalog, audit }) {
  async function validate(kind, payload) {
    const table = TABLE[kind];
    if (!table) throw new ValidationError("kind must be material, supplier or location");
    const values = clean(table, payload || {});
    if (kind === "material" && (await catalog.materialByName(values.name))) throw new HttpError(409, "a material with that name already exists");
    if (kind === "location" && (await catalog.locationByPlace(values.region, values.district))) throw new HttpError(409, "that district already exists");
    if (kind === "supplier" && values.location_id && !(await catalog.location(values.location_id))) throw new ValidationError("that location does not exist");
    return { table, values };
  }

  async function approveRow(reviewer, proposal, note) {
    const { table, values } = await validate(proposal.kind, proposal.payload);       // re-check: it may have been added meanwhile
    return db.tx(async (t) => {
      const record = await resourcesRepo(t).insert(table, values, proposal.submitted_by);
      const done = await proposalsRepo(t).decide(proposal.id, { status: "approved", reviewer: reviewer.id, note, resultId: record.id });
      if (!done) throw new HttpError(409, "this proposal was already decided");
      return done;
    });
  }

  const repo = proposalsRepo(db);
  const must = async (id) => { const p = await repo.get(id); if (!p) throw notFound(); return p; };

  return {
    async submit(actor, { kind, payload }) {
      await validate(kind, payload);
      const proposal = await repo.insert(kind, payload, actor.id);
      await audit.log(actor, { action: "propose", entity: "proposals", id: proposal.id, summary: `${kind}: ${payload.name || payload.district || ""}` });
      return can(actor.role, "proposals:review") ? this.approve(actor, proposal.id, "auto-approved: submitted by an admin") : proposal;
    },
    list: (actor, { status } = {}) => repo.list({ status, submittedBy: can(actor.role, "proposals:review") ? undefined : actor.id }),
    pendingCount: () => repo.countPending(),

    async approve(admin, id, note) {
      const p = await must(id);
      if (p.status !== "pending") throw new HttpError(409, "this proposal was already decided");
      const done = await approveRow(admin, p, note);
      await audit.log(admin, { action: "approve", entity: "proposals", id, summary: `${p.kind} approved`, changes: { result_id: done.result_id } });
      return done;
    },
    async reject(admin, id, note) {
      const p = await must(id);
      const done = await repo.decide(id, { status: "rejected", reviewer: admin.id, note });
      if (!done) throw new HttpError(409, "this proposal was already decided");
      await audit.log(admin, { action: "reject", entity: "proposals", id, summary: `${p.kind} rejected${note ? `: ${note}` : ""}` });
      return done;
    },
    async withdraw(actor, id) {
      if (!(await repo.withdraw(id, actor.id))) throw notFound("no pending proposal of yours with that id");
      await audit.log(actor, { action: "withdraw", entity: "proposals", id, summary: "proposal withdrawn" });
    },
  };
}
