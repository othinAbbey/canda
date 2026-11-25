import { can } from "../auth/permissions.js";
import { HttpError, ValidationError, notFound } from "../errors.js";
import { resourcesRepo } from "../repos/resources.js";
import { tenderWorkRepo } from "../repos/tenderWork.js";
import { usersRepo } from "../repos/users.js";

const OPEN = ["saved", "interested", "bidding", "submitted"];       // stages that still count as "in the pipeline"
const PRIORITY = ["low", "medium", "high"], STATUS = ["todo", "doing", "done"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Where a bid stands, in order. Labels are for screens and the audit trail. */
export const STAGES = [["not_started", "Not started"], ["documents", "Getting the bid documents"], ["site_visit", "Site visit / pre-bid meeting"],
  ["preparing", "Preparing documents"], ["pricing", "Pricing the BOQ"], ["review", "Internal review"], ["submitted", "Bid submitted"]];
const STAGE_KEYS = STAGES.map(([k]) => k), STAGE_NAME = Object.fromEntries(STAGES);
const today = () => new Date().toISOString().slice(0, 10);

/** Pipeline totals, the list of people tasks can go to, and tender tasks with copies. */
export function createTenderWork({ db, roles, audit, bids }) {
  const tenders = resourcesRepo(db), repo = tenderWorkRepo(db), users = usersRepo(db);
  const staff = async (actor) => (await users.list(actor.organization_id)).filter((u) => u.status === "active");   // own company only
  const person = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, role_name: roles.nameOf(u.role) });

  /** Adds copies, progress (requirements ticked off) and the latest progress note to each task. */
  async function present(rows, meId) {
    const ids = rows.map((r) => r.id);
    const [copies, counts, notes] = await Promise.all([repo.copiesFor(ids), bids.countsFor([...new Set(rows.map((r) => r.tender))]), repo.lastUpdates(ids)]);
    return rows.map((t) => {
      // the checklist belongs to the tender, so every task on a tender shows the same requirements
      const n = (st) => Number(counts.find((c) => c.tender === t.tender && c.status === st)?.n || 0);
      const done = n("done"), total = done + n("pending");                    // "not applicable" items do not count
      const last = notes.filter((x) => x.task === t.id).sort((a, b) => String(b.created).localeCompare(String(a.created)))[0];
      return {
        ...t, copies: copies.filter((c) => c.task === t.id).map((c) => ({ id: c.user_id, name: c.name, email: c.email })),
        relation: meId ? (t.assignee === meId ? "assigned" : "copied") : undefined,
        stage_name: t.stage ? STAGE_NAME[t.stage] : null,
        requirements: { total, done, na: n("na") },
        progress: t.status === "done" ? 100 : total ? Math.round((done / total) * 100) : null,
        overdue: !!(t.due && t.status !== "done" && String(t.due).slice(0, 10) < today()),
        last_update: last ? { body: last.body, created: last.created, by: last.by_name || last.by_email } : null,
      };
    });
  }
  const one = async (actor, id) => (await present((await repo.tasks({ organizationId: actor.organization_id })).filter((x) => x.id === id)))[0];

  /** Who may see and who may work on a task. Directors and admins (tasks:oversee) see every task in the company. */
  async function access(actor, id) {
    const task = await repo.task(id, actor.organization_id); if (!task) throw notFound("task not found");
    const copied = (await repo.copiesFor([id])).some((c) => c.user_id === actor.id);
    const edit = task.assignee === actor.id || can(actor, "tenders:assign");
    if (!edit && !copied && !can(actor, "tasks:oversee")) throw notFound("task not found");
    return { task, edit };
  }
  const mustEdit = (a) => { if (!a.edit) throw new HttpError(403, "only the person the task is assigned to, or someone who assigns tasks, can change its progress"); };

  return {
    /** Value of the pipeline per currency. Currencies are never mixed: UGX is shown on its own. */
    async summary(actor) {
      const rows = await repo.summary(actor.organization_id), sum = (statuses) => {
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
    async team(actor, { role } = {}) {
      return (await staff(actor)).filter((u) => (role ? u.role === role : roles.permissionsOf(u.role).includes("projects:read"))).map(person);
    },

    async assign(actor, tenderId, body) {
      const tender = await tenders.get("tenders", tenderId, actor.organization_id); if (!tender) throw notFound("tender not found");
      const title = String(body.title || "").trim();
      if (!title || title.length > 200) throw new ValidationError("give the task a title (up to 200 characters)");
      const assignee = body.assignee && (await users.byId(body.assignee));
      if (!assignee || assignee.organization_id !== actor.organization_id || assignee.status !== "active" || assignee.role !== "manager") throw new ValidationError("choose a project manager from the list");
      const due = body.due ? String(body.due) : null, priority = body.priority || "medium", notes = String(body.notes || "").trim().slice(0, 2000) || null;
      if (due && !DATE.test(due)) throw new ValidationError("due must be a date (YYYY-MM-DD)");
      if (!PRIORITY.includes(priority)) throw new ValidationError(`priority must be one of ${PRIORITY.join(", ")}`);

      // Copy in every general project manager, plus anyone extra the sender chose.
      const all = await staff(actor), copies = new Set(all.filter((u) => u.role === "general_pm").map((u) => u.id));
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
      return (await present(await repo.tasks({ organizationId: actor.organization_id, tender: tender.id }).then((r) => r.filter((x) => x.id === task.id))))[0];
    },

    async list(actor, { mine, tender, status } = {}) {
      const meId = mine ? actor.id : null;
      return present(await repo.tasks({ organizationId: actor.organization_id, tender, status, mine: meId }), meId);
    },

    async update(actor, id, body) {
      const task = await repo.task(id, actor.organization_id); if (!task) throw notFound("task not found");
      const assigner = can(actor, "tenders:assign");
      if (task.assignee !== actor.id && !assigner) throw new HttpError(403, "only the person it is assigned to, or someone who assigns tasks, can change it");
      const values = {};
      for (const k of ["status", "notes", "due", "stage"]) if (k in body) values[k] = body[k] === "" ? null : body[k];
      for (const k of ["title", "priority"]) if (k in body) { if (!assigner) throw new HttpError(403, "only someone who assigns tasks can change the title or priority"); values[k] = body[k]; }
      if ("status" in values && !STATUS.includes(values.status)) throw new ValidationError(`status must be one of ${STATUS.join(", ")}`);
      if ("stage" in values && values.stage !== null && !STAGE_KEYS.includes(values.stage)) throw new ValidationError(`stage must be one of ${STAGE_KEYS.join(", ")}`);
      if ("priority" in values && !PRIORITY.includes(values.priority)) throw new ValidationError(`priority must be one of ${PRIORITY.join(", ")}`);
      if (values.due && !DATE.test(String(values.due))) throw new ValidationError("due must be a date (YYYY-MM-DD)");
      if ("title" in values && !String(values.title || "").trim()) throw new ValidationError("the title cannot be empty");
      const row = await repo.updateTask(id, values);
      const changes = {}; for (const k of Object.keys(values)) if (task[k] !== row[k]) changes[k] = [task[k] ?? null, row[k] ?? null];
      if (changes.stage && row.stage) await repo.insertUpdate({ task: id, body: `Moved to: ${STAGE_NAME[row.stage]}`, stage: row.stage }, actor.id);
      await audit.log(actor, { action: "update", entity: "tender_tasks", id, summary: `${row.title}: ${Object.keys(changes).join(", ") || "no change"}`, changes });
      return one(actor, id);
    },

    stages: () => STAGES.map(([id, name]) => ({ id, name })),

    /** One task with its requirements checklist and progress notes. */
    async detail(actor, id) {
      const a = await access(actor, id);
      const [task, requirements, updates] = await Promise.all([one(actor, id), bids.checklist(a.task.tender), repo.updates(id)]);
      return { ...task, can_edit: a.edit, checklist: requirements, updates };
    },

    /** Every tender task in the company with its progress, and how each person is doing (Company Tasks page). */
    async company(actor, { assignee, status, stage } = {}) {
      let rows = await present(await repo.tasks({ organizationId: actor.organization_id, status: status || undefined }));
      if (assignee) rows = rows.filter((t) => t.assignee === assignee);
      if (stage) rows = rows.filter((t) => (t.stage || "not_started") === stage);
      const open = rows.filter((t) => t.status !== "done");
      const people = new Map();
      for (const t of rows) {
        const p = people.get(t.assignee) || { id: t.assignee, name: t.assignee_name || t.assignee_email, total: 0, open: 0, done: 0, overdue: 0, progress_sum: 0, progress_n: 0 };
        p.total++; if (t.status === "done") p.done++; else p.open++; if (t.overdue) p.overdue++;
        if (t.status !== "done" && t.progress !== null) { p.progress_sum += t.progress; p.progress_n++; }
        people.set(t.assignee, p);
      }
      const avg = (list) => { const xs = list.filter((t) => t.progress !== null).map((t) => t.progress); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null; };
      const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      return {
        totals: { tasks: rows.length, open: open.length, done: rows.length - open.length, overdue: open.filter((t) => t.overdue).length,
          due_this_week: open.filter((t) => t.due && !t.overdue && String(t.due).slice(0, 10) <= week).length, average_progress: avg(open) },
        people: [...people.values()].map(({ progress_sum, progress_n, ...p }) => ({ ...p, average_progress: progress_n ? Math.round(progress_sum / progress_n) : null }))
          .sort((a, b) => b.overdue - a.overdue || b.open - a.open || String(a.name).localeCompare(String(b.name))),
        tasks: rows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.status === "done") - (b.status === "done") || String(a.due || "9999").localeCompare(String(b.due || "9999"))),
        stages: STAGES.map(([id, name]) => ({ id, name })),
      };
    },

    // The checklist lives on the tender (services/bids.js). These keep the task-based addresses working.
    async addRequirements(actor, id, body) { const a = await access(actor, id); mustEdit(a); await bids.addRequirements(actor, a.task.tender, body); return this.detail(actor, id); },
    async readRequirements(actor, id, body) { const a = await access(actor, id); mustEdit(a); return bids.readText(actor, a.task.tender, body); },

    /** A progress note, optionally moving the bid to another stage. */
    async postUpdate(actor, id, body) {
      const a = await access(actor, id); mustEdit(a);
      const text = String(body.body || "").trim(), stage = body.stage || null;
      if (!text && !stage) throw new ValidationError("write what has happened");
      if (text.length > 2000) throw new ValidationError("keep the note under 2000 characters");
      if (stage && !STAGE_KEYS.includes(stage)) throw new ValidationError(`stage must be one of ${STAGE_KEYS.join(", ")}`);
      const moved = stage && stage !== a.task.stage;
      await db.tx(async (t) => {
        const w = tenderWorkRepo(t);
        if (moved) await w.updateTask(id, { stage, ...(a.task.status === "todo" ? { status: "doing" } : {}) });
        await w.insertUpdate({ task: id, body: [moved ? `Moved to: ${STAGE_NAME[stage]}.` : "", text].filter(Boolean).join(" "), stage: moved ? stage : null }, actor.id);
      });
      await audit.log(actor, { action: "update", entity: "tender_tasks", id, summary: `${a.task.title}: progress note${moved ? ` (${STAGE_NAME[stage]})` : ""}` });
      return this.detail(actor, id);
    },

    async remove(actor, id) {
      const task = await repo.task(id, actor.organization_id); if (!task) throw notFound("task not found");
      await repo.removeTask(id);
      await audit.log(actor, { action: "delete", entity: "tender_tasks", id, summary: task.title, changes: task });
    },
  };
}
