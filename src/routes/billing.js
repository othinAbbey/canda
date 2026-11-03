export default function billingRoutes(r, { billing }) {
  r.get("/api/billing", { perm: "billing:read" }, (c) => billing.overview(c.user));
  r.post("/api/billing/checkout", { perm: "billing:read" }, () => billing.checkout());   // placeholder: 501 until payments exist
}
