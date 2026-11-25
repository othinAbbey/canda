import { DbError, HttpError, ValidationError, notFound } from "../errors.js";
import { TEMPLATES, TEMPLATE_BY_CODE } from "../domain/forms/templates.js";
import { summarize, validateRecord } from "../domain/forms/validate.js";
import { formsRepo } from "../repos/forms.js";
import { resourcesRepo } from "../repos/resources.js";
import { parseJson } from "../json.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

/** Filled-in site forms. What a form asks is in domain/forms/templates.js; this keeps records, numbering and status. */
export function createForms({ db, audit }) {
  const repo = formsRepo(db), rows = resourcesRepo(db);
  const template = (code) => { const t = TEMPLATE_BY_CODE[code]; if (!t) throw new ValidationError(`unknown form (choose: ${TEMPLATES.map((x) => x.code).join(", ")})`); return t; };
  const view = (r, withData) => {
    const t = TEMPLATE_BY_CODE[r.template], data = parseJson(r.data, {}), { data: _omit, ...rest } = r;
    return { ...rest, template_name: t?.name ?? r.template, summary: t ? summarize(t, data) : null, ...(withData ? { data } : {}) };
  };
  const must = async (id, organizationId) => { const r = await repo.get(id, organizationId); if (!r) throw notFound("form not found"); return r; };
  const title = (v, fallback) => { const s = String(v ?? fallback ?? "").trim(); if (s.length > 200) throw new ValidationError("the title is too long (200 characters)"); return s || null; };
  const when = (v, fallback) => { const d = v === undefined || v === "" || v === null ? fallback : String(v); if (!DATE.test(d)) throw new ValidationError("date must be YYYY-MM-DD"); return d; };

  async function insert(actor, t, { project, title: ttl, recordDate, status, data }) {
    for (let attempt = 0; ; attempt++) {                       // two people creating at once can pick the same number: try again
      const seq = await repo.nextSeq(project, t.code);
      try {
        const { id } = await repo.insert({ userId: actor.id, project, template: t.code, version: t.version, seq, reference: `${t.prefix}-${String(seq).padStart(3, "0")}`, title: ttl, recordDate, status, data });
        return id;
      } catch (e) { if (!(e instanceof DbError && e.kind === "unique") || attempt >= 3) throw e; }
    }
  }

  return {
    templates: () => TEMPLATES,
    async list(actor, filters = {}) { return (await repo.list({ ...filters, organizationId: actor.organization_id })).map((r) => view(r, false)); },
    async get(actor, id) { return view(await must(id, actor.organization_id), true); },

    async create(actor, body) {
      const t = template(body.template);
      if (!body.project || !(await rows.get("projects", body.project, actor.organization_id))) throw new ValidationError("choose an existing project");
      const status = body.status || t.statuses[0];
      const data = validateRecord(t, body.data, status);
      const id = await insert(actor, t, { project: body.project, title: title(body.title, t.name), recordDate: when(body.record_date, today()), status, data });
      const rec = await must(id, actor.organization_id);
      await audit.log(actor, { action: "create", entity: "forms", id, project: rec.project, summary: `${rec.reference} ${t.name}` });
      return view(rec, true);
    },

    async update(actor, id, body) {
      const before = await must(id, actor.organization_id), t = template(before.template);
      if (body.if_updated && body.if_updated !== before.updated) throw new HttpError(409, "Someone else changed this form. Reload it to see their changes before saving.");
      const status = body.status ?? before.status, data = validateRecord(t, body.data !== undefined ? body.data : parseJson(before.data, {}), status);
      await repo.update(id, { title: title(body.title, before.title), recordDate: when(body.record_date, before.record_date), status, data }, actor.id);
      const rec = await must(id, actor.organization_id), moved = before.status !== status;
      await audit.log(actor, { action: "update", entity: "forms", id, project: rec.project, summary: `${rec.reference}: ${moved ? `status ${before.status} to ${status}` : "edited"}`, changes: moved ? { status: [before.status, status] } : null });
      return view(rec, true);
    },

    /** A new draft that starts with the same answers (handy for a daily report that repeats most of yesterday's). */
    async copy(actor, id) {
      const src = await must(id, actor.organization_id), t = template(src.template);
      const newId = await insert(actor, t, { project: src.project, title: src.title, recordDate: today(), status: t.statuses[0], data: parseJson(src.data, {}) });
      const rec = await must(newId, actor.organization_id);
      await audit.log(actor, { action: "copy", entity: "forms", id: newId, project: rec.project, summary: `${rec.reference} copied from ${src.reference}` });
      return view(rec, true);
    },

    async remove(actor, id) {
      const rec = await must(id, actor.organization_id);
      await repo.remove(id);
      await audit.log(actor, { action: "delete", entity: "forms", id, project: rec.project, summary: `${rec.reference} ${rec.template_name ?? ""}`.trim(), changes: { reference: rec.reference, template: rec.template, status: rec.status } });
    },
  };
}
