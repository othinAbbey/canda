import { ValidationError } from "../errors.js";

/**
 * Rules for the shared subcontracts marketplace. Pure: no database.
 * A listing is either a SUBCONTRACT (a company offers part of its work) or an AVAILABILITY (a company is free to take work).
 */
export const KINDS = ["subcontract", "availability"];
export const TRADES = [
  "Masonry and blockwork", "Concrete and formwork", "Steel fixing", "Structural steel and fabrication", "Roofing", "Carpentry and joinery",
  "Plumbing and drainage", "Electrical installation", "Plastering and finishes", "Painting and decoration", "Tiling and flooring",
  "Aluminium, glass and windows", "Earthworks and excavation", "Roads and paving", "Culverts and bridges", "Borehole drilling and water supply",
  "Solar and power systems", "HVAC and ventilation", "Fencing and gates", "Landscaping", "Plant and equipment hire", "Transport and haulage",
  "Labour supply", "Surveying and setting out", "Design and supervision", "Other",
];
export const LISTING_STATUS = ["open", "awarded", "closed"];
export const RESPONSE_STATUS = ["new", "shortlisted", "accepted", "declined", "withdrawn"];
export const OWNER_CAN_SET = ["new", "shortlisted", "accepted", "declined"];     // the company that posted the listing
const CURRENCIES = ["UGX", "USD", "EUR", "KES", "TZS"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v, label, max, required = false) => {
  const s = v === undefined || v === null ? "" : String(v).trim();
  if (required && !s) throw new ValidationError(`${label} is required`);
  if (s.length > max) throw new ValidationError(`${label} is too long (${max} characters)`);
  return s || null;
};
const date = (v, label) => { if (v === undefined || v === null || v === "") return null; if (!DATE.test(String(v))) throw new ValidationError(`${label} must be a date (YYYY-MM-DD)`); return String(v); };
const amount = (v, label) => { if (v === undefined || v === null || v === "") return null; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be a positive number`); return n; };
const email = (v) => { const s = text(v, "Email", 200); if (s && !/^\S+@\S+\.\S+$/.test(s)) throw new ValidationError("Email is not valid"); return s; };
const pick = (v, list, label, fallback) => { const x = v === undefined || v === null || v === "" ? fallback : String(v); if (!list.includes(x)) throw new ValidationError(`${label} must be one of: ${list.join(", ")}`); return x; };

/** Clean a listing from the request. `partial` for updates: only fields sent are checked and returned. */
export function cleanListing(body = {}, { partial = false } = {}) {
  const has = (k) => !partial || k in body, out = {};
  if (!partial) out.kind = pick(body.kind, KINDS, "kind");
  if (has("title")) out.title = text(body.title, "Title", 160, true);
  if (has("trade")) out.trade = pick(body.trade, TRADES, "Trade");
  if (has("description")) out.description = text(body.description, "Description", 4000);
  if (has("region")) out.region = text(body.region, "Region", 80);
  if (has("district")) out.district = text(body.district, "District", 80);
  if (has("start_date")) out.start_date = date(body.start_date, "Start date");
  if (has("end_date")) out.end_date = date(body.end_date, "End date");
  if (has("deadline")) out.deadline = date(body.deadline, "Apply by");
  if (has("value")) out.value = amount(body.value, "Value");
  if (has("currency")) out.currency = pick(body.currency, CURRENCIES, "Currency", "UGX");
  if (has("crew_size")) { const n = amount(body.crew_size, "Team size"); if (n !== null && !Number.isInteger(n)) throw new ValidationError("Team size must be a whole number"); out.crew_size = n; }
  if (has("equipment")) out.equipment = text(body.equipment, "Equipment", 1000);
  if (has("requirements")) out.requirements = text(body.requirements, "Requirements", 2000);
  if (has("contact_name")) out.contact_name = text(body.contact_name, "Contact name", 120);
  if (has("contact_phone")) out.contact_phone = text(body.contact_phone, "Phone", 40);
  if (has("contact_email")) out.contact_email = email(body.contact_email);
  if (has("status")) out.status = pick(body.status, LISTING_STATUS, "Status", "open");
  // May Buildsuite360 feature this listing on its social media? Only an explicit yes counts.
  if (has("feature_social")) out.feature_social = body.feature_social === true || body.feature_social === "true" || body.feature_social === 1;
  if (out.start_date && out.end_date && out.end_date < out.start_date) throw new ValidationError("the end date is before the start date");
  return out;
}

/** Every listing must give other companies a way to reach the poster. */
export function checkContact(l) {
  if (!l.contact_phone && !l.contact_email) throw new ValidationError("give a phone number or an email so other companies can reach you");
}

export function cleanResponse(body = {}) {
  const out = {
    message: text(body.message, "Message", 3000, true),
    price: amount(body.price, "Price"),
    currency: pick(body.currency, CURRENCIES, "Currency", "UGX"),
    contact_name: text(body.contact_name, "Contact name", 120),
    contact_phone: text(body.contact_phone, "Phone", 40),
    contact_email: email(body.contact_email),
  };
  checkContact(out);
  return out;
}
