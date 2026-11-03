/**
 * Project scheduling (critical path method). Pure functions: tasks and links in, dates out. No database, no network.
 *
 * Rules, as in MS Project:
 *  - Dates move in WORKING days (the project's work week: mon-fri, mon-sat or all).
 *  - A task's `start` is a "start no earlier than" constraint. Links can only push it later, never earlier.
 *  - Link types: FS finish-to-start, SS start-to-start, FF finish-to-finish, SF start-to-finish, each with a lag (negative = overlap).
 *  - A task that has children is a summary task: its dates and percent are rolled up from them and it takes no links.
 *  - Float = working days a task can slip without delaying the project. Zero float = on the critical path.
 */
const DAY = 86400000;
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const addCal = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);

export const WORKWEEKS = { "mon-fri": [1, 2, 3, 4, 5], "mon-sat": [1, 2, 3, 4, 5, 6], all: [0, 1, 2, 3, 4, 5, 6] };
export const LINK_TYPES = ["FS", "SS", "FF", "SF"];

/** Working-day arithmetic. All dates are "YYYY-MM-DD" strings. */
export function makeCalendar(workweek = "mon-sat") {
  const days = new Set(WORKWEEKS[workweek] || WORKWEEKS["mon-sat"]);
  const isWork = (d) => days.has(new Date(ms(d)).getUTCDay());
  const next = (d) => { while (!isWork(d)) d = addCal(d, 1); return d; };       // this day, or the next working day
  const prev = (d) => { while (!isWork(d)) d = addCal(d, -1); return d; };      // this day, or the previous working day
  /** Move n working days (negative = back). Starts from the nearest working day. */
  const add = (d, n) => {
    let cur = n >= 0 ? next(d) : prev(d), left = Math.abs(n);
    while (left > 0) { cur = addCal(cur, n >= 0 ? 1 : -1); if (isWork(cur)) left--; }
    return cur;
  };
  /** Working days from a to b (positive when b is later). */
  const between = (a, b) => {
    if (a === b) return 0;
    const [x, y] = a < b ? [a, b] : [b, a];
    let n = 0, cur = x;
    while (cur < y) { cur = addCal(cur, 1); if (isWork(cur)) n++; }
    return a < b ? n : -n;
  };
  return { isWork, next, prev, add, between };
}

/** Would adding predecessor -> successor create a loop? (Is there already a path successor -> ... -> predecessor?) */
export function wouldCreateCycle(links, predecessor, successor) {
  const out = new Map();
  for (const l of links) { if (!out.has(l.predecessor)) out.set(l.predecessor, []); out.get(l.predecessor).push(l.successor); }
  const seen = new Set(), stack = [successor];
  while (stack.length) {
    const id = stack.pop();
    if (id === predecessor) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(out.get(id) || []));
  }
  return false;
}

