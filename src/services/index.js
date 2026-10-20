import { auditRepo } from "../repos/audit.js";
import { billingRepo } from "../repos/billing.js";
import { boqRepo } from "../repos/boq.js";
import { catalogRepo } from "../repos/catalog.js";
import { filesRepo } from "../repos/files.js";
import { messagesRepo } from "../repos/messages.js";
import { projectStatsRepo } from "../repos/projectStats.js";
import { resourcesRepo } from "../repos/resources.js";
import { usersRepo } from "../repos/users.js";
import { createAccounts } from "./accounts.js";
import { createAudit } from "./audit.js";
import { createBilling } from "./billing.js";
import { createBoq } from "./boq.js";
import { createBoqClient } from "./boqClient.js";
import { createContact } from "./contact.js";
import { createFiles } from "./files.js";
import { createProposals } from "./proposals.js";
import { createResources } from "./resources.js";
import { createSourcing } from "./sourcing.js";
import { createSummary } from "./summary.js";
import { createLimiter } from "../http/rateLimit.js";

/** Builds every service from the database and config. The only place that wires repos to services. */
export function createServices({ db, config, secret, boqClient = createBoqClient(config.boq) }) {
  const users = usersRepo(db), resourcesR = resourcesRepo(db), catalog = catalogRepo(db), auditR = auditRepo(db);
  const audit = createAudit(auditR);
  const limiter = createLimiter({ max: 10, windowMs: 5 * 60_000 });
  const resources = createResources({ repo: resourcesR, audit });
  const billing = createBilling({ billing: billingRepo(db), users, audit, config });
  return {
    audit, resources, billing,
    accounts: createAccounts({ users, audit, config, secret, limiter }),
    summary: createSummary({ resources, stats: projectStatsRepo(db), audit: auditR, files: filesRepo(db) }),
    sourcing: createSourcing({ resources, catalog }),
    proposals: createProposals({ db, catalog, audit }),
    files: createFiles({ files: filesRepo(db), resources, audit, config }),
    boq: createBoq({ boq: boqRepo(db), client: boqClient, billing, audit, config }),
    contact: createContact({ messages: messagesRepo(db), audit, limiter }),
  };
}
