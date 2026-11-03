import crypto from "node:crypto";

let lastMs = 0, seq = 0;
/** Time-ordered unique id (sorts by creation time, safe as a paging cursor). 26 characters. */
export function newId() {
  const ms = Date.now();
  seq = ms === lastMs ? seq + 1 : 0;
  lastMs = ms;
  return ms.toString(36).padStart(9, "0") + seq.toString(36).padStart(3, "0") + crypto.randomBytes(7).toString("hex").slice(0, 14);
}
export const now = () => new Date().toISOString();
