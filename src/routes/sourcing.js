export default function sourcingRoutes(r, { sourcing }) {
  r.get("/api/sourcing", { perm: "catalog:read" }, () => sourcing.overview());
  r.get("/api/structures", { perm: "catalog:read" }, () => sourcing.structures());
  r.post("/api/quantities", { perm: "catalog:read" }, async (c) => sourcing.quote(await c.json()));
}
