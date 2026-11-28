import { teamEmails } from "./auth/team.js";
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
    // The AI that reads bid documents (Claude). Without a key the built-in reader handles web-page text only.
    ai: {
      apiKey: env.ANTHROPIC_API_KEY || "",
      model: env.AI_MODEL || "claude-sonnet-5-5",
      autoRead: bool(env.AI_AUTO_READ, true),        // start reading when a tender is marked interested
      delayMs: num(env.AI_READ_DELAY_MS, 3000),
      assistantModel: env.AI_ASSISTANT_MODEL || "claude-haiku-5-5",   // everyday questions: the smaller, cheaper model
      monthlyQuestions: num(env.AI_MONTHLY_QUESTIONS, 1000),          // per company per month; 0 = no limit
      chatBot: bool(env.AI_CHAT_BOT, true),                          // the bot reads project chat rooms and drafts site logs / issues
      monthlyChatReads: num(env.AI_MONTHLY_CHAT_READS, 3000),         // chat messages the bot reads per company per month; 0 = no limit
    },
    // Voiceovers for the team's adverts: Microsoft Azure text to speech. Off unless a key and region are set.
    speech: {
      key: (env.AZURE_SPEECH_KEY || "").trim(),
      region: (env.AZURE_SPEECH_REGION || "").trim().toLowerCase().replace(/\s+/g, ""),
      voice: (env.AZURE_SPEECH_VOICE || "en-KE-AsiliaNeural").trim(),        // Asilia: female, Kenyan English
      endpoint: (env.AZURE_SPEECH_ENDPOINT || "").trim(),                    // only to point tests at a stand-in
    },
    // The Buildsuite360 team (adverts and daily social posts): only these sign-in emails, whatever their role.
    teamEmails: teamEmails(env),
    social: {
      auto: bool(env.SOCIAL_AUTO, true),            // make a draft each morning
      hour: num(env.SOCIAL_HOUR, 6),                 // from this hour, Kampala time (UTC+3)
      country: (env.SOCIAL_COUNTRY || "Uganda").trim(),
    },
    // Tender feeds, all on by default (set to false to switch one off). The *_URL settings only move a feed's address.
    tenderFeeds: {
      afdb: bool(env.AFDB_FEED, true),
      afdbUrl: (env.AFDB_FEED_URL || "").trim() || undefined,
      undp: bool(env.UNDP_FEED, true),
      undpBase: (env.UNDP_FEEDS_URL || "").trim() || undefined,
      egp: bool(env.EGP_FEED, true),                // Uganda's eGP portal (egpuganda.go.ug), read from its public pages
      egpBase: (env.EGP_URL || "").trim() || undefined,
    },
  };
}
