import { toDate } from "./worldbank.js";

/** Countries offered on the Tenders page, with the other names and codes they appear under in feeds. */
export const COUNTRY_ALIASES = {
  "Uganda": ["uganda", "ouganda", "uga"],
  "Kenya": ["kenya", "ken"],
  "Tanzania": ["tanzania", "tanzanie", "tza"],
  "Rwanda": ["rwanda", "rwa"],
  "South Sudan": ["south sudan", "soudan du sud", "ssd"],
  "Democratic Republic of Congo": ["democratic republic of congo", "congo, dem", "drc", "rdc", "république démocratique du congo", "cod"],
  "Ethiopia": ["ethiopia", "éthiopie", "ethiopie", "eth"],
  "Burundi": ["burundi", "bdi"],
};
/** Does this text mention the country? Codes (UGA) only count as whole words, e.g. "UNDP-UGA-00123". */
export function mentions(text, country) {
  if (!country) return true;
  const t = ` ${String(text || "").toLowerCase()} `;
  const names = COUNTRY_ALIASES[country] || [country.toLowerCase()];
  return names.some((n) => (n.length <= 3 ? new RegExp(`[^a-z]${n}[^a-z]`).test(t) : t.includes(n)));
}
/** Every keyword must appear (any order, ignoring case). */
export function matches(text, q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const t = String(text || "").toLowerCase();
  return words.every((w) => t.includes(w));
}
export { toDate };
