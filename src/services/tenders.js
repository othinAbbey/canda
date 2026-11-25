import { HttpError, ValidationError } from "../errors.js";
import { createWorldBankProvider } from "../tenders/worldbank.js";
import { createAfdbProvider } from "../tenders/afdb.js";
import { createUndpProvider } from "../tenders/undp.js";

/** The sources this server searches: World Bank always; AfDB and UNDP unless switched off. */
export function defaultTenderProviders(config = {}) {
  const f = config.tenderFeeds || {};
  return [
    createWorldBankProvider(),
    ...(f.afdb === false ? [] : [createAfdbProvider(f.afdbUrl ? { url: f.afdbUrl } : {})]),
    ...(f.undp === false ? [] : [createUndpProvider(f.undpBase ? { base: f.undpBase } : {})]),
  ];
}

const TTL = 10 * 60_000;      // be polite to public APIs: identical searches are answered from memory for 10 minutes

/**
 * Tender search across providers. A provider is { id, name, note, search({q, country, rows, offset}) -> {total, items[]} }.
 * To add a source, write a provider with that shape and add it to the list below.
 */
export function createTenders({ db, providers = defaultTenderProviders() }) {
  const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
  const cache = new Map();

  /** Which of these notices are already in the pipeline? */
  /** Which of these notices are already in this company's pipeline? Keyed "source|external_id". */
  async function inPipeline(organizationId, items) {
    const ids = [...new Set(items.map((t) => t.external_id).filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await db.query(`SELECT id, source, external_id, status FROM tenders WHERE organization_id = $1 AND external_id IN (${ids.map((_, i) => `$${i + 2}`).join(",")})`, [organizationId, ...ids]);
    return new Map(rows.map((r) => [`${r.source}|${r.external_id}`, r]));
  }
  const ALL = "all";

  /** One provider's page, answered from memory for 10 minutes. */
  async function fetchPage(provider, q, country, rows, offset) {
    const key = JSON.stringify([provider.id, q, country, rows, offset]), hit = cache.get(key);
    if (hit && hit.at > Date.now() - TTL) return hit.result;
    const result = await provider.search({ q, country, rows, offset });
    cache.set(key, { at: Date.now(), result });
    return result;
  }

  return {
    sources: () => [
      ...(providers.length > 1 ? [{ id: ALL, name: "All sources", note: `Searches ${providers.map((p) => p.name).join(", ")} together, newest first.` }] : []),
      ...providers.map(({ id, name, note }) => ({ id, name, note })),
    ],

    /** Search one provider, or all of them merged (newest first). Marks the notices already in THIS company's pipeline. */
    async search(actor, { source = providers.length > 1 ? ALL : providers[0]?.id, q = "", country = "", page = 1 } = {}) {
      const rows = 50, pageNo = Math.max(1, Number(page) || 1);
      let total, items, failed = [];
      if (source === ALL) {
        // Each source gives its first 200; merged, sorted by date, then paged here. A source that fails is reported, not fatal.
        const results = await Promise.all(providers.map((p) => fetchPage(p, q, country, 200, 0).then((r) => ({ p, r }), (e) => ({ p, e }))));
        failed = results.filter((x) => x.e).map((x) => ({ source: x.p.id, name: x.p.name, error: x.e.message }));
        if (failed.length === providers.length) throw new HttpError(502, failed.map((f) => f.error).join(" "));
        const merged = results.filter((x) => x.r).flatMap((x) => x.r.items);
        merged.sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
        total = merged.length; items = merged.slice((pageNo - 1) * rows, pageNo * rows);
      } else {
        const provider = byId[source];
        if (!provider) throw new ValidationError(`unknown source (choose: ${[ALL, ...providers.map((p) => p.id)].join(", ")})`);
        let result;
        try { result = await fetchPage(provider, q, country, rows, (pageNo - 1) * rows); }
        catch (e) { throw new HttpError(502, e.message); }
        total = result.total; items = result.items;
      }
      const saved = await inPipeline(actor.organization_id, items);
      return {
        source, page: pageNo, total, has_more: pageNo * rows < total, failed,
        items: items.map((t) => { const s = saved.get(`${t.source}|${t.external_id}`); return { ...t, pipeline_id: s?.id ?? null, pipeline_status: s?.status ?? null }; }),
      };
    },
  };
}
