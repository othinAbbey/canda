import { HttpError, ValidationError, notFound } from "../errors.js";
import { clean } from "../domain/resources.js";
import { can } from "../auth/permissions.js";
import { proposalsRepo } from "../repos/proposals.js";
import { resourcesRepo } from "../repos/resources.js";

const TABLE = { material: "materials", supplier: "suppliers", location: "locations", rate: "rates" };

/**
 * Catalog suggestions. A non-admin submits a material, supplier or location; it stays "pending" until an admin approves it,
 * and only then does the real record exist. An admin's own submission is approved immediately.
 */
export function createProposals({ db, catalog, audit }) {
  async function validate(kind, payload) {
    const table = TABLE[kind];
    if (!table) throw new ValidationError("kind must be material, supplier, location or rate");
    if (kind === "rate") return validateRate(payload || {});
    const values = clean(table, payload || {});
    if (kind === "material" && (await catalog.materialByName(values.name))) throw new HttpError(409, "a material with that name already exists");
    if (kind === "location" && (await catalog.locationByPlace(values.region, values.district))) throw new HttpError(409, "that district already exists");
    if (kind === "supplier" && values.location_id && !(await catalog.location(values.location_id))) throw new ValidationError("that location does not exist");
    return { table, values };
  }

  /** A price: the material and district must exist (by name or id); the supplier is optional (none = general market rate). */
  async function validateRate(payload) {
    const mat = payload.material && (await catalog.materialByNameOrId(payload.material));
    if (!mat) throw new ValidationError("choose a material from the catalog (suggest the material first if it is missing)");
    const places = payload.location_id ? await catalog.locationByIdOrDistrict(payload.location_id) : [];
    if (places.length !== 1) throw new ValidationError(places.length ? "several districts have that name: choose one" : "choose a district from the catalog (suggest the district first if it is missing)");
    let sup = null;
    if (payload.supplier) { sup = await catalog.supplierByNameOrId(payload.supplier); if (!sup) throw new ValidationError("that supplier is not in the catalog (suggest the supplier first, or leave it empty for a general market price)"); }
    const values = clean("rates", { material: mat.id, supplier: sup?.id || "", location_id: places[0].id, price: payload.price, note: payload.note });
    if (!(values.price > 0)) throw new ValidationError("the price must be above zero");
    // names travel with the suggestion so reviewers can read it
    return { table: "rates", values, labels: { material_name: mat.name, unit: mat.unit, supplier_name: sup?.name || null, district: places[0].district, region: places[0].region } };
  }

  async function approveRow(reviewer, proposal, note) {
    const { table, values } = await validate(proposal.kind, proposal.payload);       // re-check: it may have been added meanwhile
    return db.tx(async (t) => {
      let record;
      const same = table === "rates" && (await catalog.sameRate(values.material, values.supplier, values.location_id));
      if (same) record = await resourcesRepo(t).update("rates", same.id, { price: values.price, note: values.note });   // a new price for the same supplier and district replaces the old one
      else record = await resourcesRepo(t).insert(table, values, proposal.submitted_by);
      const done = await proposalsRepo(t).decide(proposal.id, { status: "approved", reviewer: reviewer.id, note, resultId: record.id });
      if (!done) throw new HttpError(409, "this proposal was already decided");
      return done;
    });
  }

  const repo = proposalsRepo(db);
  const must = async (id) => { const p = await repo.get(id); if (!p) throw notFound(); return p; };

  return {
    async submit(actor, { kind, payload }) {
      const checked = await validate(kind, payload);
      const stored = kind === "rate" ? { ...checked.values, ...checked.labels } : payload;
      const proposal = await repo.insert(kind, stored, actor.id);
      await audit.log(actor, { action: "propose", entity: "proposals", id: proposal.id, summary: `${kind}: ${kind === "rate" ? `${checked.labels.material_name} ${checked.values.price} in ${checked.labels.district}` : payload.name || payload.district || ""}` });
      return can(actor, "proposals:review") ? this.approve(actor, proposal.id, "auto-approved: submitted by an admin") : proposal;
    },
    /** The checks a suggestion must pass, without saving it (the assistant runs them before proposing). */
    check: (kind, payload) => validate(kind, payload),
    list: (actor, { status } = {}) => repo.list({ status, submittedBy: can(actor, "proposals:review") ? undefined : actor.id }),
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
