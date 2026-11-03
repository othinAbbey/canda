const bool = (v, d) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(String(v)));
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const list = (v, d) => (v === undefined ? d : String(v).split(",").map((s) => s.trim()).filter(Boolean));

/** Every setting comes from the environment (see .env.example). Nothing else reads process.env. */
export function loadConfig(env = process.env) {
  return {
    databaseUrl: env.DATABASE_URL || "",
    port: num(env.PORT, 8100),
    host: env.HOST || "127.0.0.1",
    corsOrigins: list(env.CORS_ORIGINS, ["http://localhost:3000"]),
    tokenSecret: env.TOKEN_SECRET || "",
    tokenHours: num(env.TOKEN_HOURS, 12),
    allowSignup: bool(env.ALLOW_SIGNUP, true),
    resetMinutes: num(env.RESET_MINUTES, 60),
    maxUploadMb: num(env.MAX_UPLOAD_MB, 25),
    enforcePlanLimits: bool(env.ENFORCE_PLAN_LIMITS, false),
    boq: { url: (env.BOQ_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/+$/, ""), key: env.BOQ_SERVICE_KEY || "" },
    seed: bool(env.SEED, true),
  };
}
