/**
 * Quantity calculator. Pure functions: no database, no network.
 * Inputs are in METRES. Standard site-estimating factors (all adjustable in the request):
 *   dry/wet volume factor: 1.54 concrete, 1.27 mortar | cement 1440 kg/m3 | bag 50 kg | water/cement 0.5
 */
const CEMENT_KG_M3 = 1440, BAG_KG = 50, DRY_CONCRETE = 1.54, DRY_MORTAR = 1.27, WATER_CEMENT = 0.5, JOINT = 0.01;

export class CalcError extends Error {}

export const STRUCTURES = {
  "Internal Wall": { kind: "blockwork", inputs: ["length", "height"], mix: "1:4", help: "Blockwork wall: blocks plus mortar." },
  "Foundation": { kind: "blockwork", inputs: ["length", "height"], mix: "1:4", help: "Blockwork below ground (height = depth): blocks plus mortar." },
  "Concrete": { kind: "concrete", inputs: ["length", "width", "height"], mix: "1:2:4", help: "Cement, sand, aggregate and water." },
  "Slab": { kind: "concrete", inputs: ["length", "width", "height"], mix: "1:2:4", help: "Concrete slab (height = thickness). Reinforcement steel is not included." },
  "Mortar": { kind: "mortar", inputs: ["length", "width", "height"], mix: "1:4", help: "Cement, sand and water." },
};

const positive = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new CalcError(`${name} must be a number above zero (in metres)`);
  if (n > 1000) throw new CalcError(`${name} looks too large; enter metres`);
  return n;
};
const ceil = (x) => Math.ceil(x - 1e-9), r2 = (x) => Math.round(x * 100) / 100;

export function parseMix(text, parts) {
  const nums = String(text).split(":").map((s) => Number(s.trim()));
  if (nums.length !== parts || nums.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new CalcError(`mix must look like ${parts === 3 ? "1:2:4 (cement:sand:aggregate)" : "1:4 (cement:sand)"}`);
  }
  if (nums[0] !== 1) throw new CalcError("a mix starts with 1 part cement, e.g. 1:2:4");
  return nums;
}

/** "150 X 200 X 400" -> { length: 0.4, height: 0.2, thickness: 0.15 } (largest = length, smallest = thickness). */
export function parseBlockSize(size) {
  const n = String(size || "").match(/\d+(\.\d+)?/g)?.map(Number).sort((a, b) => a - b);
  if (!n || n.length < 3) return { length: 0.215, height: 0.065, thickness: 0.1025 };   // a standard brick
  return { length: n[2] / 1000, height: n[1] / 1000, thickness: n[0] / 1000 };
}

function cementSandWater(cementM3, sandM3, aggM3, extra = []) {
  const cementKg = cementM3 * CEMENT_KG_M3;
  const items = [
    { key: "cement", material: "Cement", label: "Cement", unit: "bags", exact: cementKg / BAG_KG },
    { key: "sand", material: "Sand", label: "Sand", unit: "m3", exact: sandM3 },
  ];
  if (aggM3 !== null) items.push({ key: "aggregate", material: "Aggregate", label: "Aggregate", unit: "m3", exact: aggM3 });
  items.push({ key: "water", material: null, label: "Water", unit: "litres", exact: cementKg * WATER_CEMENT });
  return [...extra, ...items];
}

/**
 * calculate({ structure, length, width, height, mix?, wastage?, block? }, blockInfo?)
 * `block` is a material name; `blockInfo` = { name, size } supplied by the caller from the database.
 */
export function calculate(input, blockInfo = null) {
  const def = STRUCTURES[input.structure];
  if (!def) throw new CalcError(`unknown structure "${input.structure}" (choose: ${Object.keys(STRUCTURES).join(", ")})`);
  const dim = Object.fromEntries(def.inputs.map((k) => [k, positive(input[k], k)]));
  const wastage = input.wastage === undefined || input.wastage === "" ? 0.05 : Number(input.wastage);
  if (!Number.isFinite(wastage) || wastage < 0 || wastage > 0.5) throw new CalcError("wastage must be between 0 and 0.5 (0% to 50%)");
  const mixText = input.mix || def.mix;
  const notes = [`Wastage allowed: ${Math.round(wastage * 100)}%`];
  let items;

  if (def.kind === "blockwork") {
    if (!blockInfo) throw new CalcError("choose a block or brick");
    const b = parseBlockSize(blockInfo.size), [, sandParts] = parseMix(mixText, 2);
    const area = dim.length * dim.height;
    const perM2 = 1 / ((b.length + JOINT) * (b.height + JOINT));
    const blocks = area * perM2 * (1 + wastage);
    const mortarPerBlock = b.thickness * JOINT * (b.length + b.height);          // bed + perpend joints
    const mortar = area * perM2 * mortarPerBlock * 1.25;                          // +25% for waste and filling
    const cementM3 = (mortar * DRY_MORTAR) / (1 + sandParts), sandM3 = (mortar * DRY_MORTAR * sandParts) / (1 + sandParts);
    items = cementSandWater(cementM3, sandM3, null, [{ key: "blocks", material: blockInfo.name, label: blockInfo.name, unit: "pcs", exact: blocks }]);
    notes.push(`Wall area ${r2(area)} m2, ${r2(perM2)} units per m2 (10 mm joints), mortar ${r2(mortar)} m3 at ${mixText}`);
  } else {
    const volume = dim.length * dim.width * dim.height * (1 + wastage);
    if (def.kind === "mortar") {
      const [, s] = parseMix(mixText, 2);
      items = cementSandWater((volume * DRY_MORTAR) / (1 + s), (volume * DRY_MORTAR * s) / (1 + s), null);
    } else {
      const [, s, a] = parseMix(mixText, 3), parts = 1 + s + a;
      items = cementSandWater((volume * DRY_CONCRETE) / parts, (volume * DRY_CONCRETE * s) / parts, (volume * DRY_CONCRETE * a) / parts);
    }
    notes.push(`Volume ${r2(volume)} m3 including wastage, mix ${mixText}`);
  }

  for (const it of items) {
    it.quantity = it.unit === "pcs" || it.unit === "bags" ? ceil(it.exact) : it.unit === "litres" ? Math.round(it.exact) : r2(it.exact);
    delete it.exact;
  }
  return { structure: input.structure, inputs: { ...dim, mix: mixText, wastage }, items, notes };
}
