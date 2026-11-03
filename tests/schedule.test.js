import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSchedule, makeCalendar, wouldCreateCycle } from "../src/domain/schedule.js";

// 2026-01-05 is a Monday.
const MON = "2026-01-05";
const t = (id, extra = {}) => ({ id, title: id, ...extra });
const run = (tasks, links = [], extra = {}) => { const r = computeSchedule({ tasks, links, projectStart: MON, today: MON, workweek: "mon-fri", ...extra }); return { ...r, by: Object.fromEntries(r.tasks.map((x) => [x.id, x])) }; };
const link = (predecessor, successor, type = "FS", lag = 0) => ({ predecessor, successor, type, lag });

describe("working calendar", () => {
  it("skips weekends and counts working days", () => {
    const c = makeCalendar("mon-fri");
    assert.equal(c.add("2026-01-09", 1), "2026-01-12");       // Fri + 1 = Mon
    assert.equal(c.add("2026-01-10", 0), "2026-01-12");       // Saturday snaps forward
    assert.equal(c.add("2026-01-12", -1), "2026-01-09");
    assert.equal(c.between("2026-01-05", "2026-01-12"), 5);
    assert.equal(c.between("2026-01-12", "2026-01-05"), -5);
    assert.equal(makeCalendar("mon-sat").add("2026-01-09", 1), "2026-01-10");   // Saturdays count in a 6-day week
    assert.equal(makeCalendar("all").add("2026-01-09", 2), "2026-01-11");
  });
});

describe("links and the forward pass", () => {
  it("finish-to-start chain; weekends are skipped", () => {
    const { by, project } = run([t("A", { duration: 5 }), t("B", { duration: 2 })], [link("A", "B")]);
    assert.deepEqual([by.A.scheduled_start, by.A.scheduled_finish], ["2026-01-05", "2026-01-09"]);
    assert.deepEqual([by.B.scheduled_start, by.B.scheduled_finish], ["2026-01-12", "2026-01-13"]);
    assert.equal(project.finish, "2026-01-13"); assert.equal(project.start, MON);
  });
  it("positive lag delays, negative lag overlaps", () => {
    const base = [t("A", { duration: 3 }), t("B", { duration: 2 })];                 // A: Mon 5 - Wed 7
    assert.equal(run(base, [link("A", "B", "FS", 2)]).by.B.scheduled_start, "2026-01-12");
    assert.equal(run(base, [link("A", "B", "FS", -1)]).by.B.scheduled_start, "2026-01-07");
    assert.equal(run(base, [link("A", "B", "FS", 0)]).by.B.scheduled_start, "2026-01-08");
  });
  it("start-to-start, finish-to-finish and start-to-finish", () => {
    const A = t("A", { duration: 5 });                                                // Mon 5 - Fri 9
    assert.equal(run([A, t("C", { duration: 3 })], [link("A", "C", "SS", 1)]).by.C.scheduled_start, "2026-01-06");
    const ff = run([A, t("D", { duration: 2 })], [link("A", "D", "FF")]).by.D;        // must not finish before A: Thu 8 - Fri 9
    assert.deepEqual([ff.scheduled_start, ff.scheduled_finish], ["2026-01-08", "2026-01-09"]);
    const sf = run([A, t("E", { duration: 2 })], [link("A", "E", "SF")]).by.E;         // may not finish before A starts: already true
    assert.equal(sf.scheduled_start, MON);
  });
  it("a start date is a 'no earlier than' constraint; links can only push later", () => {
    const r = run([t("A", { duration: 2, start: "2026-01-12" }), t("B", { duration: 1, start: "2026-01-05" })], [link("A", "B")]);
    assert.equal(r.by.A.scheduled_start, "2026-01-12"); assert.equal(r.by.B.scheduled_start, "2026-01-14");
  });
  it("durations come from start and due when not given; milestones take no time", () => {
    const r = run([t("A", { start: "2026-01-05", due: "2026-01-09" }), t("M", { milestone: 1 })], [link("A", "M")]);
    assert.equal(r.by.A.duration, 5); assert.equal(r.by.M.duration, 0);
    assert.equal(r.by.M.scheduled_start, "2026-01-12"); assert.equal(r.by.M.scheduled_finish, "2026-01-12");
  });
});

