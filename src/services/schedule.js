import { HttpError, ValidationError, notFound } from "../errors.js";
import { LINK_TYPES, computeSchedule, wouldCreateCycle } from "../domain/schedule.js";
import { resourcesRepo } from "../repos/resources.js";
import { scheduleRepo } from "../repos/schedule.js";

const whole = (v, name, min, max) => { if (!Number.isInteger(v) || v < min || v > max) throw new ValidationError(`${name} must be a whole number from ${min} to ${max}`); };

/** The project schedule: dependencies, critical path, "apply dates", baselines. The maths is in domain/schedule.js. */
export function createSchedule({ db, audit }) {
  const rows = resourcesRepo(db), repo = scheduleRepo(db);
  const must = async (table, id, what) => { const r = id ? await rows.get(table, id) : null; if (!r) throw notFound(what || "not found"); return r; };

  async function compute(projectId, today = new Date().toISOString().slice(0, 10)) {
    const project = await must("projects", projectId, "project not found");
    const tasks = await rows.list("tasks", { project: projectId });
    return { project, ...computeSchedule({ tasks, links: await repo.links(projectId), projectStart: project.start, today, workweek: project.workweek }) };
  }

  async function linkValues(body, project, existing = null) {
    const type = String(body.type ?? existing?.type ?? "FS").toUpperCase(), lag = body.lag === undefined || body.lag === "" || body.lag === null ? (existing?.lag ?? 0) : Number(body.lag);
    if (!LINK_TYPES.includes(type)) throw new ValidationError(`type must be one of ${LINK_TYPES.join(", ")}`);
    whole(lag, "lag", -365, 365);
    return { type, lag };
  }

  return {
    compute,
    async get(projectId, today) { const s = await compute(projectId, today); return { project: s.project, ...s }; },

    // ---- dependencies ----
    async addLink(actor, body) {
      const pred = await must("tasks", body.predecessor, "the first task does not exist"), succ = await must("tasks", body.successor, "the second task does not exist");
      if (pred.id === succ.id) throw new ValidationError("a task cannot depend on itself");
      if (pred.project !== succ.project) throw new ValidationError("both tasks must be in the same project");
      const existing = await repo.links(pred.project);
      if (existing.some((l) => l.predecessor === pred.id && l.successor === succ.id)) throw new HttpError(409, "those two tasks are already linked");
      if (wouldCreateCycle(existing, pred.id, succ.id)) throw new ValidationError("that link would create a loop (the first task already depends on the second)");
      const link = await repo.insertLink({ project: pred.project, predecessor: pred.id, successor: succ.id, ...(await linkValues(body, pred.project)) }, actor.id);
      await audit.log(actor, { action: "create", entity: "task_links", id: link.id, project: pred.project, summary: `${pred.title} -> ${succ.title} (${link.type}${link.lag ? ` ${link.lag > 0 ? "+" : ""}${link.lag}d` : ""})` });
      return link;
    },
    async updateLink(actor, id, body) {
      const before = await repo.link(id);
      if (!before) throw notFound("link not found");
      const link = await repo.updateLink(id, await linkValues(body, before.project, before));
      await audit.log(actor, { action: "update", entity: "task_links", id, project: before.project, summary: `${link.type} ${link.lag}`, changes: { type: [before.type, link.type], lag: [before.lag, link.lag] } });
      return link;
    },
    async removeLink(actor, id) {
      const link = await repo.removeLink(id); if (!link) throw notFound("link not found");
      await audit.log(actor, { action: "delete", entity: "task_links", id, project: link.project, summary: "link removed", changes: link });
    },

    // ---- like MS Project's "auto schedule" and "set baseline" ----
    /** Writes the computed start and finish dates into the tasks (so saved dates match the dependencies). */
    async apply(actor, projectId) {
      const s = await compute(projectId); let moved = 0;
      for (const t of s.tasks) if (!t.summary && t.differs) { await repo.setDates(t.id, { start: t.scheduled_start, due: t.scheduled_finish, duration: t.duration }); moved++; }
      await audit.log(actor, { action: "schedule", entity: "projects", id: projectId, project: projectId, summary: `applied the schedule: ${moved} task${moved === 1 ? "" : "s"} updated` });
      return { moved, ...(await this.get(projectId)) };
    },
    /** Saves today's schedule as the baseline to compare against later (or clears it). */
    async baseline(actor, projectId, { clear = false } = {}) {
      const s = await compute(projectId);
      for (const t of s.tasks) await repo.setBaseline(t.id, clear ? null : t.scheduled_start, clear ? null : t.scheduled_finish);
      await audit.log(actor, { action: "baseline", entity: "projects", id: projectId, project: projectId, summary: clear ? "baseline cleared" : `baseline saved for ${s.tasks.length} tasks` });
      return this.get(projectId);
    },

    /** Check run before a task is created or changed (see services/resources.js hooks). */
    async checkTask(values, existing) {
      const project = values.project ?? existing?.project;
      if (values.parent) {
        if (existing && values.parent === existing.id) throw new ValidationError("a task cannot be its own parent");
        const parent = await rows.get("tasks", values.parent);
        if (!parent || parent.project !== project) throw new ValidationError("the parent must be a task in the same project");
        for (let up = parent, guard = 0; existing && up && guard < 100; guard++) {
          if (up.id === existing.id) throw new ValidationError("that would put the task inside itself");
          up = up.parent ? await rows.get("tasks", up.parent) : null;
        }
      }
      if (values.percent != null) whole(values.percent, "percent", 0, 100);
      if (values.duration != null) whole(values.duration, "duration", 0, 3650);
      if (values.milestone != null && ![0, 1].includes(values.milestone)) throw new ValidationError("milestone must be 0 or 1");
      if (values.sort_order != null) whole(values.sort_order, "sort_order", -1000000, 1000000);
      if (values.workweek === null) delete values.workweek;                                   // blank means "leave as is"

      // keep status and percent complete in step, as MS Project does
      const was = existing?.status || "todo";
      if ("percent" in values && values.percent !== null && !("status" in values)) values.status = values.percent >= 100 ? "done" : values.percent > 0 ? "doing" : was === "done" ? "todo" : was;
      if ("status" in values && !("percent" in values)) {
        if (values.status === "done") values.percent = 100;
        else if (values.status === "todo" && (existing?.percent ?? 0) === 100) values.percent = 0;
      }
    },
  };
}
