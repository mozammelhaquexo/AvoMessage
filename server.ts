/**
 * server.ts — AvoMessage custom server: Next.js + Socket.io on one HTTP port.
 *
 *   dev (realtime):   tsx server.ts
 *   dev (plain Next): npm run dev:next        (no realtime; fast refresh only)
 *   prod (tsx):       npm start               (NODE_ENV=production tsx server.ts)
 *   prod (compiled):  npm run build:server && npm run start:compiled
 *
 * The Socket.io server is attached to the SAME http.Server that serves Next,
 * so there is exactly one port to deploy (default 3000, $PORT overrides).
 * If the `socket.io` package is missing, the server still boots and serves
 * HTTP with realtime disabled (loud warning) — `attachRealtime` handles that.
 *
 * In-process background work (ARCHITECTURE.md §8): a 60s presence sweep
 * (offline backstop). Token/invitation cleanup lives with the DB agent's
 * scheduler; this timer only covers realtime state.
 */
import { createServer } from 'node:http';
import next from 'next';
import { attachRealtime } from './lib/realtime/server.js';

async function main(): Promise<void> {
  const dev = process.env.NODE_ENV !== 'production';
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const hostname = process.env.HOSTNAME ?? '0.0.0.0';

  const app = next({ dev, dir: process.cwd() });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error('[http] request handler error:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });
  });

  const realtime = attachRealtime(server);

  // Presence sweep: backstop for sockets that vanished without a clean
  // disconnect (crashed tabs, killed mobile apps).
  const sweepTimer = setInterval(() => {
    realtime
      ?.sweepPresence()
      .catch((err: unknown) =>
        console.error('[realtime] presence sweep failed:', err),
      );
  }, 60_000);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

  server.listen(port, hostname, () => {
    console.log(
      `> AvoMessage ready on http://${hostname}:${port} ` +
        `(${dev ? 'development' : 'production'})` +
        ` — realtime ${realtime ? 'ENABLED' : 'DISABLED'}`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`\n[server] ${signal} — shutting down…`);
    clearInterval(sweepTimer);
    realtime?.close();
    server.close(() => process.exit(0));
    // Force-exit if connections linger.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
