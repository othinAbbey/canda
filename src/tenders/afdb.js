import { cachedFeed } from "./rss.js";
import { COUNTRY_ALIASES, matches, mentions, toDate } from "./feedTools.js";

/**
 * African Development Bank: project procurement notices from the Bank's official RSS feed (https://www.afdb.org/en/rss-feeds).
 * Titles look like "<notice type> - <country> - <project>", in English or French. The feed repeats some items: they are de-duplicated.
 * The feed holds the latest notices only (no history or paging), so searches run on that recent set.
 */
export const AFDB_FEED = "https://www.afdb.org/en/projects-and-operations/procurement.xml";

export function normalizeAfdb(item) {
  const parts = String(item.title || "").split(/\s+-\s+/);
  const country = parts.length >= 3 ? parts[1] : null;
  const known = country && Object.entries(COUNTRY_ALIASES).find(([, names]) => names.includes(country.toLowerCase()));
  return {
    source: "afdb", external_id: item.id || item.link,
    title: parts.length >= 3 ? parts.slice(2).join(" - ") : item.title || "(no title)",
    buyer: "African Development Bank financed project",
    country: known ? known[0] : country,
    type: parts.length >= 2 ? parts[0] : null, method: null,
    published: toDate(item.date), deadline: null,
    description: item.description ? item.description.slice(0, 400) : null,
    url: item.link,
  };
}

export function createAfdbProvider({ fetchImpl = fetch, url = AFDB_FEED } = {}) {
  const feed = cachedFeed(url, { fetchImpl, name: "The African Development Bank feed" });
  return {
    id: "afdb",
    name: "African Development Bank",
    note: "Latest procurement notices for projects the African Development Bank finances (official feed; recent notices only, no deadlines in the feed: open the notice for details).",
    async search({ q = "", country = "", rows = 50, offset = 0 } = {}) {
      const seen = new Set(), all = [];
      for (const it of await feed()) {
        const n = normalizeAfdb(it);
        if (!n.external_id || seen.has(n.external_id)) continue;
        seen.add(n.external_id);
        if (!mentions(`${it.title} ${n.country}`, country) || !matches(`${it.title} ${it.description}`, q)) continue;
        all.push(n);
      }
      all.sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
      return { total: all.length, items: all.slice(offset, offset + rows) };
    },
  };
}
