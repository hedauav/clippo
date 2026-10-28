import { exec } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(exec);
import { startLocalPg } from "../../scripts/pg-local-lib.mjs";

export const TEST_PG_PORT = 5439;

/**
 * Tests run against a throwaway in-process Postgres (PGlite over the wire protocol) so they exercise the SAME
 * Postgres schema + migrations as production. Set TEST_DATABASE_URL to use a real Postgres instead (must be an empty, disposable database).
 */
export default async function setup() {
  const external = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;
  let url = external;
  if (!url) {
    const s = await startLocalPg({ port: TEST_PG_PORT });
    url = s.url;
    stop = s.stop;
  }
  process.env.DATABASE_URL = url;
  // async exec: the in-process PGlite server must keep serving the event loop while prisma connects
  await run("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url } });
  return async () => {
    await stop?.();
  };
}
