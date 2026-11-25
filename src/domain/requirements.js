/**
 * The built-in requirements reader: finds the lines of a bid document that ask the bidder for something
 * ("submit a certified copy of...", "bid security of UGX 5,000,000", "a site visit will be held on...").
 * It works on pasted text, with no outside service. The AI assistant (next version) will plug in behind the same
 * button and return the same shape: [{ text, category }].
 */
const CUES = /\b(shall|must|required?|requirements?|submit(?:ted)?|provide|attach(?:ed)?|copy|copies|certified|certificate|licen[cs]e|registration|registered|clearance|bid security|bid bond|bank guarantee|guarantee|power of attorney|audited|financial statements?|turnover|experience|similar (?:works|contracts|projects)|cv|curriculum vitae|personnel|key staff|equipment|site visit|pre-?bid|meeting|deadline|closing date|validity|valid for|declaration|form of bid|bid form|signed|stamped|sealed|original|evidence|proof|tin|vat|nssf|ura|ppda|trading licence|incorporation|memorandum|bill of quantities|boq|programme of works|method statement|work plan|insurance|eligib\w*)\b/i;
const BULLET = /^\s*(?:[-*•▪◦·]|\(?[0-9]{1,2}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)])\s+/i;
const HEADING = /^(?:section|part|annex|appendix|table of contents|page \d+)/i;

const CATEGORIES = [
  ["Bid security and money", /\b(bid security|bid bond|bank guarantee|guarantee|insurance|fee|payment|non-?refundable|ugx|usd|turnover|financial statements?|audited|bank statement)\b/i],
  ["Dates and meetings", /\b(site visit|pre-?bid|meeting|deadline|closing date|on or before|not later than|validity|valid for|days?)\b/i],
  ["Company documents", /\b(certificate|incorporation|registration|registered|licen[cs]e|clearance|tin|vat|nssf|ura|ppda|memorandum|power of attorney|declaration)\b/i],
  ["Technical", /\b(experience|similar (?:works|contracts|projects)|cv|curriculum vitae|personnel|key staff|equipment|method statement|work plan|programme of works|specification|drawings?|bill of quantities|boq)\b/i],
  ["How to submit", /\b(sealed|signed|stamped|original|copies|envelope|marked|address(?:ed)?|deliver|e-?mail|portal|form of bid|bid form)\b/i],
];
export const categorize = (text) => CATEGORIES.find(([, re]) => re.test(text))?.[0] || "Other";

const clean = (s) => s.replace(BULLET, "").replace(/\s+/g, " ").replace(/^[\s:;,.-]+/, "").trim();
const key = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Pieces of text worth judging: lines, and long lines broken into sentences. */
function pieces(text) {
  const out = [];
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trim(); if (!line) continue;
    if (line.length <= 240) { out.push(line); continue; }
    for (const s of line.split(/(?<=[.;])\s+(?=[A-Z(0-9])/)) if (s.trim()) out.push(s.trim());
  }
  return out;
}

/** Returns up to `max` requirements, in the order they appear, without duplicates. */
export function readRequirements(text, { max = 60 } = {}) {
  const seen = new Set(), items = [];
  for (const p of pieces(text)) {
    const bulleted = BULLET.test(p), t = clean(p);
    if (t.length < 8 || HEADING.test(t)) continue;
    if (!CUES.test(t) && !(bulleted && t.split(" ").length >= 3)) continue;   // a bullet under a list is usually a requirement too
    if (/^(the )?(following|bidders? (are|is) (hereby )?invited)\b/i.test(t) && t.length < 60) continue;
    const short = t.length > 300 ? `${t.slice(0, 297).replace(/\s+\S*$/, "")}...` : t;
    const k = key(short); if (!k || seen.has(k)) continue;
    seen.add(k); items.push({ text: short, category: categorize(short) });
    if (items.length >= max) break;
  }
  return items;
}
