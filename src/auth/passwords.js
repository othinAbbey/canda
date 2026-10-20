import crypto from "node:crypto";

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}
export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const a = Buffer.from(hash, "hex"), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
