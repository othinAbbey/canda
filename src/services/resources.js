import { RESOURCES, clean } from "../domain/resources.js";
import { notFound } from "../errors.js";

const label = (r) => String(r.name || r.title || r.item || r.work || (r.price != null ? `rate ${r.price}` : r.id)).slice(0, 80);

/** Create / read / update / delete for every table in RESOURCES, with validation and audit in one place. */
export function createResources({ repo, audit }) {
  const projectOf = (table, row) => { const f = RESOURCES[table].projectOf; return f ? row[f] : null; };
  const must = async (table, id) => { const r = await repo.get(table, id); if (!r) throw notFound(); return r; };

  return {
    list: (table, { project } = {}) => repo.list(table, { project }),
    get: must,
    async create(actor, table, body) {
      const row = await repo.insert(table, clean(table, body), actor.id);
      await audit.log(actor, { action: "create", entity: table, id: row.id, project: projectOf(table, row), summary: label(row) });
      return row;
    },
    async update(actor, table, id, body) {
      const before = await must(table, id);
      const row = await repo.update(table, id, clean(table, body, { partial: true }));
      const changes = {};
      for (const k of Object.keys(RESOURCES[table].cols)) if (before[k] !== row[k]) changes[k] = [before[k] ?? null, row[k] ?? null];
      await audit.log(actor, { action: "update", entity: table, id, project: projectOf(table, row), summary: `${label(row)}: ${Object.keys(changes).join(", ") || "no change"}`, changes });
      return row;
    },
    async remove(actor, table, id) {
      const before = await must(table, id);
      await repo.remove(table, id);                    // child rows and documents go with a project (ON DELETE CASCADE)
      await audit.log(actor, { action: "delete", entity: table, id, project: projectOf(table, before), summary: label(before), changes: before });
    },
  };
}
