import http from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { sequelize } from './lib/db';
import { logger } from './lib/logger';
import { redis } from './lib/redis';
import { keyStore } from './keys/keyStore';

async function main() {
  await sequelize.authenticate();
  await keyStore.init();
  const app = createApp();
  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000; // above typical LB idle timeout
  server.listen(config.PORT, () => logger.info('auth-server listening', { port: config.PORT, env: config.NODE_ENV }));

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown started', { signal });
    // Hard deadline: exit within 10 s no matter what.
    setTimeout(() => {
      logger.error('forced shutdown after 10s');
      process.exit(1);
    }, 10_000).unref();
    keyStore.stop();
    // Stop accepting; in-flight requests finish; idle keep-alive sockets are closed.
    server.close(async () => {
      try {
        await sequelize.close();
        await redis.quit();
        logger.info('shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error('error during shutdown', { err });
        process.exit(1);
      }
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', { reason }));

main().catch((err) => {
  logger.error('failed to start', { err });
  process.exit(1);
});
