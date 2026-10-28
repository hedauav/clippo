// Local Postgres-compatible server (PGlite over the wire protocol) for dev/tests when no real Postgres is available.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export async function startLocalPg({ port = 5433, dataDir } = {}) {
  const db = await PGlite.create(dataDir);
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  return {
    db,
    server,
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true&sslmode=disable`,
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}
