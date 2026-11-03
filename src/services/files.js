import crypto from "node:crypto";
import { HttpError, ValidationError, notFound } from "../errors.js";
import { newId, now } from "../ids.js";
import path from "node:path";

const ALLOWED = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "doc", "docx", "xls", "xlsx", "csv", "txt", "ppt", "pptx", "dwg", "dxf", "zip"];
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", csv: "text/csv", txt: "text/plain",
  zip: "application/zip", doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };

/** Project documents, stored in the database. */
export function createFiles({ files, resources, audit, config }) {
  return {
    maxBytes: config.maxUploadMb * 1024 * 1024,
    list: (project) => files.listMeta(project),
    async upload(actor, { project, name, category, note, bytes }) {
      if (!project || !(await resources.get("projects", project).catch(() => null))) throw new ValidationError("choose an existing project");
      const clean = path.basename(String(name || "file").replace(/\\/g, "/")).replace(/[\x00-\x1f]/g, "").slice(0, 150) || "file";
      const ext = path.extname(clean).slice(1).toLowerCase();
      if (!ALLOWED.includes(ext)) throw new ValidationError(`.${ext || "?"} files are not allowed (allowed: ${ALLOWED.join(", ")})`);
      if (!bytes.length) throw new ValidationError("the file is empty");
      const f = { id: newId(), created: now(), project, name: clean, mime: MIME[ext] || "application/octet-stream", size: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"), category: String(category || "").slice(0, 60) || null, note: String(note || "").slice(0, 500) || null, uploadedBy: actor.id, data: bytes };
      await files.insert(f);
      await audit.log(actor, { action: "upload", entity: "files", id: f.id, project, summary: `${f.name} (${f.size} bytes)` });
      return files.meta(f.id);
    },
    async download(id) { const f = await files.data(id); if (!f) throw notFound("file not found"); return f; },
    async remove(actor, id) {
      const f = await files.remove(id); if (!f) throw notFound("file not found");
      await audit.log(actor, { action: "delete", entity: "files", id, project: f.project, summary: f.name });
    },
  };
}
