/** In-memory limiter: `strike(key)` records a hit, `blocked(key)` says whether the key is over the limit. One server process only. */
export function createLimiter({ max = 10, windowMs = 5 * 60_000 } = {}) {
  const hits = new Map();
  return {
    blocked(key) { const h = hits.get(key); return !!h && h.until > Date.now() && h.n >= max; },
    strike(key, weight = 1) { const h = hits.get(key), live = h && h.until > Date.now(); hits.set(key, { n: (live ? h.n : 0) + weight, until: Date.now() + windowMs }); },
    clear(key) { hits.delete(key); },
  };
}