describe("critical path and float", () => {
  it("the longest chain is critical; parallel work has float", () => {
    const tasks = [t("A", { duration: 3 }), t("B", { duration: 1 }), t("C", { duration: 1 })];
    const r = run(tasks, [link("A", "C"), link("B", "C")]);
    assert.equal(r.by.A.critical, true); assert.equal(r.by.C.critical, true);
    assert.equal(r.by.B.critical, false); assert.equal(r.by.B.float, 2); assert.equal(r.by.B.late_start, "2026-01-07");
    assert.equal(r.project.critical_tasks, 2);
  });
  it("finished work is not shown as critical", () => {
    assert.equal(run([t("A", { duration: 2, percent: 100 })]).by.A.critical, false);
  });
});

describe("summary tasks, outline and baseline", () => {
  const tasks = [t("P"), t("A", { parent: "P", duration: 2, percent: 100, sort_order: 1 }), t("B", { parent: "P", duration: 2, percent: 0, sort_order: 2 }), t("Z", { duration: 1, sort_order: 5 })];
  it("rolls up dates and percent; numbers the outline", () => {
    const r = run(tasks, [link("A", "B")]);
    assert.equal(r.by.P.summary, true); assert.deepEqual([r.by.P.scheduled_start, r.by.P.scheduled_finish], ["2026-01-05", "2026-01-08"]);
    assert.equal(r.by.P.duration, 4); assert.equal(r.by.P.percent_complete, 50);
    assert.deepEqual(r.tasks.map((x) => `${x.wbs}:${x.id}`), ["1:P", "1.1:A", "1.2:B", "2:Z"]);
    assert.deepEqual(r.tasks.map((x) => x.level), [0, 1, 1, 0]);
  });
  it("ignores links on summary tasks with a warning", () => {
    const r = run(tasks, [link("P", "Z")]);
    assert.ok(r.warnings.some((w) => /summary task/.test(w)));
  });
  it("measures slip against the baseline in working days", () => {
    const r = run([t("A", { duration: 5, baseline_start: "2026-01-05", baseline_end: "2026-01-07" })]);
    assert.equal(r.by.A.finish_variance, 2); assert.equal(r.by.A.start_variance, 0);
  });
  it("flags tasks whose saved dates differ from the schedule", () => {
    const r = run([t("A", { duration: 2, start: "2026-01-05", due: "2026-01-06" }), t("B", { duration: 2, start: "2026-01-05", due: "2026-01-06" })], [link("A", "B")]);
    assert.equal(r.by.A.differs, false); assert.equal(r.by.B.differs, true);
  });
});

describe("bad input does not break the schedule", () => {
  it("circular links are reported and ignored", () => {
    const r = run([t("A", { duration: 1 }), t("B", { duration: 1 }), t("C", { duration: 1 })], [link("A", "B"), link("B", "A")]);
    assert.ok(r.warnings.some((w) => /Circular/.test(w))); assert.equal(r.tasks.length, 3);
  });
  it("a parent loop and links to unknown tasks are tolerated; empty projects work", () => {
    const r = run([t("A", { parent: "B" }), t("B", { parent: "A" })], [link("A", "ghost")]);
    assert.equal(r.tasks.length, 2); assert.ok(r.warnings.length >= 1);
    const empty = run([]); assert.equal(empty.tasks.length, 0); assert.equal(empty.project.working_days, 0);
  });
  it("detects links that would close a loop", () => {
    const links = [link("A", "B"), link("B", "C")];
    assert.equal(wouldCreateCycle(links, "C", "A"), true);
    assert.equal(wouldCreateCycle(links, "A", "C"), false);
    assert.equal(wouldCreateCycle(links, "A", "A"), true);
  });
});
