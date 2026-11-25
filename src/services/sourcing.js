import { CalcError, STRUCTURES, calculate } from "../domain/calc.js";
import { ValidationError } from "../errors.js";

/** Material catalog overview and the quantity calculator (quantities from domain/calc.js, prices from the rate book). */
export function createSourcing({ resources, catalog }) {
  return {
    async overview() {
      const [locations, materials, suppliers, rates] = await Promise.all([catalog.locations(), resources.list("materials"), resources.list("suppliers"), resources.list("rates")]);
      return { locations, materials, suppliers, rates };
    },
    structures: () => Object.entries(STRUCTURES).map(([name, s]) => ({ name, inputs: s.inputs, mix: s.mix, help: s.help, needs_block: s.kind === "blockwork" })),

    async quote(input) {
      let block = null;
      if (STRUCTURES[input.structure]?.kind === "blockwork") {
        const row = await catalog.materialByNameOrId(input.block || "");
        if (!row) throw new ValidationError("choose a block or brick from the materials list");
        block = { name: row.name, size: row.size };
      }
      let result;
      try { result = calculate(input, block); }
      catch (e) { if (e instanceof CalcError) throw new ValidationError(e.message); throw e; }

      const loc = input.location_id ? await catalog.location(String(input.location_id)) : null;
      if (input.location_id && !loc) throw new ValidationError("that location does not exist");

      // Price each line from the cheapest rate in the district, else the region, else anywhere.
      let total = 0, unpriced = 0;
      for (const it of result.items) {
        Object.assign(it, { rate: null, total: null, supplier: null, rate_scope: "none" });
        const mat = it.material && (await catalog.materialByName(it.material));
        if (mat) {
          const rows = await catalog.ratesFor(mat.id);
          const inDistrict = loc && rows.find((r) => r.location_id === loc.id), inRegion = loc && rows.find((r) => r.region === loc.region);
          const [scope, rate] = inDistrict ? ["district", inDistrict] : inRegion ? ["region", inRegion] : rows[0] ? ["anywhere", rows[0]] : [null, null];
          if (rate) { it.rate = rate.price; it.supplier = rate.supplier || null; it.rate_scope = scope; it.total = Math.round(it.quantity * it.rate); total += it.total; }
        }
        if (it.material && it.rate === null) unpriced++;
      }
      return { ...result, location: loc ? { id: loc.id, district: loc.district, region: loc.region } : null, total, unpriced };
    },
  };
}
