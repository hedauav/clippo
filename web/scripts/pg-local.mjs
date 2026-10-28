// `npm run db:local` — dev Postgres on :5433 persisted in .pgdata (no Docker/Postgres install needed). NOT for production.
import { startLocalPg } from "./pg-local-lib.mjs";

const port = Number(process.argv[2] ?? 5433);
const dir = process.argv[3] ?? ".pgdata";
const s = await startLocalPg({ port, dataDir: dir });
console.log(`local postgres (PGlite) on ${s.url}`);
process.on("SIGINT", async () => {
  await s.stop();
  process.exit(0);
});
