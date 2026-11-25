import { can } from "../auth/permissions.js";
import { HttpError, ValidationError, notFound } from "../errors.js";
import { resourcesRepo } from "../repos/resources.js";
import { tenderWorkRepo } from "../repos/tenderWork.js";
import { usersRepo } from "../repos/users.js";

const OPEN = ["saved", "interested", "bidding", "submitted"];       // stages that still count as "in the pipeline"
const PRIORITY = ["low", "medium", "high"], STATUS = ["todo", "doing", "done"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pipeline totals, the list of people tasks can go to, and tender tasks with copies. */
export function createTenderWork({ db, roles, audit }) {
  const tenders = resourcesRepo(db), repo = tenderWorkRepo(db), users = usersRepo(db);
  const staff = async () => (await users.list()).filter((u) => u.status === "active");
  const person = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, role_name: roles.nameOf(u.role) });

  async function present(rows, meId) {
    const copies = await repo.copiesFor(rows.map((r) => r.id));
    return rows.map((t) => ({
      ...t, copies: copies.filter((c) => c.task === t.id).map((c) => ({ id: c.user_id, name: c.name, email: c.email })),
      relation: meId ? (t.assignee === meId ? "assigned" : "copied") : undefined,
    }));
  }

  return {
    /** Value of the pipeline per currency. Currencies are never mixed: UGX is shown on its own. */
    async summary() {
      const rows = await repo.summary(), sum = (statuses) => {
        const out = {};
        for (const r of rows) if (statuses.includes(r.status)) out[r.currency] = (out[r.currency] || 0) + r.total;
        return out;
      };
      return {
        open_statuses: OPEN,
        open: sum(OPEN), won: sum(["won"]), lost: sum(["lost"]),
        counts: Object.fromEntries(rows.reduce((m, r) => m.set(r.status, (m.get(r.status) || 0) + r.n), new Map())),
        by_status: rows,
      };
    },

    /** People tasks can be given to. `role` narrows it, for example "manager" for the project-manager dropdown. */
    async team({ role } = {}) {
      return (await staff()).filter((u) => (role ? u.role === role : roles.permissionsOf(u.role).includes("projects:read"))).map(person);
    },

    async assign(actor, tenderId, body) {
      const tender = await tenders.get("tenders", tenderId); if (!tender) throw notFound("tender not found");
      const title = String(body.title || "").trim();
      if (!title || title.length > 200) throw new ValidationError("give the task a title (up to 200 characters)");
      const assignee = body.assignee && (await users.byId(body.assignee));
      if (!assignee || assignee.status !== "active" || assignee.role !== "manager") throw new ValidationError("choose a project manager from the list");
      const due = body.due ? String(body.due) : null, priority = body.priority || "medium", notes = String(body.notes || "").trim().slice(0, 2000) || null;
      if (due && !DATE.test(due)) throw new ValidationError("due must be a date (YYYY-MM-DD)");
      if (!PRIORITY.includes(priority)) throw new ValidationError(`priority must be one of ${PRIORITY.join(", ")}`);

      // Copy in every general project manager, plus anyone extra the sender chose.
      const all = await staff(), copies = new Set(all.filter((u) => u.role === "general_pm").map((u) => u.id));
      for (const id of Array.isArray(body.cc) ? body.cc : []) {
        const u = all.find((x) => x.id === id);
        if (!u || !roles.permissionsOf(u.role).includes("tenders:read")) throw new ValidationError("one of the people to copy cannot be copied (choose active staff)");
        copies.add(id);
      }
      copies.delete(assignee.id);

      const task = await db.tx(async (t) => {
        const w = tenderWorkRepo(t), row = await w.insertTask({ tender: tender.id, title, assignee: assignee.id, due, priority, notes }, actor.id);
        for (const id of copies) await w.insertCopy(row.id, id);
        return row;
      });
      await audit.log(actor, { action: "assign", entity: "tender_tasks", id: task.id, summary: `"${title}" for ${assignee.name || assignee.email} on ${tender.title}`, changes: { copied: [...copies] } });
      return (await present(await repo.tasks({ tender: tender.id }).then((r) => r.filter((x) => x.id === task.id))))[0];
    },

    async list(actor, { mine, tender, status } = {}) {
      const meId = mine ? actor.id : null;
      return present(await repo.tasks({ tender, status, mine: meId }), meId);
    },

    async update(actor, id, body) {
      const task = await repo.task(id); if (!task) throw notFound("task not found");
      const assigner = can(actor, "tenders:assign");
      if (task.assignee !== actor.id && !assigner) throw new HttpError(403, "only the person it is assigned to, or someone who assigns tasks, can change it");
      const values = {};
      for (const k of ["status", "notes", "due"]) if (k in body) values[k] = body[k] === "" ? null : body[k];
      for (const k of ["title", "priority"]) if (k in body) { if (!assigner) throw new HttpError(403, "only someone who assigns tasks can change the title or priority"); values[k] = body[k]; }
      if ("status" in values && !STATUS.includes(values.status)) throw new ValidationError(`status must be one of ${STATUS.join(", ")}`);
      if ("priority" in values && !PRIORITY.includes(values.priority)) throw new ValidationError(`priority must be one of ${PRIORITY.join(", ")}`);
      if (values.due && !DATE.test(String(values.due))) throw new ValidationError("due must be a date (YYYY-MM-DD)");
      if ("title" in values && !String(values.title || "").trim()) throw new ValidationError("the title cannot be empty");
      const row = await repo.updateTask(id, values);
      const changes = {}; for (const k of Object.keys(values)) if (task[k] !== row[k]) changes[k] = [task[k] ?? null, row[k] ?? null];
      await audit.log(actor, { action: "update", entity: "tender_tasks", id, summary: `${row.title}: ${Object.keys(changes).join(", ") || "no change"}`, changes });
      return (await present((await repo.tasks({ tender: row.tender })).filter((x) => x.id === id)))[0];
    },

    async remove(actor, id) {
      const task = await repo.task(id); if (!task) throw notFound("task not found");
      await repo.removeTask(id);
      await audit.log(actor, { action: "delete", entity: "tender_tasks", id, summary: task.title, changes: task });
    },
  };
}
