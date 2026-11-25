export default function summaryRoutes(r, { summary }) {
  r.get("/api/summary", { perm: "projects:read" }, (c) => summary.portfolio(c.user));
  r.get("/api/projects/:id/summary", { perm: "projects:read" }, (c) => summary.project(c.user, c.params.id));
}
