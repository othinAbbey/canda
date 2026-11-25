import { cachedFeed } from "./rss.js";
import { matches, toDate } from "./feedTools.js";

/**
 * UNDP procurement notices from UNDP's official RSS feeds (RSS 1.0, updated hourly; list at
 * https://procurement-notices.undp.org/proc_notices_rss_feed.cfm). Each country office has its own feed, named by UNDP's office
 * code (Uganda = UGA, Tanzania = URT, DR Congo = ZAI ...); "All countries" reads the Africa feed (RAF).
 * Titles look like "UNDP-UGA-00617 - Construction of Equipment Storage Structures - UNDP - UGANDA";
 * the description holds "Application Deadline: 09-Dec-26".
 */
export const UNDP_FEEDS = "https://procurement-notices.undp.org/rss_feeds/";
export const UNDP_OFFICE = {
  "Uganda": "UGA", "Kenya": "KEN", "Tanzania": "URT", "Rwanda": "RWA", "South Sudan": "SSD",
  "Democratic Republic of Congo": "ZAI", "Ethiopia": "ETH", "Burundi": "BDI",
};
const AFRICA = "RAF";
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "09-Dec-26" -> "2026-12-09" (UNDP's short dates); anything else via the general date reader. */
export function undpDate(v) {
  const m = /^(\d{1,2})-([a-z]{3})-(\d{2}|\d{4})$/i.exec(String(v || "").trim());
  if (!m || !MONTHS[m[2].toLowerCase()]) return toDate(v);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const titleCase = (s) => String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function normalizeUndp(item) {
  const parts = String(item.title || "").split(/\s+-\s+/);
  // [ref, ...title, "UNDP", COUNTRY]; titles can themselves contain " - ".
  const hasTail = parts.length >= 4 && /^undp$/i.test(parts[parts.length - 2]);
  const ref = /^UNDP-/i.test(parts[0]) ? parts[0] : null;
  const title = (hasTail ? parts.slice(ref ? 1 : 0, -2) : parts.slice(ref ? 1 : 0)).join(" - ") || item.title || "(no title)";
  const deadline = /deadline:?\s*([0-9]{1,2}-[a-z]{3}-[0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i.exec(item.description || "");
  return {
    source: "undp", external_id: item.id || item.link,
    title,
    buyer: "UNDP",
    country: hasTail ? titleCase(parts[parts.length - 1]) : null,
    type: null, method: null,
    published: toDate(item.date), deadline: deadline ? undpDate(deadline[1]) : null,
    description: ref ? `Ref ${ref}` : null,
    url: item.link,
  };
}

export function createUndpProvider({ fetchImpl = fetch, base = UNDP_FEEDS } = {}) {
  const feeds = new Map();
  const feed = (code) => { if (!feeds.has(code)) feeds.set(code, cachedFeed(`${base}${code}.xml`, { fetchImpl, name: "The UNDP feed" })); return feeds.get(code)(); };
  return {
    id: "undp",
    name: "UNDP procurement notices",
    note: "UNDP country-office notices from UNDP's official feeds (Africa-wide when no country is chosen). Bids go through UNDP's supplier portal (Quantum) after registering.",
    async search({ q = "", country = "", rows = 50, offset = 0 } = {}) {
      const code = country ? UNDP_OFFICE[country] : AFRICA;
      if (!code) return { total: 0, items: [] };                    // a country UNDP has no feed code for here
      const seen = new Set(), all = [];
      for (const it of await feed(code)) {
        const n = normalizeUndp(it);
        if (!n.external_id || seen.has(n.external_id) || !matches(`${it.title} ${it.description}`, q)) continue;
        seen.add(n.external_id);
        all.push(n);
      }
      all.sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
      return { total: all.length, items: all.slice(offset, offset + rows) };
    },
  };
}
