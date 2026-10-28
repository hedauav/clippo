import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };

/**
 * One PrismaClient per server instance (kept on globalThis in every environment so HMR and warm serverless instances reuse it).
 * Serverless: use the Neon POOLED url in DATABASE_URL with `?pgbouncer=true&connection_limit=5` (see docs/DEPLOY_ENV.md);
 * migrations use DIRECT_URL (scripts/migrate-deploy.mjs), never the pooler.
 */
export const db = g.prisma ?? new PrismaClient();
g.prisma = db;
