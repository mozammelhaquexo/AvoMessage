// Prisma 7 config: owns the datasource URL for CLI commands (migrate, db pull…).
// Runtime code (lib/db.ts, prisma/seed.ts) must pass a driver adapter to
// `new PrismaClient({ adapter })` — see .env.example / DB agent report.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
