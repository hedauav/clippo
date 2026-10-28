import { defineConfig } from "vitest/config";
import path from "node:path";

// DB-backed tests run against a throwaway Postgres (see src/test/global-setup.ts). Never a dev/prod database.
const testDb = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5439/postgres?connection_limit=1&pgbouncer=true&sslmode=disable";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globalSetup: ["src/test/global-setup.ts"],
    env: { DATABASE_URL: testDb },
    fileParallelism: false,
    testTimeout: 30000,
  },
});
