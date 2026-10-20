// Maintenance commands:  npm run migrate | npm run seed | npm run reset-admin -- someone@example.com
import crypto from "node:crypto";
import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { seedIfEmpty } from "./seed.js";
import { sha256 } from "./auth/passwords.js";
import { usersRepo } from "./repos/users.js";

try { process.loadEnvFile(".env"); } catch { /* use the real environment */ }
const config = loadConfig();
const [cmd, arg] = process.argv.slice(2);
const db = await createDb(config);
try {
  if (cmd === "migrate") await migrate(db, console.log);
  else if (cmd === "seed") { await migrate(db); await seedIfEmpty(db); console.log("seeded"); }
  else if (cmd === "reset-admin") {
    const users = usersRepo(db), u = await users.byEmail(String(arg || "").trim().toLowerCase());
    if (!u) throw new Error("No user with that email. Usage: npm run reset-admin -- you@example.com");
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
    await users.replaceReset(u.id, sha256(raw), new Date(Date.now() + config.resetMinutes * 60_000).toISOString());
    console.log(`Reset code for ${u.email}: ${raw.slice(0, 5)}-${raw.slice(5)}  (valid ${config.resetMinutes} minutes). Use it on the "Forgot your password?" page.`);
  } else { console.log("Commands: migrate | seed | reset-admin <email>"); }
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await db.close(); }