export function computeSchedule({ tasks, links = [], projectStart = null, today, workweek = "mon-sat" }) {
  const cal = makeCalendar(workweek), warnings = [];
  const base = cal.next(projectStart || today);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // ---- hierarchy ------------------------------------------------------------------------------------
  const parentOf = new Map();
  for (const t of tasks) {
    if (!t.parent || !byId.has(t.parent) || t.parent === t.id) continue;
    let up = t.parent, loop = false;
    for (let guard = 0; up && guard <= tasks.length; guard++) { if (up === t.id) { loop = true; break; } up = byId.get(up)?.parent; }
    if (loop) warnings.push(`"${t.title}" is inside itself; its parent was ignored`); else parentOf.set(t.id, t.parent);
  }
  const children = new Map();
  for (const [child, parent] of parentOf) { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(child); }
  const isSummary = (id) => children.has(id);

  // ---- leaf tasks: durations and links ----------------------------------------------------------------
  const leaves = tasks.filter((t) => !isSummary(t.id));
  const dur = (t) => {
    if (t.milestone) return 0;
    if (Number.isInteger(t.duration) && t.duration >= 1) return t.duration;
    if (t.start && t.due && t.due >= t.start) return cal.between(cal.next(t.start), cal.prev(t.due)) + 1;
    return 1;
  };
  const leafIds = new Set(leaves.map((t) => t.id));
  const good = [], into = new Map(), outOf = new Map();
  for (const l of links) {
    if (!leafIds.has(l.predecessor) || !leafIds.has(l.successor) || l.predecessor === l.successor || !LINK_TYPES.includes(l.type)) {
      if (byId.has(l.predecessor) && byId.has(l.successor)) warnings.push("A link to a summary task was ignored; link its sub-tasks instead");
      continue;
    }
    good.push(l);
    if (!into.has(l.successor)) into.set(l.successor, []);
    if (!outOf.has(l.predecessor)) outOf.set(l.predecessor, []);
    into.get(l.successor).push(l); outOf.get(l.predecessor).push(l);
  }

  // topological order (Kahn). Anything left over is part of a loop.
  const indeg = new Map(leaves.map((t) => [t.id, (into.get(t.id) || []).length]));
  const order = [], queue = leaves.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    for (const l of outOf.get(id) || []) { indeg.set(l.successor, indeg.get(l.successor) - 1); if (indeg.get(l.successor) === 0) queue.push(l.successor); }
  }
  const stuck = leaves.filter((t) => !order.includes(t.id));
  if (stuck.length) warnings.push(`Circular links between: ${stuck.map((t) => `"${t.title}"`).join(", ")}. Their links were ignored.`);
  for (const t of stuck) order.push(t.id);
  const usable = (l) => !stuck.some((s) => s.id === l.predecessor || s.id === l.successor);

  // ---- forward pass: earliest dates -----------------------------------------------------------------
  const S = new Map();
  for (const id of order) {
    const t = byId.get(id), d = dur(t), span = Math.max(d, 1) - 1;
    let es = t.start ? cal.next(t.start) : base;
    for (const l of (into.get(id) || []).filter(usable)) {
      const p = S.get(l.predecessor), lag = l.lag || 0;
      const c = l.type === "FS" ? cal.add(p.ef, 1 + lag)
        : l.type === "SS" ? cal.add(p.es, lag)
        : l.type === "FF" ? cal.add(cal.add(p.ef, lag), -span)
        : cal.add(cal.add(p.es, lag), -span);
      if (c > es) es = c;
    }
    es = cal.next(es);
    S.set(id, { d, es, ef: d === 0 ? es : cal.add(es, d - 1) });
  }
  const finish = leaves.reduce((m, t) => (S.get(t.id).ef > m ? S.get(t.id).ef : m), base);

  // ---- backward pass: latest dates and float -----------------------------------------------------------
  for (const id of [...order].reverse()) {
    const s = S.get(id), span = Math.max(s.d, 1) - 1;
    let lf = finish;
    for (const l of (outOf.get(id) || []).filter(usable)) {
      const q = S.get(l.successor), lag = l.lag || 0;
      const cand = l.type === "FS" ? cal.add(q.ls, -(1 + lag))
        : l.type === "FF" ? cal.add(q.lf, -lag)
        : l.type === "SS" ? (s.d === 0 ? cal.add(q.ls, -lag) : cal.add(cal.add(q.ls, -lag), span))
        : (s.d === 0 ? cal.add(q.lf, -lag) : cal.add(cal.add(q.lf, -lag), span));
      if (cand < lf) lf = cand;
    }
    s.lf = lf; s.ls = s.d === 0 ? lf : cal.add(lf, -span);
    s.float = Math.max(0, cal.between(s.es, s.ls));
  }

  // ---- summary tasks roll up from their children ---------------------------------------------------------
  const R = new Map();
  for (const t of leaves) {
    const s = S.get(t.id);
    R.set(t.id, { start: s.es, finish: s.ef, duration: s.d, float: s.float, late_start: s.ls, late_finish: s.lf, weight: Math.max(s.d, 0), pct: t.percent || 0, critical: s.float === 0 && (t.percent || 0) < 100 });
  }
  const roll = (id) => {
    if (R.has(id)) return R.get(id);
    const kids = (children.get(id) || []).map(roll);
    const start = kids.reduce((m, k) => (k.start < m ? k.start : m), kids[0].start), end = kids.reduce((m, k) => (k.finish > m ? k.finish : m), kids[0].finish);
    const w = kids.reduce((n, k) => n + k.weight, 0);
    const r = { start, finish: end, duration: cal.between(start, end) + 1, float: Math.min(...kids.map((k) => k.float)), late_start: null, late_finish: null,
      weight: w, pct: w ? kids.reduce((n, k) => n + k.pct * k.weight, 0) / w : kids.reduce((n, k) => n + k.pct, 0) / kids.length, critical: kids.some((k) => k.critical) };
    R.set(id, r); return r;
  };
  for (const t of tasks) roll(t.id);

  // ---- output in outline order with WBS numbers -------------------------------------------------------------
  const sort = (ids) => [...ids].sort((a, b) => (byId.get(a).sort_order || 0) - (byId.get(b).sort_order || 0) || tasks.indexOf(byId.get(a)) - tasks.indexOf(byId.get(b)));
  const out = [];
  const walk = (ids, prefix, level) => sort(ids).forEach((id, i) => {
    const t = byId.get(id), r = R.get(id), wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    out.push({
      ...t, wbs, level, summary: isSummary(id), scheduled_start: r.start, scheduled_finish: r.finish, duration: r.duration,
      percent_complete: Math.round(r.pct), float: r.float, critical: r.critical, late_start: r.late_start, late_finish: r.late_finish,
      differs: !isSummary(id) && (t.start !== r.start || t.due !== r.finish),
      finish_variance: t.baseline_end ? cal.between(t.baseline_end, r.finish) : null,
      start_variance: t.baseline_start ? cal.between(t.baseline_start, r.start) : null,
    });
    if (isSummary(id)) walk(children.get(id), wbs, level + 1);
  });
  walk(tasks.filter((t) => !parentOf.has(t.id)).map((t) => t.id), "", 0);

  const starts = out.map((t) => t.scheduled_start), ends = out.map((t) => t.scheduled_finish);
  return {
    tasks: out, links: good.filter(usable), warnings,
    project: { start: out.length ? starts.reduce((a, b) => (a < b ? a : b)) : base, finish: out.length ? ends.reduce((a, b) => (a > b ? a : b)) : base,
      working_days: out.length ? cal.between(starts.reduce((a, b) => (a < b ? a : b)), ends.reduce((a, b) => (a > b ? a : b))) + 1 : 0,
      critical_tasks: out.filter((t) => t.critical && !t.summary).length },
  };
}
