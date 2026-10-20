import { PROJECT_TABLES } from "../domain/resources.js";
import { assessHealth } from "../domain/health.js";
import { notFound } from "../errors.js";

const DAY = 86400000;
const ms = (s) => (s ? Date.parse(s + "T00:00:00Z") : NaN);
const pct = (n) => Math.round(n * 10) / 10;
const daysBefore = (date, n) => new Date(ms(date) - n * DAY).toISOString().slice(0, 10);

/** Everything a project manager wants on one page. SQL lives in repos/projectStats.js; the arithmetic is here. */
export function createSummary({ resources, stats, audit, files }) {
  async function project(id, today = new Date().toISOString().slice(0, 10)) {
    const p = await resources.get("projects", id).catch(() => null);
    if (!p) throw notFound();

    const tasks = { todo: 0, doing: 0, done: 0 };
    for (const r of await stats.taskCounts(id)) tasks[r.status] = r.n;
    const total = tasks.todo + tasks.doing + tasks.done;
    const overdue = await stats.overdueTasks(id, today);
    const ratio = total ? tasks.done / total : null;
    const progress = total ? pct(ratio * 100) : null;

    let elapsed = null, daysLeft = null;
    if (p.start && p.end && ms(p.end) > ms(p.start)) {
      elapsed = pct(Math.min(100, Math.max(0, ((ms(today) - ms(p.start)) / (ms(p.end) - ms(p.start))) * 100)));
      daysLeft = Math.round((ms(p.end) - ms(today)) / DAY);
    }

    const budget = p.budget ?? 0, spent = await stats.spent(id);
    const forecast = ratio && budget ? Math.round(spent / ratio) : null;     // unrounded ratio
    const logs = await stats.logs(id), file = await stats.files(id);
    const open = await stats.openIssues(id);
    const issues = {
      open: open.length, high: open.filter((i) => i.severity === "high").length, overdue: open.filter((i) => i.due && i.due < today).length,
      by_type: Object.entries(open.reduce((m, i) => { const k = i.type || "Other"; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([type, n]) => ({ type, n })),
    };

    const { health, reasons } = assessHealth({
      budget, spent, end: p.end, status: p.status, today, openTasks: total - tasks.done, overdueTasks: overdue, highIssues: issues.high,
      overdueIssues: issues.overdue, elapsed, progress, forecast, recentSafety: await stats.recentSafety(id, daysBefore(today, 14)),
    });

    return {
      project: p, health, reasons,
      schedule: { elapsed_pct: elapsed, days_left: daysLeft, progress_pct: progress, behind_pct: elapsed !== null && progress !== null ? pct(elapsed - progress) : null },
      tasks: { ...tasks, total, overdue },
      budget: { budget, spent, remaining: budget - spent, used_pct: budget ? pct((spent / budget) * 100) : null, forecast, by_category: await stats.byCategory(id) },
      site_logs: { count: logs.n, last_date: logs.last_date, worker_days: logs.worker_days, delays: logs.delays, safety_incidents: logs.safety },
      issues, files: { n: file.n, bytes: file.bytes }, upcoming: await stats.upcoming(id), activity: await audit.recentForProject(id),
    };
  }

  async function portfolio(today) {
    const projects = [];
    for (const { id } of await stats.projectIds()) {
      const s = await project(id, today);
      projects.push({ id, name: s.project.name, status: s.project.status, health: s.health, progress: s.schedule.progress_pct,
        budget: s.budget.budget, spent: s.budget.spent, overdue_tasks: s.tasks.overdue, open_issues: s.issues.open });
    }
    const health = { green: 0, amber: 0, red: 0 };
    for (const p of projects) health[p.health]++;
    return { projects, totals: { projects: projects.length, health, budget: projects.reduce((n, p) => n + p.budget, 0), spent: projects.reduce((n, p) => n + p.spent, 0) } };
  }

  /** All project tables in one call (what the project pages load). */
  const data = async () => Object.fromEntries(await Promise.all(PROJECT_TABLES.map(async (t) => [t, await resources.list(t)])));
  return { project, portfolio, data };
}
