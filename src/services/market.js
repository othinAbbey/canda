import { HttpError, ValidationError, notFound } from "../errors.js";
import { KINDS, OWNER_CAN_SET, TRADES, checkContact, cleanListing, cleanResponse } from "../domain/market.js";
import { marketRepo } from "../repos/market.js";

const today = () => new Date().toISOString().slice(0, 10);
const label = (l) => `${l.kind === "subcontract" ? "Subcontract" : "Availability"}: ${l.title}`;

/**
 * The subcontracts marketplace: the ONE area every company can see.
 * Listings are public to all signed-in companies. Responses are private to the two companies involved.
 * A company changes only its own listings and its own responses; the poster decides the status of responses it receives.
 */
export function createMarket({ db, audit }) {
  const repo = marketRepo(db);
  const mustOwn = async (actor, id) => { const l = await repo.get(id); if (!l || l.organization_id !== actor.organization_id) throw notFound("listing not found"); return l; };

  async function annotate(actor, rows) {
    const own = rows.filter((r) => r.organization_id === actor.organization_id).map((r) => r.id);
    const others = rows.filter((r) => r.organization_id !== actor.organization_id).map((r) => r.id);
    const [counts, mine] = await Promise.all([repo.counts(own), repo.mine(others, actor.organization_id)]);
    return rows.map((r) => {
      const isOwn = r.organization_id === actor.organization_id;
      return { ...r, own: isOwn, responses: isOwn ? counts.get(r.id) || { n: 0, unread: 0 } : undefined, my_response: isOwn ? undefined : mine.get(r.id) || null };
    });
  }

  return {
    options: () => ({ kinds: KINDS, trades: TRADES }),

    /** Browse. Open listings from every company by default; `mine` shows all of your own company's, whatever their status. */
    async list(actor, { kind, trade, region, q, mine, status } = {}) {
      if (kind && !KINDS.includes(kind)) throw new ValidationError(`kind must be one of ${KINDS.join(", ")}`);
      const rows = await repo.list({ kind, trade, region, q, organizationId: mine ? actor.organization_id : undefined, status: mine ? status : status || "open" });
      return annotate(actor, rows);
    },

    async get(actor, id) {
      const l = await repo.get(id); if (!l) throw notFound("listing not found");
      const [view] = await annotate(actor, [l]);
      if (view.own) view.response_list = await repo.responsesFor(id);
      else if (view.my_response) view.my_response = await repo.responseOf(id, actor.organization_id);
      return view;
    },

    async create(actor, body) {
      const v = cleanListing(body);
      if (!v.contact_phone && !v.contact_email) { v.contact_email = actor.email; v.contact_name = v.contact_name || actor.name || null; }
      checkContact(v);
      if (v.kind === "subcontract" && v.deadline && v.deadline < today()) throw new ValidationError("the apply-by date has already passed");
      const { id } = await repo.insert({ ...v, status: "open", organization_id: actor.organization_id, created_by: actor.id });
      await audit.log(actor, { action: "create", entity: "market_listings", id, summary: label(v) });
      return this.get(actor, id);
    },

    async update(actor, id, body) {
      const before = await mustOwn(actor, id);
      const v = cleanListing(body, { partial: true });
      checkContact({ contact_phone: "contact_phone" in v ? v.contact_phone : before.contact_phone, contact_email: "contact_email" in v ? v.contact_email : before.contact_email });
      if ((v.start_date ?? before.start_date) && (v.end_date ?? before.end_date) && (v.end_date ?? before.end_date) < (v.start_date ?? before.start_date)) throw new ValidationError("the end date is before the start date");
      await repo.update(id, actor.organization_id, v);
      await audit.log(actor, { action: "update", entity: "market_listings", id, summary: `${label(before)}: ${Object.keys(v).join(", ") || "no change"}`,
        changes: "status" in v && v.status !== before.status ? { status: [before.status, v.status] } : null });
      return this.get(actor, id);
    },

    async remove(actor, id) {
      const before = await mustOwn(actor, id);
      await repo.remove(id, actor.organization_id);
      await audit.log(actor, { action: "delete", entity: "market_listings", id, summary: label(before) });
    },

    /** Apply to a subcontract, or contact a company that listed its availability. Sending again updates your earlier response. */
    async respond(actor, listingId, body) {
      const l = await repo.get(listingId); if (!l) throw notFound("listing not found");
      if (l.organization_id === actor.organization_id) throw new ValidationError("this is your own company's listing");
      if (l.status !== "open") throw new ValidationError("this listing is no longer open");
      if (l.kind === "subcontract" && l.deadline && l.deadline < today()) throw new ValidationError("the apply-by date for this subcontract has passed");
      const v = cleanResponse(body), existing = await repo.responseOf(listingId, actor.organization_id);
      let id;
      if (existing) {
        if (["accepted", "declined"].includes(existing.status)) throw new HttpError(409, `your response was already ${existing.status}`);
        await repo.updateResponse(existing.id, { ...v, status: existing.status === "withdrawn" ? "new" : existing.status });
        id = existing.id;
      } else {
        id = (await repo.insertResponse({ ...v, listing: listingId, organization_id: actor.organization_id, created_by: actor.id })).id;
      }
      await audit.log(actor, { action: existing ? "update" : "create", entity: "market_responses", id, summary: `${l.kind === "subcontract" ? "applied to" : "contacted"} ${l.company_name}: ${l.title}` });
      return repo.response(id);
    },

    /** Responses your company has sent. */
    sent: (actor) => repo.responsesBy(actor.organization_id),

    /** The poster sets the status (shortlisted, accepted, declined); the responder can edit or withdraw. Nobody else sees it. */
    async updateResponse(actor, id, body) {
      const r = await repo.response(id);
      if (!r || (r.listing_org !== actor.organization_id && r.organization_id !== actor.organization_id)) throw notFound("response not found");
      let values;
      if (r.listing_org === actor.organization_id) {
        if (!OWNER_CAN_SET.includes(body.status)) throw new ValidationError(`status must be one of ${OWNER_CAN_SET.join(", ")}`);
        if (r.status === "withdrawn") throw new ValidationError("the other company withdrew this response");
        values = { status: body.status };
      } else if (body.status === "withdrawn") {
        values = { status: "withdrawn" };
      } else if (body.status !== undefined) {
        throw new ValidationError("only the company that posted the listing can shortlist, accept or decline; you can withdraw");
      } else {
        if (["accepted", "declined"].includes(r.status)) throw new HttpError(409, `your response was already ${r.status}`);
        values = cleanResponse({ ...r, ...body });
      }
      await repo.updateResponse(id, values);
      await audit.log(actor, { action: "update", entity: "market_responses", id, summary: `${r.listing_title}: ${values.status || "edited"}`, changes: values.status ? { status: [r.status, values.status] } : null });
      return repo.response(id);
    },
  };
}
