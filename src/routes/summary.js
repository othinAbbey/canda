export default function summaryRoutes(r, { summary }) {
  r.get("/api/summary", { perm: "projects:read" }, () => summary.portfolio());
  r.get("/api/projects/:id/summary", { perm: "projects:read" }, (c) => summary.project(c.params.id));
}
