import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./http/app.js";
import { seedIfEmpty } from "./seed.js";

try { process.loadEnvFile(".env"); } catch { /* no .env file: use the real environment */ }
const config = loadConfig();

const db = await createDb(config);
await migrate(db, (m) => console.log(m));
if (config.seed) await seedIfEmpty(db);

const app = await createApp({ db, config });
app.server.listen(config.port, config.host, () => console.log(`C & A API on http://${config.host}:${config.port}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await app.close(); await db.close(); process.exit(0); });
