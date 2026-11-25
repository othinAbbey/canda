import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Fetches a PUBLIC web page or file for the bid reader. Tender links are typed by users, so the server must never be
 * talked into calling itself or the private network (cloud metadata, the database, other services):
 *  - only http and https, standard ports;
 *  - every address a name resolves to is checked, at connect time (so a name cannot switch to a private address
 *    between the check and the connection), and again after each redirect;
 *  - size and time limits, at most 4 redirects, no cookies or credentials sent.
 */
export class FetchError extends Error {}

const PRIVATE_V4 = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]];
const v4num = (ip) => ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return PRIVATE_V4.some(([base, bits]) => (v4num(ip) >>> (32 - bits)) === (v4num(base) >>> (32 - bits)));
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase();
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) return isPrivateAddress(mapped[1]);
    return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a);
  }
  return true;
}

/** dns.lookup that refuses private addresses; used by the connection itself. */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) return callback(new FetchError("that address is not a public website"));
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function checkUrl(raw) {
  let u; try { u = new URL(raw); } catch { throw new FetchError("the link is not a valid web address"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new FetchError("only http and https links can be read");
  if (u.username || u.password) throw new FetchError("links with a user name or password are not read");
  if (u.port && !["80", "443"].includes(u.port)) throw new FetchError("links on unusual ports are not read");
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && isPrivateAddress(u.hostname.replace(/^\[|\]$/g, ""))) throw new FetchError("that address is not a public website");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new FetchError("that address is not a public website");
  return u;
}

function once(u, { maxBytes, timeout }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method: "GET", lookup: guardedLookup, timeout, headers: { "user-agent": "Buildsuite360-BidReader/1.0 (+https://buildsuite360.org)", accept: "text/html,application/pdf,application/xhtml+xml,*/*;q=0.8" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve({ redirect: res.headers.location, status: res.statusCode }); }
      const declared = Number(res.headers["content-length"] || 0);
      if (declared > maxBytes) { res.destroy(); return reject(new FetchError(`the file is larger than ${Math.round(maxBytes / 1048576)} MB`)); }
      const chunks = []; let size = 0;
      res.on("data", (c) => { size += c.length; if (size > maxBytes) { res.destroy(); reject(new FetchError(`the file is larger than ${Math.round(maxBytes / 1048576)} MB`)); } else chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode, contentType: String(res.headers["content-type"] || "").toLowerCase(), body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new FetchError("the website took too long to answer")));
    req.on("error", (e) => reject(e instanceof FetchError ? e : new FetchError(`could not open the link (${e.code || e.message})`)));
    req.end();
  });
}

/** Returns { url, status, contentType, body }. Throws FetchError with a message fit to show. */
export async function fetchPublic(raw, { maxBytes = 5 * 1048576, timeout = 20000 } = {}) {
  let u = checkUrl(raw);
  for (let hop = 0; hop <= 4; hop++) {
    const r = await once(u, { maxBytes, timeout });
    if (!r.redirect) {
      if (r.status >= 400) throw new FetchError(`the website answered ${r.status}`);
      return { url: u.toString(), status: r.status, contentType: r.contentType, body: r.body };
    }
    u = checkUrl(new URL(r.redirect, u).toString());
  }
  throw new FetchError("the link redirects too many times");
}
