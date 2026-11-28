/**
 * Rules for Buildsuite360's daily social media post. Pure: no database, no network.
 * A post is a list of slides. Every fact on a slide is copied from a record; only the headline is reworded.
 */
export const MAX_SLIDES = 5;
export const HEADLINE_MAX = 80;
export const MIN_DAYS_LEFT = 3;          // a tender closing sooner is left out: the video may be seen days later
export const HASHTAGS = "#Uganda #UgandaTenders #Tenders #Construction #Contractors #Subcontracts #Buildsuite360";

const WORKS = /\b(construct|rehabilit|renovat|build|works?\b|civil|road|bridge|culvert|drain|water supply|borehole|sanitation|school|classroom|health cent|hospital|housing|house|office block|dormitor|latrine|irrigation|dam|market|fenc|roof|electrif|solar|install)/i;
const NOT_TENDERS = /award|cancel|expression of interest for consult|consultan|audit services|individual consultant/i;

/** Days from `day` (YYYY-MM-DD) to `date`. */
export const daysBetween = (day, date) => Math.round((Date.parse(date) - Date.parse(day)) / 86400000);

/** Kampala's date (UTC+3) for an instant. */
export const kampalaDay = (ms = Date.now()) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
export const kampalaHour = (ms = Date.now()) => new Date(ms + 3 * 3600000).getUTCHours();

/** A headline that fits a phone screen: the record's own title, cut at a word. */
export function shorten(title, max = HEADLINE_MAX) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1), sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:(\-]+$/, "")}…`;
}

/**
 * Is a reworded headline safe to show for this record? It must be short, and every number in it must already be in the
 * record (so an amount, date or count can never be made up), and it must not be empty.
 */
export function headlineOk(headline, record) {
  const h = String(headline || "").trim();
  if (!h || h.length > HEADLINE_MAX) return false;
  const source = `${record.title || ""} ${record.place || ""} ${record.who || ""}`;
  const nums = h.match(/\d[\d,.]*/g) || [];
  return nums.every((n) => source.includes(n.replace(/[.,]$/, "")));
}

const fmtMoney = (v, cur) => (v === null || v === undefined || v === "" ? null : `${cur || "UGX"} ${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

/** A tender notice as a slide (facts copied as they are). */
export function tenderSlide(t) {
  return {
    kind: "tender", ref: `${t.source}|${t.external_id}`, title: String(t.title || "").trim(), headline: shorten(t.title),
    who: t.buyer || null, place: t.country || null, closes: t.deadline || null, value: null,
    source_name: t.source_name || t.source, url: t.url || null, published: t.published || null,
  };
}

/** A marketplace listing as a slide. Never its contact details: people reply inside Buildsuite360. */
export function listingSlide(l) {
  return {
    kind: l.kind, ref: `listing|${l.id}`, title: String(l.title || "").trim(), headline: shorten(l.title),
    who: l.company_name || null, place: [l.district, l.region].filter(Boolean).join(", ") || null,
    closes: l.kind === "subcontract" ? l.deadline || null : null, value: fmtMoney(l.value, l.currency),
    trade: l.trade || null, crew_size: l.crew_size ?? null, available_from: l.kind === "availability" ? l.start_date || null : null,
    source_name: "Buildsuite360 Subcontracts", url: null, published: l.created ? String(l.created).slice(0, 10) : null,
  };
}

/** Which notices may go in today's video: building works, still open long enough, not an award or consultancy. */
export function eligibleTender(t, day) {
  const text = `${t.title || ""} ${t.type || ""}`;
  if (!WORKS.test(t.title || "") || NOT_TENDERS.test(text)) return false;
  if (t.deadline && daysBetween(day, t.deadline) < MIN_DAYS_LEFT) return false;
  if (t.published && daysBetween(t.published, day) > 14) return false;
  return true;
}

export function eligibleListing(l, day) {
  if (l.status !== "open" || !(l.feature_social === true || l.feature_social === 1)) return false;
  if (l.kind === "subcontract" && l.deadline && daysBetween(day, l.deadline) < MIN_DAYS_LEFT) return false;
  return !l.created || daysBetween(String(l.created).slice(0, 10), day) <= 14;
}

/** Without the AI: the newest tenders first, then up to two featured listings. */
export function pickByRules(tenders, listings) {
  const slides = [...tenders.slice(0, MAX_SLIDES - Math.min(2, listings.length)), ...listings.slice(0, 2)];
  return slides.slice(0, MAX_SLIDES);
}

export function defaultCaption(slides, day) {
  const nT = slides.filter((s) => s.kind === "tender").length, nL = slides.length - nT;
  const parts = [nT ? `${nT} new construction tender${nT > 1 ? "s" : ""}` : "", nL ? `${nL} subcontract${nL > 1 ? "s" : ""} on Buildsuite360` : ""].filter(Boolean);
  const date = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return `${parts.join(" and ")} for Ugandan contractors, ${date}. Closing dates and full notices on buildsuite360.org. Always check the official notice before you bid.`;
}
