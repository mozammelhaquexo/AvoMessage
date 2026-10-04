/**
 * Prisma client singleton (Prisma 7: driver adapter required).
 *
 * One client per server process; reused across hot-reloads in dev AND across
 * warm invocations of a serverless function, via globalThis.
 *
 * LAZY ON PURPOSE. The client used to be built at module scope:
 *
 *     export const prisma = createClient();   // throws if DATABASE_URL is unset
 *
 * which meant that merely *importing* this module threw when the env var was
 * missing. Every route that transitively imports `prisma` — including
 * `POST /api/auth/login`, which never touches a table until the DB call — died
 * with "Internal server error" before it could even read the request body, and
 * `next build` could fail while prerendering. The symptom looks like "the login
 * endpoint is broken"; the cause is a missing deployment env var.
 *
 * The exported value is now a Proxy that constructs the real client on first
 * property access. Consequences:
 *   - importing this module never throws;
 *   - the failure surfaces at the first actual query, with a message that says
 *     what to do about it;
 *   - routes that do not query the database keep working.
 *
 * All database access in lib/* and route handlers goes through this module —
 * never construct PrismaClient elsewhere (the one exception is prisma/seed.ts,
 * which is a standalone CLI script).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Add a Postgres connection string to the ' +
        'environment: locally in .env (see .env.example; `node scripts/dev-db.mjs` ' +
        'starts the embedded cluster), and on Vercel under Project Settings -> ' +
        'Environment Variables. Use the Supabase *pooler* string for serverless ' +
        'hosts, and run supabase.sql once so the schema exists.',
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing) return existing;
  const client = createClient();
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Property names that Node, React or JSON reach for while merely *inspecting* a
 * value. They are answered here, without touching the client, so that logging,
 * `String()`, `JSON.stringify`, spreading and `await` can never construct the
 * client (and therefore never throw) just to describe it. Anything not listed
 * is a genuine request for the client surface, where throwing is correct.
 */
const INSPECTION_PROPS: Record<string, unknown> = {
  then: undefined, // not a thenable: `await prisma` must not call .then()
  catch: undefined,
  finally: undefined,
  toJSON: () => ({}),
  inspect: undefined,
  toString: () => '[prisma client (lazy)]',
  valueOf: () => undefined,
  constructor: undefined,
};

/**
 * Proxy over the real client. Property access is forwarded lazily; methods are
 * bound to the real client so `prisma.$transaction(...)`, destructured helpers
 * and `prisma.user.findMany` all keep working unchanged.
 *
 * `Reflect.get` is called WITHOUT the receiver argument on purpose: the
 * delegates (`prisma.user`, …) are getters on the client instance, and they must
 * see the real client as `this`, not the proxy.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (typeof prop === 'symbol') return undefined;
    if (prop in INSPECTION_PROPS) return INSPECTION_PROPS[prop];
    const client = getClient();
    const value = Reflect.get(client, prop);
    return typeof value === 'function' ? value.bind(client) : value;
  },
  has(_target, prop) {
    if (typeof prop === 'symbol' || prop in INSPECTION_PROPS) return false;
    return prop in getClient();
  },
});

export default prisma;
