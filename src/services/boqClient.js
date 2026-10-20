/** Talks to the separate BOQ service (canda-boq-service). Only this file knows its URL, key and message formats. */
export class BoqError extends Error {
  constructor(status, message) { super(message); this.name = "BoqError"; this.status = status; }
}

export function createBoqClient({ url, key }, fetchImpl = fetch) {
  async function call(method, path, { json, form, timeout = 30_000, binary = false } = {}) {
    const headers = key ? { "x-service-key": key } : {};
    if (json !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await fetchImpl(`${url}/api${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : form, signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new BoqError(0, "The BOQ service is not reachable right now. Try again shortly.");
    }
    if (!res.ok) {
      let detail = await res.text();
      try { const b = JSON.parse(detail); detail = typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail ?? b); } catch { /* plain text */ }
      throw new BoqError(res.status, detail || `BOQ service error (${res.status})`);
    }
    return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
  }
  return {
    config: () => call("GET", "/config"),
    rates: () => call("GET", "/rates"),
    saveRates: (rows) => call("PUT", "/rates", { json: { rows } }),
    createJob(pdf, filename, { force = false } = {}) {
      const form = new FormData();
      form.append("file", new Blob([pdf], { type: "application/pdf" }), filename);
      return call("POST", `/jobs${force ? "?force=true" : ""}`, { form, timeout: 300_000 });
    },
    job: (id) => call("GET", `/jobs/${encodeURIComponent(id)}`),
    rebuild: (id) => call("POST", `/jobs/${encodeURIComponent(id)}/rebuild`, { timeout: 120_000 }),
    xlsx: (id) => call("GET", `/jobs/${encodeURIComponent(id)}/boq.xlsx`, { binary: true }),
  };
}
