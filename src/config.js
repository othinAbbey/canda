const bool = (v, d) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(String(v)));
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const list = (v, d) => (v === undefined ? d : String(v).split(",").map((s) => s.trim()).filter(Boolean));

/** Every setting comes from the environment (see .env.example). Nothing else reads process.env. */
export function loadConfig(env = process.env) {
  return {
    databaseUrl: env.DATABASE_URL || "",
    // "true" = always encrypt, "false" = never; unset = encrypt unless the database is on this machine or on
    // Render's private network (internal hostnames like dpg-xxxx-a have no dot). Hosted databases require SSL.
    dbSsl: env.PGSSL === undefined || env.PGSSL === "" ? "auto" : bool(env.PGSSL, false),
    port: num(env.PORT, 8100),
    // Render (and most hosts) only route traffic to a server listening on all interfaces.
    host: env.HOST || (env.RENDER ? "0.0.0.0" : "127.0.0.1"),
    corsOrigins: list(env.CORS_ORIGINS, ["http://localhost:3000","https://buildsuite360.org","https://www.buildsuite360.org"]),
    tokenSecret: env.TOKEN_SECRET || "",
    tokenHours: num(env.TOKEN_HOURS, 12),
    allowSignup: bool(env.ALLOW_SIGNUP, true),
    resetMinutes: num(env.RESET_MINUTES, 60),
    maxUploadMb: num(env.MAX_UPLOAD_MB, 25),
    enforcePlanLimits: bool(env.ENFORCE_PLAN_LIMITS, false),
    boq: { url: (env.BOQ_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/+$/, ""), key: env.BOQ_SERVICE_KEY || "" },
    seed: bool(env.SEED, true),
    // Tender feeds, all on by default (set to false to switch one off). The *_URL settings only move a feed's address.
    tenderFeeds: {
      afdb: bool(env.AFDB_FEED, true),
      afdbUrl: (env.AFDB_FEED_URL || "").trim() || undefined,
      undp: bool(env.UNDP_FEED, true),
      undpBase: (env.UNDP_FEEDS_URL || "").trim() || undefined,
    },
  };
}
