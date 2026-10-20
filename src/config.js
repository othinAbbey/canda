const bool = (v, d) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(String(v)));
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const list = (v, d) => (v === undefined ? d : String(v).split(",").map((s) => s.trim()).filter(Boolean));

/** Every setting comes from the environment (see .env.example). Nothing else reads process.env. */
export function loadConfig(env = process.env) {
  return {
    databaseUrl: env.DATABASE_URL || "",
    port: num(env.PM_PORT, 8100),
    host: env.PM_HOST || "0.0.0.0",
    corsOrigins: list(env.PM_CORS_ORIGINS),
    tokenSecret: env.TOKEN_SECRET || "",
    tokenHours: num(env.PM_TOKEN_HOURS, 12),
    allowSignup: bool(env.PM_ALLOW_SIGNUP, true),
    resetMinutes: num(env.PM_RESET_MINUTES, 60),
    maxUploadMb: num(env.PM_MAX_UPLOAD_MB, 25),
    enforcePlanLimits: bool(env.PM_ENFORCE_PLAN_LIMITS, false),
    boq: { url: (env.BOQ_SERVICE_URL).replace(/\/+$/, ""), key: env.BOQ_SERVICE_KEY || "" },
    seed: bool(env.SEED, true),
  };
}
