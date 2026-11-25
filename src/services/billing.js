import { HttpError, ValidationError, notFound } from "../errors.js";
import { now } from "../ids.js";

const LIMIT_KEY = { boq_job: "boq_jobs_per_month" };
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

/**
 * Subscription PLACEHOLDERS. Plans and usage are recorded from day one so billing can be added later without a data migration.
 * Nothing is charged. Limits are only enforced when ENFORCE_PLAN_LIMITS=true.
 */
export function createBilling({ billing, users, audit, config }) {
  async function current(userId) {
    await billing.ensure(userId, now());
    const sub = await billing.subscription(userId);
    return { sub, plan: await billing.plan(sub.plan_code) };
  }
  return {
    async planOf(user) { const { plan } = await current(user.id); return { code: plan.code, name: plan.name }; },
    async overview(user) {
      const { sub, plan } = await current(user.id);
      const used = await billing.usageSince(user.id, "boq_job", monthStart());
      return {
        billing_enabled: false,                                   // flips to true when payments are connected
        plan: { code: plan.code, name: plan.name, price_monthly: plan.price_monthly, currency: plan.currency, limits: plan.limits },
        status: sub.status, current_period_end: sub.current_period_end,
        usage: { boq_jobs_this_month: used }, limits_enforced: config.enforcePlanLimits,
        available_plans: await billing.plans(),
      };
    },
    /** Called before a metered action. Does nothing unless enforcement is switched on. */
    async assertWithinLimit(user, kind) {
      if (!config.enforcePlanLimits) return;
      const { plan } = await current(user.id);
      const limit = plan.limits[LIMIT_KEY[kind]];
      if (limit === undefined || limit === null) return;
      if ((await billing.usageSince(user.id, kind, monthStart())) >= limit) throw new HttpError(402, `Your ${plan.name} plan allows ${limit} per month. Upgrade to continue.`);
    },
    async record(user, kind) { await billing.recordUsage(user.id, kind, now()); },
    checkout() { throw new HttpError(501, "Subscriptions are not available yet."); },
    async setPlan(admin, userId, code) {
      if (!(await users.byId(userId))) throw notFound("user not found");
      if (!(await billing.plan(code))) throw new ValidationError("unknown plan");
      await billing.ensure(userId, now());
      const sub = await billing.setPlan(userId, code, now());
      await audit.log(admin, { action: "update", entity: "subscriptions", id: userId, summary: `plan set to ${code}` });
      return sub;
    },
  };
}
