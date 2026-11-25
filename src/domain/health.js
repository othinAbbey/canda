/**
 * Project health rules. Pure function: facts in, verdict out. Easy to read, easy to port.
 * red = act now, amber = look at it, green = nothing to flag. The reasons are shown to the user.
 */
export function assessHealth(f) {
  const red = [], amber = [];
  if (f.budget && f.spent > f.budget) red.push("Spending is over budget");
  if (f.end && f.end < f.today && f.status !== "complete" && f.openTasks > 0) red.push("Past the planned finish date with open tasks");
  if (f.highIssues >= 3) red.push(`${f.highIssues} high-severity issues are open`);
  if (f.overdueTasks > 0) amber.push(`${f.overdueTasks} overdue task${f.overdueTasks > 1 ? "s" : ""}`);
  if (f.budget && f.spent / f.budget > 0.9 && f.spent <= f.budget) amber.push("Over 90% of the budget is used");
  if (f.forecast && f.forecast > f.budget && f.spent <= f.budget) amber.push("Forecast cost is above budget");
  if (f.elapsed !== null && f.progress !== null && f.elapsed - f.progress > 15) amber.push("Progress is behind the time elapsed");
  if (f.highIssues >= 1 && f.highIssues < 3) amber.push("A high-severity issue is open");
  if (f.overdueIssues > 0) amber.push(`${f.overdueIssues} issue${f.overdueIssues > 1 ? "s" : ""} past response date`);
  if (f.recentSafety > 0) amber.push("Safety incident logged in the last 14 days");
  return { health: red.length ? "red" : amber.length ? "amber" : "green", reasons: [...red, ...amber] };
}
