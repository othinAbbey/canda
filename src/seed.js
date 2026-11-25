import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogRepo } from "./repos/catalog.js";
import { resourcesRepo } from "./repos/resources.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Materials from the original C & A material-sourcing screens (units made consistent for the calculator).
const MATERIALS = [
  ["Bricks", "Bricks", "pcs", null, "Burnt clay or cement brick"],
  ["Solid Block 100x200x400", "Blocks", "pcs", "100 X 200 X 400", null],
  ["Solid Block 200x200x400", "Blocks", "pcs", "200 X 200 X 400", null],
  ["Hollow Block 200x200x400", "Blocks", "pcs", "200 X 200 X 400", null],
  ["Hollow Block 150x200x400", "Blocks", "pcs", "150 X 200 X 400", null],
  ["Cement", "Cement", "bags", null, "50 kg bag"],
  ["Sand", "Sand", "m3", null, "Building sand, per cubic metre"],
  ["Aggregate", "Aggregate", "m3", null, "Crushed stone, per cubic metre"],
  ["Iron Bars", "Iron Bars", "bars", null, "12 m length"],
  ["Roofing Sheets", "Roofing Sheets", "sheets", null, null],
  ["Timber", "Timber", "m3", null, null],
  ["Tiles", "Tiles", "boxes", null, null],
  ["Paint", "Paint", "buckets", null, null],
  ["Windows", "Windows", "windows", null, null],
  ["Pipes", "Pipes", "pipes", null, null],
];
// Illustrative UGX prices for Kampala so the calculator works on day one. Replace with real quotes.
const SAMPLE_PRICES = { "Bricks": 450, "Solid Block 100x200x400": 1800, "Solid Block 200x200x400": 3000, "Hollow Block 200x200x400": 2800,
  "Hollow Block 150x200x400": 2200, "Cement": 36000, "Sand": 60000, "Aggregate": 110000 };

/** Fills an empty catalog with all Uganda districts, the starter materials and sample rates. Safe to run again. */
export async function seedIfEmpty(db) {
  const have = await catalogRepo(db).counts();
  await db.tx(async (t) => {
    const repo = resourcesRepo(t), catalog = catalogRepo(t);
    if (!have.locations) {
      for (const region of JSON.parse(fs.readFileSync(path.join(here, "..", "seed", "uganda.json"), "utf8")))
        for (const district of region.districts) await repo.insert("locations", { region: region.name, district });
    }
    if (!have.materials) {
      const kampala = await catalog.locationByPlace("Central", "Kampala");
      for (const [name, category, unit, size, description] of MATERIALS) {
        const m = await repo.insert("materials", { name, category, unit, size, description });
        if (kampala && SAMPLE_PRICES[name]) await repo.insert("rates", { material: m.id, location_id: kampala.id, price: SAMPLE_PRICES[name], note: "Sample rate - replace with a real quote" });
      }
    }
  });
}
