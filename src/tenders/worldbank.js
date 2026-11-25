/**
 * World Bank procurement notices: a free public JSON API (no key). It lists notices for projects the World Bank finances,
 * including in Uganda. Documentation: https://search.worldbank.org/api/v2/procnotices
 * Field names are read defensively (several aliases) because the API's JSON is loosely documented.
 */
const BASE = "https://search.worldbank.org/api/v2/procnotices";

const pick = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== "") return String(o[k]).trim(); return null; };

/** "2026-02-03T00:00:00Z", "2026-02-03", "February 03, 2026" -> "2026-02-03" (or null). */
export function toDate(v) {
  if (!v) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  if (iso) return iso[1];
  const t = Date.parse(`${v} UTC`) || Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

export function normalize(n) {
  const id = pick(n, "id", "notice_id");
  return {
    source: "worldbank", external_id: id,
    title: pick(n, "bid_description", "notice_title", "title", "project_name") || "(no title)",
    buyer: pick(n, "contact_organization", "borrower", "procuring_entity"),
    country: pick(n, "project_ctry_name", "contact_ctry_name", "country"),
    type: pick(n, "notice_type"), method: pick(n, "procurement_method_name", "procurement_method_code"),
    published: toDate(pick(n, "noticedate", "notice_date", "publication_date", "submission_date")),
    deadline: toDate(pick(n, "submission_deadline_date", "deadline_date", "submission_deadline")),
    description: [pick(n, "project_name"), pick(n, "bid_reference_no") && `Ref ${pick(n, "bid_reference_no")}`].filter(Boolean).join(" | ") || null,
    url: id ? `https://projects.worldbank.org/en/projects-operations/procurement-detail/${encodeURIComponent(id)}` : null,
  };
}

export function createWorldBankProvider({ fetchImpl = fetch, baseUrl = BASE } = {}) {
  return {
    id: "worldbank",
    name: "World Bank procurement notices",
    note: "Notices for World Bank financed projects. Uganda's own government tenders are on egpuganda.go.ug, which has no public API.",

    /** One page of results. `country` (a name such as "Uganda") narrows the full-text query and is checked again on the results. */
    async search({ q = "", country = "", rows = 50, offset = 0 } = {}) {
      const params = new URLSearchParams({ format: "json", rows: String(rows), os: String(offset) });
      const term = [country, q].map((s) => String(s || "").trim()).filter(Boolean).join(" ");
      if (term) params.set("qterm", term);
      let res;
      try { res = await fetchImpl(`${baseUrl}?${params}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
      catch { throw new Error("The World Bank service did not answer."); }
      if (!res.ok) throw new Error(`The World Bank service returned an error (${res.status}).`);
      const body = await res.json().catch(() => { throw new Error("The World Bank service sent an unreadable answer."); });
      const raw = body.procnotices ?? body.notices ?? [];
      const list = Array.isArray(raw) ? raw : Object.values(raw);
      let items = list.filter((n) => n && typeof n === "object").map(normalize).filter((t) => t.external_id);
      if (country) items = items.filter((t) => !t.country || t.country.toLowerCase().includes(country.toLowerCase()));
      items.sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
      return { total: Number(body.total) || items.length, items };
    },
  };
}
