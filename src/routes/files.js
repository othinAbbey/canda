import { created, file } from "../http/reply.js";

export default function fileRoutes(r, { files }) {
  r.get("/api/files", { perm: "files:read" }, (c) => files.list(c.query.project));
  // The file itself is the request body; details go in the query string.
  r.post("/api/files", { perm: "files:write" }, async (c) => created(await files.upload(c.user, { ...c.query, bytes: await c.raw(files.maxBytes) })));
  r.get("/api/files/:id/download", { perm: "files:read" }, async (c) => { const f = await files.download(c.params.id); return file({ name: f.name, type: f.mime || "application/octet-stream", data: Buffer.from(f.data) }); });
  r.delete("/api/files/:id", { perm: "files:write" }, async (c) => { await files.remove(c.user, c.params.id); return { deleted: true }; });
}
