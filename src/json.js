/** JSONB comes back parsed from PostgreSQL but as text from other engines; this makes both look the same. */
export const parseJson = (v, fallback = null) => { if (v === null || v === undefined) return fallback; if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return fallback; } };
export const toJson = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
