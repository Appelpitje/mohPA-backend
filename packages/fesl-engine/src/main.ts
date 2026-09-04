import { FeslEngineServer } from './server.js';

async function main() {
  const server = new FeslEngineServer();

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    try {
      await server.stop();
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await server.start();
  } catch (err) {
    console.error('Fatal error starting FeslEngineServer:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled bootstrap exception:', err);
  process.exit(1);
});
