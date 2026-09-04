/**
 * @centralspy/api-service - Server Startup Entry Point
 */

import dotenv from 'dotenv';
import { getDbClient, runMigrations, closeDbClient } from '@centralspy/db';
import { buildServer } from './server.js';

dotenv.config();

export * from './server.js';
export * from './websocket/inspector.js';

async function start() {
  const port = parseInt(process.env.API_PORT || '3000', 10);
  const host = process.env.API_HOST || '0.0.0.0';

  console.log('[API Service] Initializing database connection...');
  const db = await getDbClient();

  console.log('[API Service] Running pending database migrations...');
  await runMigrations(db);

  console.log('[API Service] Building Fastify application...');
  const server = await buildServer({ db, logger: true });

  try {
    await server.listen({ port, host });
    console.log(`[API Service] CentralSpy API Service running at http://${host}:${port}`);
    console.log(`[API Service] WebSocket live inspector listening at ws://${host}:${port}/ws/inspector`);
  } catch (err: any) {
    server.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`\n[API Service] Received ${signal}. Shutting down gracefully...`);
      try {
        await server.close();
        await closeDbClient();
        console.log('[API Service] Graceful shutdown complete.');
        process.exit(0);
      } catch (err) {
        console.error('[API Service] Error during shutdown:', err);
        process.exit(1);
      }
    });
  }
}

// Auto-start if executed directly
if (process.argv[1] && (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js') || process.argv[1].endsWith('server.ts'))) {
  start().catch((err) => {
    console.error('[API Service] Fatal startup error:', err);
    process.exit(1);
  });
}
