import http from "node:http";
import { can } from "../auth/permissions.js";
import { DbError, HttpError } from "../errors.js";
import { createServices } from "../services/index.js";
import { Router } from "./router.js";
import { readJson, readRaw } from "./reply.js";
import { registerRoutes } from "../routes/index.js";
import { ensureSecret } from "../auth/secret.js";

const DB_MESSAGE = { unique: "that already exists", fk: "a linked record (project, material, supplier or location) does not exist", check: "one of the values is not allowed (check status, priority or severity)", notnull: "a required field is missing" };

/** Builds the HTTP server. Pass `services` in tests to stub outside systems (e.g. the BOQ client). */
export async function createApp({ db, config, boqClient, services }) {
  const secret = await ensureSecret(db, config);
  const svc = services || createServices({ db, config, secret, boqClient });
  const router = new Router();
  registerRoutes(router, svc, { config, db });

  const origins = config.corsOrigins;
  const cors = (req) => {
    const o = req.headers.origin;
    if (!o || !(origins.includes("*") || origins.includes(o))) return {};
    return { "Access-Control-Allow-Origin": origins.includes("*") ? "*" : o, Vary: "Origin", "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Expose-Headers": "Content-Disposition" };
  };
  const base = { "x-content-type-options": "nosniff", "cache-control": "no-store" };
  const json = (req, res, status, body) => { res.writeHead(status, { "content-type": "application/json", ...base, ...cors(req) }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); return res.end(); }
      const url = new URL(req.url, "http://x");
      const { route, params, pathMatched } = router.match(req.method, url.pathname);
      if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "method not allowed" : "not found");

      let user = null;
      if (!route.opts.public) {
        user = await svc.accounts.authenticate(req.headers.authorization);
        if (route.opts.perm && !can(user.role, route.opts.perm)) throw new HttpError(403, "you do not have permission for that");
      }
      const out = await route.handler({
        req, user, params, query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress,
        json: () => readJson(req), raw: (limit) => readRaw(req, limit),
      });

      if (out?.file) {
        const f = out.file;
        res.writeHead(200, { "content-type": f.type, "content-length": f.data.length, ...base, ...cors(req),
          "content-disposition": `attachment; filename="${f.name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.name)}` });
        return res.end(f.data);
      }
      json(req, res, out?.__status || 200, out?.__status ? out.body : out ?? {});
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) return json(req, res, e.status, { error: e.message });
      if (e instanceof DbError) return json(req, res, 400, { error: DB_MESSAGE[e.kind] || "invalid data" });
      console.error(e);
      json(req, res, 500, { error: "server error" });
    }
  });
  return { server, services: svc, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}
