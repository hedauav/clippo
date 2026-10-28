import type { PrismaClient } from "@prisma/client";

/** Truncates every table of the (throwaway) test database so a test file starts from a clean slate. */
export async function resetDb(db: PrismaClient) {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
  if (rows.length === 0) return;
  await db.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}
