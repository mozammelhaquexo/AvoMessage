/**
 * Prisma client singleton (Prisma 7: driver adapter required).
 *
 * One client per server process; reused across hot-reloads in dev via
 * globalThis. All database access in lib/* and route handlers goes through
 * this module — never construct PrismaClient elsewhere.
 *
 * NOTE: requires `@prisma/adapter-pg` (DB agent: `npm i @prisma/adapter-pg`).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
