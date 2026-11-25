import { HttpError, ValidationError } from "../errors.js";
import { createWorldBankProvider } from "../tenders/worldbank.js";

const TTL = 10 * 60_000;      // be polite to public APIs: identical searches are answered from memory for 10 minutes

/**
 * Tender search across providers. A provider is { id, name, note, search({q, country, rows, offset}) -> {total, items[]} }.
 * To add a source, write a provider with that shape and add it to the list below.
 */
export function createTenders({ db, providers = [createWorldBankProvider()] }) {
  const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
  const cache = new Map();

  /** Which of these notices are already in the pipeline? */
  async function inPipeline(source, ids) {
    if (!ids.length) return new Map();
    const rows = await db.query(`SELECT id, external_id, status FROM tenders WHERE source = $1 AND external_id IN (${ids.map((_, i) => `$${i + 2}`).join(",")})`, [source, ...ids]);
    return new Map(rows.map((r) => [r.external_id, r]));
  }

  return {
    sources: () => providers.map(({ id, name, note }) => ({ id, name, note })),

    async search({ source = "worldbank", q = "", country = "", page = 1 } = {}) {
      const provider = byId[source];
      if (!provider) throw new ValidationError(`unknown source (choose: ${providers.map((p) => p.id).join(", ")})`);
      const rows = 50, pageNo = Math.max(1, Number(page) || 1);
      const key = JSON.stringify([source, q, country, pageNo]);
      const hit = cache.get(key);
      let result = hit && hit.at > Date.now() - TTL ? hit.result : null;
      if (!result) {
        try { result = await provider.search({ q, country, rows, offset: (pageNo - 1) * rows }); }
        catch (e) { throw new HttpError(502, e.message); }
        cache.set(key, { at: Date.now(), result });
      }
      const saved = await inPipeline(source, result.items.map((t) => t.external_id));
      return {
        source, page: pageNo, total: result.total, has_more: pageNo * rows < result.total,
        items: result.items.map((t) => ({ ...t, pipeline_id: saved.get(t.external_id)?.id ?? null, pipeline_status: saved.get(t.external_id)?.status ?? null })),
      };
    },
  };
}
