import accountRoutes from "./accounts.js";
import auditRoutes from "./audit.js";
import billingRoutes from "./billing.js";
import boqRoutes from "./boq.js";
import contactRoutes from "./contact.js";
import fileRoutes from "./files.js";
import proposalRoutes from "./proposals.js";
import resourceRoutes from "./resources.js";
import roleRoutes from "./roles.js";
import scheduleRoutes from "./schedule.js";
import sourcingRoutes from "./sourcing.js";
import summaryRoutes from "./summary.js";
import tenderRoutes from "./tenders.js";

/** One file per area. Routes stay thin: read the request, call one service method, return the result. */
export function registerRoutes(router, svc, ctx) {
  router.get("/api/health", { public: true }, async () => ({ ok: true, setup_required: await svc.accounts.setupRequired() }));
  // Order matters: tenderRoutes must come before resourceRoutes so "/api/tenders/search" is not read as a tender id.
  for (const register of [accountRoutes, roleRoutes, tenderRoutes, scheduleRoutes, resourceRoutes, summaryRoutes, sourcingRoutes, proposalRoutes, fileRoutes, boqRoutes, billingRoutes, auditRoutes, contactRoutes]) register(router, svc, ctx);
}
