import { HttpError } from "../errors.js";

/** What handlers return. A plain object means 200 JSON. */
export const created = (body) => ({ __status: 201, body });
export const file = ({ name, type, data }) => ({ file: { name, type, data } });

export async function readJson(req, limit = 1_000_000) {
  const raw = await readRaw(req, limit);
  if (!raw.length) return {};
  try { const j = JSON.parse(raw.toString("utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; }
  catch { throw new HttpError(400, "body must be valid JSON"); }
}

/** Reads the whole body. Over the limit it keeps reading (so the client gets a clean 413) but stores nothing more, up to a hard stop. */
export function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit + 50 * 1048576) return req.destroy();   // hard stop for runaway uploads
      if (size > limit) { over = true; return; }
      chunks.push(c);
    });
    req.on("end", () => (over ? reject(new HttpError(413, `request is larger than ${Math.round(limit / 1048576 * 10) / 10} MB`)) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
    req.on("aborted", () => reject(new HttpError(400, "upload interrupted")));
  });
}
