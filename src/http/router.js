/** A tiny router. Routes: add(method, "/api/x/:id", { perm | public }, handler). */
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, opts, handler) {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
    this.routes.push({ method, re, keys, opts, handler });
    return this;
  }
  get(p, o, h) { return this.add("GET", p, o, h); }
  post(p, o, h) { return this.add("POST", p, o, h); }
  put(p, o, h) { return this.add("PUT", p, o, h); }
  patch(p, o, h) { return this.add("PATCH", p, o, h); }
  delete(p, o, h) { return this.add("DELETE", p, o, h); }

  /** -> { route, params } | { pathMatched } (path exists but not for this method) | {} */
  match(method, path) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method === method) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return { pathMatched };
  }
}
