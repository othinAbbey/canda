import crypto from "node:crypto";

// Signed token: base64url(JSON payload) + "." + HMAC-SHA256. Same idea as a JWT, no library needed.
const b64 = (s) => Buffer.from(s).toString("base64url");
const mac = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("base64url");

export function signToken(payload, secret, hours) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + hours * 3600_000 }));
  return `${body}.${mac(body, secret)}`;
}
export function verifyToken(token, secret) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const good = mac(body, secret);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; }
  catch { return null; }
}
