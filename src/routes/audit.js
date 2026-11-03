export default function auditRoutes(r, { audit }) {
  r.get("/api/audit", { perm: "audit:read" }, (c) => audit.list(c.query));
}
